#!/bin/bash
# =============================================================
# 从 GitHub 仓库一键部署到 CloudBase（前端 hosting + 后端云函数）
# 用法：bash scripts/deploy.sh [--pull] [--frontend-only] [--backend-only]
#   --pull          先 git pull origin master
#   --frontend-only 只部署前端
#   --backend-only  只部署后端云函数
#
# 前端 API base（VITE_API_BASE / VITE_ADMIN_BASE）的解析与双重硬门禁
# 见下方 `resolve_api_base` / `verify_frontend_bundle` 的注释。
# =============================================================
set -e

ENV_ID="tradingview-etf-d0fa42yy57cbc11b"
NODE="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
NPM_CLI="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/npm/bin/npm-cli.js"
PY="C:/Users/iquel/.workbuddy/binaries/python/versions/3.13.12/python.exe"
# CloudBase CLI 入口。允许环境变量覆盖（仅供测试/CI 注入替身；默认行为不变）
CLI="${TCB_CLI_JS:-C:/Users/iquel/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/dist/standalone/cli.js}"
REPO="D:/AI-Projects/Codex/etf-decision-engine/etf-decision-engine"
# 前端 node_modules 本地快照（仓库不存 node_modules，首次部署从这复制，避免 npm install 慢）
AUDIT_WEB_NM="D:/AI-Projects/Codex/etf-decision-engine/audit-20260830/web/node_modules"
# API base 第二级来源文件。允许环境变量覆盖（仅供测试隔离；默认行为不变）
API_BASE_ENV_FILE="${API_BASE_ENV_FILE:-$REPO/web/.env.production}"

FNS="runGen2ShadowEod runGen1ShadowEod runDecisionEngine adminGateway apiGateway extractFundamental fetchDailyData fetchFundamentalNews fetchRealtimeData materializeIndicators"

DO_FRONTEND=1
DO_BACKEND=1
for a in "$@"; do
  case "$a" in
    --pull)          GIT_PULL=1 ;;
    --frontend-only) DO_BACKEND=0 ;;
    --backend-only)  DO_FRONTEND=0 ;;
  esac
done

# ===== 环境准备（Windows 家用机三坑：凭证目录重定向 + 取消 Clash 代理）=====
export USERPROFILE="C:/Users/iquel/.workbuddy/binaries/node/workspace/.tcb-home"
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY
export NO_PROXY="*"

cd "$REPO"

# =============================================================
# 前端 API base 解析与硬门禁
#
# 背景：`vite build` 在缺少 VITE_API_BASE / VITE_ADMIN_BASE 的环境下执行时，
#   会把 API base 编译为空字符串，而构建与 hosting 部署**都会成功**，
#   最终在浏览器里退化为 /api/... ⇒ 404。本段保证：
#     ① 构建前解析出可信 base（三级来源），任一来源都必须通过形状校验；
#     ② 三级全部失败 ⇒ 立即 exit 1（⛔ 不 build、⛔ 不 deploy）；
#     ③ 构建后校验真实 bundle 是否消费了该 base ⇒ 否则 exit 1（⛔ 不 deploy）。
#
# 来源优先级：
#   1) shell environment（VITE_API_BASE / VITE_ADMIN_BASE，需同时提供）
#   2) web/.env.production（需同时提供两个键）
#   3) CloudBase 自动发现（Hosting CdnDomain + 网关路由存在性探测）
#   4) 全部失败 ⇒ FAIL CLOSED
#
# ⛔ 任何情况下都不允许 base 为空/非法后继续构建或部署（无静默 fallback）。
# ⛔ 不做跨来源混用：某一级只提供了一半 ⇒ 该级视为不完整，打印警告后下沉。
# =============================================================
API_GATEWAY_PATH="/apiGateway"
ADMIN_GATEWAY_PATH="/adminGateway"

# 从 .env 风格文件读取某个键（去掉 CR / 引号 / 首尾空白）；键不存在 ⇒ 返回 1
read_env_key() {
  local file="$1" key="$2" line val
  [ -f "$file" ] || return 1
  line=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1) || return 1
  [ -n "$line" ] || return 1
  val="${line#*=}"
  val=$(printf '%s' "$val" | tr -d '\r')
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  printf '%s' "$val"
}

# 形状校验：必须恰为 http(s)://<非空 host><期望路径>。
# ⛔ 明确拒绝：空串 / 无协议 / host 为空 / path 不等于期望（如 /apiGateway、/api、/、undefined、null）
validate_api_base() {
  local v="$1" want="$2" name="$3" rest host path
  case "$v" in
    "") echo "  ❌ $name 为空"; return 1 ;;
    http://*|https://*) ;;
    *) echo "  ❌ $name 缺少 http(s):// 前缀：$v"; return 1 ;;
  esac
  rest="${v#*://}"
  host="${rest%%/*}"
  [ -n "$host" ] || { echo "  ❌ $name 的 host 为空：$v"; return 1; }
  path="/${rest#*/}"
  [ "$path" = "$want" ] || { echo "  ❌ $name 的 path 必须恰为 $want（实际：$path）：$v"; return 1; }
  return 0
}

