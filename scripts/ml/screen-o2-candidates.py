#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gen-2 O2 —— 扩池候选的机械枚举与边界审计。

裁决 C（2026-09-15）：
    O2 扩池**批准**，但先做**候选清单与边界审计**，不做策略回测。
    候选池**至少新增 12 只**此前未观察、较早上市、可交易 ETF，给准入淘汰留缓冲。
    **选取只能依据 上市、流动性、类别覆盖，不得看收益表现。**

本脚本据此：
  ① 机械枚举东财 ETF 全表（`clist`，含上市日 `f26`）—— 保证候选不是手工挑的；
  ② 以 `scripts/ml/build-cluster-taxonomy.py` 的 `keyword_rule_v1` 指派 L2 cluster；
  ③ 逐只取**东财全历史前复权**（`fqt=1`，与 M1-A 同源同法）算：真实上市日、250 日暖机、
     最长连续缺口（停牌）、§2.4① 口径的 60 日滚动最差成交额；
  ④ **全程不读** 涨跌幅字段（f2/f3/f4/f15..f18），从代码层面杜绝「看收益挑标的」。

裁决 E：本脚本**只**产出日线与成交额读数；生存偏差证据由交易所官方公告另行承担。
    生存偏差的**证据源、已完成的 6 条退市码逐码核验、以及「全量清单未完成」的现状**见
    `ml/gen2/reports/gen2_m1b_gap_audit_20260916.md` §5.1。
    ⚠ 勘误（2026-09-16，本包修复）：旧版本文档串曾指向 `gen2_m1b_survivorship_20260915.md`，
    该文件**在仓库任何位置都不存在**（悬空引用，GAP AUDIT 缺口⑤），现已删除该引用。

------------------------------------------------------------------------------
联网前加固（2026-09-16「联网前脚本加固包」，仅本文件 + 离线测试，**未联网取数**）
⚠ 编号约定：本节 A–G 是**加固项编号**，与报告里的**裁决编号 A–L** 无关
（例如「加固 B（缓存根）」对应「裁决 F（数据版本/缓存口径）」，两者不是同一个编号体系）。

A. **fail-fast**：单个 URL **只尝试 1 次**；失败**立即整体中止**；**不换主机 / 不自动重试 / 无退避**。
   ⇒ 单 URL 请求数恒为 `ATTEMPTS_PER_URL`(=1)。主机轮换常量（`CLIST_HOSTS` / `KL_HOSTS`）已删除。
   **旧设计最坏口径（精确写法）**：`61 个逻辑 URL × 每 URL 最多 8 次 = 488 次 HTTP 请求`；
   其中 `61 = 17（clist 枚举页）+ 1（交易日历）+ 43（行业类候选）`。
   ⚠ **主机轮换只是「每次尝试选哪台主机」的选址逻辑**（换台主机重试**同一个**逻辑 URL），
   **不产生额外请求 ⇒ 不得再乘 5**（旧表述把它当乘数是错的，本包已更正）。
B. **`--cache-root`**：缓存根默认落在**仓库外**的稳定路径 `DEFAULT_CACHE_ROOT`
   （`~/gen2-o2-evidence/o2-eastmoney-qfq-v1`），不再用 `%TEMP%` / `~/.cache`
   —— 旧默认会随临时目录清理而**丢失证据链**（本次 PENDING 的直接成因之一）。
   旧参数 `--cache` 仍有效且优先级更高。**缓存目录落进仓库内一律 fail-closed 拒绝**
   （裁决 F：原始 payload 不入库）。
C. **`--progress`**：逐只 **JSONL 追加**（append + 立即 flush），每行含
   `payload_sha256` / `bytes` / `source`(cache|network) / `attempts` / `http_status` /
   `generated_on` / `ts`；末尾追加一行 `summary`（网络请求数 / 缓存命中数 / 失败数 / 是否中止）。
   ⇒ 「HTTP 层留痕」从无到有（旧版失败归因无法复核的根因）。
D. 删除悬空引用（见上）。
E. **`--candidates <json>`**：直接读取既有 `AUDIT_SCOPE_SNAPSHOT` 清单（当前 = 92 条），
   **跳过枚举**（省 17 次 clist 请求），并在进度与输出中记录来源 artifact 的
   `sha256_raw` **与**项目口径 `sha256_normalized_crlf_lf`。
   ⚠ 快照**不等于**请求清单：候选还要过 `--scope`（见 G），**默认只取行业类 43 条**。
F. **`--max-requests`（真实网络请求硬预算，运行时 fail-closed）**
   ① **联网模式必须显式提供**；未提供 ⇒ **拒绝运行**（`SystemExit`，一个请求都不发）；
   ② **发起第 `N+1` 次真实网络请求之前**即中止（`RequestBudgetExceeded`）——
      **不是事后只汇总计数**；③ **缓存命中不计入预算**（没有发出网络请求）；
   ④ **计划前置校验**：若 `枚举 + 日历 + 筛选后候选 > 预算`，则在**任何候选请求之前**中止。
   Stage A 日后**只能**传 `--max-requests 44`（= 43 只行业类候选 + 1 次日历）。
G. **`--scope industry|all`（候选范围，默认 `industry`）**：行业判据 = **分类学重算**的 L2 cluster
   不属于 `NON_SECTOR_CLUSTERS`（`scripts/ml/build-cluster-taxonomy.py` 为单一真相源；
   **不采信快照里的 `coverage_eligible` 字段**，仅作交叉核对）。
   ⇒ `--candidates` 的 92 条快照**默认不会直接请求全部**，只请求行业类 **43** 条；
   全量必须**显式** `--scope all` 并相应提高 `--max-requests`。
   输出新增 `request_plan` 段，机械记录：**候选来源 SHA**（raw + 项目归一化口径）、
   **筛选后代码数**、**日历请求数**、**预算值**，以及旧设计最坏口径对照。

⚠ **有意为之的行为变更（fail-closed）**：任何取数失败——**包括 `--offline` 下的缓存缺失**——
   都会**中止整轮**且**不写 `--out` 产物**。理由：旧行为会产出「92/92 条 `data_error` 却仍是一份
   完整 artifact」的半成品，正是被误读成「东财限流已取证」的那份文件。
   `--progress` 保留已完成部分，配合稳定缓存可**断点续跑**。

