# M1-B 证据链与口径缺口审计（GAP AUDIT）

> **状态**：`COMPLETED` / `DOCS_ONLY`（**文档审计包**；未改任何代码、数据、bundle、lock、参数或 OOS 分割）
> **生成日**：2026-09-16
> **入库基线**：`origin/master` = `6793d7f29ba161cf18166233d844f284696f7417`（实时 `ls-remote` 核验）
> **入库分支**：`docs/gen2-m1b-gap-audit`
> **性质**：只读取证 + 缺口整理。**不含任何新数据**，不向东财发出任何请求，**不主张任何生产资格**。
> **上位对象**：`gen2_m1b_o2_expansion_20260915.md`（`FROZEN`）与其机器可读件
> `gen2_m1b_o2_candidates_20260915.json`、`ml/gen2/universe/cluster_taxonomy_v1.json`
> **上位冻结**：`gen2_data_boundary_freeze_20260915.md`（`FROZEN v1.1`）
> **规则状态**：Rule V2.0.1 = `ACCEPTED_FAIL` / `NOT_PRODUCTION_ELIGIBLE`（**本文件不改动该状态**）

---

## §0 审计范围与基线

### 0.1 入库基线三连复核（只读）

| 检查 | 命令 | 结果 |
|---|---|---|
| 工作区 | `git rev-parse --show-toplevel` | `.../etf-decision-gen2-gapaudit-20260916` ✅ 独立 worktree（仓库外） |
| 分支 | `git branch --show-current` | `docs/gen2-m1b-gap-audit` ✅ 非 master |
| HEAD | `git rev-parse HEAD` | `6793d7f29ba161cf18166233d844f284696f7417` |
| 远端 master | `git ls-remote origin refs/heads/master` | `6793d7f29ba161cf18166233d844f284696f7417`（**实时**，非复用旧读数） |
| worktree 隔离 | `git worktree list` | 主仓库 `etf-decision-engine`(master)、`-gen1`、`-monstatus`、`-gen2`、**本目录**（第 5 个，独立） |

**结论**：本包从**当时**的 `origin/master` 新建独立 worktree 与独立分支产出，**未**在既有研究分支 `gen2-worktree-20260916` 上提交。

### 0.2 一处需更正的既有前设（如实记录）

任务前置曾给出「当前 `HEAD 6793d7f` **不是**可用于后续正式产物的最新 master 基线」。本次以完全只读方式复核（`git ls-remote`，**未 fetch、未改任何本地 ref**）：

```
git ls-remote origin refs/heads/master  -> 6793d7f29ba161cf18166233d844f284696f7417
git rev-parse origin/master             -> 6793d7f29ba161cf18166233d844f284696f7417
git rev-parse HEAD（旧 Gen-2 worktree） -> 6793d7f29ba161cf18166233d844f284696f7417
```

⇒ **远端 master 与旧 worktree 的 HEAD 在核验时点逐位相同**，该前设**在本次核验时点不成立**，不能作为事实依据。

但**程序性结论照旧执行**，依据替换为三条**与 SHA 是否相同无关**的治理理由：
① 旧 worktree 是**专用 Gen-2 研究分支**（`gen2-worktree-20260916`），不是 master；
② 既有纪律：**并行任务必须独立 worktree**，正式产物应从**当时的** `origin/master` 新建独立 worktree/分支产出；
③ `ls-remote` 只是**某一时点**读数 —— 入库前必须重新核验、不得复用。

### 0.3 零写入声明（本包边界）

本轮**未**修改任何代码 / 数据 / 参数 / 阈值：未改 `bundle`、`lock`、`immutable_set`、规则参数、`data_version`、OOS 分割；
未触碰 `docs/gen1`、Gen-1 代码、`gen1_authority`、`ml_effective`；未发起任何联网请求（含东财）；未创建或合并 PR。
受版本控制的改动**仅限** `ml/gen2/reports/` 下 3 个文档文件（详见 §7）。

### 0.4 worktree 创建记录（可复现性）

`git worktree add` 首次以 Git Bash 风格路径 `/c/Users/...` 传入时，被 Git for Windows 解析为字面路径 `C:\c\Users\...`（**本机已知的路径解析坑**）。该误落 worktree 为全新 checkout、零本地改动，已用 `git worktree remove` 干净移除并以 Windows 风格路径 `C:/Users/...` 重建。

> 附注：`C:\c\` 目录本身**早已存在**且含有其他历史产物（如 `C:\c\tmp\cd-dump\` 的数据库导出、`C:\c\Users\...\Nutstore\` 等），**与本包无关**，本包**未触碰**。

**可复现命令**：

```bash
git worktree add -b docs/gen2-m1b-gap-audit \
  "C:/Users/iquel/Documents/ChatGPT/Tradingview/etf-decision-gen2-gapaudit-20260916" \
  6793d7f29ba161cf18166233d844f284696f7417
