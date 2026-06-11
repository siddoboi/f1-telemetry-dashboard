"""
Physics-rule engine.

These rules serve two purposes:
1. WEAK GROUND TRUTH - the Isolation Forest is unsupervised; we judge whether
   its flags are sensible by checking agreement with these physics rules.
2. EVENT LABELLING - when the ML flags a region, the dominant rule firing in
   that region supplies the human-readable diagnosis text.

All thresholds operate on the uniform 5 m distance grid, so a gradient of
"x per step" means "x per 5 metres travelled".
"""
import numpy as np
import pandas as pd

# Tunable thresholds (per 5 m step unless noted)
LOCKUP_DECEL_KMH = 9.0        # speed drop per step while braking hard
WHEELSPIN_RPM_JUMP = 320.0    # RPM jump per step w/o matching acceleration
WHEELSPIN_SPEED_GAIN = 1.2    # km/h per step considered "matching" accel
THROTTLE_OSC_STD = 16.0       # rolling std of throttle = pedal instability
SNAP_THROTTLE_LIFT = 28.0     # sudden mid-corner lift (% per step)


def apply_rules(df: pd.DataFrame) -> pd.DataFrame:
    """Returns df with boolean rule columns + a combined `rule_label` column."""
    out = df.copy()
    d_speed = np.gradient(out["speed"].to_numpy())
    d_rpm = np.gradient(out["rpm"].to_numpy())
    d_throttle = np.gradient(out["throttle"].to_numpy())
    gear_change = np.concatenate(([0], np.diff(out["gear"].to_numpy()))) != 0

    braking = out["brake"].to_numpy() > 50

    # 1) Lock-up: braking + decel far beyond normal, not explained by downshift
    out["rule_lockup"] = braking & (d_speed < -LOCKUP_DECEL_KMH)

    # 2) Wheelspin / traction loss: revs spike but car barely accelerates,
    #    throttle applied, and it is not a gear change
    out["rule_wheelspin"] = ((d_rpm > WHEELSPIN_RPM_JUMP)
                             & (d_speed < WHEELSPIN_SPEED_GAIN)
                             & (out["throttle"].to_numpy() > 40)
                             & ~gear_change)

    # 3) Throttle instability: oscillating pedal (confidence problem)
    out["rule_throttle_osc"] = (out["throttle"]
                                .rolling(8, center=True, min_periods=4)
                                .std()
                                .fillna(0) > THROTTLE_OSC_STD)

    # 4) Mid-corner snap lift: large sudden throttle lift at partial throttle
    partial = (out["throttle"] > 15) & (out["throttle"] < 90)
    out["rule_snap_lift"] = partial & (d_throttle < -SNAP_THROTTLE_LIFT)

    labels = np.full(len(out), None, dtype=object)
    labels[out["rule_snap_lift"].to_numpy()] = "Mid-corner stability loss"
    labels[out["rule_throttle_osc"].to_numpy()] = "Throttle instability"
    labels[out["rule_wheelspin"].to_numpy()] = "Traction loss / wheelspin"
    labels[out["rule_lockup"].to_numpy()] = "Possible lock-up"  # highest prio
    out["rule_label"] = labels
    return out


def agreement_report(df: pd.DataFrame, ml_flags: np.ndarray) -> dict:
    """
    Validation metric: of the points the ML flagged, how many does at least
    one physics rule also flag (precision-vs-rules), and vice versa
    (recall-vs-rules). Reported on the dashboard's model-info panel.
    """
    rule_any = (df["rule_lockup"] | df["rule_wheelspin"]
                | df["rule_throttle_osc"] | df["rule_snap_lift"]).to_numpy()
    ml = ml_flags.astype(bool)
    inter = (ml & rule_any).sum()
    return {
        "ml_flagged": int(ml.sum()),
        "rules_flagged": int(rule_any.sum()),
        "agreement": int(inter),
        "precision_vs_rules": float(inter / ml.sum()) if ml.sum() else None,
        "recall_vs_rules": float(inter / rule_any.sum()) if rule_any.sum() else None,
    }
