from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from gen2.backtest.rotation_backtest import run_rotation_backtest
from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_gen2_config, load_universe_definition, load_universe_records
from gen2.evaluation.portfolio_metrics import cluster_concentration, core_residence_days
from gen2.evaluation.rank_metrics import quantile_forward_returns, rank_ic_by_date, top_bottom_spread
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.portfolio_builder import build_cluster_exposure, build_portfolio_candidates
from gen2.portfolio.replacement_engine import build_rotation_events
from gen2.baseline.selection_scores import canonical_selection_scores
from gen2.baseline.v2_role_view import build_v2_role_view
from gen2.ranking.rank_engine import run_rank_engine
from gen2.ranking.rank_postprocess import validate_rankings

EXPERIMENT_ID = "gen2-exp-0002-rule-baseline-universe-v1"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _display_path(path: Path) -> str:
    """报告里展示路径：能相对仓库根就相对，否则给出绝对路径（覆写输出目录时不炸）。"""
    try:
        return str(Path(path).relative_to(GEN2_ROOT.parent.parent))
    except ValueError:
        return str(Path(path))


def _write_manifest(output_dir: Path, config: dict, summary: pd.DataFrame,
                    manifest_path: str | Path | None = None) -> Path:
    cfg_path = GEN2_ROOT / "config" / "gen2.yaml"
    manifest = {
        "experiment_id": EXPERIMENT_ID,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": None,
        "universe_version": config["universe"]["version"],
        "data_version": "daily-qfq-v1",
        "feature_version": config["ranking"]["feature_version"],
        "label_version": config["ranking"]["label_version"],
        "rotation_version": "rotation_v1_research_baseline",
        "model": "rule_leadership_v1",
        "train_end": None,
        "test_range": f"{summary['days'].min() if not summary.empty else 'na'} rows / see daily outputs",
        "config_sha256": _sha256_file(cfg_path),
        "production": {
            "write_decision_result": False,
            "write_portfolio_position": False,
            "auto_execution": False,
            "write_cloudbase": False,
        },
    }
    # 允许覆写：避免重算基线时覆盖历史实验 manifest（审计留痕）
    out = Path(manifest_path) if manifest_path else GEN2_ROOT / "manifests" / f"{EXPERIMENT_ID}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def _markdown_table(df: pd.DataFrame, max_rows: int = 20) -> str:
    if df.empty:
        return "(empty)"
    return "```csv\n" + df.head(max_rows).to_csv(index=False).strip() + "\n```"


