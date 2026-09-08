#!/bin/bash
# =============================================================
# 从 GitHub 仓库一键部署到 CloudBase（前端 hosting + 后端云函数）
# 用法：bash scripts/deploy.sh [--pull] [--frontend-only] [--backend-only]
#   --pull          先 git pull origin master
#   --frontend-only 只部署前端
#   --backend-only  只部署后端云函数
# =============================================================
set -e

ENV_ID="tradingview-etf-d0fa42yy57cbc11b"
NODE="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
NPM_CLI="C:/Users/iquel/.workbuddy/binaries/node/versions/22.22.2-2/node_modules/npm/bin/npm-cli.js"
PY="C:/Users/iquel/.workbuddy/binaries/python/versions/3.13.12/python.exe"
CLI="C:/Users/iquel/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/dist/standalone/cli.js"
REPO="C:/Users/iquel/Documents/ChatGPT/Tradingview/etf-decision-engine"
# 前端 node_modules 本地快照（仓库不存 node_modules，首次部署从这复制，避免 npm install 慢）
AUDIT_WEB_NM="C:/Users/iquel/Documents/ChatGPT/Tradingview/audit-20260830/web/node_modules"

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

if [ "$GIT_PULL" == "1" ]; then
  echo "=== git pull ==="
  git pull origin master
fi

# ===== 前端 =====
if [ "$DO_FRONTEND" == "1" ]; then
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

  echo "=== 前端部署（hosting）==="
  "$NODE" "$CLI" hosting deploy web/dist -e "$ENV_ID"
fi

# ===== 后端 =====
if [ "$DO_BACKEND" == "1" ]; then
  echo "=== 准备云函数（dist-functions + cloudbaserc.json）==="
  "$PY" scripts/prepare-deploy.py

  echo "=== 部署云函数 ==="
  for fn in $FNS; do
    echo "--- $fn ---"
    "$NODE" "$CLI" fn deploy "$fn" --dir "dist-functions/$fn" --force -e "$ENV_ID"
  done
fi

echo "=== 全部完成 ==="
