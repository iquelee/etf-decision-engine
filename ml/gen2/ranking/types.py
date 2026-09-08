from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass(frozen=True)
class UniverseRecord:
    code: str
    name: str
    asset_class: str
    sector: str
    theme: str
    correlation_cluster: str
    listing_date: date
    tradable: bool
    research_only: bool
    core_eligible: bool
    incumbent: bool
    gen1_domain_status: str
    benchmark_code: str = "510300"
    strategic_role_hint: str = ""
    challenger: bool = False
    liquidity_tier: str = "unknown"
    gen1_category: str = ""
    gen1_category_coverage: str = ""
    notes: str = ""


@dataclass(frozen=True)
class FeatureRow:
    trade_date: date
    code: str
    features: dict[str, float | str]
    feature_version: str
    data_version: str


@dataclass(frozen=True)
class RankResult:
    trade_date: date
    code: str
    score: float
    rank: int
    rank_percentile: float
    cluster: str
    eligibility: str
    engine_id: str
    universe_version: str = "dev_universe_v0"
    feature_version: str = "feature_v1"
    model_id: str = "gen2-rule-v2"
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RotationDecision:
    trade_date: date
    incumbent: str
    challenger: str
    raw_edge: float
    correlation_penalty: float
    turnover_penalty: float
    crowding_penalty: float
    final_edge: float
    persistence_days: int
    decision: str


@dataclass(frozen=True)
class PortfolioCandidate:
    trade_date: date
    code: str
    role: str
    priority: int
    score: float
    cluster: str
    reason_codes: list[str]
