"""Generate the deterministic Gen-2 cross-language parity fixture.

产出 fixtures/gen2/parity_fixture.json，供 Node（scripts/parity/run_node.js）与
Python（scripts/parity/run_python.py）消费同一份「特征层」输入，逐字段比对决策输出。

关键设计：
- 特征层（raw bars -> feature）不在此 parity 范围内（属于数据正确性 stage -1，另有测试）。
- 本 fixture 直接提供「post-feature / pre-scoring」矩阵，覆盖评分→排名→角色→组合→防守的决策链。
- universe 与 Node 端 UNIVERSE（30 只 + benchmark 510300）严格一致。
- 场景：RISK_ON → RANGE → RISK_OFF 三阶段 regime 切换，覆盖 promotion / demotion /
  cluster cap / replacement gate / NO_CORE(trend_gate) / tech cap / vol target 与 risk_off 防守。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "gen2" / "parity_fixture.json"

# 30 只 universe（与 runGen2ShadowEod 的 UNIVERSE.eligible_codes 顺序一致）
CODES = [
    "513310", "515880", "159582", "518880", "159570",
    "588000", "588080", "512480", "159995", "512760", "515050", "159819", "159915", "159992",
    "159770", "159852", "512010", "512690", "159928", "510880", "512800", "512000",
    "512660", "515030", "515790", "512400", "515220", "513180", "159941", "513500",
]

CLUSTER = {
    "513310": "tech_hardware", "515880": "tech_hardware", "159582": "tech_hardware",
    "518880": "gold_commodity", "159570": "healthcare",
    "588000": "growth_broad", "588080": "growth_broad",
    "512480": "tech_hardware", "159995": "tech_hardware", "512760": "tech_hardware",
    "515050": "tech_hardware", "159819": "software_ai", "159915": "growth_broad",
    "159992": "healthcare", "159770": "software_ai", "159852": "software_ai",
    "512010": "healthcare", "512690": "consumer", "159928": "consumer",
    "510880": "defensive_dividend", "512800": "financial", "512000": "financial",
    "512660": "cyclical_resources", "515030": "cyclical_resources", "515790": "cyclical_resources",
    "512400": "cyclical_resources", "515220": "cyclical_resources",
    "513180": "overseas_equity", "159941": "overseas_equity", "513500": "overseas_equity",
}

NAME = {
    "513310": "中韩半导体ETF", "515880": "通信ETF", "159582": "半导体设备ETF",
    "518880": "黄金ETF", "159570": "港股通创新药ETF", "588000": "科创50ETF",
    "588080": "科创板50ETF", "512480": "半导体ETF", "159995": "芯片ETF",
    "512760": "芯片产业ETF", "515050": "5G通信ETF", "159819": "人工智能ETF",
    "159915": "创业板ETF", "159992": "创新药ETF", "159770": "机器人ETF",
    "159852": "软件ETF", "512010": "医药ETF", "512690": "酒ETF", "159928": "消费ETF",
    "510880": "红利ETF", "512800": "银行ETF", "512000": "券商ETF", "512660": "军工ETF",
    "515030": "新能源车ETF", "515790": "光伏ETF", "512400": "有色金属ETF",
    "515220": "煤炭ETF", "513180": "恒生科技ETF", "159941": "纳指ETF", "513500": "标普500ETF",
}

INCUMBENT = ["513310", "515880", "159582", "518880", "159570"]
HEDGE = ["518880"]

# 显式 alpha 排名顺序（strength 从高到低），制造 promotion / demotion / cluster cap / replacement。
# rank 1..7 = rank_percentile >= 0.8 → proposed CORE；其中 4 只 tech_hardware → cluster cap 降级 2 只现任。
# 588000 设 px_ma60<0（NO_CORE 趋势闸门）；159570 排名垫底（现任 demotion）。
STRENGTH_ORDER = [
    "512480", "159995", "159819", "159770", "588000", "513310", "515880", "159582",
    "588080", "518880", "512760", "515050", "159915", "159992", "159852", "512010",
    "512690", "159928", "510880", "512800", "512000", "512660", "515030", "515790",
    "159570", "512400", "515220", "513180", "159941", "513500",
]

# 跌破 MA60 的代码（trend_gate=false，测试 NO_CORE 硬门槛）。588000 排名前 7 但应被拦下。
BELOW_MA60 = {"588000"}

# 交易日（12 个），三段 regime：
#   d0-d3  RISK_ON (ma20=+0.02, ma60=+0.02 -> market_score 70)
#   d4-d7  RANGE   (0.0, 0.0 -> 50) 且 benchmark vol 0.25（vol target 触发 0.17/0.25=0.68 缩放）
#   d8-d11 RISK_OFF (-0.02, -0.02 -> 30)
TRADE_DATES = [f"2026-06-{d:02d}" for d in range(1, 13)]

REGIME_PHASES = [
    (0, 3, 0.02, 0.02, 0.15, "RISK_ON"),
    (4, 7, 0.0, 0.0, 0.25, "RANGE"),
    (8, 11, -0.02, -0.02, 0.15, "RISK_OFF"),
]


def strength_of(code: str) -> float:
    idx = STRENGTH_ORDER.index(code)
    return 1.0 - (idx / len(STRENGTH_ORDER))  # rank1≈1.0 ... rank30≈0.033


def build() -> dict:
    universe = {}
    for c in CODES:
        universe[c] = {
            "name": NAME[c],
            "cluster": CLUSTER[c],
            "incumbent": c in INCUMBENT,
            "hedge": c in HEDGE,
        }

    benchmark = []
    for i, d in enumerate(TRADE_DATES):
        for lo, hi, ma20, ma60, vol, _reg in REGIME_PHASES:
            if lo <= i <= hi:
                benchmark.append({
                    "trade_date": d,
                    "benchmark_px_ma20": ma20,
                    "benchmark_px_ma60": ma60,
                    "realized_vol20": vol,
                })
                break

    features = []
    for d_i, d in enumerate(TRADE_DATES):
        ma20_b, ma60_b = 0.0, 0.0
        for lo, hi, ma20, ma60, _v, _r in REGIME_PHASES:
            if lo <= d_i <= hi:
                ma20_b, ma60_b = ma20, ma60
                break
        for c in CODES:
            s = strength_of(c)
            below = c in BELOW_MA60
            # px_ma60 单独控制（趋势闸门）：BELOW_MA60 代码为负（NO_CORE 硬门槛），其余恒为正。
            px_ma60 = -0.02 if below else (0.10 * s + 0.01)
            features.append({
                "code": c,
                "trade_date": d,
                # trend
                "px_ma20": 0.10 * s - 0.05,
                "px_ma60": px_ma60,
                "ma20_slope_5d": 0.05 * s - 0.01,
                "ma60_slope_10d": 0.04 * s - 0.01,
                # rs
                "rs20_vs_benchmark": 0.20 * s - 0.10,
                "rs60_vs_benchmark": 0.18 * s - 0.09,
                "rs_accel_5d": 0.10 * s - 0.02,
                # consolidation / stage
                "sideway_days": int(20 * s),
                "sideway_range": 0.12 * (1 - s) + 0.02,
                "volume_ratio_5_20": 1.0 + 0.6 * s,
                # momentum / breakout
                "momentum_accel_5_20": 0.08 * s - 0.01,
                "breakout_distance": 0.06 * s - 0.02,
                # volatility
                "atr20_pct": 0.02 + 0.02 * s,
                "realized_vol20": 0.15 + 0.10 * s,
                "max_drawdown_20d": -0.05 - 0.10 * s,
                # liquidity / diversification / crowding
                "avg_amount_20d": 1e8 * (1.0 + s),
                "corr_to_portfolio_60d": 0.4 + 0.3 * s,
                "corr_to_cluster_60d": 0.3 + 0.4 * s,
                # benchmark regime（每行携带，Node 端逐行读）
                "benchmark_px_ma20": ma20_b,
                "benchmark_px_ma60": ma60_b,
            })

    return {
        "meta": {
            "engine_id": "gen2-rule-v2",
            "universe_version": "universe_v1",
            "benchmark_code": "510300",
            "target_size": 30,
            "n_dates": len(TRADE_DATES),
            "scenarios": [
                "RISK_ON", "RANGE(vol_target)", "RISK_OFF",
                "promotion", "demotion", "cluster_cap", "replacement_gate", "NO_CORE", "tech_cap",
            ],
        },
        "universe": universe,
        "benchmark": benchmark,
        "features": features,
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {OUT}")
    print(f"  codes={len(data['universe'])} dates={data['meta']['n_dates']} feature_rows={len(data['features'])}")
    print(f"  strength_rank(alpha) 前8: {STRENGTH_ORDER[:8]}")
    print(f"  BELOW_MA60(NO_CORE): {sorted(BELOW_MA60)}")
    print(f"  incumbent: {INCUMBENT}  hedge: {HEDGE}")


if __name__ == "__main__":
    main()
