"""Gen-2 run 级数据质量闸门（Python 等价入口）。

与 ``cloudfunctions/runGen2ShadowEod/index.js`` 的 ``main()`` 数据闸门逐条对齐，
是两个实现之间「同一输入 → 同一 run 状态」的可执行契约（WP-G2-03 / G2S-06）。

闸门顺序（两端必须逐条一致，顺序即优先级）::

    0. NAN_OR_MISSING_FIELD          字段完整性：trade_date 必须存在；OHLCV 必须为有限数值
    1. DUPLICATE_TRADE_DATE          同一 code 不允许重复 trade_date
    2. BENCHMARK_MISSING             benchmark 无数据
    3. BENCHMARK_INSUFFICIENT_HISTORY benchmark 唯一交易日 < benchmark_min_days
    4. STALE_BATCH                   LIVE：benchmark 落后于应到交易日（陈旧批次）
    5. NO_ELIGIBLE_TODAY             全部候选不合格（无数据 / 历史不足 / 陈旧）
    6. UNIVERSE_INCOMPLETE           0 < 合格数 < target_size（缺任一即禁止发布完整横截面）
    7. PUBLISH_VALIDATION_FAILED     发布前完整性：唯一 code / 非有限 alpha / 写入 0 行

状态语义（四态契约，见夹具 ``seam_contracts.run_status_gate``）::

    blocked    数据 / 资格 / 约束不通过 → 今日没有可信结果（可预期业务结果）
    failed     代码 / 网络 / 数据库等运行异常（本模块内不产生；由调用方捕获异常后置位）
    completed  全部闸门通过。**Python 侧不发布**；completed 表示「闸门通过、可发布」，
               等价于 JS 完成发布后的 completed。

只读：不写库、不改规则、不部署。
"""
from __future__ import annotations

import math

#: 关键日线字段（缺失 / 非有限即视为数据不可用）。amount 允许缺失（由 close×volume 估算）。
CRITICAL_BAR_FIELDS = ("open", "high", "low", "close", "volume")

#: 四态取值（与 JS 同名）
STATUS_COMPLETED = "completed"
STATUS_BLOCKED = "blocked"
STATUS_FAILED = "failed"

DATA_GATE_REASON = "DATA_OR_ELIGIBILITY_GATE"
PUBLISH_REASON = "PUBLISH_VALIDATION_FAILED"
SYSTEM_REASON = "SYSTEM_ERROR"


def _date_key(v) -> str:
    return "" if v is None else str(v)[:10]


def _is_finite_number(v) -> bool:
    if v is None or v == "" or isinstance(v, bool):
        return False
    try:
        return math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _blocked(gate: str, detail: str, **extra) -> dict:
    out = {
        "status": STATUS_BLOCKED,
        "status_reason": DATA_GATE_REASON,
        "data_gate": gate,
        "detail": detail,
    }
    out.update(extra)
    return out


def _completed(**extra) -> dict:
    out = {"status": STATUS_COMPLETED, "status_reason": None, "data_gate": None, "detail": None}
    out.update(extra)
    return out


def inspect_bars_integrity(bars_by_code: dict, codes: list) -> dict | None:
    """字段完整性 + 唯一交易日体检；通过返回 None（与 JS inspectBarsIntegrity 同序同判）。"""
    for code in codes:
        rows = bars_by_code.get(code) or []
        if not rows:
            continue  # 缺失由后续 benchmark / eligibility 闸门判定
        seen = set()
        for b in rows:
            d = _date_key(b.get("trade_date"))
            if not d:
                return {"gate": "NAN_OR_MISSING_FIELD", "detail": f"{code} 存在缺失 trade_date 的行", "code": code}
            for f in CRITICAL_BAR_FIELDS:
                if not _is_finite_number(b.get(f)):
                    return {
                        "gate": "NAN_OR_MISSING_FIELD",
                        "detail": f"{code} {d} 字段 {f} 缺失或非有限值（{b.get(f)}）",
                        "code": code, "trade_date": d, "field": f,
                    }
            if d in seen:
                return {"gate": "DUPLICATE_TRADE_DATE", "detail": f"{code} 交易日 {d} 重复",
                        "code": code, "trade_date": d}
            seen.add(d)
    return None


def unique_trade_dates(rows: list) -> list:
    seen, out = set(), []
    for b in rows or []:
        d = _date_key(b.get("trade_date"))
        if not d or d in seen:
            continue
        seen.add(d)
        out.append(d)
    out.sort()
    return out