用法：
    # 纯离线复算（不需 --max-requests）
    python scripts/ml/screen-o2-candidates.py --out <p> --offline
    python scripts/ml/screen-o2-candidates.py --out <p> --enum <enum.json> --offline
    python scripts/ml/screen-o2-candidates.py --out <p> --cache-root <dir> --progress <jsonl>
    # Stage A 取数（日后唯一被授权的联网调用形态；44 = 43 行业类候选 + 1 日历）
    python scripts/ml/screen-o2-candidates.py --out <p> --max-requests 44 \\
        --candidates ml/gen2/reports/gen2_m1b_o2_candidates_20260915.json --progress <jsonl>
    # 全量候选（显式；必须自行把预算提到 93）
    python scripts/ml/screen-o2-candidates.py --out <p> --scope all --max-requests 93 \\
        --candidates ml/gen2/reports/gen2_m1b_o2_candidates_20260915.json --offline
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TAXY_PATH = ROOT / "scripts" / "ml" / "build-cluster-taxonomy.py"

# ---------------------------------------------------------------- 冻结门槛（freeze §2.4）
WARMUP = 250                 # 暖机期，交易日
SUSP_MAX = 20                # 停牌上限，连续交易日（严格大于才排除）
LIQ_MIN_WAN = 3000.0         # 流动性下限，万元
ROLL = 60                    # 流动性滚动窗口，交易日
OBSERVED_END = "2018-04-02"  # 未被观察的最后一日（观察段自 2018-04-03 起）
EARLY_LISTING_CUTOFF = "2017-12-31"
MIN_NEW_CANDIDATES = 12      # 裁决 C 的下限

# ---------------------------------------------------------------- 取数策略（A/B，硬约束）
ATTEMPTS_PER_URL = 1         # A：单 URL 只尝试 1 次（旧值 8）
HOST_ROTATION = False        # A：不换主机（旧的 CLIST_HOSTS / KL_HOSTS 轮换已删除）
DEFAULT_PAUSE = 2.5          # A：串行节奏 ≈ 1 请求 / 2–3 秒
TIMEOUT = 30                 # 单次请求超时（秒）

# ---------------------------------------------------------------- 请求预算与候选范围（F/G）
CALENDAR_REQUESTS = 1        # 交易日历固定 1 次请求
#: 92 条 `AUDIT_SCOPE_SNAPSHOT` 经行业筛选（分类学重算）后的**机械计数**
STAGE_A_INDUSTRY_CANDIDATES = 43
#: Stage A 授权口径的硬上限：43 只行业类候选 + 1 次日历 = 44
STAGE_A_MAX_REQUESTS = STAGE_A_INDUSTRY_CANDIDATES + CALENDAR_REQUESTS

SCOPE_INDUSTRY = "industry"  # G 默认（保守）：只取行业类候选
SCOPE_ALL = "all"            # G 显式：全部候选（快照下 = 92 条，须自行提高预算）
SCOPE_CHOICES = (SCOPE_INDUSTRY, SCOPE_ALL)

#: 旧设计（已作废）预算对照口径 —— **仅供对照，不进任何执行路径**
LEGACY_CLIST_PAGES = 17      # 旧文档记录值（`--candidates` 省下的 clist 请求数）；枚举 payload 已丢失，不可复算
LEGACY_ATTEMPTS_PER_URL = 8  # 旧 `tries=8`
LEGACY_LOGICAL_URLS = CALENDAR_REQUESTS + LEGACY_CLIST_PAGES + STAGE_A_INDUSTRY_CANDIDATES  # = 61
LEGACY_WORST_HTTP_REQUESTS = LEGACY_LOGICAL_URLS * LEGACY_ATTEMPTS_PER_URL                  # = 488

# ---------------------------------------------------------------- 缓存根（B，裁决 F）
DATA_VERSION = "o2-eastmoney-qfq-v1"        # 裁决 F 拟名，**不覆盖** daily-qfq-v1
CACHE_NAMESPACE = "gen2-o2-evidence"
DEFAULT_CACHE_ROOT = Path.home() / CACHE_NAMESPACE / DATA_VERSION

UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
      "Referer": "https://quote.eastmoney.com/center/gridlist.html", "Accept": "*/*"}
UT = "bd1d9ddb04089700cf9c27f6f7426281"
CLIST_FIELDS = "f1,f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f20,f21,f26"
CLIST_FS = "b:MK0021,b:MK0023,b:MK0022,b:MK0024"
CLIST_HOST = "push2.eastmoney.com"           # 单主机：不做主机轮换（A）
KLINE_HOST = "push2his.eastmoney.com"        # 实际 kline URL 由 M1-A 的 kline_url() 构造
#: 端点模板 —— 仅作文档；**构造 kline URL 的唯一入口是 m1a.kline_url()**（同源同法）
KLINE_TPL = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&ut={ut}"
             "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
             "&klt=101&fqt={fqt}&beg=0&end=20500101&lmt=1000000")

#: 测试缝合点：单测只替换本模块的 `_urlopen`，不污染全局 urllib
_urlopen = urllib.request.urlopen


class FetchError(RuntimeError):
    """fail-fast 取数失败 ⇒ 调用方**立即整体中止**（不重试、不换主机）。"""


class RequestBudgetExceeded(RuntimeError):
    """请求预算（F）耗尽 ⇒ **在发起第 N+1 次真实网络请求之前**中止。

    只在网络路径触发：缓存命中**不计入**预算（没有发出网络请求）。
    """


#: `--offline` 缓存缺失。**直接沿用 `FileNotFoundError`**（不另建子类）：
#: 2026-09-15 artifact 的逐条 `data_error` 字面即为 `FileNotFoundError: offline 且无缓存：<url>`，
#: 异常名保持稳定，未来产物才能与它**逐位比对**；改成子类名会让这条历史证据失去可比性。
CacheMiss = FileNotFoundError


def _http_get_once(url: str) -> tuple[bytes, int]:
    """单次 HTTP GET。失败**不吞异常**（由 Fetcher 记录留痕后转 FetchError）。"""
    req = urllib.request.Request(url, headers=UA)
    with _urlopen(req, timeout=TIMEOUT) as r:
        return r.read(), int(getattr(r, "status", 200))