# 网关路由存在性探测：404 / 连接失败 ⇒ 视为路由缺失
# 注：诊断信息一律走 stderr —— 本函数可能在 `$( )` 命令替换中被调用，
#     写 stdout 会被调用方捕获吞掉，导致失败时看不到原因。
probe_gateway_route() {
  local url="$1" code
  command -v curl >/dev/null 2>&1 || { echo "  ❌ 未找到 curl，无法探测网关路由存在性" >&2; return 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 --noproxy '*' "$url" 2>/dev/null) || code="000"
  [ -n "$code" ] || code="000"
  case "$code" in
    404|000) echo "  ❌ 网关路由缺失或不可达：$url（HTTP $code）" >&2; return 1 ;;
  esac
  return 0
}

# 第三级：CloudBase 自动发现 —— 只使用平台权威数据（Hosting CdnDomain + 网关路由）
# ⛔ 不靠字符串猜测 / 前端源码猜测 / 现有 bundle 猜测 / 硬编码域名
# 注：诊断信息一律走 stderr；本函数只向 stdout 输出最终的两行 base。
discover_api_base() {
  local out dom count
  echo "  · 查询 CloudBase Hosting 域名（$ENV_ID）…" >&2
  out=$("$NODE" "$CLI" hosting detail -e "$ENV_ID" 2>&1) || { echo "  ❌ 查询 CloudBase Hosting 失败" >&2; return 1; }
  dom=$(printf '%s\n' "$out" | tr -d '\r' \
        | grep -oE '[a-z0-9][a-z0-9.-]*\.tcloudbaseapp\.com' | sort -u)
  count=$(printf '%s\n' "$dom" | grep -c . || true)
  if [ "$count" != "1" ]; then
    echo "  ❌ 无法唯一确定 CdnDomain（命中 $count 个，期望 1 个）" >&2
    return 1
  fi
  echo "  · 已确定 CdnDomain：$dom" >&2
  echo "  · 探测网关路由存在性 …" >&2
  probe_gateway_route "https://${dom}${API_GATEWAY_PATH}/api/constants"     || return 1
  probe_gateway_route "https://${dom}${ADMIN_GATEWAY_PATH}/api/admin/param" || return 1
  printf 'https://%s%s\nhttps://%s%s\n' "$dom" "$API_GATEWAY_PATH" "$dom" "$ADMIN_GATEWAY_PATH"
  return 0
}

# 解析并导出 VITE_API_BASE / VITE_ADMIN_BASE；任一步失败 ⇒ exit 1（⛔ 不 build、⛔ 不 deploy）
resolve_api_base() {
  local a="" d="" src=""

  # ---- 1) shell environment（要求两个变量同时提供才视为「完整」）----
  if [ -n "${VITE_API_BASE:-}" ] && [ -n "${VITE_ADMIN_BASE:-}" ]; then
    a="$VITE_API_BASE"; d="$VITE_ADMIN_BASE"; src="shell environment"
  elif [ -n "${VITE_API_BASE:-}" ] || [ -n "${VITE_ADMIN_BASE:-}" ]; then
    echo "  ⚠️ shell environment 只提供了 VITE_API_BASE / VITE_ADMIN_BASE 之一 ⇒ 视为不完整，忽略并下沉"
    echo "     （⛔ 不做跨来源混用；如需显式指定，请两个变量同时提供）"
  fi

  # ---- 2) web/.env.production（同样要求两个键都存在）----
  if [ -z "$src" ]; then
    if [ -f "$API_BASE_ENV_FILE" ]; then
      a=$(read_env_key "$API_BASE_ENV_FILE" VITE_API_BASE || true)
      d=$(read_env_key "$API_BASE_ENV_FILE" VITE_ADMIN_BASE || true)
      if [ -n "$a" ] && [ -n "$d" ]; then
        src="$API_BASE_ENV_FILE"
      else
        echo "  ⚠️ $API_BASE_ENV_FILE 未同时提供 VITE_API_BASE / VITE_ADMIN_BASE ⇒ 忽略并下沉"
        a=""; d=""
      fi
    else
      echo "  · 未找到 $API_BASE_ENV_FILE"
    fi
  fi

  # ---- 3) CloudBase 自动发现 ----
  if [ -z "$src" ]; then
    local disc
    if disc=$(discover_api_base); then
      a=$(printf '%s\n' "$disc" | sed -n '1p')
      d=$(printf '%s\n' "$disc" | sed -n '2p')
      src="CloudBase 自动发现"
    else
      echo ""
      echo "❌ API base 无法自动发现。请显式提供："
      echo "     VITE_API_BASE=https://<host>${API_GATEWAY_PATH} \\"
      echo "     VITE_ADMIN_BASE=https://<host>${ADMIN_GATEWAY_PATH} \\"
      echo "     bash scripts/deploy.sh --frontend-only"
      echo "   ⛔ 已中止：未执行 vite build，未执行 hosting deploy。"
      exit 1
    fi
  fi

  echo "  · 来源：$src"

  # ---- 统一形状校验（任一级都不豁免）----
  if ! validate_api_base "$a" "$API_GATEWAY_PATH" VITE_API_BASE; then
    echo "❌ VITE_API_BASE 校验失败。⛔ 已中止：未执行 vite build，未执行 hosting deploy。"
    exit 1
  fi
  if ! validate_api_base "$d" "$ADMIN_GATEWAY_PATH" VITE_ADMIN_BASE; then
    echo "❌ VITE_ADMIN_BASE 校验失败。⛔ 已中止：未执行 vite build，未执行 hosting deploy。"
    exit 1
  fi

  export VITE_API_BASE="$a"
  export VITE_ADMIN_BASE="$d"
  echo "  ✅ VITE_API_BASE   = $VITE_API_BASE"
  echo "  ✅ VITE_ADMIN_BASE = $VITE_ADMIN_BASE"
}

