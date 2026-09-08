from __future__ import annotations

import numpy as np
import pandas as pd

from gen2.data.loader import load_gen2_config

DEFAULT_DEFENSE = {
    "enabled": True,
    "risk_off_exposure_scale": 0.50,
    "risk_off_hedge_weight": 0.15,
    "hedge_code": "518880",
    "regime_field": "ma60",
    "ma60_risk_off": -0.02,
    "vol_target_enabled": True,
    "vol_target_annualized": 0.17,
}


def _benchmark_series(features: pd.DataFrame) -> pd.DataFrame:
    codes = features["code"].astype(str).str.zfill(6)
    bench = features[codes == "510300"]
    cols = [c for c in ["trade_date", "benchmark_px_ma20", "benchmark_px_ma60", "realized_vol20"] if c in bench.columns]
    return bench[cols].drop_duplicates("trade_date").set_index("trade_date")


def _build_defense_signal(features: pd.DataFrame, dcfg: dict) -> pd.DataFrame:
    """Per-date defense signal: core_scale (multiplier) and hedge_weight (absolute)."""
    if dcfg.get("regime_field") != "ma60":
        # legacy risk_state path (used by unit tests); no vol targeting.
        regime = features[["trade_date", "risk_state"]].drop_duplicates("trade_date").set_index("trade_date")["risk_state"]
        off_scale = float(dcfg["risk_off_exposure_scale"])
        hedge_w = float(dcfg["risk_off_hedge_weight"])
        rows = []
        for d, state in regime.items():
            if state == "RISK_OFF":
                rows.append({"trade_date": d, "state": "RISK_OFF", "core_scale": max(0.0, off_scale - hedge_w), "hedge_weight": hedge_w})
            else:
                rows.append({"trade_date": d, "state": state, "core_scale": 1.0, "hedge_weight": 0.0})
        return pd.DataFrame(rows)

    from gen2.portfolio.regime import RISK_OFF, classify_regime, market_score

    bench = _benchmark_series(features)
    off_scale = float(dcfg["risk_off_exposure_scale"])
    hedge_w = float(dcfg["risk_off_hedge_weight"])
    vol_target = float(dcfg.get("vol_target_annualized", 0.15)) if dcfg.get("vol_target_enabled", True) else None

    rows = []
    for d, row in bench.iterrows():
        vol = row["realized_vol20"]
        # 统一 regime 契约：RISK_OFF 由 market_score<=45 判定（替代原先 MA60<-2% 硬编码）。
        if "benchmark_px_ma20" in bench.columns:
            ms = market_score(row["benchmark_px_ma20"], row["benchmark_px_ma60"])
            risk_off = classify_regime(ms) == RISK_OFF
        else:
            risk_off = False  # 缺 ma20（legacy 单测）时不做 risk_off
        if risk_off:
            rows.append({"trade_date": d, "state": "RISK_OFF", "core_scale": max(0.0, off_scale - hedge_w), "hedge_weight": hedge_w})
        else:
            if vol_target is not None and pd.notna(vol) and vol > 0:
                scale = min(1.0, vol_target / vol)
            else:
                scale = 1.0
            rows.append({"trade_date": d, "state": "NORMAL", "core_scale": scale, "hedge_weight": 0.0})
    return pd.DataFrame(rows)


def apply_regime_defense(candidates: pd.DataFrame, features: pd.DataFrame, config: dict | None = None) -> pd.DataFrame:
    """Adjust portfolio target weights by point-in-time market regime + volatility targeting.

    Only touches target_weight; does NOT modify roles or rankings, and only uses
    features computed at trade_date t (causal, no future data).
    """
    cfg = config or load_gen2_config()
    dcfg = {**DEFAULT_DEFENSE, **(cfg.get("portfolio", {}).get("defense", {}) or {})}
    if not dcfg["enabled"]:
        return candidates.copy()

    signal = _build_defense_signal(features, dcfg).set_index("trade_date")
    out = candidates.copy()
    out["target_weight"] = out["target_weight"].fillna(0.0)
    hedge_code = str(dcfg.get("hedge_code", "518880")).zfill(6)

    rows = []
    for trade_date, day in out.groupby("trade_date", sort=True):
        day = day.copy()
        if trade_date in signal.index:
            sig = signal.loc[trade_date]
            state = sig["state"]
            core_scale = float(sig["core_scale"])
            hedge_weight = float(sig["hedge_weight"])
        else:
            state = "NORMAL"
            core_scale = 1.0
            hedge_weight = 0.0

        is_hedge = day["code"].astype(str).str.zfill(6) == hedge_code
        day.loc[~is_hedge, "target_weight"] = day.loc[~is_hedge, "target_weight"] * core_scale
        if hedge_weight > 0 and is_hedge.any():
            day.loc[is_hedge, "target_weight"] = hedge_weight
        day["defense_state"] = state
        rows.append(day)
    out = pd.concat(rows, ignore_index=True)
    sort_cols = ["trade_date", "priority"] if "priority" in out.columns else ["trade_date"]
    return out.sort_values(sort_cols).reset_index(drop=True)
