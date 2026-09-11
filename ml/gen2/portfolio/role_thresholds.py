"""Gen-2 显式角色分层配置（WP-G2-05 / F2 修复）。

背景（F2，用户裁决 2026-09-11）：
  旧配置字段 `top_quantile` 语义含混（要靠 `1 - top_quantile` 反向推导角色门槛），
  且 V2 权威状态机把它硬编码成 `core_pct = 0.80` —— 配置不生效、又容易被误读成「已调参」。

新的显式契约（「位于前多少比例」，不需要反向推导）：

    role_thresholds:
      core_top_fraction:        0.20   # alpha 前 20% → CORE 候选
      challenger_top_fraction:  0.30   # alpha 前 30% → CHALLENGER 候选
      satellite_top_fraction:   0.40   # alpha 前 40% → SATELLITE 候选

  校验：0 < core <= challenger <= satellite < 1
  默认值与**当前行为完全一致**（0.20 / 0.30 / 0.40 ↔ core_pct 0.80 / challenger_pct 0.70 /
  satellite_pct 0.60），所以这次迁移不是策略调参。

旧 `top_quantile` **只作为迁移审计字段保留**，本模块不读取它（新 bundle 生效后必须禁止再读）。
"""
from __future__ import annotations

from dataclasses import dataclass

#: 三个显式分位字段（唯一合法键集合；多写/少写/拼错都会直接报错）
ROLE_THRESHOLD_FIELDS = ("core_top_fraction", "challenger_top_fraction", "satellite_top_fraction")

#: 默认值 = 当前线上行为（core 0.80 / challenger 0.70 / satellite 0.60 的等价写法）
DEFAULT_ROLE_THRESHOLDS = {
    "core_top_fraction": 0.20,
    "challenger_top_fraction": 0.30,
    "satellite_top_fraction": 0.40,
}

#: 旧字段名（仅迁移审计；运行路径不得读取）
LEGACY_TOP_QUANTILE_FIELD = "top_quantile"

SOURCE_CONFIG = "CONFIG_ROLE_THRESHOLDS"
SOURCE_DEFAULT = "DEFAULT_ROLE_THRESHOLDS"


class RoleThresholdError(ValueError):
    """角色阈值配置非法（缺失 / 键名错误 / 顺序不满足约束）。"""


@dataclass(frozen=True)
class RoleThresholds:
    """显式角色阈值 + 由它派生的百分位切点（cut point = 1 - top_fraction）。"""

    core_top_fraction: float
    challenger_top_fraction: float
    satellite_top_fraction: float
    source: str = SOURCE_CONFIG

    @property
    def core_pct(self) -> float:
        """alpha 百分位切点：>= core_pct 即 CORE 候选（0.80）。"""
        return 1.0 - self.core_top_fraction

    @property
    def challenger_pct(self) -> float:
        return 1.0 - self.challenger_top_fraction

    @property
    def satellite_pct(self) -> float:
        return 1.0 - self.satellite_top_fraction

    def as_dict(self) -> dict:
        return {
            "core_top_fraction": self.core_top_fraction,
            "challenger_top_fraction": self.challenger_top_fraction,
            "satellite_top_fraction": self.satellite_top_fraction,
            "source": self.source,
            "derived": {
                "core_pct": self.core_pct,
                "challenger_pct": self.challenger_pct,
                "satellite_pct": self.satellite_pct,
            },
        }


def validate_role_thresholds(raw: dict, *, context: str = "role_thresholds") -> RoleThresholds:
    """校验并构造 RoleThresholds（键集合 + 顺序约束）。"""
    if not isinstance(raw, dict):
        raise RoleThresholdError(f"{context} 必须是对象，实际 {type(raw).__name__}")

    unknown = sorted(set(raw) - set(ROLE_THRESHOLD_FIELDS))
    if unknown:
        raise RoleThresholdError(
            f"{context} 含未知字段 {unknown}；唯一合法字段为 {list(ROLE_THRESHOLD_FIELDS)}"
            f"（旧字段 {LEGACY_TOP_QUANTILE_FIELD} 不得出现在运行配置中，只作迁移审计保留）")
    missing = [f for f in ROLE_THRESHOLD_FIELDS if f not in raw]
    if missing:
        raise RoleThresholdError(f"{context} 缺少字段 {missing}")

    vals = {}
    for f in ROLE_THRESHOLD_FIELDS:
        try:
            vals[f] = float(raw[f])
        except (TypeError, ValueError):
            raise RoleThresholdError(f"{context}.{f} 必须是数值，实际 {raw[f]!r}") from None

    if not (0.0 < vals["core_top_fraction"] < 1.0):
        raise RoleThresholdError(f"{context}.core_top_fraction 必须落在 (0,1)，实际 {vals['core_top_fraction']}")
    if not (0.0 < vals["satellite_top_fraction"] < 1.0):
        raise RoleThresholdError(
            f"{context}.satellite_top_fraction 必须落在 (0,1)，实际 {vals['satellite_top_fraction']}")
    if not (vals["core_top_fraction"] <= vals["challenger_top_fraction"] <= vals["satellite_top_fraction"]):
        raise RoleThresholdError(
            "必须满足 0 < core_top_fraction <= challenger_top_fraction <= satellite_top_fraction < 1，实际 "
            f"{vals['core_top_fraction']} / {vals['challenger_top_fraction']} / {vals['satellite_top_fraction']}")
    return RoleThresholds(**vals)


def load_role_thresholds(config: dict | None, *, allow_default: bool = False) -> RoleThresholds:
    """从配置读取角色阈值。

    查找顺序（两者都是显式契约，不是隐式兜底）：
      1. `config["portfolio"]["role_thresholds"]`（研究配置 gen2.yaml）
      2. `config["selection"]["role_thresholds"]`（bundle 布局）

    读不到时：
      * `allow_default=False`（默认）→ **直接报错**：配置缺字段不得静默沿用旧阈值；
      * `allow_default=True` → 返回 DEFAULT_ROLE_THRESHOLDS（source=DEFAULT_ROLE_THRESHOLDS），
        仅供「显式声明默认行为」的调用方使用（例如需要断言默认值与历史一致的测试）。
    """
    cfg = config if isinstance(config, dict) else {}
    raw = None
    for section in ("portfolio", "selection"):
        node = cfg.get(section)
        if isinstance(node, dict) and isinstance(node.get("role_thresholds"), dict):
            raw = node["role_thresholds"]
            break
    if raw is None:
        if allow_default:
            return RoleThresholds(**DEFAULT_ROLE_THRESHOLDS, source=SOURCE_DEFAULT)
        raise RoleThresholdError(
            "配置缺少 role_thresholds（显式角色分层）。请使用 "
            f"{list(ROLE_THRESHOLD_FIELDS)} 声明；旧字段 {LEGACY_TOP_QUANTILE_FIELD} 不再参与运行。")
    return validate_role_thresholds(raw)
