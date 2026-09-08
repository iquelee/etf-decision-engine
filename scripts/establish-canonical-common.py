# -*- coding: utf-8 -*-
"""
P0-01 一次性迁移：把 10 个云函数各自的 common/ 收敛为 src/common/ 单一真相源。

Canonical 决策规则（见 docs/P0-01-common-drift-analysis.md）：
  R1 生产权威：decision 逻辑以 runDecisionEngine（V3.6.1 冻结基线）为准。
  R2 干净超集胜出：纯加法超集 → 超集为 canonical。
  R3 声明式并集：constants/schema 收敛到生产版。
  R4 死拷贝消除：canonical 只保留一份，构建时按 require 复制。
  R5 专有改名：Gen-1 专有保持独立文件名。

关键结论：
  - decision-v3.js 的 advisoryStageOverride 是全仓库无人调用的死代码 → canonical=生产纯净版(94f1d9c9)。
  - datasource.js 生产版是「全量版但 SEC 重试是旧的 1 次」；数据抓取版是「精简版但 SEC 重试已修(3次退避)」。
    → canonical = 全量版 + 采纳 3 次退避（顺带修复 extractFundamental 的 SEC 限流隐患）。

用法：python scripts/establish-canonical-common.py
"""
import os, json, hashlib, shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "src", "common")
BASE = os.path.join(REPO, "cloudfunctions", "runDecisionEngine", "common")


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def copy_file(fn, rel):
    """从 cloudfunctions/<fn>/common/<rel> 复制到 src/common/<rel>"""
    src = os.path.join(REPO, "cloudfunctions", fn, "common", rel)
    dst = os.path.join(SRC, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def main():
    if os.path.exists(SRC):
        shutil.rmtree(SRC)  # 重建（一次性脚本，src/common 是新建目录，无安全守卫风险）
    os.makedirs(SRC)

    # 1) 基线：runDecisionEngine/common 全量复制（R1 生产权威）
    for root, dirs, files in os.walk(BASE):
        for f in files:
            s = os.path.join(root, f)
            rel = os.path.relpath(s, BASE)
            d = os.path.join(SRC, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)

    # 2) 覆盖（R2 超集胜出 / R4 活依赖方权威）
    overrides = {
        # 文件相对路径 -> 来源函数
        "schema.js": "adminGateway",                 # 仅 adminGateway 活依赖（587 行最全）
        "utils/v3-shadow.js": "adminGateway",        # 超集：+ v361_baseline 字段
        "utils/gateway-errors.js": "adminGateway",   # 仅 adminGateway 活依赖
        "utils/request-validate.js": "adminGateway", # 仅 adminGateway 活依赖
        "utils/review-position.js": "apiGateway",    # 仅 apiGateway 活依赖
        "utils/review-stats.js": "apiGateway",       # 仅 apiGateway 活依赖
        "utils/ml-shadow.js": "apiGateway",          # 仅 apiGateway 活依赖
    }
    for rel, fn in overrides.items():
        copy_file(fn, rel)

    # 3) 新增（runDecisionEngine 没有、但其他函数活依赖的文件）
    additions = {
        "utils/gateway-auth.js": "adminGateway",
        "utils/gen1-view-model.js": "adminGateway",  # Gen-1 视图（仅测试引用，取 admin 展示版）
        "utils/gen1-capability.js": "runGen1ShadowEod",      # Gen-1 冻结
        "utils/gen1-rule-permission.js": "runGen1ShadowEod", # Gen-1 冻结
    }
    for rel, fn in additions.items():
        copy_file(fn, rel)

    # 4) datasource.js：全量版 + SEC 3 次退避（修复 extractFundamental SEC 限流隐患）
    ds = os.path.join(SRC, "utils", "datasource.js")
    txt = open(ds, encoding="utf-8").read()
    old = "    timeout: 15000\n  }), 1, [2000]);"
    new = "    timeout: 30000\n  }), 3, [1000, 5000, 15000]);"
    if old in txt:
        txt = txt.replace(old, new)
        open(ds, "w", encoding="utf-8").write(txt)
        print("[patch] datasource.js SEC 重试 1→3 次退避")
    else:
        print("[WARN] datasource.js 未找到 SEC 重试上下文，跳过 patch")

    # 5) 生成 SHA256 manifest
    manifest = {}
    for root, dirs, files in os.walk(SRC):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, SRC).replace("\\", "/")
            manifest[rel] = sha256(p)

    manifest_path = os.path.join(SRC, "MANIFEST.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"generated": "establish-canonical-common.py", "files": manifest},
                  f, ensure_ascii=False, indent=2, sort_keys=True)

    # 6) 汇总输出
    print(f"\n[OK] src/common 已建立：{len(manifest)} 个文件 + MANIFEST.json")
    print("覆盖/新增明细：")
    for rel, fn in {**overrides, **additions}.items():
        print(f"  {fn:20s} -> {rel}")


if __name__ == "__main__":
    main()