def run_rule_baseline(output_dir: str | Path | None = None, *, report_path: str | Path | None = None,
                      manifest_path: str | Path | None = None) -> dict[str, Path]:
    """角色基线回测（V2 权威角色语义 + 唯一权威账本）。

    report_path / manifest_path 允许覆写，避免重算时覆盖历史报告与 manifest。
    """
    out_dir = Path(output_dir) if output_dir else GEN2_ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = load_gen2_config()

    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    validate_rankings(rankings)
    # WP-G2-05：Alpha 显式注入（canonical；替代 Alpha 实验请显式传入）
    selection = canonical_selection_scores(features)
    roles = build_v2_role_view(features, rankings, cfg, selection_scores=selection)
    events = build_rotation_events(roles, config=cfg)
    candidates = build_portfolio_candidates(roles)
    defended = apply_regime_defense(candidates, features, config=cfg)
    labels = build_labels(features)
    rank_ic = rank_ic_by_date(rankings, labels)
    spreads = top_bottom_spread(rankings, labels)
    quantiles = quantile_forward_returns(rankings, labels)
    backtest_summary, _ = run_rotation_backtest(
        features, rankings, candidates, output_dir=out_dir,
        extra_weights={"rule_leadership_rotation_defended": defended[["trade_date", "code", "target_weight"]]},
    )
    cluster_exp = build_cluster_exposure(candidates)
    concentration = cluster_concentration(candidates)
    residence = core_residence_days(roles)
    universe_eligibility = features[["trade_date", "code", "eligibility", "history_days", "feature_version", "data_version"]].copy()
    feature_coverage = features.groupby("code", as_index=False).agg(
        rows=("trade_date", "size"),
        eligible_rows=("eligibility", lambda s: int((s == "ELIGIBLE").sum())),
        first_eligible_date=("trade_date", lambda s: ""),
        last_date=("trade_date", "max"),
    )
    eligible_dates = features[features["eligibility"] == "ELIGIBLE"].groupby("code")["trade_date"].min()
    feature_coverage["first_eligible_date"] = feature_coverage["code"].map(eligible_dates)
    feature_coverage["eligible_ratio"] = feature_coverage["eligible_rows"] / feature_coverage["rows"]

    paths = {
        "features": out_dir / "feature_matrix_v1.csv",
        "rankings": out_dir / "daily_rankings.csv",
        "roles": out_dir / "daily_roles.csv",
        "rotation_events": out_dir / "rotation_events.csv",
        "portfolio_candidates": out_dir / "portfolio_candidates.csv",
        "defended_candidates": out_dir / "portfolio_candidates_defended.csv",
        "labels": out_dir / "labels_v1.csv",
        "rank_ic": out_dir / "rank_ic_by_date.csv",
        "top_bottom_spread": out_dir / "top_bottom_spread.csv",
        "quantile_returns": out_dir / "quantile_forward_returns.csv",
        "cluster_exposure": out_dir / "cluster_exposure.csv",
        "cluster_concentration": out_dir / "cluster_concentration.csv",
        "core_residence": out_dir / "core_residence_days.csv",
        "universe_eligibility": out_dir / "universe_eligibility.csv",
        "feature_coverage": out_dir / "feature_coverage.csv",
        "benchmark_nav": out_dir / "benchmark_nav.csv",
    }
    features.to_csv(paths["features"], index=False)
    rankings.to_csv(paths["rankings"], index=False)
    roles.to_csv(paths["roles"], index=False)
    events.to_csv(paths["rotation_events"], index=False)
    candidates.to_csv(paths["portfolio_candidates"], index=False)
    defended.to_csv(paths["defended_candidates"], index=False)
    labels.to_csv(paths["labels"], index=False)
    rank_ic.to_csv(paths["rank_ic"], index=False)
    spreads.to_csv(paths["top_bottom_spread"], index=False)
    quantiles.to_csv(paths["quantile_returns"], index=False)
    cluster_exp.to_csv(paths["cluster_exposure"], index=False)
    concentration.to_csv(paths["cluster_concentration"], index=False)
    residence.to_csv(paths["core_residence"], index=False)
    universe_eligibility.to_csv(paths["universe_eligibility"], index=False)
    feature_coverage.to_csv(paths["feature_coverage"], index=False)

    manifest_path = _write_manifest(out_dir, cfg, backtest_summary, manifest_path=manifest_path)

    latest_date = rankings["trade_date"].max()
    latest_top = rankings[rankings["trade_date"] == latest_date].head(10)[["rank", "code", "name", "leadership_score", "correlation_cluster", "rank_percentile"]]
    bt10 = backtest_summary[backtest_summary["cost_bps"] == 10.0].sort_values("strategy")
    ic_mean = float(rank_ic["rank_ic"].mean()) if not rank_ic.empty else float("nan")
    ic_pos = float((rank_ic["rank_ic"] > 0).mean()) if not rank_ic.empty else float("nan")
    spread_mean = float(spreads["top_bottom_spread"].mean()) if not spreads.empty else float("nan")

    def _bt_val(name):
        r = backtest_summary[(backtest_summary["strategy"] == name) & (backtest_summary["cost_bps"] == 10.0)]
        return r.iloc[0] if len(r) else None

    bt_rule = _bt_val("rule_leadership_rotation_defended")
    bt_main5 = _bt_val("main5_equal_weight")
    bt_uew = _bt_val("expanded_universe_equal_weight")
    gate_pass = bool(
        bt_rule is not None and bt_main5 is not None
        and bt_rule["sharpe"] > bt_main5["sharpe"]
        and bt_rule["max_drawdown"] >= bt_main5["max_drawdown"]  # MDD 不显著恶化
    )
    verdict = "PASS" if gate_pass else "FAIL / UNPROVEN"

    report = Path(report_path) if report_path else GEN2_ROOT / "reports" / "gen2_rule_baseline_report.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("\n".join([
        "# Gen-2 Rule Leadership Baseline Report v1",
        "",
        f"**Experiment ID**：`{EXPERIMENT_ID}`",
        f"**Universe**：`{cfg['universe']['version']}`（正式 30 只 universe_v1 + benchmark 510300）",
        f"**Feature**：`{cfg['ranking']['feature_version']}`",
        f"**Label**：`{cfg['ranking']['label_version']}`",
        f"**日期范围**：{rankings['trade_date'].min()} 至 {latest_date}",
        f"**Manifest**：`{_display_path(manifest_path)}`",
        "",
        "## 硬约束",
        "",
        "```text",
        "PRODUCTION WRITE = OFF",
        "AUTO TRADING     = OFF",
        "GEN1 MODIFIED    = NO",
        "V361 MODIFIED    = NO",
        "```",
        "",
        "## 核心排名指标（v1）",
        "",
        f"- Rank IC mean：{ic_mean:.4f}",
        f"- Rank IC > 0 日期占比：{ic_pos:.2%}",
        f"- Top-Bottom 20D excess spread mean：{spread_mean:.4f}",
        "",
        "## 最新一日 Top 10",
        "",
        _markdown_table(latest_top),
        "",
        "## 10bps 成本下经济对照（T+1 生效）",
        "",
        _markdown_table(bt10),
        "",
        "## v1 结论与下一步",
        "",
        f"- Rank IC mean = {ic_mean:.4f}；Top-Bottom spread = {spread_mean:.4f}；",
        f"- Rule+防守 Sharpe {bt_rule['sharpe']:.2f} vs Main5 PIT {bt_main5['sharpe']:.2f}（10bps），**Economic Gate = {verdict}**。",
        "",
        "**结论：Rank IC≈0 的根因不是池子大小，而是 Leadership Score 把「找赢家(Alpha)」和「控风险(Utility)」混成一个分，正负因子互相抵消**（component IC：RS/Breakout/Trend +0.03，Vol/Diversification/Stage/Consolidation -0.02~-0.06）。且分 regime 后 RISK_ON IC +0.075、RISK_OFF IC -0.083——「RISK_ON 会选、RISK_OFF 反着选」。详见 `reports/gen2_p0_experiment_framework_fixes.md`。",
        "",
        "下一步优先级（P0 已修实验框架，进入 P1 重构）：",
        "",
        "1. P1：重构 Selection Engine（Market Permission → Alpha Leadership → Cluster Ranking → Portfolio Utility → Role），禁止风险因子混入 Alpha Ranking；",
        "2. P2：补 10 只老 ETF 长历史 + 真实 listing_date + 真实成交额；",
        "3. P3：Rule V2（AlphaScore = Trend+RS+Breakout）walk-forward 验证；",
        "4. P4：Economic Gate 重评（Gen2 V2 vs Main5 PIT vs Universe EW vs V3.6.1 Replay）。",
        "",
        "> 注：component IC 运行 `python -m gen2.evaluation.component_ic`；归因（含 undefended/defended + defense_state）运行 `python -m gen2.evaluation.attribution`。",
        "",
        "## 重要解释边界",
        "",
        "1. `universe_v1` 为正式 30 只选池；其中 10 只老 ETF 腾讯 qfq 仅 640 根约 2.5 年历史，回测早期（2024 年前）universe 不足 30 只。",
        "2. `fixed_main5_system_proxy` / `main5_equal_weight` 为 **Main5 PIT 等权**（只对当日已上市有历史的 Main5 重归一化），并非线上 V3.6.1 完整仓位系统，也非「幸存者偏差的固定等权」。",
        "3. 回测采用 T+1 收盘执行假设（收益 close[T+1]→close[T+2]），消除隔夜 lookahead。",
        "4. 数据已统一截止至最近交易日；部分标的由腾讯 qfq 兜底补齐，复权口径需复核。",
        "5. 本报告用于验证工程链路和动态选池信号，不能作为最终经济结论或上线依据。",
        "",
        "## 输出文件",
        "",
        *[f"- `{_display_path(p)}`" for p in paths.values()],
    ]), encoding="utf-8")
    paths["report"] = report
    paths["manifest"] = manifest_path
    return paths


if __name__ == "__main__":
    result = run_rule_baseline()
    for k, v in result.items():
        print(f"{k}: {v}")
