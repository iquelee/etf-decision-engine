# -*- coding: utf-8 -*-
"""
从仓库源码 + 线上 zip 快照，准备 CloudBase 可部署的 dist-functions/ 与 cloudbaserc.json。

原理：
  - 源码 bundle（index.js + canonical common）由 scripts/build-cloudfunctions.js 生成。
  - 本脚本从 BASELINE_DIR（线上函数 zip 快照）恢复每个函数的 node_modules + config.json
    （依赖因安全被 .gitignore 排除，仓库不存），再生成 cloudbaserc.json。
  - 部署编排见 scripts/deploy.sh：先 build-cloudfunctions.js 后本脚本。

用法：
  python scripts/prepare-deploy.py [--baseline <zip快照目录>]
"""
import os, sys, json, zipfile, shutil, argparse

ENV_ID = "tradingview-etf-d0fa42yy57cbc11b"

# 线上函数（与 MCP listFunctions 一致）+ 新增 runIntegratedShadowEod（Integrated Shadow，只读反事实）
FUNCTIONS = [
    "runGen2ShadowEod", "runGen1ShadowEod", "runDecisionEngine",
    "adminGateway", "apiGateway", "extractFundamental",
    "fetchDailyData", "fetchFundamentalNews", "fetchRealtimeData",
    "materializeIndicators", "runIntegratedShadowEod",
]

# 线上 zip 里无顶层 config.json 的函数，用此默认配置补全（与线上 MCP getFunctionDetail 一致）
DEFAULT_CONFIGS = {
    "adminGateway": {
        "permissions": {"openapi": []},
        "timeout": 60,
        "envVariables": {"DECISION_ENV": "prod"},
        "triggers": [
            {"name": "http", "type": "http",
             "config": "{\"path\":\"/adminGateway\",\"method\":[\"GET\",\"POST\"]}"}
        ],
    },
    "runGen1ShadowEod": {
        "permissions": {"openapi": []},
        "timeout": 300,
        "envVariables": {},
        "triggers": [],  # timer 触发器已在云端（工作日 22:20），部署代码不动它
    },
    "runIntegratedShadowEod": {
        "permissions": {"openapi": []},
        "timeout": 120,
        "envVariables": {},
        "triggers": [],  # timer 触发器（shadowIntegrated-0910）在云端，部署代码不动它
    },
}

# 无线上 zip 快照的新函数：node_modules 从指定兄弟函数复用（同为 @cloudbase/node-sdk 依赖）
NO_BASELINE_DEPS_FROM = {
    "runIntegratedShadowEod": "runGen2ShadowEod",
}

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE_DEFAULT = r"C:/Users/iquel/Documents/ChatGPT/Tradingview/_gen2-online-baseline"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", default=BASELINE_DEFAULT, help="线上函数 zip 快照目录")
    args = ap.parse_args()

    dist = os.path.join(REPO, "dist-functions")
    # 覆盖式更新（不整目录删除，避免触发批量删除守卫）；
    # 如需干净重建，手动删除 dist-functions/ 后重跑本脚本。
    os.makedirs(dist, exist_ok=True)

    cloudbaserc_functions = []

    for fn in FUNCTIONS:
        out = os.path.join(dist, fn)
        os.makedirs(out, exist_ok=True)

        zip_path = os.path.join(args.baseline, fn + ".zip")
        if not os.path.exists(zip_path):
            # 新函数无线上 zip：写默认 config.json + 复用兄弟函数 node_modules（同 SDK 依赖）
            if fn in DEFAULT_CONFIGS:
                with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as f:
                    json.dump(DEFAULT_CONFIGS[fn], f, ensure_ascii=False, indent=2)
            dep_from = NO_BASELINE_DEPS_FROM.get(fn)
            if dep_from:
                src_nm = os.path.join(dist, dep_from, "node_modules")
                dst_nm = os.path.join(out, "node_modules")
                if os.path.isdir(src_nm) and os.listdir(src_nm) and not (os.path.isdir(dst_nm) and os.listdir(dst_nm)):
                    shutil.copytree(src_nm, dst_nm)
                    print(f"[复用依赖] {fn} ← {dep_from}/node_modules")
                elif os.path.isdir(dst_nm) and os.listdir(dst_nm):
                    pass  # 已缓存
                else:
                    print(f"[警告] {fn}: 无 zip 且 {dep_from} node_modules 未缓存，需先部署 {dep_from}")
            # 继续走 config.json 读取 + cloudbaserc 追加（不 continue）

        # 1) 从 zip 恢复 node_modules + config.json（线上权威）
        #    node_modules 缓存：已存在且非空则跳过解压（避免每次部署解压 6 分钟）；
        #    如需强制刷新依赖，删掉 dist-functions/<fn>/node_modules 后重跑。
        nm_dir = os.path.join(out, "node_modules")
        nm_cached = os.path.isdir(nm_dir) and bool(os.listdir(nm_dir))
        z = zipfile.ZipFile(zip_path)
        for name in z.namelist():
            nn = name.replace("\\", "/")
            if nn.endswith("/"):
                continue
            if nm_cached and nn.startswith("node_modules/"):
                continue  # 依赖已缓存，跳过
            if nn.startswith("node_modules/") or nn == "config.json":
                target = os.path.join(out, nn.replace("/", os.sep))
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(name) as f, open(target, "wb") as g:
                    shutil.copyfileobj(f, g)

        # 2) 读 config.json 的 timeout（供 cloudbaserc.json）；缺失则写默认配置
        cfg_path = os.path.join(out, "config.json")
        if not os.path.exists(cfg_path) and fn in DEFAULT_CONFIGS:
            with open(cfg_path, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIGS[fn], f, ensure_ascii=False, indent=2)
        timeout = 60
        if os.path.exists(cfg_path):
            try:
                cfg = json.load(open(cfg_path, encoding="utf-8"))
                timeout = cfg.get("timeout", 60)
            except Exception:
                pass

        cloudbaserc_functions.append({
            "name": fn,
            "runtime": "Nodejs16.13",
            "timeout": timeout,
            "handler": "index.main",
            "installDependency": False,
        })
        print(f"[OK] {fn} (timeout={timeout}s)")

    # 4) 生成 cloudbaserc.json（本地部署用，不入 git）
    cloudbaserc = {
        "version": "2.0",
        "envId": ENV_ID,
        "functionRoot": "./dist-functions",
        "functions": cloudbaserc_functions,
    }
    rc_path = os.path.join(REPO, "cloudbaserc.json")
    with open(rc_path, "w", encoding="utf-8") as f:
        json.dump(cloudbaserc, f, ensure_ascii=False, indent=2)
    print(f"\n[OK] 已生成 {rc_path}（{len(cloudbaserc_functions)} 个函数）")


if __name__ == "__main__":
    main()