def evaluate_run_gate(
    bars_by_code: dict,
    *,
    eligible_codes: list,
    benchmark_code: str = "510300",
    target_size: int = 30,
    expected_trade_date: str | None = None,
    mode: str = "REPLAY",
    min_history_days: int = 120,
    benchmark_min_days: int = 60,
) -> dict:
    """run 级数据闸门（与 JS main() 逐条对齐）。返回含 status / status_reason / data_gate 的 dict。"""
    codes_all = list(eligible_codes) + [benchmark_code]

    # 0) 输入完整性
    bad = inspect_bars_integrity(bars_by_code, codes_all)
    if bad:
        return _blocked(bad["gate"], bad["detail"], **{k: v for k, v in bad.items() if k not in ("gate", "detail")})

    # 1) benchmark 存在性 + 唯一交易日完整性
    bench_rows = bars_by_code.get(benchmark_code) or []
    if not bench_rows:
        return _blocked("BENCHMARK_MISSING", f"benchmark {benchmark_code} 无数据，阻断 Gen-2 输出")
    bench_dates = unique_trade_dates(bench_rows)
    if len(bench_dates) < benchmark_min_days:
        return _blocked(
            "BENCHMARK_INSUFFICIENT_HISTORY",
            f"benchmark 唯一交易日不足（{len(bench_dates)}<{benchmark_min_days}），MA20/MA60/vol 必要输入未就绪",
        )
    bench_latest = bench_dates[-1]

    # 2) 应到交易日：LIVE 必须显式传入且数据覆盖到应到日；REPLAY 取 benchmark 最新日
    eff_mode = "REPLAY" if mode != "LIVE" else "LIVE"
    if eff_mode == "LIVE":
        if not expected_trade_date:
            eff_mode = "REPLAY"  # LIVE 缺应到交易日 → 降级历史重放（禁止宣称新鲜）
            as_of = bench_latest
        elif bench_latest < expected_trade_date:
            return _blocked(
                "STALE_BATCH",
                f"benchmark 数据停在 {bench_latest}，落后于应到交易日 {expected_trade_date}，陈旧批次阻断",
                as_of=bench_latest, expected_trade_date=expected_trade_date,
            )
        else:
            as_of = expected_trade_date
    else:
        as_of = bench_latest

    # 3) 逐只候选：唯一交易日 → 历史长度 → 当日新鲜度
    eligible, excluded = [], []
    for c in eligible_codes:
        rows = bars_by_code.get(c) or []
        if not rows:
            excluded.append({"code": c, "reason": "NO_DATA"})
            continue
        ds = unique_trade_dates(rows)
        if len(ds) < min_history_days:
            excluded.append({"code": c, "reason": "INSUFFICIENT_HISTORY", "unique_days": len(ds)})
            continue
        if ds[-1] != as_of:
            excluded.append({"code": c, "reason": "STALE", "last_date": ds[-1]})
            continue
        eligible.append(c)

    if not eligible:
        return _blocked("NO_ELIGIBLE_TODAY", "当日无合格 universe 数据",
                        as_of=as_of, excluded=excluded, eligible_count=0)

    # 4) 完整横截面：缺任一即 blocked（A2/A3：universe_count = target_size 才允许发布）
    if len(eligible) != target_size:
        return _blocked(
            "UNIVERSE_INCOMPLETE",
            f"当日合格横截面 {len(eligible)}/{target_size}，缺 {target_size - len(eligible)} 只，禁止发布不完整横截面",
            as_of=as_of, excluded=excluded, eligible_count=len(eligible),
        )

    return _completed(mode=eff_mode, as_of=as_of, excluded=excluded, eligible_count=len(eligible))


def validate_publish_results(codes: list, alphas: list, written) -> dict:
    """发布前完整性校验（与 JS validatePublishResults 同判）。

    ``codes`` / ``alphas`` 为**行**级序列（允许出现重复 code），``written`` 为实际写入行数。
    """
    codes = list(codes or [])
    alphas = list(alphas or [])
    unique_code_count = len(set(codes))
    non_finite_alpha = sum(0 if _is_finite_number(v) else 1 for v in alphas)
    written_count = int(written) if written is not None and str(written) != "" else 0
    failed = (unique_code_count == 0 or unique_code_count != len(codes)
              or non_finite_alpha > 0 or written_count == 0)
    base = {
        "unique_code_count": unique_code_count,
        "row_count": len(codes),
        "non_finite_alpha": non_finite_alpha,
        "written": written_count,
    }
    if failed:
        return {"status": STATUS_BLOCKED, "status_reason": PUBLISH_REASON,
                "data_gate": PUBLISH_REASON, "detail": "发布前完整性校验未通过", **base}
    return {"status": STATUS_COMPLETED, "status_reason": None, "data_gate": None, "detail": None, **base}