class ProgressWriter:
    """进度留痕（C）：逐行 JSONL **追加**，每行写完立即 flush。

    失败/中止时已落盘的行即为可复核证据；重跑时同文件继续追加，不覆盖。
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = self.path.open("a", encoding="utf-8", newline="\n")
        self.lines = 0

    def write(self, obj: dict) -> None:
        rec = dict(obj)
        rec.setdefault("generated_on", date.today().isoformat())
        rec.setdefault("ts", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        self.fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
        self.fh.flush()
        self.lines += 1

    def close(self, **summary: object) -> None:
        self.write({"type": "summary", **summary})
        self.fh.close()


class Fetcher:
    """fail-fast 取数器：缓存命中**零请求**；未命中时**只发 1 次**请求。

    `max_requests`（F）为**真实网络请求**硬预算：在发起第 `N+1` 次之前即中止。
    """

    def __init__(self, cache: str | Path, *, offline: bool = False,
                 pause: float = DEFAULT_PAUSE, progress: ProgressWriter | None = None,
                 max_requests: int | None = None):
        self.cache = Path(cache)
        self.offline = bool(offline)
        self.pause = float(pause)
        self.progress = progress
        self.max_requests = None if max_requests is None else int(max_requests)
        self.requests = 0        # 真实网络请求数（缓存命中不计入）
        self.cache_hits = 0
        self.failures = 0
        self.seq = 0

    def budget_remaining(self) -> int | None:
        """剩余预算；未设预算时为 `None`。"""
        return None if self.max_requests is None else self.max_requests - self.requests

    def path_for(self, url: str, sub: str) -> Path:
        """缓存文件名 = `sha256(url)[:16].json`（与 M1-A 同法，**只依赖原始 URL**）"""
        return self.cache / sub / (hashlib.sha256(url.encode()).hexdigest()[:16] + ".json")

    def _log(self, **kw: object) -> None:
        if self.progress is not None:
            self.progress.write(kw)

    def get(self, url: str, sub: str, *, role: str, code: str | None = None) -> bytes:
        self.seq += 1
        fp = self.path_for(url, sub)
        if fp.is_file():
            b = fp.read_bytes()
            self.cache_hits += 1
            self._log(type="fetch", seq=self.seq, role=role, code=code, source="cache",
                      attempts=0, http_status=None, bytes=len(b),
                      payload_sha256=hashlib.sha256(b).hexdigest(), url=url)
            return b
        if self.offline:
            self.failures += 1
            err = CacheMiss(f"offline 且无缓存：{url}")
            self._log(type="fetch_error", seq=self.seq, role=role, code=code, source="offline",
                      attempts=0, http_status=None, cached_path=str(fp),
                      error=f"{type(err).__name__}: {err}", url=url)
            raise err
        # F：预算硬闸 —— **在真正发出第 N+1 次请求之前**中止（不是事后汇总）
        if self.max_requests is not None and self.requests >= self.max_requests:
            self.failures += 1
            err = RequestBudgetExceeded(
                f"请求预算耗尽：--max-requests={self.max_requests}，"
                f"拒绝发起第 {self.requests + 1} 次真实网络请求"
                f"（fail-closed 于请求发出之前）：{url}")
            self._log(type="budget_exceeded", seq=self.seq, role=role, code=code,
                      source="network", attempts=0, http_status=None,
                      requests_so_far=self.requests, max_requests=self.max_requests,
                      error=f"{type(err).__name__}: {err}", url=url)
            raise err
        fp.parent.mkdir(parents=True, exist_ok=True)
        try:
            b, status = _http_get_once(url)
        except Exception as e:                       # noqa: BLE001
            self.requests += 1
            self.failures += 1
            self._log(type="fetch_error", seq=self.seq, role=role, code=code, source="network",
                      attempts=ATTEMPTS_PER_URL, http_status=getattr(e, "code", None),
                      error=f"{type(e).__name__}: {e}", url=url)
            raise FetchError(
                f"取数失败（fail-fast：单 URL 仅 {ATTEMPTS_PER_URL} 次尝试，不换主机、不重试）："
                f"{url}: {type(e).__name__}: {e}") from e
        self.requests += 1
        fp.write_bytes(b)
        self._log(type="fetch", seq=self.seq, role=role, code=code, source="network",
                  attempts=ATTEMPTS_PER_URL, http_status=status, bytes=len(b),
                  payload_sha256=hashlib.sha256(b).hexdigest(), url=url)
        time.sleep(self.pause)                       # 串行节奏；缓存命中不睡
        return b


def resolve_cache(cache: str | None = None, cache_root: str | None = None) -> Path:
    """解析缓存根（B）。优先级：`--cache` > `--cache-root` > `DEFAULT_CACHE_ROOT`。

    `--cache-root <dir>` 会在其下再嵌 `DATA_VERSION` 子目录（按数据版本隔离）。
    **仓库内的缓存路径一律拒绝**（fail-closed，裁决 F）。
    """
    if cache:
        p = Path(cache)
    elif cache_root:
        p = Path(cache_root) / DATA_VERSION
    else:
        p = DEFAULT_CACHE_ROOT
    p = p.expanduser()
    try:
        rp, root = p.resolve(), ROOT.resolve()
    except OSError:
        rp, root = p, ROOT
    if rp == root or root in rp.parents:
        raise SystemExit(f"[screen] 拒绝把缓存写进仓库内：{rp}（裁决 F：原始 payload 不入库；"
                         f"请用 --cache-root 指定仓库外路径）")
    return p


# ---------------------------------------------------------------- 枚举（可完全跳过）
def clist_all(fetcher: Fetcher) -> list[dict]:
    rows: dict[str, dict] = {}
    pn, pz = 1, 100
    total = None
    while True:
        url = (f"https://{CLIST_HOST}/api/qt/clist/get?pn={pn}&pz={pz}&po=0&np=1"
               f"&fltt=2&invt=2&fid=f12&fs={CLIST_FS}&fields={CLIST_FIELDS}&ut={UT}")
        d = json.loads(fetcher.get(url, "clist", role="enumerate"))
        data = d.get("data") or {}
        total = int(data.get("total") or 0) if total is None else total
        diff = data.get("diff") or []
        if not diff:
            break
        for r in diff:
            rows[str(r["f12"])] = r
        if len(rows) >= total or pn > 40:
            break
        pn += 1
    return list(rows.values())


def load_candidates_snapshot(path: str | Path) -> tuple[list[dict], dict]:
    """E：读取既有 `AUDIT_SCOPE_SNAPSHOT` 候选清单，并留存来源 artifact 指纹。

    ⚠ 该清单的来源枚举 payload 已丢失 ⇒ **不可独立重枚举复现**，只用于界定审计范围。
    """
    p = Path(path)
    raw = p.read_bytes()
    d = json.loads(raw.decode("utf-8"))
    rows = d.get("candidates")
    if not isinstance(rows, list) or not rows:
        raise SystemExit(f"[screen] --candidates 文件不含非空 candidates 数组：{p}")
    meta = {
        "mode": "snapshot",
        "artifact": str(p),
        "artifact_audit": d.get("audit"),
        "artifact_generated_on": d.get("generated_on"),
        "snapshot_count": len(rows),
        "sha256_raw": hashlib.sha256(raw).hexdigest(),
        "sha256_normalized_crlf_lf": hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest(),
        "sha256_note": ("项目口径（scripts/verify-immutable.js::sha256File）= sha256(utf8 + CRLF→LF 归一化)；"
                        "两个值都记，避免把口径差当成篡改"),
        "audit_scope_snapshot": True,
        "reproducible_by_reenumeration": False,
        "note": ("AUDIT_SCOPE_SNAPSHOT：来源枚举 payload（%TEMP%/m1b/cache/etf_all_enumerated.json）"
                 "已丢失，本清单**不可独立重枚举复现**，只可用于界定「要审计哪些只」，"
                 "不得作准入结论或 freeze §2.6 判定依据"
                 "（见 ml/gen2/reports/gen2_m1b_gap_audit_20260916.md §2.4）"),
    }
    keep = ("code", "name", "market", "listing_date_vendor", "in_current_pool", "l2_cluster",
            "kind", "l1_sector", "coverage_eligible", "amount_wan_today", "mktcap_yi_today")
    out = []
    for r in rows:
        if not r.get("code"):
            continue
        rec = {k: r.get(k) for k in keep}
        rec["from_snapshot"] = True
        out.append(rec)
    return out, meta


# ---------------------------------------------------------------- 候选范围（G）+ 请求计划（F）
def industry_l2(rec: dict, taxy) -> str:
    """**分类学重算**的 L2 cluster（单一真相源）。

    ⚠ 一律从 `name` 重算，**不采信**记录里已有的 `l2_cluster` / `coverage_eligible`
    —— 那两个字段只是某一次快照的产物，不能当判据（只作交叉核对）。
    """
    cl, _kind = taxy.classify_name(rec.get("name") or "")
    return cl


def in_industry_scope(rec: dict, taxy) -> bool:
    """行业类判据：重算 L2 cluster **不属于** `NON_SECTOR_CLUSTERS`。"""
    return industry_l2(rec, taxy) not in taxy.NON_SECTOR_CLUSTERS


def apply_scope(rows: list[dict], scope: str, taxy) -> list[dict]:
    """按 `--scope` 过滤候选（G）：`industry` 只留行业类；`all` 原样返回（须显式）。"""
    if scope == SCOPE_ALL:
        return list(rows)
    if scope != SCOPE_INDUSTRY:
        raise SystemExit(f"[screen] 未知 --scope：{scope}（可选 {SCOPE_CHOICES}）")
    return [r for r in rows if in_industry_scope(r, taxy)]


def legacy_budget_reference() -> dict:
    """旧设计（已作废）最坏请求口径 —— **精确写法**，供对照与防误引。

    61 个逻辑 URL = 17（clist 枚举页）+ 1（交易日历）+ 43（行业类候选）；
    每 URL 最多 8 次（旧 `tries=8`）⇒ 最坏 61 × 8 = **488 次 HTTP 请求**。
    ⚠ **主机轮换只是「每次尝试选哪台主机」的选址逻辑**，不产生额外请求 ⇒ **不得再乘 5**。
    """
    return {
        "logical_urls": LEGACY_LOGICAL_URLS,
        "decomposition": {"clist_pages": LEGACY_CLIST_PAGES, "calendar": CALENDAR_REQUESTS,
                          "industry_candidates": STAGE_A_INDUSTRY_CANDIDATES},
        "decomposition_note": f"{LEGACY_CLIST_PAGES} + {CALENDAR_REQUESTS} + "
                              f"{STAGE_A_INDUSTRY_CANDIDATES} = {LEGACY_LOGICAL_URLS}"
                              f"（clist 页数为旧文档记录值，枚举 payload 已丢失，不可复算）",
        "attempts_per_url": LEGACY_ATTEMPTS_PER_URL,
        "worst_case_http_requests": LEGACY_WORST_HTTP_REQUESTS,
        "formula": (f"{LEGACY_LOGICAL_URLS} 个逻辑 URL × 每 URL 最多 {LEGACY_ATTEMPTS_PER_URL} 次 "
                    f"= {LEGACY_WORST_HTTP_REQUESTS} 次 HTTP 请求"),
        "host_rotation_is_not_a_multiplier": True,
        "note": ("主机轮换只是每次尝试的**选址逻辑**（换台主机重试同一个逻辑 URL），"
                 "不产生额外请求 ⇒ 不得再乘 5（主机台数不是请求数的乘数）。"),
    }


def build_request_plan(*, scope: str, selected_code_count: int, enumeration_requests: int,
                       snapshot_meta: dict | None, max_requests: int | None,
                       calendar_requests: int = CALENDAR_REQUESTS) -> dict:
    """机械化的请求计划（F/G）—— 输出必须可核对「43 + 1 = 44」。

    `planned_requests` = 枚举请求 + 日历请求 + **筛选后**候选数；
    这是「零缓存命中」下的**上界**（缓存命中只会让它变小，不会变大）。
    """
    planned = int(enumeration_requests) + int(calendar_requests) + int(selected_code_count)
    snap = snapshot_meta or {}
    return {
        "scope": scope,
        "scope_filter": ("分类学重算 L2 cluster ∉ NON_SECTOR_CLUSTERS（默认保守）"
                         if scope == SCOPE_INDUSTRY else "全部候选（显式 --scope all）"),
        # ---- ① 候选来源 SHA（快照模式下为 artifact 指纹；枚举模式下无）
        "candidate_source_artifact": snap.get("artifact"),
        "candidate_source_sha256_raw": snap.get("sha256_raw"),
        "candidate_source_sha256_normalized_crlf_lf": snap.get("sha256_normalized_crlf_lf"),
        "snapshot_count": snap.get("snapshot_count"),
        # ---- ② 筛选后代码数 / ③ 日历请求数 / ④ 预算值
        "selected_code_count": int(selected_code_count),
        "calendar_requests": int(calendar_requests),
        "enumeration_requests": int(enumeration_requests),
        "planned_requests": planned,
        "planned_formula": (f"枚举 {int(enumeration_requests)} + 日历 {int(calendar_requests)} "
                            f"+ 候选 {int(selected_code_count)} = {planned}"),
        "max_requests": max_requests,
        "budget_sufficient": (True if max_requests is None else planned <= max_requests),
        "budget_remaining_after_plan": (None if max_requests is None else max_requests - planned),
        "matches_stage_a_caliber": bool(
            scope == SCOPE_INDUSTRY and int(selected_code_count) == STAGE_A_INDUSTRY_CANDIDATES
            and int(calendar_requests) == CALENDAR_REQUESTS and planned == STAGE_A_MAX_REQUESTS),
        "stage_a_reference": {"scope": SCOPE_INDUSTRY,
                              "selected_code_count": STAGE_A_INDUSTRY_CANDIDATES,
                              "calendar_requests": CALENDAR_REQUESTS,
                              "planned_requests": STAGE_A_MAX_REQUESTS},
        "cache_hits_do_not_consume_budget": True,
        "legacy_reference": legacy_budget_reference(),
    }


def assert_plan_within_budget(plan: dict, max_requests: int | None,
                              progress: "ProgressWriter | None" = None) -> None:
    """计划前置校验（F④）：计划 > 预算 ⇒ **在发起任何候选请求之前**中止。"""
    if max_requests is None or plan["budget_sufficient"]:
        return
    err = RequestBudgetExceeded(
        f"请求计划 {plan['planned_requests']} 次 > 预算 {max_requests} 次 ⇒ "
        f"**在发起任何候选请求之前**中止（fail-closed）。"
        f"计划 = {plan['planned_formula']}；scope={plan['scope']}。"
        f"（{SCOPE_INDUSTRY} 为保守默认；如需全量请显式 --scope {SCOPE_ALL} 并提高 --max-requests）")
    if progress is not None:
        progress.write({"type": "plan_rejected", "error": f"{type(err).__name__}: {err}",
                        **{k: v for k, v in plan.items() if k != "legacy_reference"}})
    raise err


# ---------------------------------------------------------------- M1-A 原语
def _load_m1a():
    p = ROOT / "scripts" / "ml" / "audit-m1a-etf-history.py"
    spec = importlib.util.spec_from_file_location("m1a", p)
    m = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(m)
    return m


def _load_taxy():
    spec = importlib.util.spec_from_file_location("taxy", TAXY_PATH)
    m = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(m)
    return m


def main() -> int:
    ap = argparse.ArgumentParser(description="O2 扩池候选机械枚举与边界审计（联网前加固版）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=None, help="缓存根（最高优先级；仓库内路径被拒绝）")
    ap.add_argument("--cache-root", default=None,
                    help=f"缓存根（其下自动嵌数据版本子目录 {DATA_VERSION}）；"
                         f"默认 {DEFAULT_CACHE_ROOT}")
    ap.add_argument("--offline", action="store_true", help="只用缓存；缓存缺失即中止（不联网）")
    ap.add_argument("--progress", default=None, help="进度 JSONL 追加文件（C）")
    ap.add_argument("--pause", type=float, default=DEFAULT_PAUSE,
                    help=f"每次**网络**请求后的串行间隔秒数（默认 {DEFAULT_PAUSE}）")
    ap.add_argument("--max-requests", type=int, default=None,
                    help=f"加固 F：真实网络请求硬预算。**联网模式必填**（未提供即拒绝运行）；"
                         f"缓存命中不计入；第 N+1 次请求发出**之前**中止。"
                         f"Stage A 口径 = {STAGE_A_MAX_REQUESTS}"
                         f"（{STAGE_A_INDUSTRY_CANDIDATES} 行业类候选 + {CALENDAR_REQUESTS} 日历）")
    ap.add_argument("--scope", choices=list(SCOPE_CHOICES), default=SCOPE_INDUSTRY,
                    help=f"加固 G：候选范围，默认 {SCOPE_INDUSTRY}（保守）。"
                         f"{SCOPE_INDUSTRY} = 分类学重算 L2 ∉ NON_SECTOR_CLUSTERS；"
                         f"{SCOPE_ALL} = 全部候选（**必须显式**，快照下 = 92 条）")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--enum", default=None,
                     help="复用已落盘的 clist 枚举 JSON（跳过枚举请求，便于复核与限流期重跑）")
    src.add_argument("--candidates", default=None,
                     help="E：直接读取既有 AUDIT_SCOPE_SNAPSHOT 候选清单（跳过枚举；"
                          "候选仍受 --scope 约束 ⇒ 默认只取行业类）")
    ap.add_argument("--master", default=str(ROOT / "ml/gen2/universe/etf_master.csv"))
    a = ap.parse_args()

    # F① 联网模式必须显式给预算 —— 未提供即拒绝运行（fail-closed，一个请求都不发）
    if not a.offline:
        if a.max_requests is None:
            raise SystemExit(
                "[screen] 联网模式必须显式提供 --max-requests（fail-closed）：未提供时拒绝运行，"
                "以免无上限联网。"
                f"Stage A 授权口径 = --max-requests {STAGE_A_MAX_REQUESTS}"
                f"（{STAGE_A_INDUSTRY_CANDIDATES} 只行业类候选 + {CALENDAR_REQUESTS} 次日历）。"
                "纯离线复算请改用 --offline（离线模式不需要 --max-requests）。")
        if a.max_requests < 0:
            raise SystemExit(f"[screen] --max-requests 必须 >= 0，当前 {a.max_requests}")

    cache = resolve_cache(a.cache, a.cache_root)
    progress = ProgressWriter(a.progress) if a.progress else None
    fetcher = Fetcher(cache, offline=a.offline, pause=a.pause, progress=progress,
                      max_requests=a.max_requests)
    m1a, taxy = _load_m1a(), _load_taxy()
    pool = {r["code"] for r in csv.DictReader(open(a.master, encoding="utf-8-sig", newline=""))}

    print(f"[screen] 缓存根 = {cache}（仓库外={ROOT.resolve() not in Path(cache).resolve().parents}）")
    print(f"[screen] 取数策略：fail-fast（单 URL {ATTEMPTS_PER_URL} 次尝试）、"
          f"不换主机、offline={a.offline}、pause={a.pause}s、"
          f"max-requests={a.max_requests if a.max_requests is not None else '（离线，不适用）'}")
    print(f"[screen] 候选范围 --scope={a.scope}"
          f"（默认保守 {SCOPE_INDUSTRY}；全量需显式 {SCOPE_ALL}）")
    if progress:
        print(f"[screen] 进度留痕 = {progress.path}")

    snapshot_meta = None
    rows: list[dict] = []
    aborted: str | None = None
    ok = pending = 0
    candidates_selected_before_scope = 0
    request_plan: dict | None = None
    calendar: list[str] = []
    cal_err = None

    try:
        # ① 枚举（--candidates 模式下**完全跳过**）
        if a.candidates:
            cand, snapshot_meta = load_candidates_snapshot(a.candidates)
            for rec in cand:                      # 抹掉上一轮的取数结论，避免与本次混读
                rec.pop("data_ok", None)
                rec.pop("data_error", None)
            cand.sort(key=lambda r: (r["listing_date_vendor"] or "", r["code"]))
            print(f"[screen] 快照模式：候选 = {len(cand)}（来源 {snapshot_meta['artifact']}，"
                  f"sha256_raw={snapshot_meta['sha256_raw'][:16]}…，**不可重枚举复现**）")
            mism = []
            for rec in cand:
                cl, kind = taxy.classify_name(rec.get("name") or "")
                rec["recomputed_l2_cluster"] = cl
                rec["recomputed_kind"] = kind
                rec["snapshot_classification_ok"] = bool(
                    cl == rec.get("l2_cluster") and kind == rec.get("kind"))
                if not rec["snapshot_classification_ok"]:
                    mism.append({"code": rec["code"], "snapshot": rec.get("l2_cluster"),
                                 "recomputed": cl})
            print(f"[screen] 快照分类交叉核对：不一致 {len(mism)} 条（分类学单一真相源未漂移则为 0）")
        else:
            # ②' 枚举 + 分类 + 初筛（原有路径）
            if a.enum:
                enum = json.loads(Path(a.enum).read_text(encoding="utf-8"))
                if not isinstance(enum, list) or not enum:
                    raise SystemExit(
                        f"[screen] --enum 文件必须是**行数组**（`clist_all()` 的落盘结果，"
                        f"元素含 f12/f14/f26），当前类型 = {type(enum).__name__}：{a.enum}")
                enum_src = f"复用落盘枚举 {a.enum}"
            else:
                enum = clist_all(fetcher)
                enum_src = f"实时枚举（fs={CLIST_FS}）"
            print(f"[screen] 枚举 ETF = {len(enum)} | 现有池 = {len(pool)} | {enum_src}")

            def f26(r: dict) -> str | None:
                v = r.get("f26")
                s = str(v) if v not in (None, "", "-", 0) else None
                return f"{s[:4]}-{s[4:6]}-{s[6:]}" if s else None

            for r in enum:
                code, name = str(r["f12"]), str(r.get("f14") or "")
                cl, kind = taxy.classify_name(name)
                rows.append({
                    "code": code, "name": name,
                    "market": "SH" if str(r.get("f13")) == "1" else "SZ",
                    "listing_date_vendor": f26(r),
                    "in_current_pool": code in pool,
                    "l2_cluster": cl, "kind": kind,
                    "l1_sector": taxy.L2_TO_L1.get(cl),
                    "coverage_eligible": cl not in taxy.NON_SECTOR_CLUSTERS,
                    "amount_wan_today": (round(float(r["f6"]) / 1e4, 1)
                                         if isinstance(r.get("f6"), (int, float)) else None),
                    "mktcap_yi_today": (round(float(r["f20"]) / 1e8, 2)
                                        if isinstance(r.get("f20"), (int, float)) else None),
                })
            cand = [r for r in rows
                    if not r["in_current_pool"] and r["listing_date_vendor"]
                    and r["listing_date_vendor"] <= EARLY_LISTING_CUTOFF
                    and r["kind"] != "excluded"]
            cand.sort(key=lambda r: (r["listing_date_vendor"], r["code"]))
            print(f"[screen] 候选（未观察 & 上市<={EARLY_LISTING_CUTOFF} & 非货基/债）= {len(cand)}")

        # ② 候选范围（G）+ 请求计划（F）—— 一律在**任何候选请求之前**完成
        candidates_selected_before_scope = len(cand)
        cand = apply_scope(cand, a.scope, taxy)
        if a.scope == SCOPE_INDUSTRY:
            print(f"[screen] --scope {SCOPE_INDUSTRY}：候选 {candidates_selected_before_scope} → "
                  f"{len(cand)}（剔除非行业类 "
                  f"{candidates_selected_before_scope - len(cand)}；判据 = 分类学重算 L2 ∉ "
                  f"{sorted(taxy.NON_SECTOR_CLUSTERS)}）")
        request_plan = build_request_plan(
            scope=a.scope, selected_code_count=len(cand),
            enumeration_requests=fetcher.requests, snapshot_meta=snapshot_meta,
            max_requests=a.max_requests)
        print(f"[screen] 请求计划：scope={request_plan['scope']} | "
              f"枚举 {request_plan['enumeration_requests']} + "
              f"日历 {request_plan['calendar_requests']} + "
              f"候选 {request_plan['selected_code_count']} = "
              f"{request_plan['planned_requests']} 次 | 预算 {request_plan['max_requests']} | "
              f"余量 {request_plan['budget_remaining_after_plan']} | "
              f"Stage A 口径匹配={request_plan['matches_stage_a_caliber']}")
        if snapshot_meta:
            print(f"[screen] 候选来源 sha256(raw)="
                  f"{request_plan['candidate_source_sha256_raw'][:16]}… / 归一化="
                  f"{request_plan['candidate_source_sha256_normalized_crlf_lf'][:16]}…；"
                  f"快照 {request_plan['snapshot_count']} → "
                  f"筛选后 {request_plan['selected_code_count']}")
        assert_plan_within_budget(request_plan, a.max_requests, progress)

        # ③ 逐只边界读数
        # ⚠ 日历用 fqt=0：与 M1-A 的日历缓存同键（日历与复权无关，指数序列日期一致）
        cal_url = m1a.kline_url(m1a.CALENDAR_SECID, 0)
        _cn, crows = m1a.parse_klines(fetcher.get(cal_url, "kline", role="calendar"))
        calendar = [c["date"] for c in crows]
        print(f"[screen] 日历 {calendar[0]} → {calendar[-1]} ({len(calendar)} 日)")

        for i, rec in enumerate(cand, 1):
            url = m1a.kline_url(m1a.secid_of(rec["code"]), 1)
            raw = fetcher.get(url, "kline", role="kline", code=rec["code"])
            _n, k = m1a.parse_klines(raw)
            ok += 1
            dates = [x["date"] for x in k]
            rec.update({
                "data_ok": True, "rows": len(k),
                "local_first_date": dates[0], "local_last_date": dates[-1],
                "listing_matches_vendor": dates[0] == rec["listing_date_vendor"],
                "earliest_dev_start_250": dates[WARMUP - 1] if len(dates) >= WARMUP else None,
                "kline_payload_sha256": hashlib.sha256(raw).hexdigest(),
                "kline_payload_bytes": len(raw),
            })
            sub = [x for x in k if x["date"] <= OBSERVED_END]
            rec["pre_observed_days"] = len(sub)
            if len(dates) >= WARMUP:
                rec["warmup_ready_before_observed_end"] = dates[WARMUP - 1] <= OBSERVED_END
            if calendar and sub:
                lo, hi = sub[0]["date"], sub[-1]["date"]
                longest, run = m1a.max_gap_run({x["date"] for x in sub},
                                               [d for d in calendar if lo <= d <= hi])
                rec["max_suspension_pre_observed"] = longest
                rec["max_suspension_run"] = run
                rec["suspension_ok"] = longest <= SUSP_MAX
            w_all, w_all_d = m1a.rolling_worst_60(k)
            w_pre, w_pre_d = (m1a.rolling_worst_60(sub) if len(sub) >= ROLL else (None, None))
            rec["w60_wan_full"] = round(w_all / 1e4, 1) if w_all else None
            rec["w60_full_end"] = w_all_d
            rec["w60_wan_pre_observed"] = round(w_pre / 1e4, 1) if w_pre else None
            rec["w60_pre_end"] = w_pre_d
            rec["liquidity_ok_pre_observed"] = bool(w_pre and w_pre >= LIQ_MIN_WAN * 1e4)
            rec["liquidity_ok_full"] = bool(w_all and w_all >= LIQ_MIN_WAN * 1e4)
            if i % 15 == 0 or i == len(cand):
                print(f"  [{i:03d}/{len(cand)}] ok={ok} pending={pending} {rec['code']}")
    except (FetchError, CacheMiss, RequestBudgetExceeded) as e:
        aborted = f"{type(e).__name__}: {e}"

    if progress is not None:
        progress.close(note="A–G 加固版：fail-fast（单 URL 1 次尝试）、无重试、无主机轮换、"
                            "请求预算运行时 fail-closed（第 N+1 次请求前中止）、"
                            "候选范围默认行业类",
                       requests_network=fetcher.requests, cache_hits=fetcher.cache_hits,
                       failures=fetcher.failures, aborted=aborted is not None,
                       consecutive_failures_is_fatal=True,
                       max_requests=fetcher.max_requests, scope=a.scope,
                       request_plan=request_plan)

    if aborted is not None:
        # 有意不写 --out：避免再产出「全 data_error 却像一份完整 artifact」的半成品
        print(f"[screen] ✗ 已按 fail-fast 中止：{aborted}")
        print(f"[screen] 网络请求 {fetcher.requests} 次 / 缓存命中 {fetcher.cache_hits} 次 / "
              f"失败 {fetcher.failures} 次；预算 "
              f"{fetcher.max_requests if fetcher.max_requests is not None else '（离线，不适用）'}"
              f"；**未写 --out**")
        if progress:
            print(f"[screen] 进度已保留：{progress.path}（{progress.lines} 行）；"
                  f"缓存可复用 ⇒ 处理原因后可直接续跑")
        return 2

    # ④ 汇总
    by_cluster: dict[str, int] = {}
    for r in cand:
        by_cluster[r["l2_cluster"]] = by_cluster.get(r["l2_cluster"], 0) + 1
    sector_covered = sorted(c for c in by_cluster
                            if c not in taxy.NON_SECTOR_CLUSTERS and by_cluster[c] > 0)
    liq_ok = [r for r in cand if r.get("liquidity_ok_pre_observed")]
    summary = {
        "candidates_total": len(cand),
        "candidates_with_kline": ok,
        "candidates_pending_data": pending,
        "aborted": False,
        "calendar": ({"first": calendar[0], "last": calendar[-1], "days": len(calendar),
                      "error": cal_err} if calendar else {"available": False, "error": cal_err}),
        "by_cluster": dict(sorted(by_cluster.items())),
        "sector_clusters_covered": sector_covered,
        "n_sector_clusters_covered": len(sector_covered),
        "coverage_denominator": 8,
        "coverage_meets_gate_ge6": len(sector_covered) >= 6,
        "min_12_new_satisfied": len(cand) >= MIN_NEW_CANDIDATES,
        "unmatched_needs_review": [{"code": r["code"], "name": r["name"]}
                                   for r in cand if r["kind"] == "unknown"],
        "liquidity_pass_pre_observed": [r["code"] for r in liq_ok],
        "n_liquidity_pass": len(liq_ok),
        "snapshot_classification_mismatches": ([{"code": r["code"],
                                                 "snapshot": r.get("l2_cluster"),
                                                 "recomputed": r.get("recomputed_l2_cluster")}
                                                for r in cand if r.get("snapshot_classification_ok") is False]
                                               if snapshot_meta else []),
        "fetch": {
            "network_requests": fetcher.requests, "cache_hits": fetcher.cache_hits,
            "attempts_per_url": ATTEMPTS_PER_URL, "host_rotation": HOST_ROTATION,
            "pause_seconds": a.pause, "offline": a.offline,
            "cache_root": str(cache), "cache_outside_repo": True,
            "progress_jsonl": (str(progress.path) if progress else None),
            "max_requests": fetcher.max_requests,
            "budget_remaining": fetcher.budget_remaining(),
            "budget_scope": "real_network_requests_only（缓存命中不计入）",
            "budget_enforced_before_request": True,
        },
        "scope": a.scope,
        "candidates_before_scope": candidates_selected_before_scope,
        "scope_caveat": ("本文件为**逐只数据质量取证**。流动性/停牌的「整窗最差」读数对任何子段是"
                         "**充分（保守）**的；但**暖机起点**依赖 Dev 起点、**标的数与 cluster 数**"
                         "依赖尚未裁决的分段边界 ⇒ 本文件**不得**用于宣称 freeze §2.6 段级准入通过。"),
    }
    payload = {
        "audit": "gen2_m1b_o2_candidate_screen",
        "generated_on": date.today().isoformat(),
        "authority": {
            "ruling_C": ("O2 扩池批准：≥12 只未观察/较早上市/可交易；只依据上市、流动性、"
                         "类别覆盖；不得看收益表现"),
            "ruling_D": "cluster 归属以 ml/gen2/universe/cluster_taxonomy_v1.json 为准",
            "ruling_E": "本文件只承担日线与成交额；生存偏差由交易所官方公告承担",
            "ruling_F": f"数据版本拟名 {DATA_VERSION}（不覆盖 daily-qfq-v1）；须附 payload 哈希/抓取日/复权定义",
            "freeze": "ml/gen2/reports/gen2_data_boundary_freeze_20260915.md (FROZEN v1.1)",
        },
        "method": {
            "enumeration": ((f"东财 clist fs={CLIST_FS}（含 f26 上市日），**单主机 + fail-fast + 稳定缓存**；"
                             f"本次来源 = {snapshot_meta['artifact']}（快照模式，未枚举；"
                             f"本次 0 次 clist 请求）")
                            if snapshot_meta else
                            (f"东财 clist fs={CLIST_FS}（含 f26 上市日），"
                             f"**单主机 {CLIST_HOST}；fail-fast 单 URL {ATTEMPTS_PER_URL} 次；无主机轮换**"
                             f"（旧版为每 URL 最多 8 次尝试；主机轮换只是每次尝试的选址逻辑，"
                             f"不额外倍增；旧设计最坏 = {LEGACY_LOGICAL_URLS} 个逻辑 URL × "
                             f"{LEGACY_ATTEMPTS_PER_URL} = {LEGACY_WORST_HTTP_REQUESTS} 次 HTTP 请求）；"
                             f"本次来源 = {enum_src}")),
            "scope": (f"候选范围 --scope={a.scope}；判据 = 分类学重算 L2 cluster "
                      f"{'∉' if a.scope == SCOPE_INDUSTRY else '不限'} "
                      f"NON_SECTOR_CLUSTERS={sorted(taxy.NON_SECTOR_CLUSTERS)}"),
            "classification": "keyword_rule_v1（scripts/ml/build-cluster-taxonomy.py，单一真相源）",
            "price_source": "东财 push2his kline fqt=1（与 M1-A 同源同法）",
            "return_blindness": "全程未读取 f2/f3/f4/f15..f18 等涨跌字段",
            "fetch_policy": {
                "fail_fast": True, "attempts_per_url": ATTEMPTS_PER_URL,
                "host_rotation": HOST_ROTATION, "auto_retry": False, "backoff": False,
                "abort_on_failure": True, "writes_out_on_abort": False,
                "pause_seconds_between_network_requests": a.pause,
                "cache_root_default": str(DEFAULT_CACHE_ROOT),
                "cache_root_forbidden_inside_repo": True,
                "progress_jsonl_append": True,
                "max_requests": fetcher.max_requests,
                "max_requests_required_in_network_mode": True,
                "budget_enforced_before_request": True,
                "budget_covers": "real_network_requests_only；缓存命中不计入",
                "budget_precheck_before_any_candidate_request": True,
                "stage_a_max_requests": STAGE_A_MAX_REQUESTS,
            },
        },
        "thresholds": {"warmup_days": WARMUP, "suspension_max_consecutive": SUSP_MAX,
                       "liquidity_min_wan": LIQ_MIN_WAN, "roll_window": ROLL,
                       "observed_end": OBSERVED_END,
                       "early_listing_cutoff": EARLY_LISTING_CUTOFF},
        "summary": summary,
        # F/G：机械化的请求计划 —— 候选来源 SHA / 筛选后代码数 / 日历请求数 / 预算值
        "request_plan": request_plan,
        "candidates_source": snapshot_meta,
        "candidates": cand,
        "universe_scan": ({"enumerated_total": None, "pool_size": len(pool),
                           "all_rows_by_kind": None,
                           "note": "快照模式：本次未枚举，universe_scan 不适用"}
                          if snapshot_meta else
                          {"enumerated_total": len(enum), "pool_size": len(pool),
                           "all_rows_by_kind": {k: sum(1 for r in rows if r["kind"] == k)
                                                for k in sorted({r["kind"] for r in rows})}}),
    }
    outp = Path(a.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[screen] wrote {outp}")
    print(f"[screen] 候选 {len(cand)} | 有日线 {ok} | 待取数 {pending}")
    print(f"[screen] sector 覆盖 {len(sector_covered)}/8 -> {sector_covered}")
    print(f"[screen] ≥12 新增：{'OK' if summary['min_12_new_satisfied'] else 'NOT MET'}"
          f" | ≥6/8：{'OK' if summary['coverage_meets_gate_ge6'] else 'NOT MET'}")
    print(f"[screen] 流动性通过（未观察窗）n={len(liq_ok)}")
    print(f"[screen] 网络请求 {fetcher.requests} 次 / 缓存命中 {fetcher.cache_hits} 次 / "
          f"预算 {fetcher.max_requests}（余 {fetcher.budget_remaining()}）")
    print(f"[screen] 请求计划落盘：候选来源 sha256(raw)="
          f"{str(request_plan['candidate_source_sha256_raw'])[:16]}… | 筛选后候选 "
          f"{request_plan['selected_code_count']} | 日历 {request_plan['calendar_requests']} | "
          f"计划 {request_plan['planned_requests']} | 预算 {request_plan['max_requests']}")
    if snapshot_meta:
        print(f"[screen] ⚠ §2.6 段级准入**未判**：快照口径不可重枚举，且裁决 G / 裁决 I 未裁决 ⇒ "
              f"本文件不构成段级合格结论")
    return 0


if __name__ == "__main__":
    sys.exit(main())
