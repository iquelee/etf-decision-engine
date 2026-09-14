"""Gen-2 研究侧**统一候选组合构建**（WP-G2-06 / F4）。

F4 缺陷（本模块修复前）——研究路径与权威路径各算一套权重：

  * CORE 权重被**重置为 1/n 等权**，丢弃 `rule_v2_ab.build_v2_roles` 已算好的
    单只（`max_single_weight`）/ cluster（`max_cluster_weight`）/ 广义科技
    （`max_tech_weight`）上限；
  * `priority` 取 legacy `rank`（leadership 排名），而角色层已有显式注入的
    selection score（`alpha_score_v2`）；
  * 组合里**没有现金腿、没有防守腿**。

后果：研究基线（归因 / 敏感性 / rotation）与权威路径 `rule_v2_ab.run_v2_backtest`
不是同一组合口径，经济指标不可比。

=======================  统一契约（CANDIDATE_CONTRACT）  =======================

  B1  权重**直接沿用角色层权威 `target_weight`**，只做上限复核（越界**抛错**，
      绝不静默缩、更不重置为等权）；
  B2  `priority` **必须**由调用方显式注入 selection score（缺 → `PortfolioBuildError`），
      **绝不**读 legacy `rank`；
  B3  现金腿（`code=CASH_CODE`）与防守腿（hedge，由 `apply_regime_defense` 给权）
      逐日进入研究组合；
  B4  与权威路径**同口径**：本模块不重算权重，只搬运 + 复核；
  B5  `priority` 完备性：证券腿全覆盖、值有限、按 score **降序**，**同分按 `code` 升序**
      稳定（与输入行序无关），并写入 `priority_source` / `priority_hash`；
  B6  所有腿带 `sleeve='GEN2_CANDIDATE'` —— 属于 **Gen-2 candidate sleeve**，
      绝不等于（也绝不写入）V3.6.1 的 `final_target`。

现金腿为什么在喂账本时要剔除：唯一权威账本 `gen2.backtest.ledger` 内部按
`cash_weight = 1 - Σ证券` 计算现金。若把 CASH 行也当作证券腿喂进去，现金会被
**重复计数**，破坏 `Σtarget + cash == 1` 守恒。故 `ledger_signals()` 显式剔除。
"""
from __future__ import annotations

import hashlib
import math
from typing import Mapping

import pandas as pd

#: 本组合属于 Gen-2 候选研究 sleeve（不是 V3.6.1 正式仓位）
SLEEVE = "GEN2_CANDIDATE"
#: 研究组合里的现金腿代码（与权威账本内部哨兵 `ledger.CASH` 不同：那是账本内部用）
CASH_CODE = "CASH"
#: priority 的唯一合法来源
PRIORITY_SOURCE = "INJECTED_SELECTION_SCORE"
#: 现金腿不是被排序的候选，priority 由「当日证券腿数 + 1」确定（有限、可复现）
PRIORITY_SOURCE_RESIDUAL = "RESIDUAL_CASH_LEG"
#: 角色层承载显式 selection score 的列名（WP-G2-05 / F1）
DEFAULT_SCORE_COL = "alpha_score_v2"

_EPS = 1e-9


class PortfolioBuildError(RuntimeError):
    """候选组合构建的**显式失败**（禁止任何静默 fallback）。"""


# --------------------------------------------------------------------------- #
# priority：显式注入 score → 稳定 dense rank
# --------------------------------------------------------------------------- #

def priority_from_roles(roles: pd.DataFrame, score_col: str = DEFAULT_SCORE_COL) -> dict:
    """从角色的**显式注入 selection score** 构造 priority 映射（唯一合法来源）。

    返回 `{trade_date: {code: score}}`；调用方把它显式传给 `build_portfolio_candidates`。
    roles 缺评分列 → 抛错（**禁止**退化成 legacy `rank`）。
    """
    if score_col not in roles.columns:
        raise PortfolioBuildError(
            f"roles 缺显式评分列 {score_col}：priority 只能来自注入的 selection score（B2）")
    out: dict = {}
    for d, g in roles.groupby("trade_date", sort=True):
        out[d] = {str(c): float(s) for c, s in zip(g["code"], g[score_col])}
    return out


