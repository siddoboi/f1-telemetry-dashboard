"""
Export - CSV bundle and PDF lap report for the currently loaded comparison.

CSV export = a ZIP with two files:
  telemetry.csv  one row per 5 m step, every driver's channels side by side
  events.csv     one row per anomaly event incl. entry/exit channel values

PDF export = multi-page A4 portrait, monochrome (prints clean in greyscale):
  page 1   header, ML-vs-rules validation, per-driver channel statistics
  page 2+  anomaly events, each with entry/exit/change for the channels
           relevant to its label (all four channels are in the CSV).
"""
import io
import zipfile
from datetime import datetime

import numpy as np
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

STAT_CHANNELS = ["speed", "throttle", "brake", "rpm"]
UNITS = {"speed": "km/h", "throttle": "%", "brake": "%", "rpm": ""}
RELEVANT = {
    "Possible lock-up": ["speed", "brake", "rpm"],
    "Traction loss / wheelspin": ["speed", "throttle", "rpm"],
    "Throttle instability": ["speed", "throttle"],
    "Mid-corner stability loss": ["speed", "throttle"],
}


# --------------------------------------------------------------------------
# shared helpers
# --------------------------------------------------------------------------
def _at_distance(df: pd.DataFrame, distance: float) -> pd.Series:
    """Row nearest to a given distance (grid is uniform & sorted)."""
    idx = int(np.searchsorted(df["distance"].to_numpy(), distance))
    return df.iloc[min(idx, len(df) - 1)]


def event_channel_stats(df: pd.DataFrame, event: dict) -> dict:
    """Entry/exit/change plus in-range min/max for every stat channel.
    Entry/exit alone miss V-shaped excursions (dip-and-recover inside the
    event), so min/max across the range are reported too."""
    start = _at_distance(df, event["start_distance"])
    end = _at_distance(df, event["end_distance"])
    rng = df[(df["distance"] >= event["start_distance"])
             & (df["distance"] <= event["end_distance"])]
    if rng.empty:
        rng = df.iloc[[0]]
    out = {}
    for ch in STAT_CHANNELS:
        e, x = float(start[ch]), float(end[ch])
        out[ch] = {"entry": round(e, 1), "exit": round(x, 1),
                   "change": round(x - e, 1),
                   "min": round(float(rng[ch].min()), 1),
                   "max": round(float(rng[ch].max()), 1)}
    return out


def _driver_stats(df: pd.DataFrame) -> dict:
    return {
        "top_speed": round(float(df["speed"].max()), 1),
        "mean_throttle": round(float(df["throttle"].mean()), 1),
        "brake_pct": round(float((df["brake"] > 50).mean() * 100), 1),
        "rpm_min": int(df["rpm"].min()),
        "rpm_max": int(df["rpm"].max()),
        "flagged_pct": round(float(df["anomaly"].mean() * 100), 1)
        if "anomaly" in df else 0.0,
    }


# --------------------------------------------------------------------------
# CSV bundle
# --------------------------------------------------------------------------
def build_csv_zip(meta: dict, scored_laps: dict[str, pd.DataFrame]) -> bytes:
    # telemetry.csv - merge on the distance grid
    frames = []
    export_cols = STAT_CHANNELS + ["gear", "drs",
                                   "anomaly_score", "anomaly_label", "delta"]
    for drv, df in scored_laps.items():
        sub = df[["distance"] + [c for c in export_cols if c in df.columns]]
        sub = sub.set_index("distance")
        sub.columns = [f"{drv}_{c}" for c in sub.columns]
        frames.append(sub)
    telemetry = pd.concat(frames, axis=1).sort_index().reset_index()

    # events.csv - one row per event with entry/exit values, all channels
    rows = []
    for ev in meta.get("events", []):
        df = scored_laps.get(ev["driver"])
        if df is None:
            continue
        stats = event_channel_stats(df, ev)
        row = {"driver": ev["driver"],
               "start_m": ev["start_distance"], "end_m": ev["end_distance"],
               "label": ev["label"], "peak_score": ev["peak_score"],
               "diagnosis": ev["diagnosis"]}
        for ch in STAT_CHANNELS:
            row[f"{ch}_entry"] = stats[ch]["entry"]
            row[f"{ch}_exit"] = stats[ch]["exit"]
            row[f"{ch}_change"] = stats[ch]["change"]
            row[f"{ch}_min"] = stats[ch]["min"]
            row[f"{ch}_max"] = stats[ch]["max"]
        rows.append(row)
    events = pd.DataFrame(rows)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("telemetry.csv", telemetry.to_csv(index=False))
        z.writestr("events.csv", events.to_csv(index=False))
    return buf.getvalue()


# --------------------------------------------------------------------------
# PDF report
# --------------------------------------------------------------------------
GREY = colors.HexColor("#555555")
LIGHT = colors.HexColor("#EEEEEE")

