"""Each physics rule must fire on its crafted pattern and stay silent on
clean driving. These rules are the weak ground truth for the ML model, so
their correctness underpins the whole validation framework."""
import numpy as np
import pandas as pd

from app.ml import physics_rules


def _clean(n=200):
    dist = np.arange(n) * 5.0
    return pd.DataFrame({
        "distance": dist,
        "speed": np.full(n, 220.0),
        "rpm": np.full(n, 10500.0),
        "gear": np.full(n, 7),
        "throttle": np.full(n, 80.0),
        "brake": np.zeros(n),
        "drs": 0, "time_s": dist / 60,
    })


def test_clean_driving_fires_no_rules():
    out = physics_rules.apply_rules(_clean())
    for col in ("rule_lockup", "rule_wheelspin",
                "rule_throttle_osc", "rule_snap_lift"):
        assert out[col].sum() == 0, f"{col} fired on clean data"


def test_lockup_rule_fires():
    df = _clean()
    df.loc[100:106, "brake"] = 100
    df.loc[100:106, "speed"] -= np.linspace(0, 80, 7)
    out = physics_rules.apply_rules(df)
    assert out["rule_lockup"].iloc[98:110].any()
    assert (out["rule_label"].iloc[98:110] == "Possible lock-up").any()


def test_wheelspin_rule_fires():
    df = _clean()
    df.loc[100:105, "rpm"] += np.linspace(0, 2800, 6)   # revs spike
    out = physics_rules.apply_rules(df)                  # speed flat, gear same
    assert out["rule_wheelspin"].iloc[98:110].any()


def test_wheelspin_not_confused_with_gearchange():
    # a realistic downshift: ONE-step rpm jump coinciding with a gear change
    df = _clean()
    df.loc[101:, "rpm"] += 2500
    df.loc[101:, "gear"] = 6
    out = physics_rules.apply_rules(df)
    assert not out["rule_wheelspin"].iloc[100:103].any(), \
        "rpm jump from a downshift was misread as wheelspin"


def test_throttle_oscillation_fires():
    df = _clean()
    df.loc[100:130, "throttle"] = [20 if i % 2 else 95 for i in range(31)]
    out = physics_rules.apply_rules(df)
    assert out["rule_throttle_osc"].iloc[100:130].any()


def test_snap_lift_fires():
    # sustained sudden lift at partial throttle (central gradients ignore
    # single-point dips, so the lift must persist - as a real lift does)
    df = _clean()
    df["throttle"] = 85.0                                # partial throttle
    df.loc[101:, "throttle"] = 15.0                      # sudden, sustained
    out = physics_rules.apply_rules(df)
    assert out["rule_snap_lift"].iloc[99:104].any()


def test_agreement_report_math():
    df = physics_rules.apply_rules(_clean())
    flags = np.zeros(len(df), dtype=bool)
    rep = physics_rules.agreement_report(df, flags)
    assert rep["ml_flagged"] == 0 and rep["precision_vs_rules"] is None
