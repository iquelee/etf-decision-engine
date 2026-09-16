#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""离线测试：`scripts/ml/screen-o2-candidates.py` 的联网前加固（A–E）。

**全部离线**：不发起任何真实网络请求。
* 默认路径全部走 `--offline` + 预置缓存（cache hit ⇒ 0 请求）；
* 需要「成功取数」路径的用例用 `screen._urlopen` 缝合点注入假响应，
  因此既不联网、也不依赖东财可用性。

覆盖：
  A fail-fast（单 URL 1 次尝试 / 不换主机 / 无重试无退避 / 失败即中止）
  B `--cache-root`（默认仓库外稳定路径 / 不在 %TEMP% 与 ~/.cache / 仓库内 fail-closed）
  C `--progress`（JSONL 追加不覆盖 / 逐行内容 / payload sha256 / 请求计数 / summary 行）
  D 悬空引用已消除（`gen2_m1b_survivorship_20260915.md` 在源码与仓库中均不存在）
  E `--candidates`（读快照 / 记录来源 artifact 双口径 sha256 / 标记不可重枚举 / 分类交叉核对）
  加固 F `--max-requests`（联网模式未提供即 fail-closed；第 N+1 次请求**发出前**中止；
                       缓存命中不计入预算；计划前置校验）
  加固 G `--scope`（默认 industry ⇒ 92 条快照**不会**被默认全量请求；真实快照筛选恰为 43 条；
                   43 + 1 日历 = 44 计划；输出 `request_plan` 记录来源 SHA/筛选数/日历数/预算）
  行为契约：失败中止时**不写 `--out`**，且 §2.6 段级结论显式声明未判。
  旧口径更正：旧设计最坏 = `61 个逻辑 URL × 每 URL 最多 8 次 = 488 次 HTTP 请求`，
  主机轮换只是**每次尝试的选址逻辑**、不额外倍增（不得写成 ×5）。
