from __future__ import annotations

import pandas as pd


def build_equal_weight_weights(dates: pd.Series, codes: list[str]) -> pd.DataFrame:
    rows = []
    unique_dates = sorted(pd.Series(dates).unique())
    weight = 1.0 / len(codes) if codes else 0.0
    for d in unique_dates:
        for code in codes:
            rows.append({"trade_date": d, "code": code, "target_weight": weight})
    return pd.DataFrame(rows)


def build_benchmark_weights(rankings: pd.DataFrame, main5: list[str]) -> dict[str, pd.DataFrame]:
    # Main5 PIT 等权：只对当日 ELIGIBLE（已上市且有历史）的 main5 重归一化。
    # 修正原实现从 2018 起给未上市的 main5 各 20%（缺失收益填 0=现金）的幸存者偏差。
    main5_pit_rows = []
    for d, g in rankings.groupby("trade_date", sort=True):
        day_codes = set(g["code"])
        avail = [c for c in main5 if c in day_codes]
        if not avail:
            continue
        w = 1.0 / len(avail)
        for c in avail:
            main5_pit_rows.append({"trade_date": d, "code": c, "target_weight": w})
    main5_pit = pd.DataFrame(main5_pit_rows)

    expanded = rankings.groupby("trade_date", sort=True)["code"].apply(list).to_dict()
    universe_rows = []
    for d, codes in expanded.items():
        w = 1.0 / len(codes) if codes else 0.0
        for c in codes:
            universe_rows.append({"trade_date": d, "code": c, "target_weight": w})
    return {
        "fixed_main5_system_proxy": main5_pit,
        "main5_equal_weight": main5_pit,
        "expanded_universe_equal_weight": pd.DataFrame(universe_rows),
    }