_tbl_style = TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
    ("FONTSIZE", (0, 0), (-1, -1), 8),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
    ("GRID", (0, 0), (-1, -1), 0.4, GREY),
    ("TOPPADDING", (0, 0), (-1, -1), 3),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
])


def build_pdf(meta: dict, scored_laps: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title="PIT WALL lap report")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=15,
                        spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontSize=8.5,
                         textColor=GREY, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11,
                        spaceBefore=12, spaceAfter=4)
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=8.5,
                          leading=11)

    story = [Paragraph("PIT WALL - Lap Comparison Report", h1)]

    # header line
    drivers = meta.get("drivers", {})
    mode = meta.get("mode", "replay")
    header_bits = [f"Generated {datetime.now():%Y-%m-%d %H:%M}",
                   f"mode: {mode}",
                   f"baseline: {meta.get('baseline_mode')}"]
    if meta.get("baseline_owner"):
        header_bits.append(f"baseline lap: {meta['baseline_owner']} "
                           f"{meta.get('baseline_lap_time', '')}")
    story.append(Paragraph(" · ".join(header_bits), sub))

    # drivers table
    rows = [["Driver", "Lap", "Lap time", "vs baseline"]]
    for key, info in drivers.items():
        rows.append([key, str(info.get("lap_number", "")),
                     info.get("lap_time", ""),
                     f"{info.get('baseline_driver') or '-'} "
                     f"{info.get('baseline_lap_time') or ''}"])
    t = Table(rows, colWidths=[60, 50, 80, 160])
    t.setStyle(_tbl_style)
    story += [t]

    # validation metrics
    validation = meta.get("validation", {})
    if validation:
        story.append(Paragraph("ML vs physics-rules validation", h2))
        rows = [["Driver", "ML flags", "Rule flags", "Agreement",
                 "Precision", "Recall"]]
        for drv, v in validation.items():
            pct = lambda x: f"{x*100:.0f}%" if x is not None else "-"
            rows.append([drv, v["ml_flagged"], v["rules_flagged"],
                         v["agreement"], pct(v["precision_vs_rules"]),
                         pct(v["recall_vs_rules"])])
        t = Table(rows, colWidths=[60, 60, 60, 60, 60, 60])
        t.setStyle(_tbl_style)
        story += [t]

    # per-driver channel statistics
    story.append(Paragraph("Channel statistics (full lap)", h2))
    rows = [["Driver", "Top speed", "Mean throttle", "Braking",
             "RPM range", "Frames flagged"]]
    for drv, df in scored_laps.items():
        s = _driver_stats(df)
        rows.append([drv, f"{s['top_speed']} km/h",
                     f"{s['mean_throttle']} %", f"{s['brake_pct']} % of lap",
                     f"{s['rpm_min']}–{s['rpm_max']}",
                     f"{s['flagged_pct']} %"])
    t = Table(rows, colWidths=[55, 70, 75, 75, 90, 75])
    t.setStyle(_tbl_style)
    story += [t]

    # anomaly events with entry/exit channel stats
    events = meta.get("events", [])
    story.append(Paragraph(f"Anomaly events ({len(events)})", h2))
    if not events:
        story.append(Paragraph("No anomalies flagged.", body))
    for i, ev in enumerate(events, 1):
        df = scored_laps.get(ev["driver"])
        block = [Paragraph(
            f"<b>{i}. {ev['driver']} · {ev['label']}</b> &nbsp; "
            f"{ev['start_distance']:.0f}–{ev['end_distance']:.0f} m · "
            f"peak score {ev['peak_score']:.2f}", body),
            Paragraph(ev["diagnosis"], sub)]
        if df is not None:
            stats = event_channel_stats(df, ev)
            chans = RELEVANT.get(ev["label"], STAT_CHANNELS)
            rows = [["Channel", "Entry", "Exit", "Change", "Range (min–max)"]]
            for ch in chans:
                u = UNITS[ch]
                s = stats[ch]
                sign = "+" if s["change"] > 0 else ""
                rows.append([ch.upper(),
                             f"{s['entry']} {u}".strip(),
                             f"{s['exit']} {u}".strip(),
                             f"{sign}{s['change']} {u}".strip(),
                             f"{s['min']}–{s['max']} {u}".strip()])
            t = Table(rows, colWidths=[70, 75, 75, 75, 110])
            t.setStyle(_tbl_style)
            block.append(t)
        block.append(Spacer(0, 8))
        story.append(KeepTogether(block))

    story.append(Paragraph(
        "Unofficial educational project - not associated with Formula 1 or "
        "the FIA. Data via FastF1/OpenF1.", sub))
    doc.build(story)
    return buf.getvalue()