```

---

## §1 现有 92 条 JSON 的 `data_error` **不能**作为「东财限流」的可复核证据

### 1.1 实测

`ml/gen2/reports/gen2_m1b_o2_candidates_20260915.json`（`sha256(raw) = de0ceb76b8a68fff…`，62,170 B）：

```
"candidates_total": 92,
"candidates_with_kline": 0,
"candidates_pending_data": 92,
"n_liquidity_pass": 0
```

逐条 `data_ok = false`，且 **92/92 条**的 `data_error` 均为：

```
FileNotFoundError: offline 且无缓存：
https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.510050&ut=...
&klt=101&fqt=1&beg=0&end=20500101&lmt=1000000
```

对照源码 `scripts/ml/screen-o2-candidates.py`：

```python
def cached(url, cache, hosts, offline=False, pause=0.5):
    ...
    if offline:
        raise FileNotFoundError(f"offline 且无缓存：{url}")   # ← 本分支被触发
```

`offline=True` 仅在传入 `--offline` 时成立。

### 1.2 判定

| 命题 | 判定 |
|---|---|
| 「东财对该机返回 HTTP 000（连接被重置）」 | ❌ **不可复核**。该断言只存在于 `gen2_m1b_o2_expansion_20260915.md` §3.6 的报告正文与 `reports/README.md` 的散文里；**机器可读件中没有任何一条 HTTP 层错误记录**（无状态码、无异常类型 `URLError`/`ConnectionResetError`、无重试计数）。 |
| 「这 92 只的 kline 拉取失败」 | ✅ 成立，但失败原因是**本地前置条件不满足**（`--offline` 且缓存为空），**与数据源行为无关**。 |
| 该 JSON 能否证明「曾尝试联网取数并受阻」 | ❌ 不能。**它证明的是从未发出请求。** |

### 1.3 结论措辞（后续文档引用须照此）

> 现有 `gen2_m1b_o2_candidates_20260915.json` 的 92 条 `pending` 是「**离线空缓存重跑**」的产物，
> **不构成对东财限流的证据**。`gen2_m1b_o2_expansion_20260915.md` §3.6 关于 HTTP 000 的归因
> **缺少机器可读留痕**，应按「**未复现 / 未留痕**」处理，**不得**在后续文档中作为既证事实引用。
> 限流是否存在，须由**一次受控联网探测**单独取证（但该探测**本轮未获批准**，见 §8）。

---

## §2 枚举 payload 位于临时目录且已丢失 ⇒ 候选枚举**不可复现**

### 2.1 已入库 artifact 自述的落盘路径

`gen2_m1b_o2_candidates_20260915.json` → `method.enumeration`：

```
东财 clist fs=b:MK0021,b:MK0023,b:MK0022,b:MK0024（含 f26 上市日），主机轮换+缓存；
本次来源 = 复用落盘枚举 C:/Users/iquel/AppData/Local/Temp/m1b/cache/etf_all_enumerated.json
```

### 2.2 实测：该路径与相关缓存**均已不存在**

| 路径 | 用途 | 现状 |
|---|---|---|
| `%TEMP%\m1b\cache\etf_all_enumerated.json` | 1,604 只 clist 枚举原始 payload | ❌ 不存在（连 `%TEMP%\m1b` 目录本身都不存在） |
| `~\.cache\gen2-o2-screen\` | `screen-o2-candidates.py` 默认缓存 | ❌ 不存在 |
| `%TEMP%\m1a_em_cache` | `audit-m1a-etf-history.py` 默认缓存 | ❌ 不存在 |

全盘遍历 `%TEMP%`、`~/.cache`、`Documents/ChatGPT/Tradingview` **未发现**任何 `*enumerated*` / `m1b*` 枚举残留；
仅找到 3 份**内容逐位相同**（62,170 B）的候选 JSON 副本（`-gen1`、`-monstatus`、`-gen2` 三处及其 `%TEMP%` 快照），
均源自同一次离线重跑。

### 2.3 后果

1. **候选清单不可复现**：报告 §3.1 的方法论承诺是「**机械枚举**，保证候选不是手工挑的」。但支撑该承诺的原始 payload 已灭失
   ⇒ 92 只这一结果**当前只能被信任，不能被复算**。
2. **1,604 只全表普查不可复算**：报告 §3.2 的逐年上市数量表失去底层数据。*部分留存*：`cluster_taxonomy_v1.json`
   保留了全 1,604 只的**分类聚合**与 92 只的逐只枚举字段（`listing_date_vendor` / `amount_wan_today` / `mktcap_yi_today`）；
   **丢失的是逐只明细层**（其余 1,512 只的 `f26`/`f6`/`f20`）。
3. **缓存落在临时目录 = 设计缺陷**：两个脚本的默认缓存都在 `%TEMP%` / `~/.cache`，Windows 清理与 `~/.cache` 重建会**静默销毁研究证据**。

> **重跑真实成本被报告低估**：报告 §3.6 的「重跑命令」假设枚举可复用（`--enum <clist 枚举 json>`），但该文件已不存在
> ⇒ 真实重跑还要**额外 17 次** clist 分页请求（`ceil(1604/100)`），且**改变了枚举来源**（从已冻结的落盘 payload 变成一次新的实时枚举）。

### 2.4 ⚠ 92 条清单的正式定性：`AUDIT_SCOPE_SNAPSHOT`（待审计范围快照）

依用户 2026-09-16 裁决，正式固化其**证据等级**：

| 字段 | 值 |
|---|---|
| `designation` | **`AUDIT_SCOPE_SNAPSHOT`**（待审计范围快照） |
| `artifact` | `ml/gen2/reports/gen2_m1b_o2_candidates_20260915.json` |
| `artifact_sha256_raw` | `de0ceb76b8a68fff…`（62,170 B） |
| `source_payload_status` | **`LOST`** —— `%TEMP%\m1b\cache\etf_all_enumerated.json` 已不存在 |
| `independently_re_enumerable` | **`false`** —— 无法从现存 artifact 独立重枚举复现 |
| `permitted_use` | 仅作 **M1-B 待审计范围的界定依据**（「要审计哪些只」） |
| `forbidden_use` | ❌ 不得作**准入结论**；❌ 不得作 **freeze §2.6 段级判定依据**（见 §4）；❌ 不得宣称满足任何门槛（见 §8） |
| `remedy_if_needed` | 需**补跑一次枚举并持久化落盘**（+17 次请求，**未获批**）以恢复可复现性；或长期接受「候选清单已冻结、不可重算」并在 §5 挂账 |

⇒ **本文件及后续一切引用「92 只」的地方，均须同时标注 `AUDIT_SCOPE_SNAPSHOT` 与 `source_payload_lost`。**

---

## §3 重试策略会**放大**请求 ⇒ 联网前必须改 fail-fast + 稳定缓存 + 进度留痕

### 3.1 实测源码（`scripts/ml/screen-o2-candidates.py`）

```python
CLIST_HOSTS = ["push2.eastmoney.com", "1.push2.eastmoney.com", "7.push2.eastmoney.com",
               "82.push2.eastmoney.com", "push2delay.eastmoney.com"]        # 5 个
