"""显式、可校验的 selection score（Alpha）注入 —— WP-G2-05 / F1 修复。

设计（用户裁决 2026-09-11）：

    特征 → Alpha 计算 / 注入 → Alpha 排名 → build_v2_roles → 角色 → 候选权重 → 账本

  * `build_v2_roles` **不得**在内部静默重算并覆盖外部已提供的 Alpha；
  * 评分必须显式、完整、可校验：键 `trade_date + code`、覆盖当日全部合格标的、分数必须有限、
    记录 `score_version` / `score_source` / 内容哈希；
  * 缺失、重复、覆盖不完整 → **直接失败**，不得 fallback 到另一套分数；
  * 正式 Rule V2 入口传 canonical Alpha（`bundle.alpha` 三因子等权）；敏感性实验传替代 Alpha。

为什么必须是显式输入（F1 的真实根因）：
  旧实现里 `build_v2_roles` 自己调 `compute_alpha_score_v2(features)` 重算 Alpha，
  外部传入的 `weights` 只影响 `rankings.leadership_score`，因此"重配权重"的实验
  在组合层面**完全不生效**，却仍然以组合净值的形式被展示出来。
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

#: 组件百分位分数字段（`leadership_score.add_component_scores` 的输出列）
COMPONENT_SCORE_COLUMNS = {
    "trend": "trend_score",
    "rs": "rs_score",
    "breakout": "breakout_approach_score",
    "stage": "stage_quality",
    "momentum": "momentum_accel_score",
    "consolidation": "consolidation_score_v1",
    "volatility": "volatility_quality_score",
    "liquidity": "liquidity_score",
    "diversification": "diversification_score_v1",
}

#: canonical Alpha 权重 = bundle.alpha（Trend / RS / Breakout 等权，与 ALPHA_WEIGHTS_V2 一致）
CANONICAL_ALPHA_WEIGHTS = {"trend": 1 / 3, "rs": 1 / 3, "breakout": 1 / 3}
CANONICAL_SCORE_VERSION = "alpha-v2-equal-3"
CANONICAL_SCORE_SOURCE = "bundle.alpha"

#: 注入后进入角色状态机的列名（= 历史 `alpha_score_v2`，避免下游重命名）
SELECTION_SCORE_COL = "selection_score"
_ROLES_SCORE_COL = "alpha_score_v2"
_HASH_PRECISION = 12


class SelectionScoresError(ValueError):
    """评分输入非法（缺失 / 重复 / 覆盖不完整 / 非有限 / 权重非法）。"""


@dataclass(frozen=True)
class SelectionScores:
    """一份显式评分 + 其可审计元数据。"""

    frame: pd.DataFrame                      # columns: trade_date, code, selection_score
    score_version: str
    score_source: str
    content_hash: str
    weights: dict = field(default_factory=dict)
    notes: tuple = ()

    @property
    def coverage(self) -> int:
        return int(len(self.frame))

    def metadata(self) -> dict:
        return {
            "score_version": self.score_version,
            "score_source": self.score_source,
            "score_hash": self.content_hash,
            "score_weights": dict(self.weights),
            "score_coverage": self.coverage,
            "notes": list(self.notes),
        }

    def merge_frame(self) -> pd.DataFrame:
        """供 `build_v2_roles` 左连接使用的两列键 + 分数列。"""
        return self.frame.rename(columns={SELECTION_SCORE_COL: _ROLES_SCORE_COL})


def _content_hash(frame: pd.DataFrame) -> str:
    ordered = frame.sort_values(["trade_date", "code"])
    payload = "|".join(
        "%s~%s~%.*f" % (str(d), str(c), _HASH_PRECISION, float(s))
        for d, c, s in zip(ordered["trade_date"], ordered["code"], ordered[SELECTION_SCORE_COL])
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_weights(weights: dict) -> dict:
    if not isinstance(weights, dict) or not weights:
        raise SelectionScoresError("selection weights 必须是非空对象（组件名 → 权重）")
    unknown = sorted(set(weights) - set(COMPONENT_SCORE_COLUMNS))
    if unknown:
        raise SelectionScoresError(
            f"selection weights 含未知组件 {unknown}；合法组件为 {sorted(COMPONENT_SCORE_COLUMNS)}")
    out = {}
    for k, v in weights.items():
        try:
            w = float(v)
        except (TypeError, ValueError):
            raise SelectionScoresError(f"selection weights[{k}] 必须是数值，实际 {v!r}") from None
        if not np.isfinite(w) or w < 0:
            raise SelectionScoresError(f"selection weights[{k}] 必须是非负有限数，实际 {w}")
        if w > 0:
            out[k] = w
    if not out:
        raise SelectionScoresError("selection weights 不能全为 0")
    return out


def _combine(scored: pd.DataFrame, weights: dict) -> pd.Series:
    """按组件权重合成评分。

    等权特例走「逐列相加再除以列数」，与历史 canonical 实现 `(trend+rs+breakout)/3.0`
    **逐位一致**（避免 0.3333333333 这类十进制权重引入 1e-11 级漂移，破坏 parity）。
    """
    cols = [(COMPONENT_SCORE_COLUMNS[k], float(w)) for k, w in weights.items()]
    first_w = cols[0][1]
    if all(w == first_w for _, w in cols):
        acc = scored[cols[0][0]].astype(float)
        for col, _ in cols[1:]:
            acc = acc + scored[col].astype(float)
        return acc / float(len(cols))
    wsum = float(sum(w for _, w in cols))
    total = scored[cols[0][0]].astype(float) * cols[0][1]
    for col, w in cols[1:]:
        total = total + scored[col].astype(float) * w
    return total / wsum


def eligible_mask(features: pd.DataFrame, benchmark_code: str | None = None) -> pd.Series:
    """可排名集合 = ELIGIBLE 且非 benchmark（与 `compute_alpha_score_v2` 同口径）。"""
    if benchmark_code is None:
        from gen2.data.loader import load_gen2_config
        benchmark_code = load_gen2_config()["data"].get("benchmark_code", "510300")
    return (features["eligibility"] == "ELIGIBLE") & (
        features["code"].astype(str).str.zfill(6) != str(benchmark_code).zfill(6))


def build_selection_scores(
    features: pd.DataFrame,
    weights: dict | None = None,
    *,
    score_version: str,
    score_source: str,
    notes: tuple | list = (),
) -> SelectionScores:
    """构造一份显式评分（weights=None → canonical 三因子等权）。"""
    from gen2.baseline.leadership_score import add_component_scores

    w = _normalize_weights(CANONICAL_ALPHA_WEIGHTS if weights is None else weights)
    eligible = features[eligible_mask(features)].copy()
    if eligible.empty:
        raise SelectionScoresError("可排名集合为空（eligibility == ELIGIBLE 的行数为 0）")

    # 横截面百分位只在可排名集合内计算（与 canonical 一致，避免非合格资产污染分母）
    scored = add_component_scores(eligible)
    score = _combine(scored, w)

    frame = pd.DataFrame({
        "trade_date": scored["trade_date"].values,
        "code": scored["code"].astype(str).values,
        SELECTION_SCORE_COL: np.asarray(score, dtype=float),
    })
    non_finite = int((~np.isfinite(frame[SELECTION_SCORE_COL].to_numpy(dtype=float))).sum())
    if non_finite:
        raise SelectionScoresError(
            f"评分含 {non_finite} 行非有限值（NaN/Inf）：score_source={score_source}。"
            "评分类输入必须完整有限，禁止静默丢弃或用另一套分数兜底。")

    return SelectionScores(
        frame=frame,
        score_version=score_version,
        score_source=score_source,
        content_hash=_content_hash(frame),
        weights=w,
        notes=tuple(notes),
    )


def canonical_selection_scores(features: pd.DataFrame) -> SelectionScores:
    """正式 Rule V2 入口使用的 canonical Alpha（替代旧 `compute_alpha_score_v2` 隐式重算）。"""
    return build_selection_scores(
        features, None,
        score_version=CANONICAL_SCORE_VERSION,
        score_source=CANONICAL_SCORE_SOURCE,
        notes=("canonical Alpha = 1/3*(trend+rs+breakout)，与 compute_alpha_score_v2 逐位一致",),
    )


def validate_selection_scores(scores: "SelectionScores", universe: pd.DataFrame,
                              *, context: str = "selection_scores") -> dict:
    """校验评分与角色状态机的输入宇宙**完全一致**（唯一键、有限、无缺无多）。

    universe：角色状态机的输入面板（`rankings`，列含 trade_date / code）。
    返回元数据；任何不满足都抛 SelectionScoresError —— 不提供 fallback。
    """
    if not isinstance(scores, SelectionScores):
        raise SelectionScoresError(f"{context}: 必须传入 SelectionScores（显式评分），实际 {type(scores).__name__}")
    frame = scores.frame
    for col in ("trade_date", "code", SELECTION_SCORE_COL):
        if col not in frame.columns:
            raise SelectionScoresError(f"{context}: 评分缺少列 {col}")

    if frame.duplicated(subset=["trade_date", "code"]).any():
        dup = frame[frame.duplicated(subset=["trade_date", "code"], keep=False)].head(5)
        raise SelectionScoresError(
            f"{context}: 评分存在重复键（trade_date+code），示例 {dup[['trade_date', 'code']].to_dict('records')}")

    vals = frame[SELECTION_SCORE_COL].to_numpy(dtype=float)
    if not np.isfinite(vals).all():
        raise SelectionScoresError(f"{context}: 评分含 {int((~np.isfinite(vals)).sum())} 行非有限值")

    have = set(map(tuple, frame[["trade_date", "code"]].astype(str).to_numpy()))
    need = set(map(tuple, universe[["trade_date", "code"]].astype(str).to_numpy()))
    missing = sorted(need - have)
    extra = sorted(have - need)
    if missing:
        raise SelectionScoresError(
            f"{context}: 评分未覆盖 {len(missing)} 个 (trade_date, code) 键，示例 {missing[:5]}")
    if extra:
        raise SelectionScoresError(
            f"{context}: 评分含 {len(extra)} 个不属于可排名集合的键，示例 {extra[:5]}")

    return {
        "score_version": scores.score_version,
        "score_source": scores.score_source,
        "score_hash": scores.content_hash,
        "score_coverage": scores.coverage,
        "score_weights": dict(scores.weights),
        "validated_against": context,
    }