def _canonical_score_map(priority: Mapping) -> dict:
    """把注入的 score 映射规范化为 `{str(date): {str(code): float}}`（跨端可复现）。"""
    if priority is None:
        raise PortfolioBuildError("缺显式 priority：研究路径禁止回退 legacy rank（B2）")
    if not isinstance(priority, Mapping) or len(priority) == 0:
        raise PortfolioBuildError("priority 必须是非空映射 {trade_date: {code: score}}")
    out: dict = {}
    for d, m in priority.items():
        if not isinstance(m, Mapping) or len(m) == 0:
            raise PortfolioBuildError(f"priority[{d}] 必须是非空映射 {{code: score}}")
        out[str(d)] = {str(c): float(s) for c, s in m.items()}
    return out


def _fixed10(x) -> str:
    """固定 10 位小数的十进制表示 —— 跨语言（JS `toFixed(10)`）位级可复现。"""
    return f"{float(x):.10f}"


def priority_hash(priority: Mapping) -> str:
    """注入 score 映射的内容哈希（确定性；跨端一致性证据之一）。

    配方与 JS 端逐字一致：逐日逐码 `"{date}~{code}~{score:.10f}"` 后按字典序排序、`|` 连接、
    sha256 —— 与既有 `selectionScoreHash` 同一风格。
    """
    pmap = _canonical_score_map(priority)
    rows = [f"{d}~{c}~{_fixed10(pmap[d][c])}"
            for d in sorted(pmap) for c in sorted(pmap[d])]
    return hashlib.sha256("|".join(rows).encode("utf-8")).hexdigest()


def portfolio_config_hash(pcfg: Mapping | None = None, defense_cfg: Mapping | None = None) -> str:
    """组合配置哈希（上限 + 防守参数），跨端逐字一致。"""
    from gen2.portfolio.defense_gate import DEFAULT_DEFENSE

    p = dict(pcfg or {})
    d = {**DEFAULT_DEFENSE, **dict(defense_cfg or {})}
    clusters = sorted(p.get("tech_clusters", ["tech_hardware", "software_ai"]))
    tokens = [
        "max_single_weight=" + _fixed10(p.get("max_single_weight", 0.25)),
        "max_cluster_weight=" + _fixed10(p.get("max_cluster_weight", 0.40)),
        "max_tech_weight=" + _fixed10(p.get("max_tech_weight", 0.65)),
        "tech_clusters=" + ",".join(clusters),
        "risk_off_exposure_scale=" + _fixed10(d.get("risk_off_exposure_scale", 0.50)),
        "risk_off_hedge_weight=" + _fixed10(d.get("risk_off_hedge_weight", 0.15)),
    ]
    return hashlib.sha256("|".join(tokens).encode("utf-8")).hexdigest()


def _priority_frame(roles: pd.DataFrame, priority: Mapping) -> tuple[pd.DataFrame, str]:
    """逐 `(date, code)` 校验完备性 / 有限性，并按 score 降序 + code 升序给 dense rank。"""
    pmap = _canonical_score_map(priority)
    phash = priority_hash(pmap)
    seen: set = set()
    rows = []
    for r in roles.itertuples():
        d, c = str(r.trade_date), str(r.code)
        if (d, c) in seen:
            raise PortfolioBuildError(f"roles 存在重复 (trade_date, code)：{d}/{c}")
        seen.add((d, c))
        m = pmap.get(d)
        if m is None:
            raise PortfolioBuildError(f"priority 缺交易日 {d}（{c}）：必须全覆盖（B5）")
        if c not in m:
            raise PortfolioBuildError(f"priority 缺 {d}/{c}：必须全覆盖（B5）")
        s = float(m[c])
        if not math.isfinite(s):
            raise PortfolioBuildError(f"priority 非有限值：{d}/{c} = {m[c]!r}（B5）")
        rows.append({"trade_date": r.trade_date, "code": c, "priority_score": s})

    df = pd.DataFrame(rows)
    parts = []
    for _, g in df.groupby("trade_date", sort=True):
        # 稳定排序：score 降序 → 同分按 code 升序（与输入行序无关）
        g = g.sort_values(["priority_score", "code"], ascending=[False, True], kind="mergesort").copy()
        g["priority"] = range(1, len(g) + 1)
        parts.append(g)
    return pd.concat(parts, ignore_index=True)[["trade_date", "code", "priority", "priority_score"]], phash


# --------------------------------------------------------------------------- #
# 组合构建
# --------------------------------------------------------------------------- #

def _portfolio_cfg(config: dict | None) -> dict:
    if config is not None:
        return dict(config.get("portfolio", {}) or {})
    from gen2.data.loader import load_gen2_config

    return dict(load_gen2_config().get("portfolio", {}) or {})