"""
from __future__ import annotations

import contextlib
import csv
import hashlib
import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
import urllib.error
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "ml" / "screen-o2-candidates.py"
GAP_AUDIT = REPO / "ml" / "gen2" / "reports" / "gen2_m1b_gap_audit_20260916.md"
#: 真实 `AUDIT_SCOPE_SNAPSHOT`（92 条）—— 行业筛选计数 43 的机械证明对象
SNAPSHOT = REPO / "ml" / "gen2" / "reports" / "gen2_m1b_o2_candidates_20260915.json"
DANGLING = "gen2_m1b_survivorship_20260915.md"


def load_screen():
    spec = importlib.util.spec_from_file_location("screen_o2", SCRIPT)
    m = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(m)
    return m


screen = load_screen()
SRC = SCRIPT.read_text(encoding="utf-8")


def code_only(src: str) -> str:
    """剥掉**所有**三引号文档串与行注释，只留**可执行代码**。

    断言「代码里已无旧重试/主机轮换」必须基于此 —— 模块与函数的 docstring 会**刻意保留**
    旧行为的描述（`tries=8` / 主机轮换），那是变更记录，不是残留。
    """
    body = re.sub(r'"""[\s\S]*?"""', "", src)
    return "\n".join(ln.split("#")[0] for ln in body.splitlines())


CODE = code_only(SRC)


# ------------------------------------------------------------------ 测试工具
def business_days(n: int, start=(2016, 1, 4)) -> list[str]:
    d, out = date(*start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def kline_payload(rows: int = 300, amount: float = 1.0e8, start=(2016, 1, 4)) -> dict:
    """构造合法 kline payload：amount 单位「元」，1e8 元 = 10000 万 ≥ 门槛 3000 万。"""
    return {"data": {"name": "FAKE",
                     "klines": [f"{d},1.0,1.0,1.0,1.0,1000,{amount:.0f}"
                                for d in business_days(rows, start)]}}


def calendar_payload() -> dict:
    # 800 个交易日（≈2015-01 → 2018-01）必须**长于**候选序列，否则停牌缺口窗口会被截断
    return {"data": {"name": "上证指数",
                     "klines": [f"{d},1.0,1.0,1.0,1.0,1000,1.0e8"
                                for d in business_days(800, (2015, 1, 5))]}}


def enum_payload(codes: list[tuple[str, str]]) -> dict:
    """clist 原始响应（网络枚举路径用）。"""
    return {"data": {"total": len(codes),
                     "diff": [{"f12": c, "f13": 1, "f14": n, "f26": 20150616,
                               "f6": 1.0e8, "f20": 2.0e10} for c, n in codes]}}


def enum_rows(codes: list[tuple[str, str]]) -> list[dict]:
    """`--enum` 期望的形状 = `clist_all()` 的落盘结果（**行数组**），不是 clist 原始响应。"""
    return [{"f12": c, "f13": 1, "f14": n, "f26": 20150616, "f6": 1.0e8, "f20": 2.0e10}
            for c, n in codes]


def kline_url(code: str, fqt: int = 1) -> str:
    m1a = screen._load_m1a()
    return m1a.kline_url(m1a.secid_of(code), fqt)


def cal_url() -> str:
    m1a = screen._load_m1a()
    return m1a.kline_url(m1a.CALENDAR_SECID, 0)


def seed(cache: Path, url: str, sub: str, payload: dict) -> bytes:
    fp = screen.Fetcher(cache).path_for(url, sub)
    fp.parent.mkdir(parents=True, exist_ok=True)
    b = json.dumps(payload).encode("utf-8")
    fp.write_bytes(b)
    return b


class _FakeResp:
    def __init__(self, body: bytes, status: int = 200):
        self._b, self.status = body, status

    def read(self) -> bytes:
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeUrlopen:
    """假 urlopen：记录每个被请求的 URL，按 router 返回 payload；可指定某 URL 抛错。"""

    def __init__(self, router, fail_url: str | None = None, fail_exc: Exception | None = None):
        self.router, self.fail_url, self.fail_exc = router, fail_url, fail_exc
        self.calls: list[str] = []

    def __call__(self, req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        self.calls.append(url)
        if self.fail_url and url == self.fail_url:
            raise self.fail_exc or urllib.error.URLError("boom")
        return _FakeResp(json.dumps(self.router(url)).encode("utf-8"), 200)


def read_jsonl(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


class ScreenTestBase(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.tmp = Path(self._td.name)
        self.cache = self.tmp / "cache"
        self.out = self.tmp / "out.json"
        self.prog = self.tmp / "progress.jsonl"

    def tearDown(self):
        self._td.cleanup()

    # ---- 夹具
    def free_codes(self, n: int) -> list[str]:
        """取 n 个**不在 etf_master 现有池内**的代码（枚举路径的候选筛不得被误伤）。"""
        path = REPO / "ml" / "gen2" / "universe" / "etf_master.csv"
        with open(path, encoding="utf-8-sig", newline="") as fh:
            pool = {r["code"] for r in csv.DictReader(fh)}
        out, i = [], 0
        while len(out) < n:
            c = f"5999{i:02d}"
            if c not in pool:
                out.append(c)
            i += 1
        return out

    def sector_names(self, n: int) -> list[str]:
        """取 n 个被 keyword_rule_v1 判为**行业类**的 ETF 名称。

        行业类判据与脚本一致：**分类学重算的 L2 cluster ∉ NON_SECTOR_CLUSTERS**
        （仅 `kind != excluded` 不够 —— `broad_beta` 之类 kind 也可以是 `non_sector`）。
        """
        taxy = screen._load_taxy()
        pool = ["景顺长城中证科技传媒通信150ETF", "南方中证申万有色金属ETF",
                "华宝中证医疗ETF", "国泰中证全指证券公司ETF", "广发中证全指信息技术ETF",
                "华夏中证新能源汽车ETF"]
        ok = [x for x in pool
              if taxy.classify_name(x)[0] not in taxy.NON_SECTOR_CLUSTERS
              and taxy.classify_name(x)[1] not in ("excluded", "unknown")]
        if not ok:
            self.skipTest("分类学中找不到行业类样例名称")
        return [ok[i % len(ok)] for i in range(n)]

    def non_sector_names(self, n: int) -> list[str]:
        """取 n 个 L2 cluster **落在 NON_SECTOR_CLUSTERS 内**的名称（`--scope` 过滤靶子）。"""
        taxy = screen._load_taxy()
        pool = ["华安黄金易ETF", "博时黄金ETF", "易方达黄金ETF", "南方中证500ETF",
                "华夏沪深300ETF", "嘉实沪深300ETF"]
        ok = [x for x in pool if taxy.classify_name(x)[0] in taxy.NON_SECTOR_CLUSTERS]
        if not ok:
            self.skipTest("分类学中找不到非行业类样例名称")
        return [ok[i % len(ok)] for i in range(n)]

    def taxonomy_rows(self, n: int = 3) -> list[dict]:
        taxy = screen._load_taxy()
        codes, names = self.free_codes(n), self.sector_names(n)
        rows = []
        for i in range(n):
            cl, kind = taxy.classify_name(names[i])
            rows.append({"code": codes[i], "name": names[i], "market": "SH",
                         "listing_date_vendor": f"2015-06-1{i + 1}",
                         "in_current_pool": False, "l2_cluster": cl, "kind": kind,
                         "l1_sector": taxy.L2_TO_L1.get(cl),
                         "coverage_eligible": cl not in taxy.NON_SECTOR_CLUSTERS,
                         "amount_wan_today": 1234.5, "mktcap_yi_today": 10.0})
        return rows

    def mixed_rows(self, n_industry: int, n_non_sector: int) -> list[dict]:
        """行业类 + 非行业类混合候选（用于验证 `--scope` 默认只取行业类）。"""
        taxy = screen._load_taxy()
        codes = self.free_codes(n_industry + n_non_sector)
        names = self.sector_names(n_industry) + self.non_sector_names(n_non_sector)
        rows = []
        for i, name in enumerate(names):
            cl, kind = taxy.classify_name(name)
            rows.append({"code": codes[i], "name": name, "market": "SH",
                         "listing_date_vendor": f"2015-06-{i + 1:02d}",
                         "in_current_pool": False, "l2_cluster": cl, "kind": kind,
                         "l1_sector": taxy.L2_TO_L1.get(cl),
                         "coverage_eligible": cl not in taxy.NON_SECTOR_CLUSTERS,
                         "amount_wan_today": 1234.5, "mktcap_yi_today": 10.0})
        return rows

    def write_snapshot(self, rows: list[dict], name: str = "snap.json") -> Path:
        p = self.tmp / name
        p.write_text(json.dumps({"audit": "gen2_m1b_o2_candidate_screen",
                                 "generated_on": "2026-09-15", "authority": {}, "method": {},
                                 "thresholds": {}, "summary": {"coverage_denominator": 8},
                                 "candidates": rows, "universe_scan": {}},
                                ensure_ascii=False, indent=1), encoding="utf-8")
        return p

    def seed_all(self, codes: list[str]) -> None:
        seed(self.cache, cal_url(), "kline", calendar_payload())
        for c in codes:
            seed(self.cache, kline_url(c), "kline", kline_payload())

    def run_main(self, argv: list[str]) -> tuple[int, str]:
        with mock.patch.object(sys, "argv", ["screen-o2-candidates.py"] + argv), \
                contextlib.redirect_stdout(io.StringIO()) as buf:
            rc = screen.main()
        return rc, buf.getvalue()

    def snapshot_argv(self, snap: Path, **extra) -> list[str]:
        argv = ["--out", str(self.out), "--cache", str(self.cache),
                "--offline", "--candidates", str(snap), "--progress", str(self.prog)]
        for k, v in extra.items():
            argv += ["--" + k.replace("_", "-"), str(v)]
        return argv


# ------------------------------------------------------------------ A：fail-fast
class FailFastTest(ScreenTestBase):
    def test_constants_and_legacy_rotation_removed(self):
        self.assertEqual(screen.ATTEMPTS_PER_URL, 1)
        self.assertFalse(screen.HOST_ROTATION)
        # 旧版轮换常量与退避循环必须已从**可执行代码**中消失
        for bad in ("1.push2his", "82.push2his", "push2delay", "for i in range(tries)",
                    "tries=8", "CLIST_HOSTS", "KL_HOSTS", "hosts["):
            self.assertNotIn(bad, CODE, f"可执行代码残留旧重试/轮换痕迹：{bad}")
        # 而旧行为必须在文档串里被**记录**（变更可追溯），故 SRC 中应仍可见
        self.assertIn("tries=8", SRC)
        self.assertIn("主机轮换", SRC)

    def test_single_attempt_then_fetch_error(self):
        url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.512220"
        fake = FakeUrlopen(lambda u: {}, fail_url=url, fail_exc=urllib.error.URLError("reset"))
        with mock.patch.object(screen, "_urlopen", fake), \
                mock.patch("time.sleep") as slp:
            with self.assertRaises(screen.FetchError):
                screen.Fetcher(self.cache, pause=0.0).get(url, "kline", role="kline",
                                                          code="512220")
            self.assertEqual(len(fake.calls), 1, "必须只尝试 1 次")
            self.assertEqual(slp.call_count, 0, "失败不得退避/重试等待")

    def test_no_host_substitution_on_attempt(self):
        url = "https://1.push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.512220"
        fake = FakeUrlopen(lambda u: kline_payload())
        with mock.patch.object(screen, "_urlopen", fake), mock.patch("time.sleep"):
            screen.Fetcher(self.cache, pause=0.0).get(url, "kline", role="kline")
        self.assertEqual(fake.calls, [url], "请求 URL 必须与给定 URL 逐字相同（不换主机）")

    def test_http_error_records_status_code_in_progress(self):
        url = kline_url("512220")
        exc = urllib.error.HTTPError(url, 429, "Too Many Requests", None, None)
        fake = FakeUrlopen(lambda u: {}, fail_url=url, fail_exc=exc)
        pw = screen.ProgressWriter(self.prog)
        with mock.patch.object(screen, "_urlopen", fake):
            with self.assertRaises(screen.FetchError):
                screen.Fetcher(self.cache, pause=0.0, progress=pw).get(
                    url, "kline", role="kline", code="512220")
        pw.close(aborted=True)          # Windows：句柄不关闭会挡住 tempdir 清理
        rec = read_jsonl(self.prog)[0]
        self.assertEqual(rec["type"], "fetch_error")
        self.assertEqual(rec["http_status"], 429)
        self.assertEqual(rec["attempts"], 1)
        self.assertEqual(rec["source"], "network")

    def test_cache_hit_costs_zero_requests_and_no_sleep(self):
        url = kline_url("512220")
        seed(self.cache, url, "kline", kline_payload())
        f = screen.Fetcher(self.cache, pause=2.5)
        with mock.patch("time.sleep") as slp:
            b = f.get(url, "kline", role="kline", code="512220")
        self.assertTrue(b)
        self.assertEqual((f.requests, f.cache_hits), (0, 1))
        self.assertEqual(slp.call_count, 0, "缓存命中不得 sleep")

    def test_one_request_per_url_on_success_path(self):
        """成功路径请求数必须恰为 1×N（旧版 tries=8 ⇒ 最坏 8×N）。"""
        rows = self.taxonomy_rows(3)
        enum_fp = self.tmp / "enum.json"
        enum_fp.write_text(json.dumps(enum_rows([(r["code"], r["name"]) for r in rows])),
                           encoding="utf-8")
        router = lambda u: (calendar_payload() if "1.000001" in u else kline_payload())
        fake = FakeUrlopen(router)
        with mock.patch.object(screen, "_urlopen", fake):
            rc, _ = self.run_main(["--out", str(self.out), "--cache", str(self.cache),
                                   "--enum", str(enum_fp), "--pause", "0",
                                   "--max-requests", "4",          # 0 枚举 + 1 日历 + 3 候选
                                   "--progress", str(self.prog)])
        self.assertEqual(rc, 0)
        self.assertEqual(len(fake.calls), 1 + 3, "应为 1 次日历 + 3 只候选 = 4 次请求")
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["fetch"]["network_requests"], 4)
        self.assertEqual(payload["summary"]["fetch"]["cache_hits"], 0)
        self.assertEqual(payload["summary"]["candidates_with_kline"], 3)
        self.assertEqual(payload["summary"]["fetch"]["attempts_per_url"], 1)
        self.assertFalse(payload["summary"]["fetch"]["host_rotation"])

    def test_live_enumeration_uses_single_host_and_single_page(self):
        rows = self.taxonomy_rows(2)
        pairs = [(r["code"], r["name"]) for r in rows]
        clist_hits: list[str] = []

        def router(u):
            if "clist/get" in u:
                clist_hits.append(u)
                return enum_payload(pairs)
            return calendar_payload() if "1.000001" in u else kline_payload()

        fake = FakeUrlopen(router)
        with mock.patch.object(screen, "_urlopen", fake):
            rc, _ = self.run_main(["--out", str(self.out), "--cache", str(self.cache),
                                   "--pause", "0",
                                   "--max-requests", "4"])       # 1 枚举 + 1 日历 + 2 候选
        self.assertEqual(rc, 0)
        self.assertEqual(len(clist_hits), 1, "总数 ≤ pz=100 时应只翻 1 页（不重复翻页）")
        self.assertTrue(clist_hits[0].startswith(
            "https://push2.eastmoney.com/api/qt/clist/get"), "枚举必须走单一主机，不轮换")
        self.assertEqual(len(fake.calls), 1 + 1 + 2, "1 枚举 + 1 日历 + 2 候选")
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["universe_scan"]["enumerated_total"], 2)
        self.assertEqual(payload["summary"]["candidates_total"], 2)

    def test_enum_file_must_be_row_array(self):
        """`--enum` 必须是行数组（原语义）；喂 clist 原始响应要**响亮失败**而不是崩在循环里。"""
        bad = self.tmp / "enum_bad.json"
        bad.write_text(json.dumps(enum_payload([("599900", "x")])), encoding="utf-8")
        with mock.patch.object(sys, "argv", ["p", "--out", str(self.out),
                                             "--enum", str(bad)]), \
                contextlib.redirect_stdout(io.StringIO()), \
                self.assertRaises(SystemExit):
            screen.main()


# ------------------------------------------------------------------ B：缓存根
class CacheRootTest(ScreenTestBase):
    def test_default_root_is_outside_repo_temp_and_user_cache(self):
        d = screen.DEFAULT_CACHE_ROOT.resolve()
        rp = REPO.resolve()
        self.assertNotIn(rp, d.parents, "默认缓存根不得在仓库内")
        self.assertNotIn(Path(tempfile.gettempdir()).resolve(), d.parents, "不得在 %TEMP%")
        self.assertNotIn((Path.home() / ".cache").resolve(), d.parents, "不得在 ~/.cache")
        self.assertEqual(d.name, screen.DATA_VERSION)
        self.assertIn(screen.CACHE_NAMESPACE, d.parts)

    def test_cache_root_arg_embeds_data_version(self):
        p = screen.resolve_cache(None, str(self.tmp / "root"))
        self.assertEqual(p, Path(self.tmp / "root") / screen.DATA_VERSION)

    def test_cache_arg_takes_priority(self):
        p = screen.resolve_cache(str(self.tmp / "exact"), str(self.tmp / "root"))
        self.assertEqual(p, Path(self.tmp / "exact"))

    def test_cache_inside_repo_fails_closed(self):
        with self.assertRaises(SystemExit):
            screen.resolve_cache(str(REPO / ".cache" / "x"), None)
        with self.assertRaises(SystemExit):
            screen.resolve_cache(str(REPO), None)

    def test_default_used_when_nothing_passed(self):
        self.assertEqual(screen.resolve_cache(None, None), screen.DEFAULT_CACHE_ROOT)

    def test_fetcher_path_for_is_url_keyed(self):
        f = screen.Fetcher(self.tmp)
        self.assertEqual(f.path_for("https://a/b", "kline").name,
                         hashlib.sha256(b"https://a/b").hexdigest()[:16] + ".json")


# ------------------------------------------------------------------ C：进度留痕
class ProgressTest(ScreenTestBase):
    def test_append_not_overwrite(self):
        self.prog.write_text('{"type":"sentinel"}\n', encoding="utf-8")
        rows = self.taxonomy_rows(2)
        snap = self.write_snapshot(rows)
        self.seed_all([r["code"] for r in rows])
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        lines = read_jsonl(self.prog)
        self.assertEqual(lines[0]["type"], "sentinel", "必须追加而非覆盖")

    def test_exact_line_count_when_abort_at_first_candidate(self):
        rows = self.taxonomy_rows(3)
        snap = self.write_snapshot(rows)
        seed(self.cache, cal_url(), "kline", calendar_payload())   # 只有日历有缓存
        rc, out = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 2)
        self.assertFalse(self.out.exists(), "中止时不得写 --out")
        lines = read_jsonl(self.prog)
        self.assertEqual(len(lines), 3, "1 日历(命中) + 1 候选(缺失) + 1 summary")
        self.assertEqual(lines[0]["role"], "calendar")
        self.assertEqual(lines[0]["source"], "cache")
        self.assertEqual(lines[1]["type"], "fetch_error")
        self.assertEqual(lines[1]["role"], "kline")
        self.assertEqual(lines[1]["code"], rows[0]["code"])
        self.assertEqual(lines[2]["type"], "summary")
        self.assertTrue(lines[2]["aborted"])
        self.assertEqual(lines[2]["failures"], 1)
        self.assertEqual(lines[2]["requests_network"], 0)
        self.assertIn("fail-fast", out)

    def test_offline_empty_cache_aborts_without_out(self):
        rows = self.taxonomy_rows(2)
        snap = self.write_snapshot(rows)
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 2)
        self.assertFalse(self.out.exists())
        lines = read_jsonl(self.prog)
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["type"], "fetch_error")
        self.assertEqual(lines[0]["role"], "calendar")
        self.assertEqual(lines[0]["source"], "offline")
        self.assertIn("FileNotFoundError", lines[0]["error"])

    def test_success_lines_payload_sha256_matches_bytes(self):
        rows = self.taxonomy_rows(2)
        codes = [r["code"] for r in rows]
        snap = self.write_snapshot(rows)
        self.seed_all(codes)
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        lines = read_jsonl(self.prog)
        fetched = [x for x in lines if x["type"] == "fetch"]
        self.assertEqual(len(fetched), 1 + len(codes))
        for rec in fetched:
            fp = screen.Fetcher(self.cache).path_for(rec["url"],
                                                     "clist" if rec["role"] == "enumerate" else "kline")
            self.assertEqual(rec["payload_sha256"],
                             hashlib.sha256(fp.read_bytes()).hexdigest())
            self.assertEqual(rec["bytes"], fp.stat().st_size)
            self.assertEqual(rec["attempts"], 0)   # 缓存命中：0 次尝试
            self.assertEqual(rec["source"], "cache")
        summary = lines[-1]
        self.assertEqual(summary["type"], "summary")
        self.assertFalse(summary["aborted"])
        self.assertEqual(summary["cache_hits"], 1 + len(codes))
        self.assertEqual(summary["requests_network"], 0)

    def test_progress_lines_have_generated_on_and_ts(self):
        rows = self.taxonomy_rows(1)
        snap = self.write_snapshot(rows)
        self.seed_all([rows[0]["code"]])
        self.run_main(self.snapshot_argv(snap))
        for rec in read_jsonl(self.prog):
            self.assertEqual(rec["generated_on"], date.today().isoformat())
            self.assertRegex(rec["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


# ------------------------------------------------------------------ D：悬空引用
class DanglingReferenceTest(unittest.TestCase):
    def test_dangling_survivorship_reference_removed(self):
        self.assertNotIn(DANGLING, CODE, "可执行代码不得引用该悬空文件")
        self.assertFalse((REPO / "ml" / "gen2" / "reports" / DANGLING).exists())
        m1a = (REPO / "scripts" / "ml" / "audit-m1a-etf-history.py").read_text(encoding="utf-8")
        self.assertNotIn(DANGLING, m1a)
        # 文档串若提到该名字，只能作为「已删除的悬空引用」出现在勘误上下文里
        if DANGLING in SRC:
            i = SRC.index(DANGLING)
            ctx = SRC[max(0, i - 260): i + 260]
            self.assertTrue("悬空" in ctx or "不存在" in ctx or "已删除" in ctx,
                            "提到该文件名时必须在勘误上下文中说明它不存在")

    def test_new_pointer_exists(self):
        self.assertIn("gen2_m1b_gap_audit_20260916.md", SRC)
        self.assertTrue(GAP_AUDIT.is_file(), "新指针必须指向真实存在的文件")

    def test_paths_referenced_by_script_exist(self):
        self.assertTrue((REPO / "scripts" / "ml" / "build-cluster-taxonomy.py").is_file())
        self.assertTrue((REPO / "scripts" / "ml" / "audit-m1a-etf-history.py").is_file())
        self.assertTrue((REPO / "ml" / "gen2" / "universe" / "etf_master.csv").is_file())


# ------------------------------------------------------------------ E：--candidates
class CandidatesSnapshotTest(ScreenTestBase):
    def test_snapshot_mode_skips_enumeration_and_records_artifact_fingerprints(self):
        rows = self.taxonomy_rows(3)
        snap = self.write_snapshot(rows)
        raw = snap.read_bytes()
        codes = [r["code"] for r in rows]
        self.seed_all(codes)
        fake = FakeUrlopen(lambda u: {})
        with mock.patch.object(screen, "_urlopen", fake):
            rc, out = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        self.assertEqual(fake.calls, [], "快照模式必须一次网络请求都不发（本次全命中缓存）")
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        cs = payload["candidates_source"]
        self.assertEqual(cs["sha256_raw"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(cs["sha256_normalized_crlf_lf"],
                         hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest())
        self.assertTrue(cs["audit_scope_snapshot"])
        self.assertFalse(cs["reproducible_by_reenumeration"])
        self.assertEqual(cs["artifact_generated_on"], "2026-09-15")
        self.assertEqual([c["code"] for c in payload["candidates"]], sorted(codes))
        self.assertEqual(payload["summary"]["candidates_with_kline"], len(codes))
        self.assertIsNone(payload["universe_scan"]["enumerated_total"])
        self.assertIn("快照", out)

    def test_snapshot_requires_candidates_array(self):
        bad = self.tmp / "bad.json"
        bad.write_text('{"candidates": []}', encoding="utf-8")
        with self.assertRaises(SystemExit):
            screen.load_candidates_snapshot(bad)

    def test_snapshot_classification_mismatch_detected(self):
        rows = self.taxonomy_rows(2)
        rows[0]["l2_cluster"] = "definitely_not_the_recomputed_cluster"
        snap = self.write_snapshot(rows)
        self.seed_all([r["code"] for r in rows])
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        mism = payload["summary"]["snapshot_classification_mismatches"]
        self.assertEqual([m["code"] for m in mism], [rows[0]["code"]])
        self.assertEqual(mism[0]["snapshot"], "definitely_not_the_recomputed_cluster")

    def test_snapshot_and_enum_are_mutually_exclusive(self):
        snap = self.write_snapshot(self.taxonomy_rows(1))
        enum_fp = self.tmp / "enum.json"
        enum_fp.write_text(json.dumps(enum_payload([("512220", "x")])), encoding="utf-8")
        with mock.patch.object(sys, "argv", ["p", "--out", str(self.out),
                                             "--enum", str(enum_fp),
                                             "--candidates", str(snap)]), \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit):
            screen.main()

    def test_snapshot_resets_previous_data_verdicts(self):
        rows = self.taxonomy_rows(2)
        for r in rows:
            r["data_ok"] = False
            r["data_error"] = "FileNotFoundError: offline 且无缓存"
        snap = self.write_snapshot(rows)
        self.seed_all([r["code"] for r in rows])
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        for c in payload["candidates"]:
            self.assertTrue(c["data_ok"])
            self.assertNotIn("data_error", c)
            self.assertTrue(c["kline_payload_sha256"])
            self.assertTrue(c["from_snapshot"])


# ------------------------------------------------------------------ 加固 F：请求预算
class RequestBudgetTest(ScreenTestBase):
    def test_network_mode_without_max_requests_fails_closed(self):
        """联网模式（未加 `--offline`）未提供 `--max-requests` ⇒ 拒绝运行，且一个请求都不发。"""
        rows = self.taxonomy_rows(1)
        enum_fp = self.tmp / "enum.json"
        enum_fp.write_text(json.dumps(enum_rows([(rows[0]["code"], rows[0]["name"])])),
                           encoding="utf-8")
        fake = FakeUrlopen(lambda u: {})
        with mock.patch.object(screen, "_urlopen", fake):
            with self.assertRaises(SystemExit) as cm:
                self.run_main(["--out", str(self.out), "--cache", str(self.cache),
                               "--enum", str(enum_fp), "--pause", "0"])
        self.assertIn("--max-requests", str(cm.exception))
        self.assertIn(str(screen.STAGE_A_MAX_REQUESTS), str(cm.exception),
                      "报错里必须给出 Stage A 的 44 口径")
        self.assertEqual(fake.calls, [], "fail-closed 必须发生在任何请求之前")
        self.assertFalse(self.out.exists())

    def test_negative_budget_rejected(self):
        with self.assertRaises(SystemExit):
            self.run_main(["--out", str(self.out), "--cache", str(self.cache),
                           "--max-requests=-1"])

    def test_offline_mode_does_not_require_max_requests(self):
        rows = self.taxonomy_rows(1)
        snap = self.write_snapshot(rows)
        self.seed_all([rows[0]["code"]])
        rc, _ = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0, "纯离线复算不得被强制要求 --max-requests")
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertIsNone(payload["request_plan"]["max_requests"])
        self.assertIsNone(payload["summary"]["fetch"]["max_requests"])

    def test_aborts_before_the_45th_request_when_budget_is_44(self):
        """预算 44：前 44 次放行；第 45 次**在发出之前**中止（不是事后只汇总计数）。"""
        codes = self.free_codes(50)
        fake = FakeUrlopen(lambda u: kline_payload())
        f = screen.Fetcher(self.cache, pause=0.0, max_requests=44)
        with mock.patch.object(screen, "_urlopen", fake), mock.patch("time.sleep"):
            for c in codes[:44]:
                f.get(kline_url(c), "kline", role="kline", code=c)
            self.assertEqual((f.requests, f.cache_hits), (44, 0))
            self.assertEqual(f.budget_remaining(), 0)
            with self.assertRaises(screen.RequestBudgetExceeded):
                f.get(kline_url(codes[44]), "kline", role="kline", code=codes[44])
        self.assertEqual(len(fake.calls), 44, "第 45 次网络请求必须**没有发出**")
        self.assertEqual(f.requests, 44)
        self.assertNotIn(kline_url(codes[44]), fake.calls)
        self.assertEqual(f.failures, 1)

    def test_cache_hits_do_not_consume_budget(self):
        """缓存命中 = 0 网络请求 ⇒ 不吃预算（预算只约束**真实网络请求**）。"""
        codes = self.free_codes(4)
        for c in codes[:3]:
            seed(self.cache, kline_url(c), "kline", kline_payload())
        fake = FakeUrlopen(lambda u: kline_payload())
        f = screen.Fetcher(self.cache, pause=0.0, max_requests=1)
        with mock.patch.object(screen, "_urlopen", fake), mock.patch("time.sleep"):
            for c in codes[:3]:
                f.get(kline_url(c), "kline", role="kline", code=c)
            self.assertEqual((f.requests, f.cache_hits), (0, 3), "3 次命中不消耗任何预算")
            self.assertEqual(f.budget_remaining(), 1)
            f.get(kline_url(codes[3]), "kline", role="kline", code=codes[3])
            self.assertEqual((f.requests, f.cache_hits), (1, 3))
            self.assertEqual(f.budget_remaining(), 0)
            with self.assertRaises(screen.RequestBudgetExceeded):
                f.get(kline_url(codes[3]) + "&extra=1", "kline", role="kline")
        self.assertEqual(len(fake.calls), 1, "预算 1 ⇒ 网络请求恰好 1 次")

    def test_budget_exceeded_is_recorded_in_progress(self):
        fake = FakeUrlopen(lambda u: kline_payload())
        pw = screen.ProgressWriter(self.prog)
        f = screen.Fetcher(self.cache, pause=0.0, progress=pw, max_requests=0)
        with mock.patch.object(screen, "_urlopen", fake):
            with self.assertRaises(screen.RequestBudgetExceeded):
                f.get(kline_url("512220"), "kline", role="kline", code="512220")
        pw.close(aborted=True)
        self.assertEqual(fake.calls, [], "预算 0 ⇒ 不得发出任何请求")
        rec = read_jsonl(self.prog)[0]
        self.assertEqual(rec["type"], "budget_exceeded")
        self.assertEqual(rec["requests_so_far"], 0)
        self.assertEqual(rec["max_requests"], 0)
        self.assertEqual(rec["attempts"], 0)
        self.assertEqual(rec["source"], "network")
        self.assertIn("RequestBudgetExceeded", rec["error"])

    def test_plan_exceeding_budget_aborts_before_any_request(self):
        """`--scope all` 让计划 = 0 + 1 + 5 = 6 > 预算 3 ⇒ 在任何请求之前中止。"""
        rows = self.mixed_rows(3, 2)
        snap = self.write_snapshot(rows)
        fake = FakeUrlopen(lambda u: kline_payload())
        with mock.patch.object(screen, "_urlopen", fake):
            rc, _ = self.run_main(["--out", str(self.out), "--cache", str(self.cache),
                                   "--candidates", str(snap), "--scope", "all",
                                   "--max-requests", "3", "--pause", "0",
                                   "--progress", str(self.prog)])
        self.assertEqual(rc, 2)
        self.assertEqual(fake.calls, [], "计划超预算必须在**任何**请求之前中止")
        self.assertFalse(self.out.exists(), "中止时不写 --out")
        recs = read_jsonl(self.prog)
        self.assertEqual(recs[0]["type"], "plan_rejected")
        self.assertEqual(recs[0]["planned_requests"], 6)
        self.assertEqual(recs[0]["max_requests"], 3)
        self.assertIn("请求计划", recs[0]["error"])
        self.assertEqual(recs[-1]["type"], "summary")
        self.assertTrue(recs[-1]["aborted"])


# ------------------------------------------------------------------ 加固 G：Stage A 计划（43 + 1 = 44）
class StageAPlanTest(ScreenTestBase):
    def test_stage_a_constants_are_43_plus_1_equals_44(self):
        self.assertEqual(screen.STAGE_A_INDUSTRY_CANDIDATES, 43)
        self.assertEqual(screen.CALENDAR_REQUESTS, 1)
        self.assertEqual(screen.STAGE_A_MAX_REQUESTS, 44)
        self.assertEqual(screen.STAGE_A_MAX_REQUESTS,
                         screen.STAGE_A_INDUSTRY_CANDIDATES + screen.CALENDAR_REQUESTS)

    def test_real_snapshot_industry_filter_is_exactly_43(self):
        """机械证明：真实 92 条 `AUDIT_SCOPE_SNAPSHOT` 经行业筛选后**恰为 43 条**。"""
        self.assertTrue(SNAPSHOT.is_file(), f"缺少快照：{SNAPSHOT}")
        raw = SNAPSHOT.read_bytes()
        doc = json.loads(raw.decode("utf-8"))
        self.assertEqual(len(doc["candidates"]), 92)
        cand, meta = screen.load_candidates_snapshot(SNAPSHOT)
        self.assertEqual(meta["snapshot_count"], 92)
        self.assertEqual(meta["sha256_raw"], hashlib.sha256(raw).hexdigest())
        taxy = screen._load_taxy()
        selected = screen.apply_scope(cand, screen.SCOPE_INDUSTRY, taxy)
        self.assertEqual(len(selected), 43)
        self.assertEqual(len(selected), screen.STAGE_A_INDUSTRY_CANDIDATES)
        # 交叉核对：快照自带的 coverage_eligible 集合必须与**分类学重算**结果逐位相同
        by_field = {r["code"] for r in doc["candidates"] if r.get("coverage_eligible")}
        self.assertEqual({r["code"] for r in selected}, by_field)
        # 反向：`--scope all` 才是 92
        self.assertEqual(len(screen.apply_scope(cand, screen.SCOPE_ALL, taxy)), 92)

    def test_stage_a_plan_is_exactly_44(self):
        plan = screen.build_request_plan(
            scope=screen.SCOPE_INDUSTRY, selected_code_count=screen.STAGE_A_INDUSTRY_CANDIDATES,
            enumeration_requests=0, snapshot_meta=None,
            max_requests=screen.STAGE_A_MAX_REQUESTS)
        self.assertEqual(plan["enumeration_requests"], 0, "快照模式不枚举")
        self.assertEqual(plan["selected_code_count"], 43)
        self.assertEqual(plan["calendar_requests"], 1)
        self.assertEqual(plan["planned_requests"], 44)
        self.assertEqual(plan["max_requests"], 44)
        self.assertEqual(plan["planned_formula"], "枚举 0 + 日历 1 + 候选 43 = 44")
        self.assertTrue(plan["budget_sufficient"])
        self.assertEqual(plan["budget_remaining_after_plan"], 0)
        self.assertTrue(plan["matches_stage_a_caliber"])
        self.assertEqual(plan["stage_a_reference"]["planned_requests"], 44)

    def test_real_snapshot_plan_is_exactly_44(self):
        """端到端机械化：真实快照 + 默认 scope ⇒ 计划恰为 44。"""
        cand, meta = screen.load_candidates_snapshot(SNAPSHOT)
        selected = screen.apply_scope(cand, screen.SCOPE_INDUSTRY, screen._load_taxy())
        plan = screen.build_request_plan(
            scope=screen.SCOPE_INDUSTRY, selected_code_count=len(selected),
            enumeration_requests=0, snapshot_meta=meta,
            max_requests=screen.STAGE_A_MAX_REQUESTS)
        self.assertEqual(plan["planned_requests"], 44)
        self.assertEqual(plan["snapshot_count"], 92)
        self.assertEqual(plan["selected_code_count"], 43)
        self.assertEqual(plan["candidate_source_sha256_raw"], meta["sha256_raw"])
        self.assertTrue(plan["matches_stage_a_caliber"])

    def test_snapshot_default_scope_does_not_request_all(self):
        """5 条快照（3 行业 + 2 非行业）⇒ 默认只请求 3 条，**不会**请求全部。"""
        rows = self.mixed_rows(3, 2)
        self.seed_all([r["code"] for r in rows])
        snap = self.write_snapshot(rows)
        fake = FakeUrlopen(lambda u: {})
        with mock.patch.object(screen, "_urlopen", fake):
            rc, out = self.run_main(self.snapshot_argv(snap))
        self.assertEqual(rc, 0)
        self.assertEqual(fake.calls, [], "全部命中缓存 ⇒ 0 网络请求")
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["candidates_total"], 3, "默认只取行业类")
        self.assertEqual(payload["summary"]["candidates_before_scope"], 5)
        self.assertEqual(payload["request_plan"]["selected_code_count"], 3)
        self.assertEqual(payload["request_plan"]["scope"], screen.SCOPE_INDUSTRY)
        self.assertIn("NON_SECTOR_CLUSTERS", payload["request_plan"]["scope_filter"])
        self.assertIn("--scope industry", out)

    def test_scope_all_is_explicit_opt_in(self):
        rows = self.mixed_rows(2, 2)
        self.seed_all([r["code"] for r in rows])
        snap = self.write_snapshot(rows)
        rc, _ = self.run_main(self.snapshot_argv(snap, scope="all"))
        self.assertEqual(rc, 0)
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(payload["summary"]["candidates_total"], 4)
        self.assertEqual(payload["request_plan"]["scope"], screen.SCOPE_ALL)
        self.assertIn("显式", payload["request_plan"]["scope_filter"])

    def test_output_records_source_sha_counts_calendar_and_budget(self):
        rows = self.taxonomy_rows(2)
        snap = self.write_snapshot(rows)
        raw = snap.read_bytes()
        self.seed_all([r["code"] for r in rows])
        rc, _ = self.run_main(self.snapshot_argv(snap, max_requests=44))
        self.assertEqual(rc, 0)
        p = json.loads(self.out.read_text(encoding="utf-8"))
        plan = p["request_plan"]
        # ① 候选来源 SHA（双口径，避免把「口径差」当成篡改）
        self.assertEqual(plan["candidate_source_sha256_raw"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(plan["candidate_source_sha256_normalized_crlf_lf"],
                         hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest())
        self.assertEqual(plan["candidate_source_artifact"], str(snap))
        # ② 筛选后代码数 ③ 日历请求数 ④ 预算值
        self.assertEqual(plan["snapshot_count"], 2)
        self.assertEqual(plan["selected_code_count"], 2)
        self.assertEqual(plan["calendar_requests"], 1)
        self.assertEqual(plan["max_requests"], 44)
        self.assertEqual(plan["planned_requests"], 0 + 1 + 2)
        self.assertTrue(plan["budget_sufficient"])
        self.assertFalse(plan["matches_stage_a_caliber"], "仅 2 只候选，不构成 Stage A 口径")
        self.assertTrue(plan["cache_hits_do_not_consume_budget"])
        self.assertEqual(p["summary"]["fetch"]["max_requests"], 44)
        self.assertEqual(p["summary"]["fetch"]["network_requests"], 0, "全部命中缓存")
        self.assertEqual(p["summary"]["fetch"]["budget_remaining"], 44,
                         "预算只被**真实网络请求**消耗 ⇒ 0 请求时仍是 44")
        self.assertTrue(p["summary"]["fetch"]["budget_enforced_before_request"])
        self.assertIn("缓存命中不计入", p["summary"]["fetch"]["budget_scope"])
        self.assertEqual(p["method"]["fetch_policy"]["stage_a_max_requests"], 44)
        self.assertTrue(p["method"]["fetch_policy"]["max_requests_required_in_network_mode"])

    def test_legacy_worst_case_is_61_times_8_equals_488_not_times_5(self):
        ref = screen.legacy_budget_reference()
        self.assertEqual(ref["logical_urls"], 61)
        self.assertEqual(ref["decomposition"],
                         {"clist_pages": 17, "calendar": 1, "industry_candidates": 43})
        self.assertEqual(sum(ref["decomposition"].values()), 61)
        self.assertEqual(ref["attempts_per_url"], 8)
        self.assertEqual(ref["worst_case_http_requests"], 488)
        self.assertEqual(ref["worst_case_http_requests"],
                         ref["logical_urls"] * ref["attempts_per_url"])
        self.assertNotEqual(ref["worst_case_http_requests"], 61 * 8 * 5,
                            "主机轮换不是乘数 ⇒ 不得再乘 5")
        self.assertTrue(ref["host_rotation_is_not_a_multiplier"])
        self.assertIn("选址逻辑", ref["note"])
        self.assertIn("61 个逻辑 URL × 每 URL 最多 8 次 = 488 次 HTTP 请求", ref["formula"])
        # 全仓零命中：脚本里不得残留任何把主机台数当乘数 / 错误最坏值的表述
        for bad in ("880", "× 5 主机", "×5 主机", "5 主机轮换", "台主机也乘"):
            self.assertNotIn(bad, SRC, f"旧口径残留：{bad}")


# ------------------------------------------------------------------ 行为契约
class ContractTest(ScreenTestBase):
    def test_out_payload_declares_fetch_policy(self):
        rows = self.taxonomy_rows(1)
        snap = self.write_snapshot(rows)
        self.seed_all([rows[0]["code"]])
        self.run_main(self.snapshot_argv(snap))
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        pol = payload["method"]["fetch_policy"]
        self.assertTrue(pol["fail_fast"])
        self.assertEqual(pol["attempts_per_url"], 1)
        self.assertFalse(pol["host_rotation"])
        self.assertFalse(pol["auto_retry"])
        self.assertFalse(pol["backoff"])
        self.assertTrue(pol["abort_on_failure"])
        self.assertFalse(pol["writes_out_on_abort"])
        self.assertTrue(pol["cache_root_forbidden_inside_repo"])
        self.assertTrue(pol["progress_jsonl_append"])
        self.assertEqual(payload["authority"]["ruling_F"].count(screen.DATA_VERSION), 1)

    def test_scope_caveat_forbids_section_26_claim(self):
        rows = self.taxonomy_rows(1)
        snap = self.write_snapshot(rows)
        self.seed_all([rows[0]["code"]])
        self.run_main(self.snapshot_argv(snap))
        payload = json.loads(self.out.read_text(encoding="utf-8"))
        cav = payload["summary"]["scope_caveat"]
        self.assertIn("§2.6", cav)
        self.assertIn("不得", cav)
        self.assertEqual(payload["summary"]["aborted"], False)

    def test_readings_match_frozen_thresholds(self):
        self.assertEqual((screen.WARMUP, screen.SUSP_MAX, screen.LIQ_MIN_WAN, screen.ROLL),
                         (250, 20, 3000.0, 60))
        self.assertEqual(screen.OBSERVED_END, "2018-04-02")
        self.assertEqual(screen.EARLY_LISTING_CUTOFF, "2017-12-31")
        self.assertEqual(screen.MIN_NEW_CANDIDATES, 12)

    def test_liquidity_and_warmup_readings_on_seeded_data(self):
        rows = self.taxonomy_rows(1)
        snap = self.write_snapshot(rows)
        self.seed_all([rows[0]["code"]])
        self.run_main(self.snapshot_argv(snap))
        c = json.loads(self.out.read_text(encoding="utf-8"))["candidates"][0]
        self.assertEqual(c["rows"], 300)
        self.assertTrue(c["liquidity_ok_pre_observed"])
        self.assertTrue(c["liquidity_ok_full"])
        self.assertTrue(c["suspension_ok"])
        self.assertIsNotNone(c["earliest_dev_start_250"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