# 构建后硬门禁：确认 bundle 真的消费了 base。
# env 存在 ≠ 产物正确：rewrite 侧走 ENV.VITE_API_BASE 属性访问、
# legacy 侧走 import.meta.env 静态替换，两条路径必须都落到产物里。
verify_frontend_bundle() {
  local dir="$REPO/web/dist/assets" hits_api hits_adm seg_api seg_adm
  [ -d "$dir" ] || { echo "❌ 构建产物目录不存在：$dir"; return 1; }

  hits_api=$(grep -lF -- "$VITE_API_BASE"   "$dir"/*.js 2>/dev/null | wc -l | tr -d ' ')
  hits_adm=$(grep -lF -- "$VITE_ADMIN_BASE" "$dir"/*.js 2>/dev/null | wc -l | tr -d ' ')
  echo "  · bundle 内完整 base 命中文件数：api=$hits_api admin=$hits_adm"
  if [ "$hits_api" -lt 1 ] || [ "$hits_adm" -lt 1 ]; then
    echo "❌ bundle 未消费 API base（env 已提供，但产物里找不到完整 base 串）。"
    echo "   期望命中：$VITE_API_BASE"
    echo "            $VITE_ADMIN_BASE"
    echo "   ⛔ 已中止：未执行 hosting deploy。"
    return 1
  fi

  # 退化形态补充检查：bundle 内必须同时存在两个网关路径片段
  seg_api=$(grep -lF -- "$API_GATEWAY_PATH"   "$dir"/*.js 2>/dev/null | wc -l | tr -d ' ')
  seg_adm=$(grep -lF -- "$ADMIN_GATEWAY_PATH" "$dir"/*.js 2>/dev/null | wc -l | tr -d ' ')
  if [ "$seg_api" -lt 1 ] || [ "$seg_adm" -lt 1 ]; then
    echo "❌ bundle 内缺少网关路径片段（api=$seg_api admin=$seg_adm）"
    echo "   ⛔ 已中止：未执行 hosting deploy。"
    return 1
  fi

  echo "  ✅ bundle 校验通过"
  return 0
}

if [ "$GIT_PULL" == "1" ]; then
  echo "=== git pull ==="
  git pull origin master
fi

# ===== 前端 =====
if [ "$DO_FRONTEND" == "1" ]; then
  echo "=== 前端 API base 解析（构建前硬门禁）==="
  resolve_api_base

  echo "=== 前端构建 ==="
  cd web
  if [ ! -d node_modules ]; then
    if [ -d "$AUDIT_WEB_NM" ]; then
      echo "  复用本地快照 node_modules ..."
      cp -r "$AUDIT_WEB_NM" node_modules
    else
      echo "  npm install ..."
      "$NODE" "$NPM_CLI" install
    fi
  fi
  "$NODE" node_modules/vite/bin/vite.js build
  cd ..

  echo "=== 构建后 bundle 校验（部署前硬门禁）==="
  verify_frontend_bundle || exit 1

  echo "=== 前端部署（hosting）==="
  "$NODE" "$CLI" hosting deploy web/dist -e "$ENV_ID"
fi

# ===== 后端 =====
if [ "$DO_BACKEND" == "1" ]; then
  echo "=== 构建云函数源码 bundle（index.js + canonical common）==="
  "$NODE" scripts/build-cloudfunctions.js

  echo "=== 准备云函数（恢复 node_modules + config.json，生成 cloudbaserc.json）==="
  "$PY" scripts/prepare-deploy.py

  echo "=== 部署云函数 ==="
  for fn in $FNS; do
    echo "--- $fn ---"
    "$NODE" "$CLI" fn deploy "$fn" --dir "dist-functions/$fn" --force -e "$ENV_ID"
  done
fi

echo "=== 全部完成 ==="