def _assert_caps(out: pd.DataFrame, pcfg: dict) -> None:
    """上限**复核**（B1/B4）：权威权重越界即抛错，绝不静默缩、绝不重置为等权。"""
    max_single = float(pcfg.get("max_single_weight", 0.25))
    max_cluster = float(pcfg.get("max_cluster_weight", 0.40))
    max_tech = float(pcfg.get("max_tech_weight", 0.65))
    tech_clusters = set(pcfg.get("tech_clusters", ["tech_hardware", "software_ai"]))

    w = out["target_weight"].astype(float)
    if not bool(w.map(math.isfinite).all()):
        raise PortfolioBuildError("target_weight 存在非有限值")
    if bool((w < -_EPS).any()):
        raise PortfolioBuildError("target_weight 出现负值")
    if float(w.max()) > max_single + _EPS:
        raise PortfolioBuildError(
            f"单只上限被突破：max={float(w.max()):.6f} > {max_single}（B1）")

    core = out[out["role"] == "CORE"]
    if not core.empty:
        by_cluster = core.groupby(["trade_date", "correlation_cluster"])["target_weight"].sum()
        if len(by_cluster) and float(by_cluster.max()) > max_cluster + _EPS:
            bad = by_cluster[by_cluster > max_cluster + _EPS]
            raise PortfolioBuildError(f"cluster 上限被突破：{bad.to_dict()}（B1）")
        by_day = core.groupby("trade_date")["target_weight"].sum()
        if len(by_day) and float(by_day.max()) > 1.0 + _EPS:
            raise PortfolioBuildError("CORE 权重合计超过 1")

    day_total = out.groupby("trade_date")["target_weight"].sum()
    if len(day_total) and float(day_total.max()) > 1.0 + _EPS:
        raise PortfolioBuildError(f"持仓合计超过 1：{float(day_total.max()):.6f}")


def _append_cash_leg(out: pd.DataFrame, cash_code: str) -> pd.DataFrame:
    """逐日追加现金腿：`weight = 1 - Σ其他腿`（B3）。

    priority = 当日证券腿数 + 1（有限、稳定，且与跨端 JS 逐字一致）。
    求和按 **code 升序** 累积（避免与输入行序耦合，保证 IEEE 浮点结果跨端一致）。
    """
    rows = []
    for trade_date, g in out.groupby("trade_date", sort=True):
        g = g.sort_values("code", kind="mergesort")
        invested = float(sum(float(x) for x in g["target_weight"]))
        if invested > 1.0 + _EPS:
            raise PortfolioBuildError(f"持仓合计 {invested:.6f} > 1 @ {trade_date}")
        cash = max(0.0, 1.0 - invested)
        n = int(len(g))
        template = g.iloc[0]
        row = {}
        for col in out.columns:
            if col == "code":
                row[col] = cash_code
            elif col == "name":
                row[col] = "现金"
            elif col == "role":
                row[col] = "CASH"
            elif col == "correlation_cluster":
                row[col] = "cash"
            elif col == "target_weight":
                row[col] = cash
            elif col == "priority":
                row[col] = n + 1
            elif col == "priority_score":
                row[col] = float("nan")
            elif col == "priority_source":
                row[col] = PRIORITY_SOURCE_RESIDUAL
            elif col == "sleeve":
                row[col] = SLEEVE
            else:
                row[col] = template[col]
        rows.append(row)
    return pd.concat([out, pd.DataFrame(rows)], ignore_index=True)


