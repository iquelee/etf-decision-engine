from __future__ import annotations

import pandas as pd

from gen2.data.loader import load_gen2_config, load_universe_records

CORE_PCT = 0.80
CHALLENGER_PCT = 0.70
SATELLITE_PCT = 0.60

#: **V2 唯一权威角色实现**（用户裁决 2026-09-11，WP-G2-03）。
#:
#: 本模块**不再是角色实现**：legacy 独立状态机 `build_daily_roles` 已停用（调用即抛错）。
#: 角色语义一律走 `V2_AUTHORITATIVE_ROLE_IMPL`；需要 rank / rank_percentile / leadership_score /
#: persistence_days 展示列时走 `gen2.baseline.v2_role_view.build_v2_role_view`。
#: 迁移记录见 fixtures/gen2/golden_scenarios_v1.json → seam_contracts.role_engine_migration。
V2_AUTHORITATIVE_ROLE_IMPL = "gen2.baseline.rule_v2_ab.build_v2_roles"

#: 允许继续调用 legacy `build_daily_roles` 的模块。
#: **必须保持为空**：该实现已 fail-fast 停用（调用即抛错），仓库内不允许任何消费者。
#: 若确需恢复某条历史 V1 分析路径，必须先把该函数改造为「调用权威实现的兼容包装层」（WP-G2-05），
#: 再显式加入本白名单 —— 直接加入而不改造会被 ml/gen2/tests/test_role_impl_authority.py 拦下。
LEGACY_V1_CONSUMER_ALLOWLIST = frozenset()

#: V2 路径禁止清单：以下模块**不得**出现 `build_daily_roles`
#: （它们是 V2 权威语义的使用者；V2 回测 / 敏感性 / 归因 / parity 一律不得调用 legacy 实现）
V2_PATH_FORBIDDEN_ROLE_IMPL = (
    "ml/gen2/baseline/rule_v2_ab.py",
    "ml/gen2/baseline/rule_v21_ab.py",
    "ml/gen2/baseline/rule_rotation.py",
    "ml/gen2/baseline/sensitivity_matrix.py",
    "ml/gen2/evaluation/attribution.py",
    "scripts/parity/run_gen2_scenarios.py",
)


def _consecutive_by_code(flags: pd.Series, codes: pd.Series) -> pd.Series:
    """Consecutive True count within each code, preserving the input row index."""
    df = pd.DataFrame({"code": codes, "flag": flags.astype(bool)})
    result = pd.Series(0, index=df.index, dtype="int64")
    for _, s in df.groupby("code", sort=False)["flag"]:
        c = 0
        for idx, v in s.items():
            c = c + 1 if v else 0
            result.loc[idx] = c
    return result


def _cap_core_roles(day: pd.DataFrame, max_core_count: int, max_core_per_cluster: int, priority_col: str = "leadership_score", priority_rank_col: str = "rank") -> pd.Series:
    """Return final roles for one date after global/cluster caps.

    排序依据由 priority_col / priority_rank_col 显式传入，禁止隐藏读取旧字段。
    V1 用 leadership_score/rank；V2 必须传 alpha_score_v2 / alpha_rank。
    """
    roles = day["role"].copy()
    sort_cols = [c for c in (priority_col, priority_rank_col) if c in day.columns]
    asc = [False] + [True] * (len(sort_cols) - 1)
    core = day[day["role"] == "CORE"].sort_values(sort_cols, ascending=asc)
    if core.empty:
        return roles
    keep = []
    cluster_counts: dict[str, int] = {}
    for row in core.itertuples():
        cluster = row.correlation_cluster
        if max_core_count is not None and len(keep) >= max_core_count:
            continue
        if cluster_counts.get(cluster, 0) >= max_core_per_cluster:
            continue
        keep.append(row.Index)
        cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1
    demote = set(core.index) - set(keep)
    roles.loc[list(demote)] = "SATELLITE"
    return roles


def build_daily_roles(rankings: pd.DataFrame, config: dict | None = None):
    """[BLOCKED] legacy 独立角色状态机 —— 已停用，调用即抛错。

    为什么停用：本实现**缺 NO_CORE 硬门槛与 Selection Permission**（RISK_OFF 禁晋升），
    与 V2 权威实现语义不同。两套状态机并存会再次语义分叉，因此不再允许任何调用路径使用它。

    正确用法：
      * 需要角色语义（研究 / 回测 / 敏感性 / 归因 / parity）→
        `gen2.baseline.rule_v2_ab.build_v2_roles(features, rankings, config)`
        或需要 rank / rank_percentile / leadership_score / persistence_days 展示列时用
        `gen2.baseline.v2_role_view.build_v2_role_view(features, rankings, config)`。
      * 若未来确需保留本函数名，只能改造为**调用权威实现的兼容包装层**（登记见 WP-G2-05），
        不得在此重新实现任何角色决策。
    """
    raise RuntimeError(
        "gen2.portfolio.role_engine.build_daily_roles 已停用（LEGACY 独立状态机，缺 NO_CORE 与权限门）。"
        "V2 语义请使用 gen2.baseline.rule_v2_ab.build_v2_roles(features, rankings, config)；"
        "需要展示列请使用 gen2.baseline.v2_role_view.build_v2_role_view(...)。"
    )
