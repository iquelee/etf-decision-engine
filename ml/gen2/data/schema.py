from __future__ import annotations

import pandas as pd

DAILY_BAR_COLUMNS = [
    "trade_date",
    "code",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "amount",
    "adj_close",
    "source",
    "source_trade_date",
]

NUMERIC_COLUMNS = ["open", "high", "low", "close", "volume", "amount", "adj_close"]


def normalize_daily_bars(df: pd.DataFrame, code: str, source: str) -> pd.DataFrame:
    """Normalize local qfq CSV to the Gen-2 daily bar contract."""
    required = {"date", "open", "close", "high", "low", "volume", "amount"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{code}: missing required daily bar columns: {sorted(missing)}")

    out = df.copy()
    out["trade_date"] = pd.to_datetime(out["date"]).dt.date
    out["code"] = str(code).zfill(6)
    out["source"] = source
    out["source_trade_date"] = out["trade_date"]
    out["adj_close"] = out["close"]
    out["amount_estimated"] = out["amount"].isna()
    # 部分本地 qfq CSV 未提供成交额；为保持统一 schema，用 close × volume 估算。
    # 估算只用于 Liquidity 特征与 QC，不改变原始价格/量能。
    out["amount"] = out["amount"].fillna(out["close"] * out["volume"])
    out = out[["trade_date", "code", "open", "high", "low", "close", "volume", "amount", "adj_close", "source", "source_trade_date", "amount_estimated"]]
    for col in NUMERIC_COLUMNS:
        out[col] = pd.to_numeric(out[col], errors="coerce")
    return out.sort_values("trade_date").reset_index(drop=True)


def validate_daily_bars(df: pd.DataFrame) -> None:
    """Hard assertions for Gen-2 daily bars."""
    missing = set(DAILY_BAR_COLUMNS) - set(df.columns)
    if missing:
        raise AssertionError(f"missing columns: {sorted(missing)}")
    if df.empty:
        raise AssertionError("daily bars are empty")

    dup = df.duplicated(["code", "trade_date"]).sum()
    assert dup == 0, f"duplicate (code, trade_date) rows: {dup}"
    assert (df["close"] > 0).all(), "close must be positive"
    assert (df["high"] >= df["low"]).all(), "high must be >= low"
    assert (df["high"] >= df[["open", "close"]].max(axis=1)).all(), "high must cover open/close"
    assert (df["low"] <= df[["open", "close"]].min(axis=1)).all(), "low must be below open/close"
    assert (df["volume"] >= 0).all(), "volume must be >= 0"
    assert (df["amount"] >= 0).all(), "amount must be >= 0"
    assert (pd.to_datetime(df["source_trade_date"]) <= pd.to_datetime(df["trade_date"])).all(), "source_trade_date must be <= trade_date"