def build_portfolio_candidates(
    roles: pd.DataFrame,
    *,
    priority: Mapping | None = None,
    portfolio_config: dict | None = None,
    config: dict | None = None,
    features: pd.DataFrame | None = None,
    apply_defense: bool = False,
    cash_code: str = CASH_CODE,
) -> pd.DataFrame:
    """**唯一**候选组合构建口径（研究路径与权威路径同口径，B4）。

    参数
      roles            : 角色层输出（**必须**已含权威 `target_weight`；缺列即抛错）
      priority         : `{trade_date: {code: score}}`，来自显式注入的 selection score
                         —— 用 `priority_from_roles(roles)` 生成。**必填**（B2）
      portfolio_config : 上限配置（None → 读 `gen2.yaml` 的 `portfolio` 段）
      features         : `apply_defense=True` 时必填（benchmark regime / vol 目标）
      apply_defense    : 是否套用 regime 防守（RISK_OFF 缩仓 + hedge 腿）

    返回逐 `(trade_date, code)` 一行，含 `target_weight` / `priority` /
    `priority_source` / `priority_hash` / `sleeve`，以及现金腿与（可选）`defense_state`。
    """
    if roles is None or len(roles) == 0:
        raise PortfolioBuildError("roles 为空，无法构建候选组合")
    for col in ("trade_date", "code", "role", "target_weight"):
        if col not in roles.columns:
            raise PortfolioBuildError(
                f"roles 缺列 {col}：候选组合必须直接沿用角色层权威 target_weight（B1/B4），"
                "研究路径不得自行重算权重")

    pcfg = portfolio_config if portfolio_config is not None else _portfolio_cfg(config)
    pframe, phash = _priority_frame(roles, priority)

    out = roles.copy()
    out["code"] = out["code"].astype(str)
    out["target_weight"] = out["target_weight"].astype(float)
    out = out.merge(pframe[["trade_date", "code", "priority", "priority_score"]],
                    on=["trade_date", "code"], how="left")
    if bool(out["priority"].isna().any()):
        raise PortfolioBuildError("priority 覆盖不全（merge 后出现空值）")
    out["priority"] = out["priority"].astype(int)
    out["priority_source"] = PRIORITY_SOURCE
    out["priority_hash"] = phash
    out["sleeve"] = SLEEVE

    _assert_caps(out, pcfg)

    if apply_defense:
        if features is None:
            raise PortfolioBuildError("apply_defense=True 必须提供 features（benchmark regime 输入）")
        from gen2.portfolio.defense_gate import apply_regime_defense

        out = apply_regime_defense(out, features, config=config)

    out = _append_cash_leg(out, cash_code)
    return out.sort_values(["trade_date", "priority"], kind="mergesort").reset_index(drop=True)


def ledger_signals(candidates: pd.DataFrame) -> pd.DataFrame:
    """候选组合 → 账本信号：**剔除现金腿**（账本内部按 `1 - Σ证券` 计算现金，避免重复计数）。"""
    df = candidates
    if "code" in df.columns:
        df = df[df["code"].astype(str) != CASH_CODE]
    return df[["trade_date", "code", "target_weight"]].copy()


def build_research_ledger(
    candidates: pd.DataFrame,
    returns: pd.DataFrame,
    *,
    cost_bps: float = 10.0,
    execution_lag: int = 1,
    return_col: str = "ret_1d",
    calendar: list | None = None,
) -> pd.DataFrame:
    """研究账本：候选组合（含现金/防守腿）→ 唯一权威账本，并显式标注 Gen-2 sleeve（B6）。

    * 现金腿不直接喂账本（见 `ledger_signals`），账本自带 `cash_weight`；
    * 追加 `defense_weight`（防守腿逐日权重）与 `sleeve='GEN2_CANDIDATE'`；
    * **绝不**产生 V3.6.1 的 `final_target` 字段。
    """
    from gen2.backtest.ledger import run_ledger

    if "sleeve" in candidates.columns and not bool((candidates["sleeve"] == SLEEVE).all()):
        raise PortfolioBuildError(f"候选组合的 sleeve 必须全部为 {SLEEVE}")

    sig = ledger_signals(candidates)
    ret = returns[["trade_date", "code", return_col]].copy()
    led = run_ledger(sig, ret, cost_bps=cost_bps, calendar=calendar,
                     execution_lag=execution_lag, return_col=return_col)

    if "role" in candidates.columns:
        hedge = candidates[candidates["role"] == "HEDGE"].groupby("trade_date")["target_weight"].sum()
    else:
        hedge = pd.Series(dtype=float)
    led["defense_weight"] = led["trade_date"].map(hedge).fillna(0.0)
    led["sleeve"] = SLEEVE

    if "final_target" in led.columns:
        raise PortfolioBuildError("研究账本不得包含 final_target（那属于 V3.6.1 正式仓位口径）")
    return led


def build_cluster_exposure(candidates: pd.DataFrame) -> pd.DataFrame:
    core = candidates[candidates["role"] == "CORE"].copy()
    if core.empty:
        return pd.DataFrame(columns=["trade_date", "correlation_cluster", "core_count", "target_weight"])
    return core.groupby(["trade_date", "correlation_cluster"], as_index=False).agg(
        core_count=("code", "count"),
        target_weight=("target_weight", "sum"),
    )
