"""
MongoDB Time-Series storage.

Design notes
------------
* Collection is created with `timeseries={timeField, metaField}` so MongoDB
  buckets frames automatically and range queries stay fast.
* `metaField` holds {year, round, session, driver, lap} - everything you
  filter by. `timeField` is a synthetic timestamp derived from lap time.
* The app DEGRADES GRACEFULLY: if MongoDB is not running, everything still
  works (live replay does not need the DB); you just lose history persistence.
"""
import logging
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import CollectionInvalid, PyMongoError

from app import config

log = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_available = False


async def connect() -> None:
    """Called on app startup. Never raises - sets availability flag instead."""
    global _client, _available
    try:
        _client = AsyncIOMotorClient(config.MONGO_URI,
                                     serverSelectionTimeoutMS=2000)
        await _client.admin.command("ping")
        db = _client[config.MONGO_DB_NAME]
        try:
            await db.create_collection(
                config.TELEMETRY_COLLECTION,
                timeseries={"timeField": "ts",
                            "metaField": "meta",
                            "granularity": "seconds"},
            )
        except CollectionInvalid:
            pass  # already exists
        _available = True
        log.info("MongoDB connected: %s", config.MONGO_URI)
    except PyMongoError as exc:
        _available = False
        log.warning("MongoDB unavailable (%s). Running without persistence.",
                    exc.__class__.__name__)


def is_available() -> bool:
    return _available


SCHEMA_VERSION = 2          # bump when the stored shape changes

# Per-frame fields persisted for re-serving. v2 adds x/y (GPS),
# anomaly_label and delta so history mode can render the track map and the
# original events/delta without re-running FastF1 or the ML model.
_FRAME_FIELDS = ("distance", "speed", "rpm", "gear", "throttle", "brake",
                 "drs", "time_s", "anomaly_score", "anomaly", "anomaly_label",
                 "x", "y", "delta")


async def save_lap_frames(year: int, rnd: int, session: str, driver: str,
                          lap_number: int, frames: list[dict]) -> None:
    """Persist one aligned lap so it can be re-served without FastF1."""
    if not _available or not frames:
        return
    db = _client[config.MONGO_DB_NAME]
    base_ts = datetime.now(timezone.utc)
    docs = []
    for f in frames:
        docs.append({
            "ts": base_ts + timedelta(seconds=float(f["time_s"])),
            "meta": {"year": year, "round": rnd, "session": session,
                     "driver": driver, "lap": lap_number},
            **{k: f[k] for k in _FRAME_FIELDS if k in f},
        })
    try:
        # idempotency: wipe any previous copy of this exact lap first
        await db[config.TELEMETRY_COLLECTION].delete_many(
            {"meta": docs[0]["meta"]})
        await db[config.TELEMETRY_COLLECTION].insert_many(docs)
    except PyMongoError as exc:
        log.warning("Mongo write failed: %s", exc)


async def save_lap_meta(year: int, rnd: int, session: str, driver: str,
                        lap_number: int, meta: dict) -> None:
    """Persist per-lap metadata (events, baseline arrays, driver color, lap
    time) in a plain collection keyed by the same descriptor. Lets history
    mode skip the Isolation Forest and re-use the original events/baseline.
    Schema-versioned so older v1 laps (frames only) still load via fallback."""
    if not _available:
        return
    db = _client[config.MONGO_DB_NAME]
    key = {"year": year, "round": rnd, "session": session,
           "driver": driver, "lap": lap_number}
    doc = {"_id": _meta_id(key), "key": key,
           "schema_version": SCHEMA_VERSION, **meta}
    try:
        await db[config.SESSION_META_COLLECTION].replace_one(
            {"_id": doc["_id"]}, doc, upsert=True)
    except PyMongoError as exc:
        log.warning("Mongo meta write failed: %s", exc)


async def load_lap_meta(year: int, rnd: int, session: str, driver: str,
                        lap: int) -> dict | None:
    """Return stored per-lap meta (v2) or None if absent (v1 / not cached)."""
    if not _available:
        return None
    db = _client[config.MONGO_DB_NAME]
    key = {"year": year, "round": rnd, "session": session,
           "driver": driver, "lap": lap}
    try:
        return await db[config.SESSION_META_COLLECTION].find_one(
            {"_id": _meta_id(key)}, projection={"_id": 0})
    except PyMongoError as exc:
        log.warning("Mongo meta read failed: %s", exc)
        return None


def _meta_id(key: dict) -> str:
    return (f'{key["year"]}_{key["round"]}_{key["session"]}'
            f'_{key["driver"]}_{key["lap"]}')


async def load_lap_frames(year: int, rnd: int, session: str, driver: str,
                          lap: int) -> list[dict]:
    """Phase 3: read one saved lap's frames back, sorted by distance,
    without touching FastF1. Returns [] when unavailable."""
    if not _available:
        return []
    db = _client[config.MONGO_DB_NAME]
    try:
        cursor = db[config.TELEMETRY_COLLECTION].find(
            {"meta.year": year, "meta.round": rnd, "meta.session": session,
             "meta.driver": driver, "meta.lap": lap},
            projection={"_id": 0, "ts": 0, "meta": 0},
        ).sort("distance", 1)
        return [doc async for doc in cursor]
    except PyMongoError as exc:
        log.warning("Mongo read failed: %s", exc)
        return []


async def get_saved_laps() -> list[dict]:
    """Distinct lap descriptors stored so far (history browser endpoint).
    Each descriptor is annotated with schema_version: 2 if a v2 meta document
    exists for it, else 1 (frames-only legacy lap)."""
    if not _available:
        return []
    db = _client[config.MONGO_DB_NAME]
    try:
        cursor = db[config.TELEMETRY_COLLECTION].aggregate([
            {"$group": {"_id": "$meta"}},
            {"$replaceRoot": {"newRoot": "$_id"}},
        ])
        laps = [doc async for doc in cursor]
        # which of these have a v2 meta doc?
        v2_ids = set()
        meta_cursor = db[config.SESSION_META_COLLECTION].find(
            {}, projection={"_id": 1})
        async for m in meta_cursor:
            v2_ids.add(m["_id"])
        for lap in laps:
            lap["schema_version"] = 2 if _meta_id(lap) in v2_ids else 1
        return laps
    except PyMongoError:
        return []