KL_HOSTS    = ["push2his.eastmoney.com", "1.push2his.eastmoney.com", "7.push2his.eastmoney.com",
               "82.push2his.eastmoney.com", "push2his.eastmoney.com"]      # 5 个（首尾重复，实为 4 个有效）

def _get(url, hosts, tries=8, pause=0.5):
    for i in range(tries):                       # ← 单 URL 最多 8 次
        u = url.replace(hosts[0], hosts[i % len(hosts)], 1)   # ← 失败即换主机重发
        try:
            ... urlopen(req, timeout=30) ...
        except Exception as e:
            last = e
            time.sleep(1.0 * (i + 1))            # ← 退避 1s,2s,...,8s
    raise RuntimeError(f"取数失败 {url}: ...")
```

### 3.2 请求量级

| 场景 | 请求数 |
|---|---|
| 理想（无失败） | 枚举 17 + 日历 1 + 候选 92 = **110** |
| **最坏（全失败）** | 110 × 8 = **880**（且集中在 IP 被判限流的时刻发出） |

报告 §3.6 自述「已尝试：主机轮换（5 个）、退避重试、`ut` 令牌、UA/Referer 伪装」——
**这套组合正是把请求放大最多 8 倍的做法**，与被禁止的「循环重试」同构，且在被限流时只会加深限流。
它同时是**观测污染源**：无法区分「本来就不通」与「因重试被加重封禁」。

### 3.3 联网前必须落地的三项改造（**本包未实施、未获批**）

| # | 改造 | 具体要求 |
|---|---|---|
| ① | **fail-fast** | 单 URL **1 次**尝试；失败**立即整体中止**，不换主机、不自动重试、不退避循环。退出码非 0，保留已完成进度。 |
| ② | **稳定缓存** | 缓存根目录**不得**在 `%TEMP%` / `~/.cache`。改为**非临时、可长期留存**的固定路径；原始 payload 与 `sha256` 一并落盘。 |
| ③ | **进度留痕** | 每只成功即**立即追加**写入进度文件（追加模式，非收尾统一写），使任何中止都留下可审计的已完成集与请求计数；记录 `generated_on`、`ut`、实际命中主机、逐只 payload `sha256`、复权基准日（裁决 F 要求）。 |

**另需**：全程**串行**、请求间隔 ≥2–3 s、无并发、无批量重试。

### 3.4 文件级改造方案（`NOT_APPROVED` / `NOT_IMPLEMENTED`）

> **仅方案，不执行。** 待用户明确批准后方可动代码。**本包未改动该文件一个字节。**

**目标文件（唯一）**：`scripts/ml/screen-o2-candidates.py`

| 改动点 | 现状 | 拟改为 | 风险 |
|---|---|---|---|
| **A. `_get` 失败语义** | `tries=8` + `hosts[i % len]` 轮换 + `sleep(1.0*(i+1))` 退避 | `tries=1`；失败直接 `raise`（保留原异常类型）；删除主机轮换与退避循环 | 低。无调用方依赖重试；失败面变大，但**这正是所需语义** |
| **B. 缓存根路径** | 默认 `~/.cache/gen2-o2-screen` | 新增 `--cache-root`，默认改为仓库外固定路径（如 `%USERPROFILE%\gen2-o2-evidence\<data_version>\`）；仍保留 `--cache` 覆盖 | 低。`--cache` 语义不变，仅默认值变更 |
| **C. 进度留痕** | 收尾统一写汇总 JSON | 新增 `--progress <path>`，**每只成功即刻 append 一行 JSONL**（含 `code`/`url`/`payload_sha256`(归一化口径，见 §9.4)/`generated_on`/`host_index`/`http_status`）；请求计数器同步 append | 中。需确保「追加写入 + flush」在异常路径也落盘 |
| **D. 悬空引用** | docstring 指向 `ml/gen2/reports/gen2_m1b_survivorship_20260915.md`（**该文件不存在**） | 删除该行，或改指向本审计 §5.1 | 无 |
| **E.（可选，需单独批准）`--candidates <json>` 断点续跑** | 只能从 `--enum` 读候选 | 支持从**已入库 JSON** 读 `code`/`listing_date_vendor`，避免重新枚举 17 页 | 低，但**改变口径来源**（须在进度文件记录来源 artifact 的 sha256） |

**明确不做**：不改 `--offline` / `--enum` / `--out` 现有语义；不改任何输出 JSON 的既有字段名；
不触碰 `ml/gen2/manifests/**`、`ml/gen2/universe/**`、`cloudfunctions/**`。

### 3.5 测试方案（`NOT_APPROVED` / `NOT_IMPLEMENTED`）

> 与 §3.4 一并待批。**测试全部离线**，不发起任何真实请求。

| # | 测试 | 类型 | 期望 |
|---|---|---|---|
| T1 | `_get` 在 stub 抛错时**只调用 1 次** | 单测（monkeypatch `urlopen`） | 断言调用计数 == 1；抛出原异常；**无 `sleep` 调用** |
| T2 | `_get` 失败时**不换主机** | 单测 | 断言请求 URL 恒含 `hosts[0]`，不出现其他主机 |
| T3 | 缓存默认根**不在**临时目录 | 单测 | 断言默认路径不以 `%TEMP%` / `~/.cache` 为前缀（`os.environ['TEMP']` / `expanduser('~/.cache')` 双向否定） |
| T4 | `--offline` 且无缓存 → `FileNotFoundError`（**保留既有语义**） | 回归 | 与 §1.1 现行为逐字一致（防改造引入回归） |
| T5 | 进度文件为 **JSONL append**：模拟「第 3 只失败中止」 | 集成（本地假 payload） | 文件内含**恰好 3 行**，第 3 行为失败记录；无截断、无重写 |
| T6 | 进度行含 `payload_sha256` 且**归一化口径正确** | 单测 | 对已知 payload 计算 `sha256(utf8.replace('\r\n','\n'))` 逐位相符（口径见 §9.4） |
| T7 | 请求计数 == 实际请求数（无放大） | 集成 | 计数 == 1×N（N = 计划 URL 数），**不等于** 8×N |
| T8 | 改造后 **golden 回归**：对 `--offline` 空缓存场景输出与改造前**逐字段一致** | 回归 | 唯一差异应为新增进度字段；既有字段零漂移 |
| T9 | 悬空引用已消除 | 静态 | `grep` 结果为空，或指向存在文件（T-存在性断言） |

**测试落位建议**：T1–T9 放入 `ml/gen2/tests/`（Python）并在 PR 描述中标注「**离线**、不联网、不发请求」。

---

## §4 92 只 / 7（或 5）个 cluster 是**候选池并集**，不是 freeze §2.6 要求的**逐段最小值**

### 4.1 冻结口径原文（`gen2_data_boundary_freeze_20260915.md`）

| 门槛 | 冻结值 | 适用层级 | 核验口径 |
|---|---|---|---|
| 最小标的数 | **每段 ≥ 15 只** | **段级** | 标的数 = 该段**每个交易日历日**都满足 §2.2 的标的总数，取**最小值**（**不是并集**） |
| sector 覆盖 | **≥ 6 个**（现有 8 个 cluster 中） | **段级** | Dev / Val / OOS **各段分别** ≥ 6 个 cluster |

⇒ §2.6 是 **(段, 取最小值)** 的**二维**判定：Dev / Val / OOS **各自**都要达标。

### 4.2 M1-B 实际报的是什么

| M1-B 报的读数 | 实际口径 | 能否支持 §2.6 |
|---|---|---|
| `92 只候选` | **候选池并集**（从未落在任何具体段内） | ❌ 不能 |
| `sector 覆盖 7/8`（§3.4） | **候选池并集** | ❌ 不能 |
| `sector 覆盖 5/8`（§3.4 代理筛后） | **候选池并集** + 2026 年「今日成交额」 | ❌ 不能（且**时点错配**） |

**离线复算已确认**（本包用已入库 JSON 重算，**无网络**）：92 → 43、行业类 18、覆盖 5/8、
`tech_hardware` 与 `defensive_dividend` 双双归零 —— 与报告 §3.4 **逐位一致**。
⇒ 报告内部**自洽**；问题不在算错，而在**口径层级选错**。

### 4.3 判定

> M1-B §5 的「预判」以**候选池并集**去回应一个**段级最小值**门槛，属**方法层级错配**：
> **既不能证成、也不能证伪 §2.6。** 报告 §5 已自我限定为「预判（非判定）」，这是**正确**的；
> 但须进一步明确：**该预判连预判力都受限** —— 并集恒 ≥ 任一子集/最小值，
> 故「池级 7/8」与「段级 ≥6」之间**无任何逻辑蕴含关系**（两个方向都不成立）。

### 4.4 一处**可**从数据质量取数中拿到的保守结论（精确边界）

三项门槛对「整窗 vs 逐段」的敏感性**不同**：

| 门槛 | 整窗读数是否充分？ | 说明 |
|---|---|---|
| **流动性**（最差 60 日窗口 ≥3,000 万） | ✅ **充分（保守）** | 若「目标整窗」的 60 日滚动**最小值** ≥ 门槛，则**其内任意子段**的最小值也 ≥ 门槛（子集最小值不可能更小）⇒ 整窗通过 ⇒ **所有子段通过**。反之不成立。 |
| **停牌**（连续 >20 日不得出现） | ✅ **充分（保守）** | 同类推理：整窗内未出现 >20 日缺口 ⇒ 任何子段也未出现。 |
| **暖机**（Dev 起点前 ≥250 日） | ❌ **不充分** | 依赖 **Dev 起点**，而 Dev/Val/OOS 分割属 P1、**当前未定**。只能给 `earliest_dev_start_250` 与「`≤2018-04-02` 前是否已具备 250 日」的**代理**读数。 |
| **标的数 ≥15 / cluster ≥6** | ❌ **不充分** | 必须知道**具体分段边界**才能取段内逐日最小值。分割未定 ⇒ 无法判定。 |

⇒ **这是 Stage A 能合法主张的上界**：逐只数据质量 + 流动性/停牌的**保守**（充分不必要）结论；
**不能**主张暖机达标、标的数达标、cluster 达标，**更不能**主张「段级准入通过」（见 §6）。

---

## §5 仍未闭合的事项

### 5.1 生存偏差清单 —— 未完成

| 项 | 状态 |
|---|---|
| 官方双源已定位且实测可取（上交所 `ssenotice`、深交所 `fund/dynamic`） | ✅ |
| 抽取规则已定义（`{code, name, delist_date, exchange, notice_url, notice_no}`） | ✅ |
| 已实测退市样本（6 条，且 6/6 **不在**东财现行 1,604 只枚举内；2/2 存续对照**在**内） | ✅ |
| **全量清单** | ❌ **未完成**（两所索引**无总数、无类型筛选**，需逐页翻十余年） |
| **对 `2005–2018`（O2 窗口）的完备性** | ❌ **未验证** |
| 后果 | 按 freeze §2.5 / X6：**存在未量化生存偏差** ⇒ O2 段结论**只能用于机制否证，不得作资格判定**，报告须显式声明 |

**⚠ 悬空引用（已登记待修）**：`scripts/ml/screen-o2-candidates.py` docstring 指向
`ml/gen2/reports/gen2_m1b_survivorship_20260915.md` —— **该文件不存在**（`git ls-files` 已确认）。
须删引用或补文件（方案 D，见 §3.4）。

### 5.2 cluster 分母口径 —— 未闭合

`cluster_taxonomy_v1.json` 的 `unresolved` 三项原样悬空（`sha256(raw) = fd7f0e3fd125c53a…`，19,118 B）：

1. 「8」的原始出处**全仓库无文件枚举过**（只出现在 freeze §2.4/§2.6 与 taskbook §0.9）；本包给出**可复算构造**
   （11 − 3 个非行业 cluster = 8；独立路径 `etf_master.sector` 10 − 2 = 8），**待用户确认**。
2. 若分母应取 **9 / 10 / 11**，只需改 `coverage_denominator.value` 与 `members`；阈值 ≥6 不动。
   备选读法已并列：`11_all_l2_clusters` / `10_competitive_l2` / `9_l2_minus_broad_commodity`。
3. **`growth_broad` 是否算「行业」**：`cluster_taxonomy_v1` 按 `sector = broad` 判为**非行业**，待裁决。

### 5.3 治理缺口 —— 未闭合（同「旁路」类别）

Rule V2 的 `immutable_set` 为 **8 项**（`lock_revision = 3`），**不含** `clusters_v1.json` 与 `universe_v1.json`
⇒ 在 bundle 字节不变、LOCK 不改的前提下，**改动 cluster 成员关系即可改变运行语义**
（例：把某标的从 `tech_hardware` 移到 `consumer`，可绕开 `max_cluster_weight = 0.40` 与 `max_tech_weight = 0.65`）。
这与已修补的 `role_thresholds.py` / `regime.py` 是**同一类旁路**。

`cluster_taxonomy_v1.json` 的处理是：**研究侧冻结成员映射**，但**不**擅自把 `clusters_v1.json` 纳入 LOCK
（那属**新 lock revision**，须用户批准）。

### 5.4 G–L 裁决 —— 全部悬空（见 §8 状态登记）

| # | 问题 | M1-B 的建议 | 2026-09-16 状态 |
|---|---|---|---|
| G | §2.6 分母取 8/9/10/11？`growth_broad` 算不算行业？ | 取 **8**；判非行业 | **暂不裁决** |
| H | 是否把 `clusters_v1.json` 纳入 `immutable_set`（＝新 lock revision）？ | 建议纳入 | 悬空（不阻塞） |
| I | 「同 L2 cluster 内按 underlying 去重」是否启用？ | 建议**启用** | **暂不裁决** |
| J | 生存偏差全量抽取：立 **M1-C** 独立包，还是 P1 内前置子任务？ | 建议立 **M1-C** | 悬空（不阻塞） |
| K | 限流解除后是否立即补跑流动性读数？ | 建议补跑（P1 硬前置） | 悬空 |
| L | O2 的 Frozen OOS 早于 B3、属不同制度 —— 是否接受该外推限制？ | 建议接受并写入 P1 `regime` 声明 | 悬空（不阻塞） |

### 5.5 其他结构性缺口（沿用 M1-B，未改判）

1. **`software_ai` 结构性不可得**：2018 年前市场**不存在** AI/软件主题 ETF（最早 `159819` = 2020-09-23，且已在池内）
   ⇒ O2 的 sector 覆盖**天花板 = 7/8**。
2. **卡线簇（离线复算，用已入库 `amount_wan_today`，仅作代理、不作准入）**：

   | cluster | 候选数 | 距 3,000 万代理门槛最近的读数 |
   |---|---|---|
   | `tech_hardware` | 4 | `512220` 2,299.4 万、`159939` 2,127.9 万、`159909` 440.0、`512330` 377.3 → **代理筛后 0** |
   | `defensive_dividend` | 3 | `159905` 2,188.4 万、`510030` 236.4、`159913` 85.6 → **代理筛后 0** |
   | `consumer` | 4 | `510630` 4,090.5 万（唯一过代理）、`510150` 1,103.3、`512600` 451.0、`159936` 37.8 |
   | `healthcare` | 4 | `159929` 3,195.8 万（唯一过代理）、`159938` 1,501.0、`512120` 991.7、`510660` 493.5 |

   ⇒ 两簇距门槛约 **25–30%**，是**最可能被流动性门槛整体淘汰**的两簇。
3. **O2 窗口被封在 `≤2018-04-02`**（观察段自 `2018-04-03` 起）⇒ O2 的 Frozen OOS **早于** B3、属**不同 regime**，外推限制须在 P1 声明。
4. **同类重复暴露**：存在同指数多产品（中证500 ×5、证券 ×4、军工 ×3、创业板 ×4）⇒ 去重规则待裁决 I。
5. **A/B 项 4 只**（`512690` / `515220` / `510880` / `512400`）保留 `PENDING_VENDOR_METHOD`，未纳入 92 只。

---

## §6 Stage A 的**目标边界声明**（唯一允许的主张；**当前未获批，不得执行**）

### 6.1 Stage A 是什么（若获批准）

**Stage A = 逐只数据质量取证**：对 **43 只行业类候选**（7 个 cluster：`consumer` 4 / `cyclical_resources` 10 /
`defensive_dividend` 3 / `financial` 11 / `healthcare` 4 / `overseas_equity` 7 / `tech_hardware` 4）取东财 `push2his`
全历史前复权（`fqt=1`，与 M1-A 同源同法），外加 **1 次** A 股交易日历（`1.000001`，`fqt=0`），产出：

- 真实上市日与 `listing_date_vendor` 的逐位比对；
- 250 日暖机的**代理**读数 `earliest_dev_start_250` / `warmup_ready_before_observed_end`；
- `≤2018-04-02` 窗内最长连续缺口（停牌）；
- `≤2018-04-02` 窗内 60 日滚动**最差**日均成交额；
- 逐只 payload `sha256` + `generated_on` + 复权基准日。

**请求预算**：**44 次**（43 候选 + 1 日历），**硬上限 45**。
（Stage B 若连做：+49 只非行业候选 = 49 次，硬上限 50；**Stage B 仅在 A 通过且获批后**。）

### 6.2 Stage A **不能**主张什么（六条禁止）

1. ❌ **不得**宣称「§2.6 段级准入通过」—— 分割未定、并集 ≠ 段内最小值（§4.3）。
2. ❌ **不得**宣称「暖机达标」—— Dev 起点未定（§4.4）。
3. ❌ **不得**宣称「标的数 ≥15 / cluster ≥6 达标」—— 同上。
4. ❌ **不得**把「今日成交额代理筛」当作准入读数（时点错配：O2 关心 2011–2017 的流动性）。
5. ❌ **不得**用 `fqt=0` 顶替、**不得**跨源拼接（腾讯 `fqkline` 无成交额且与东财基准日不同）。
6. ❌ **不得**因 Stage A 结果而修改任何规则/参数/阈值/lock，也不得据此启动 Dev/Val/OOS。

### 6.3 Stage A **可以**主张什么（唯一上界）

- 逐只**数据可得性与质量**的事实读数（上市日、行数、缺口、成交额齐备性）；
- **流动性**与**停牌**两项的**保守（充分不必要）**结论 —— 整窗通过 ⇒ 其内任意子段通过（§4.4）。

### 6.4 联网前置条件（全部满足才可开机）

1. §3.3 三项改造（fail-fast / 稳定缓存 / 进度留痕）**已实现并通过 §3.5 测试**；
2. 用户已批准请求上限（A：45；如连做 B：50）；
3. **明确「一次性同日取齐」**（前复权基准日随抓取日漂移，跨日即产生假跳变）；
4. 已登记并批准 `--candidates` 与缓存根位置（如启用）。

> **注**：G / I **不再**列为 Stage A 的阻塞前置（用户 2026-09-16 裁决）。
> 但**在 G / I 裁决前，任何候选数与 cluster 数均不得宣称满足 §2.6**（见 §8）。

---

## §7 本次入库清单与 diff 范围（**已执行**）

### 7.1 文件清单（3 个文档文件，全部位于 `ml/gen2/reports/`）

| # | 路径 | 类型 | 说明 |
|---|---|---|---|
| 1 | `ml/gen2/reports/gen2_m1b_gap_audit_20260916.md` | **新增** | 本文件（人读版） |
| 2 | `ml/gen2/reports/gen2_m1b_gap_audit_20260916.json` | **新增** | 机器可读版（缺口条目 + 证据引用 + 裁决状态机 + 门禁结果） |
| 3 | `ml/gen2/reports/README.md` | **修改** | ①「当前有效」表新增本报告索引行；②对 M1-B 行的 **§3.6 措辞加勘误指针**（指向本文件 §1） |

### 7.2 明确**未**改动

| 对象 | 状态 |
|---|---|
| `ml/gen2/reports/gen2_m1b_o2_expansion_20260915.md`（`FROZEN`） | **一字未改**（措辞修正只经 #3 索引指向 + 本文件 §1 勘误实现） |
| `scripts/ml/screen-o2-candidates.py` | **未改**（改造方案见 §3.4，`NOT_APPROVED`） |
| `ml/gen2/manifests/**`（bundle / lock / 各 manifest） | **未改** |
| `ml/gen2/universe/**`（`cluster_taxonomy_v1` / `clusters_v1` / `universe_v1`） | **未改** |
| `cloudfunctions/**`、`src/**`、`web/**` | **未改** |
| 任何 `data_version` / 缓存 payload / 新数据 | **未新增** |

---

## §8 裁决状态登记（用户 2026-09-16）

| 序 | 事项 | 用户裁决 | 对本包的影响 |
|---|---|---|---|
| 1 | **本审计正式入库** | ✅ **批准，仅限文档审计包** | 已执行（§7）；从当时 `origin/master` 新建独立 worktree + 分支；**不建/不并 PR**，可 SSH 推送停在待建 PR 状态 |
| 2 | **Stage A 取数** | ❌ **暂不批准** | 未向东财发任何请求；**未重跑枚举**；未改脚本；未加 `--candidates` |
| 3 | **G（分母 + `growth_broad` 归属）** | ⏸ **暂不裁决** | **不得**当作 Stage A 前置；后续若进入 P1/资格计数，须**单独提交裁决材料**；在此之前**任何候选数或 cluster 数都不得宣称满足 §2.6** |
| 4 | **I（同 cluster 内 underlying 去重）** | ⏸ **暂不裁决** | 同上 |
| 5 | **代码改造** | ⏸ **待独立批准** | §3.4 / §3.5 仅为方案；**未动一个字节** |

### 8.1 92 条清单的定性（依裁决 2）

92 条清单正式定性为 **`AUDIT_SCOPE_SNAPSHOT`（待审计范围快照）**，并**必须**同时标注：
**来源 payload 已丢失（`%TEMP%\m1b\cache\etf_all_enumerated.json` 不存在）⇒ 不可独立重枚举复现**（详 §2.4）。

---

## §9 冻结门禁结果（本包改动前后一致性证明）

> 目的：证明本包为**纯文档变更**，未使任何冻结对象发生漂移。
> 运行环境：Node `22.22.2`（managed）、Python 3.13.14（managed venv `envs/default`，含 `pandas 3.0.5`）。

### 9.1 门禁读数

| # | 门禁 | 命令 | 结果 |
|---|---|---|---|
| G1 | **不可变对象 SHA 核验** | `node scripts/verify-immutable.js` | ✅ **23/23 项锁定**（exit 0） |
| G2 | **构建产物逐位一致（WP-G2-04）** | `node scripts/verify-gen2-build-artifacts.js` | ✅ **7/7 项**（exit 0） |
| G3 | **冻结回归（Node）** | `node tests/gen2-rule-freeze.test.js` | ✅ **37 通过 / 0 失败** |
| G4 | **冻结回归（Python）** | `python ml/gen2/tests/test_wp_g2_04_freeze.py` | ✅ **18 tests OK** |

**G2 环境前置（须留档）**：在**全新 worktree** 上 `dist-functions/` 尚未构建，G2 首次运行仅 **1/3 项**
（`产物存在 dist-functions/runGen2ShadowEod/*` 两项 FAIL）。补跑 `node scripts/build-cloudfunctions.js`（该目录命中 `.gitignore:6`）
后即 **7/7 项**。⇒ **这不是冻结对象漂移，而是构建产物未生成的空目录效应**；复现时必须先构建。

### 9.2 冻结对象身份（实时核验）

| 字段 | 值 |
|---|---|
| `bundle_version` | `gen2-rule-v2.0.1` |
| `lock_revision` | `3` |
| `bundle_sha256`（lock 声明值） | `fabd31d9b1c2500e82f5f927fd24acdee63df2d01fce09053028c353426d6b37` |
| `immutable_set` 条目数 | **8**（`bundle` / `js_implementation` / `python_rule` / `python_candidate` / `python_defense` / `python_role_thresholds` / `python_selection_scores` / `python_regime`） |
| `GEN2_RULE_V2_LOCK.json` 根锚（`ROOT_ANCHORS`） | `d3d40f99dd3d766bd326bf11cc81dcc1168fde4d59693187f1154b2a9e7b2d9c` |
| 规则归档状态 | `ACCEPTED_FAIL` / `NOT_PRODUCTION_ELIGIBLE`（**未改**） |

### 9.3 哈希口径（**本包实测澄清，供后续引用**）

项目内 `verify-immutable.js::sha256File` 的口径为：

```
sha256( fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n') )
```

即 **UTF-8 解码 + CRLF→LF 归一化** 后再取 sha256 —— **不是**原始字节 sha256。实测差异（同一文件）：

| 文件 | 原始字节 sha256 | **归一化后 sha256（= 项目口径）** |
|---|---|---|
| `ml/gen2/manifests/GEN2_RULE_V2_LOCK.json` | `dea4b092a1e7399b…` | **`d3d40f99dd3d766b…`** == `ROOT_ANCHORS` ✅ |
| `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json` | `3a8be7e7227f126c…` | **`fabd31d9b1c2500e…`** == `lock.bundle_sha256` ✅ |

⇒ **凡后续报告引用 `bundle_sha256` / `lock_sha256`，须声明使用上述归一化口径**，否则会得出「哈希不一致」的假告警。

---

## §10 变更记录

| 日期 | 内容 |
|---|---|
| 2026-09-16 | 初版（仓库外草稿）：只读取证 —— 校正 HEAD 前设、证否「HTTP 000」可复核性、定位枚举 payload 丢失、量化重试放大 8×、指出 §2.6 口径层级错配、梳理未闭合项、给出 Stage A 边界与最小裁决清单。**未改任何受版本控制文件、未联网、未入库。** |
| 2026-09-16 | **正式入库（本版）**：按用户裁决以**文档审计包**入库。新增：§2.4 92 条清单定性 `AUDIT_SCOPE_SNAPSHOT`（来源 payload 丢失、不可独立重枚举复现）、§3.4 文件级改造方案与 §3.5 测试方案（均 `NOT_APPROVED`）、§7 入库清单与 diff 范围、§8 裁决状态登记、§9 冻结门禁结果（23/23 · 7/7 · 37/0 · 18 OK）与哈希归一化口径澄清。**仍为纯文档：未改代码/数据/bundle/lock/参数/OOS 分割，未联网，未建/未并 PR。** |
