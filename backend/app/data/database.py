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
            **{k: f[k] for k in ("distance", "speed", "rpm", "gear",
                                 "throttle", "brake", "drs", "time_s",
                                 "anomaly_score")},
        })
    try:
        # idempotency: wipe any previous copy of this exact lap first
        await db[config.TELEMETRY_COLLECTION].delete_many(
            {"meta": docs[0]["meta"]})
        await db[config.TELEMETRY_COLLECTION].insert_many(docs)
    except PyMongoError as exc:
        log.warning("Mongo write failed: %s", exc)


async def get_saved_laps() -> list[dict]:
    """Distinct lap descriptors stored so far (history browser endpoint)."""
    if not _available:
        return []
    db = _client[config.MONGO_DB_NAME]
    try:
        cursor = db[config.TELEMETRY_COLLECTION].aggregate([
            {"$group": {"_id": "$meta"}},
            {"$replaceRoot": {"newRoot": "$_id"}},
        ])
        return [doc async for doc in cursor]
    except PyMongoError:
        return []
