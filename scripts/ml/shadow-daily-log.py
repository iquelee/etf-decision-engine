#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shadow daily ledger (observe-only). Does not change production or Gen-1."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
BUNDLE_ID = "shadow-bundle-v1"
MODEL_DIR = ROOT / "ml" / "models" / MODEL_ID
SHADOW_DIR = ROOT / "ml" / "shadow" / MODEL_ID
BUNDLE_PATH = ROOT / "ml" / "manifests" / "SHADOW_BUNDLE_v1.json"
STAGE_W = {"S0": 0.055, "S1": 0.225, "S2": 0.40, "S3": 0.49, "S4": 0.635, "S5": 0.75}
GOLD = {"518880"}
STICKY_DAYS = 10
TRAIN_END = "2026-08-24"
MAIN5_CODES = frozenset({"513310", "515880", "159582", "518880", "159570"})
SIGNAL_STATUSES = frozenset({"NO_OPPORTUNITY", "OBSERVED", "CANDIDATE", "BLOCKED", "DEGRADED"})


def decision_hash(
    date: str,
    code: str,
    engine_version: str,
    model_id: str,
    feature_version: str,
    label_version: str,
    threshold_version: str,
    calibration_version: str,
    source_trade_date: str = "",
    feature_schema_hash: str = "",
) -> str:
    raw = "|".join([
        str(date), str(code), engine_version, model_id,
        feature_version, label_version, threshold_version, calibration_version,
        str(source_trade_date), str(feature_schema_hash),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def feature_schema_hash(features_core: list, features_cat: list) -> str:
    payload = {
        "features_core": list(features_core),
        "features_cat": list(features_cat),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def latest(pat: str) -> Path:
    hits = sorted(ROOT.glob(pat), reverse=True)
    if not hits:
        raise SystemExit(f"missing {pat}")
    return hits[0]


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def load_bundle() -> dict:
    if BUNDLE_PATH.exists():
        return json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    return {"bundle_id": BUNDLE_ID, "versions": {}}


def decide(p: float, thr: dict) -> str:
    if p >= thr["signal_p"]:
        return "SIGNAL"
    if thr["abstain_low"] < p < thr["abstain_high"]:
        return "ABSTAIN"
    return "NO_SIGNAL"


def make_thr(manifest: dict) -> dict:
    t = manifest.get("thresholds", {})
    return {
        "signal_p": float(t.get("signal_p", 0.65)),
        "abstain_low": float(t.get("abstain_low", 0.35)),
        "abstain_high": float(t.get("abstain_high", 0.65)),
    }


def append_row(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame([row])
    if path.exists():
        old = pd.read_csv(path)
        if "date" in old.columns:
            old = old[old["date"].astype(str) != str(row["date"])]
        df = pd.concat([old, df], ignore_index=True)
    df.to_csv(path, index=False)


def append_signals(path: Path, rows: list) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    if path.exists():
        old = pd.read_csv(path)
        if not old.empty and {"date", "code"}.issubset(old.columns):
            keys = set(zip(df["date"].astype(str), df["code"].astype(str)))
            old = old[~old.apply(lambda r: (str(r["date"]), str(r["code"])) in keys, axis=1)]
            df = pd.concat([old, df], ignore_index=True)
    df.to_csv(path, index=False)


def assert_main5_integrity(day: str, signal_rows: list) -> None:
    """EOD hard assertion: Main5 每天必须各有一条信号行（含 NO_OPPORTUNITY）。"""
    actual = {str(r.get("code")) for r in signal_rows if str(r.get("code")) in MAIN5_CODES}
    invalid = [str(r.get("signal_status")) for r in signal_rows
               if r.get("code") in MAIN5_CODES and r.get("signal_status") not in SIGNAL_STATUSES]
    missing = sorted(MAIN5_CODES - actual)
    if missing or invalid or len(actual) != len(MAIN5_CODES):
        raise RuntimeError(
            f"Main5 Shadow completeness failed for {day}: missing={missing}, invalid_status={invalid}, "
            f"actual={len(actual)}/{len(MAIN5_CODES)}"
        )


def advance_day(panel_day: pd.DataFrame, signal_codes: set, sticky: dict):
    rows = []
    new_sticky = dict(sticky)
    for _, r in panel_day.iterrows():
        code = str(r["code"])
        st = str(r.get("stage", "S2"))
        ret = float(r.get("ret_1d", 0.0) or 0.0)
        if st == "S2" and code in signal_codes:
            new_sticky[code] = STICKY_DAYS
        left = int(new_sticky.get(code, 0))
        use = False
        if left > 0:
            if st in ("S0", "S1", "S4", "S5", "S6"):
                new_sticky[code] = 0
            elif st in ("S2", "S3"):
                use = True
                new_sticky[code] = left - 1
            else:
                new_sticky[code] = left - 1
        w0 = STAGE_W.get(st, 0.40)
        w1 = STAGE_W["S4"] if use else w0
        rows.append({
            "code": code, "stage": st, "fast_path": use,
            "w_v361": w0, "w_ml": w1, "ret_1d": ret,
        })
    return pd.DataFrame(rows), {k: v for k, v in new_sticky.items() if v > 0}


def book_from_weights(day_w: pd.DataFrame, prev_w):
    if day_w.empty:
        return {
            "n_names": 0, "fp_names": 0,
            "v361_w": 0.0, "ml_w": 0.0, "delta_w": 0.0,
            "v361_pnl": 0.0, "ml_pnl": 0.0, "incr_pnl": 0.0,
        }
    prev = prev_w or {}
    pn361, pnml, w0s, w1s = [], [], [], []
    for _, r in day_w.iterrows():
        code = str(r["code"])
        ret = float(r["ret_1d"])
        pw0, pw1 = prev.get(code, (0.0, 0.0))
        pn361.append(pw0 * ret)
        pnml.append(pw1 * ret)
        w0s.append(float(r["w_v361"]))
        w1s.append(float(r["w_ml"]))
    return {
        "n_names": len(day_w),
        "fp_names": int(day_w["fast_path"].sum()),
        "v361_w": float(np.mean(w0s)),
        "ml_w": float(np.mean(w1s)),
        "delta_w": float(np.mean(w1s) - np.mean(w0s)),
        "v361_pnl": float(np.mean(pn361)),
        "ml_pnl": float(np.mean(pnml)),
        "incr_pnl": float(np.mean(pnml) - np.mean(pn361)),
    }


def tiered_breaker(ledger: pd.DataFrame, signals: pd.DataFrame):
    out = {
        "level": "OK",
        "fastpath_permission": True,
        "reason": "insufficient_oos",
        "roll30": None,
        "roll60": None,
        "false_fp_rate": None,
        "brier": None,
    }
    if ledger is None or ledger.empty or "date" not in ledger.columns:
        return out
    df = ledger.copy()
    df["date"] = pd.to_datetime(df["date"])
    oos = df[df["date"] > pd.Timestamp(TRAIN_END)].sort_values("date")
    if oos.empty:
        return {**out, "reason": "awaiting_first_oos_day"}

    roll30 = float(oos["incr_pnl"].tail(30).sum())
    roll60 = float(oos["incr_pnl"].tail(60).sum())
    out["roll30"] = roll30
    out["roll60"] = roll60

    false_fp = None
    brier = None
    cal_bad = False
    fp_high = False
    if signals is not None and not signals.empty and "outcome_class" in signals.columns:
        ready = signals[signals["outcome_ready"].astype(str).isin(["True", "true", "1"])]
        fast = ready[ready["ml_fast"].astype(str).isin(["True", "true", "1"])]
        if len(fast) >= 8:
            false_fp = float((fast["outcome_class"].astype(str) == "D").mean())
            out["false_fp_rate"] = false_fp
            fp_high = false_fp > 0.55
        if {"y_reached_s4", "calibrated_probability"}.issubset(ready.columns) and len(ready) >= 12:
            p = ready["calibrated_probability"].astype(float).clip(0, 1)
            y = ready["y_reached_s4"].astype(float)
            brier = float(np.mean((p - y) ** 2))
            out["brier"] = brier
            hi = ready[p >= 0.65]
            if len(hi) >= 6 and float(hi["y_reached_s4"].mean()) < 0.45:
                cal_bad = True
            if brier > 0.28:
                cal_bad = True

    if len(oos) >= 60 and roll60 < 0 and fp_high:
        return {**out, "level": "ML_OFF", "fastpath_permission": False,
                "reason": f"roll60_incr<0 ({roll60:.4f}) & false_fp_high"}
    if len(oos) >= 30 and roll30 < 0 and (cal_bad or fp_high):
        return {**out, "level": "DEGRADED", "fastpath_permission": False,
                "reason": f"roll30_incr<0 ({roll30:.4f}) & cal/fp"}
    if len(oos) >= 30 and roll30 < 0:
        return {**out, "level": "WARNING", "fastpath_permission": True,
                "reason": f"roll30_incr<0 ({roll30:.4f})"}
    if len(oos) < 30:
        return {**out, "reason": f"oos_days<30 ({len(oos)})"}
    return {**out, "reason": "ok"}


def run_day(day, events, panel, model, manifest, bundle, sticky, prev_w, rehearsal):
    thr = make_thr(manifest)
    core = list(manifest.get("features_core", []))
    cat = list(manifest.get("features_cat", []))
    cols = core + cat
    schema_hash = feature_schema_hash(core, cat)

    all_day_ev = events[events["date"] == pd.Timestamp(day)].copy()
    day_ev = all_day_ev.copy()
    if "stage_t" in day_ev.columns:
        day_ev = day_ev[day_ev["stage_t"].astype(str) == "S2"].copy()
    for c in cat:
        if c not in day_ev.columns:
            day_ev[c] = "NA"
        day_ev[c] = day_ev[c].astype(str).fillna("NA")
    for c in core:
        if c not in day_ev.columns:
            day_ev[c] = np.nan

    if len(day_ev):
        day_ev["p_raw"] = model.predict_proba(day_ev[cols])[:, 1]
        day_ev["p_calibrated"] = day_ev["p_raw"]
        day_ev["ml_decision"] = [decide(float(p), thr) for p in day_ev["p_calibrated"]]
        day_ev["is_gold"] = day_ev["code"].astype(str).isin(GOLD)
    else:
        day_ev["p_raw"] = []
        day_ev["p_calibrated"] = []
        day_ev["ml_decision"] = []
        day_ev["is_gold"] = []

    sig = day_ev[day_ev["ml_decision"] == "SIGNAL"] if len(day_ev) else day_ev
    signal_codes = set(sig["code"].astype(str)) if len(sig) else set()
    cand_n = int(len(day_ev))
    signal_n = int(len(sig))
    abstain_n = int((day_ev["ml_decision"] == "ABSTAIN").sum()) if len(day_ev) else 0

    panel_day = panel[panel["date"] == pd.Timestamp(day)].copy()
    if "main5" in panel_day.columns:
        panel_day = panel_day[
            (panel_day["main5"] == True) | (panel_day["code"].astype(str) == "588000")  # noqa: E712
        ].copy()

    day_w, sticky = advance_day(panel_day, signal_codes, sticky)
    book = book_from_weights(day_w, prev_w)

    cf_codes = set(panel_day["code"].astype(str)) if len(panel_day) else set()
    stage_map = {str(r["code"]): str(r["stage"]) for _, r in panel_day.iterrows()} if len(panel_day) else {}
    close_map = (
        {str(r["code"]): float(r["close"]) for _, r in panel_day.iterrows()}
        if (len(panel_day) and "close" in panel_day.columns) else {}
    )

    versions = bundle.get("versions", {})
    signal_rows = []
    n_a = n_b = 0
    for _, r in day_ev.iterrows():
        code = str(r["code"])
        p = float(r["p_calibrated"])
        decision = str(r["ml_decision"])
        ml_fast = decision == "SIGNAL"
        st = stage_map.get(code, str(r.get("stage_t", "S2")))
        in_cf = code in cf_codes
        rule_gate = "PERMIT" if (in_cf and st in ("S2", "S3")) else "BLOCK"
        if ml_fast and rule_gate == "PERMIT":
            perm_class = "A"
            n_a += 1
        elif ml_fast and rule_gate == "BLOCK":
            perm_class = "B"
            n_b += 1
        else:
            perm_class = ""
        w_v = STAGE_W.get(st, 0.40)
        w_ml = STAGE_W["S4"] if (ml_fast and rule_gate == "PERMIT" and st in ("S2", "S3")) else w_v
        eng = versions.get("engine_version", "v3.6.1")
        feat = versions.get("feature_version", "hvt-core-v1")
        lab = versions.get("label_version", "hvta-v1")
        thr_v = versions.get("threshold_version", "shadow-threshold-v1")
        cal_v = versions.get("calibration_version", "cal-isotonic-cv3-v1")
        signal_rows.append({
            "date": day,
            "source_trade_date": str(r.get("source_trade_date", day)),
            "code": code,
            "name": r.get("name", ""),
            "sector": r.get("sector", ""),
            "event_cluster_id": r.get("event_cluster_id", ""),
            "stage": st,
            "market_regime": r.get("market_regime", r.get("w_state", "")),
            "ml_probability": float(r["p_raw"]),
            "calibrated_probability": p,
            "ml_decision": decision,
            "signal_status": (
                "CANDIDATE" if (ml_fast and rule_gate == "PERMIT")
                else ("BLOCKED" if ml_fast else "OBSERVED")
            ),
            "ml_fast": ml_fast,
            "rule_gate": rule_gate,
            "permission_class": perm_class,
            "permission_a": perm_class == "A",
            "permission_b": perm_class == "B",
            "permission_hit": bool(ml_fast and rule_gate == "BLOCK"),
            "fast_path_would_trigger": bool(ml_fast and rule_gate == "PERMIT"),
            "v361_target": w_v,
            "ml_counterfactual_target": w_ml,
            "delta_target": w_ml - w_v,
            "entry_close": close_map.get(code, float("nan")),
            "future_5d_stage": "",
            "future_10d_stage": "",
            "future_5d_return": float("nan"),
            "future_10d_return": float("nan"),
            "mae": float("nan"),
            "mfe": float("nan"),
            "y_reached_s4": float("nan"),
            "outcome_class": "",
            "outcome_ready": False,
            "bundle_id": bundle.get("bundle_id", BUNDLE_ID),
            "engine_version": eng,
            "ml_model_id": MODEL_ID,
            "model_id": MODEL_ID,
            "feature_schema_hash": schema_hash,
            "feature_version": feat,
            "label_version": lab,
            "calibration_version": cal_v,
            "threshold_version": thr_v,
            "decision_hash": decision_hash(
                day, code, eng, MODEL_ID, feat, lab, thr_v, cal_v,
                str(r.get("source_trade_date", day)), schema_hash
            ),
            "ml_effective": False,
            "rehearsal": bool(rehearsal) or (day <= TRAIN_END),
        })

    # 对非 S2 标的也写入当天显式“无候选”行，避免 UI 继续展示旧日期概率。
    # 这些行不调用模型、不产生概率，仅用于 freshness 和审计；正式仓位仍完全不变。
    candidate_codes = set(day_ev["code"].astype(str)) if len(day_ev) else set()
    for _, r in all_day_ev.iterrows():
        code = str(r["code"])
        if code in candidate_codes:
            continue
        st = stage_map.get(code, str(r.get("stage_t", r.get("stage", "S2"))))
        eng = versions.get("engine_version", "v3.6.1")
        feat = versions.get("feature_version", "hvt-core-v1")
        lab = versions.get("label_version", "hvta-v1")
        thr_v = versions.get("threshold_version", "shadow-threshold-v1")
        cal_v = versions.get("calibration_version", "cal-isotonic-cv3-v1")
        signal_rows.append({
            "date": day,
            "source_trade_date": str(r.get("source_trade_date", day)),
            "code": code,
            "name": r.get("name", ""),
            "sector": r.get("sector", ""),
            "event_cluster_id": r.get("event_cluster_id", ""),
            "stage": st,
            "market_regime": r.get("market_regime", r.get("w_state", "")),
            "ml_probability": float("nan"),
            "calibrated_probability": float("nan"),
            "ml_decision": "NO_CANDIDATE",
            "signal_status": "NO_OPPORTUNITY",
            "ml_fast": False,
            "rule_gate": "BLOCK",
            "permission_class": "",
            "permission_a": False,
            "permission_b": False,
            "permission_hit": False,
            "fast_path_would_trigger": False,
            "v361_target": STAGE_W.get(st, 0.40),
            "ml_counterfactual_target": STAGE_W.get(st, 0.40),
            "delta_target": 0.0,
            "entry_close": close_map.get(code, float("nan")),
            "future_5d_stage": "",
            "future_10d_stage": "",
            "future_5d_return": float("nan"),
            "future_10d_return": float("nan"),
            "mae": float("nan"),
            "mfe": float("nan"),
            "y_reached_s4": float("nan"),
            "outcome_class": "",
            "outcome_ready": False,
            "bundle_id": bundle.get("bundle_id", BUNDLE_ID),
            "engine_version": eng,
            "ml_model_id": MODEL_ID,
            "model_id": MODEL_ID,
            "feature_schema_hash": schema_hash,
            "feature_version": feat,
            "label_version": lab,
            "calibration_version": cal_v,
            "threshold_version": thr_v,
            "decision_hash": decision_hash(
                day, code, eng, MODEL_ID, feat, lab, thr_v, cal_v,
                str(r.get("source_trade_date", day)), schema_hash
            ),
            "ml_effective": False,
            "rehearsal": bool(rehearsal) or (day <= TRAIN_END),
        })

    assert_main5_integrity(day, signal_rows)
    next_prev = {str(r["code"]): (float(r["w_v361"]), float(r["w_ml"])) for _, r in day_w.iterrows()}

    prec = float("nan")
    if signal_n and "y_hvta" in sig.columns:
        prec = float(sig["y_hvta"].astype(float).mean())

    cluster_n = 0
    if signal_n and "event_cluster_id" in sig.columns:
        cluster_n = int(sig["event_cluster_id"].nunique())

    gold_p = float("nan")
    if len(day_ev) and "is_gold" in day_ev.columns and bool(pd.Series(day_ev["is_gold"]).any()):
        gold_p = float(day_ev.loc[day_ev["is_gold"], "p_calibrated"].mean())

    row = {
        "date": day,
        "model_id": MODEL_ID,
        "bundle_id": bundle.get("bundle_id", BUNDLE_ID),
        "rehearsal": bool(rehearsal) or (day <= TRAIN_END),
        "candidates_s2": cand_n,
        "signals": signal_n,
        "abstains": abstain_n,
        "abstain_rate": (abstain_n / cand_n) if cand_n else float("nan"),
        "signal_rate": (signal_n / cand_n) if cand_n else float("nan"),
        "mean_p_signal": float(sig["p_calibrated"].mean()) if signal_n else float("nan"),
        "fastpath_precision_proxy": prec,
        "gold_mean_p": gold_p,
        "raw_signal_count": signal_n,
        "independent_event_count": cluster_n,
        "permission_A_effective": n_a,
        "permission_B_blocked": n_b,
        "ml_permission_hits": n_b,
        "cf_signal_overlap": len(signal_codes & cf_codes),
        "main5_expected": len(MAIN5_CODES),
        "main5_signal_rows": len({str(r.get("code")) for r in signal_rows if str(r.get("code")) in MAIN5_CODES}),
        "main5_complete": True,
        "feature_schema_hash": schema_hash,
        **book,
        "logged_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    dump = SHADOW_DIR / "signals_dump"
    dump.mkdir(parents=True, exist_ok=True)
    day_ev.to_csv(dump / f"events_{day}.csv", index=False)
    if len(day_w):
        day_w.to_csv(dump / f"weights_{day}.csv", index=False)

    return row, sticky, next_prev, signal_rows


def write_status(ledger, signals, day, bundle):
    br = tiered_breaker(ledger, signals)
    status_map = {
        "OK": "SHADOW_ACTIVE",
        "WARNING": "SHADOW_WARNING",
        "DEGRADED": "ML_DEGRADED",
        "ML_OFF": "ML_OFF",
    }
    status = {
        "model_id": MODEL_ID,
        "bundle_id": bundle.get("bundle_id", BUNDLE_ID),
        "asof": day,
        "engine": "V3.6.1",
        "engine_state": "FROZEN",
        "ml_state": "FROZEN",
        "shadow": "ACTIVE",
        "fast_path": "NOT_CONNECTED",
        "production": "BLOCKED",
        "breaker_level": br["level"],
        "status": status_map.get(br["level"], "SHADOW_ACTIVE"),
        "signal_status_enum": sorted(SIGNAL_STATUSES),
        "main5_expected": len(MAIN5_CODES),
        "main5_complete": True,
        "fastpath_permission": br["fastpath_permission"],
        "degrade_reason": br["reason"],
        "roll30_incr_pnl": br["roll30"],
        "roll60_incr_pnl": br["roll60"],
        "false_fp_rate": br.get("false_fp_rate"),
        "brier": br.get("brier"),
        "train_end": TRAIN_END,
        "versions": bundle.get("versions", {}),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    save_json(SHADOW_DIR / "shadow_status.json", status)
    return status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    ap.add_argument("--backfill-from", default="")
    ap.add_argument("--backfill-to", default="")
    ap.add_argument("--rehearsal", action="store_true")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    model_path = MODEL_DIR / "model.joblib"
    man_path = MODEL_DIR / "freeze_manifest.json"
    if not model_path.exists() or not man_path.exists():
        raise SystemExit("frozen model missing — run: python3 scripts/ml/freeze-hvt-a-et.py")

    manifest = json.loads(man_path.read_text(encoding="utf-8"))
    bundle = load_bundle()
    model = joblib.load(model_path)

    panel = pd.read_csv(latest("ml/datasets/daily_stage_panel_*.csv"))
    panel["date"] = pd.to_datetime(panel["date"])
    panel["code"] = panel["code"].astype(str)
    day = args.date or panel["date"].max().strftime("%Y-%m-%d")
    if day not in set(panel["date"].dt.strftime("%Y-%m-%d")):
        day = panel["date"].max().strftime("%Y-%m-%d")

    # 优先读取当天由 CloudBase EOD 行情生成的冻结特征。它只服务推理，
    # 不会改变训练集、模型工件、阈值或校准；回放旧日期时仍回退到原始数据集。
    events_path = None
    for p in sorted(ROOT.glob("ml/datasets/hvt_live_inference_*.csv"), reverse=True):
        try:
            probe = pd.read_csv(p, dtype={"code": str})
            if "date" in probe.columns and day in set(probe["date"].astype(str).str.slice(0, 10)):
                events_path = p
                break
        except Exception:
            continue
    events_path = events_path or latest("ml/datasets/hvt_refined_*.csv")
    events = pd.read_csv(events_path)
    events["date"] = pd.to_datetime(events["date"])
    events["code"] = events["code"].astype(str)
    print(f"events={events_path.relative_to(ROOT)} day={day}")
    SHADOW_DIR.mkdir(parents=True, exist_ok=True)

    ledger_path = SHADOW_DIR / "ledger_daily.csv"
    signal_path = SHADOW_DIR / "ledger_signals.csv"
    sticky_path = SHADOW_DIR / "fp_sticky.json"
    prev_path = SHADOW_DIR / "prev_weights.json"

    if args.reset:
        for p in (ledger_path, signal_path, sticky_path, prev_path):
            if p.exists():
                p.unlink()
        print("reset: cleared ledger/signals/sticky/prev_weights")

    sticky = {str(k): int(v) for k, v in load_json(sticky_path, {}).items()}
    raw_prev = load_json(prev_path, {})
    prev_w = {str(k): (float(v[0]), float(v[1])) for k, v in raw_prev.items()}

    def process(day):
        nonlocal sticky, prev_w
        row, sticky, prev_w, sig_rows = run_day(
            day, events, panel, model, manifest, bundle, sticky, prev_w, args.rehearsal
        )
        append_row(ledger_path, row)
        append_signals(signal_path, sig_rows)
        return row

    if args.backfill_from:
        d0 = pd.Timestamp(args.backfill_from)
        d1 = pd.Timestamp(args.backfill_to or args.backfill_from)
        days = sorted(
            panel[(panel["date"] >= d0) & (panel["date"] <= d1)]["date"]
            .dt.strftime("%Y-%m-%d").unique()
        )
        for d in days:
            row = process(d)
            print(
                d,
                "sig=", row["signals"],
                "A=", row["permission_A_effective"],
                "B=", row["permission_B_blocked"],
                "incr=", f"{row['incr_pnl']:+.4%}",
            )
        save_json(sticky_path, sticky)
        save_json(prev_path, prev_w)
        ledger = pd.read_csv(ledger_path) if ledger_path.exists() else pd.DataFrame()
        signals = pd.read_csv(signal_path) if signal_path.exists() else pd.DataFrame()
        status = write_status(ledger, signals, days[-1] if days else "", bundle)
        print(json.dumps(status, indent=2, ensure_ascii=False))
        return

    row = process(day)
    save_json(sticky_path, sticky)
    save_json(prev_path, prev_w)
    ledger = pd.read_csv(ledger_path)
    signals = pd.read_csv(signal_path) if signal_path.exists() else pd.DataFrame()
    status = write_status(ledger, signals, day, bundle)
    print(json.dumps({"day": row, "status": status}, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
