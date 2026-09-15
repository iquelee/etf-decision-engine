#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gen-2 O2 —— cluster_taxonomy_v1 构建器（唯一分类学权威，版本化、可复算）。

背景（为什么需要本文件）
------------------------
`freeze §2.4 / §2.6` 与 `taskbook §0.9` 把 sector 覆盖门槛写成「**现有 8 个 cluster 中 ≥ 6 个**」，
但**全仓库没有任何文件枚举过这 8 个 cluster**。实测存在四套互不相同的口径：

| 口径 | 来源 | 基数 |
|---|---|---|
| L2 实现 cluster | `ml/gen2/universe/clusters_v1.json` | **11** |
| `correlation_cluster` 列 | `ml/gen2/universe/etf_master.csv` | **11** |
| 30 只 `eligible_codes` 实际覆盖 | `universe_v1.json` | **10** |
| `candidate_map`（仅 16 只新增） | `universe_v1.json` | **7** |

⇒ 按用户裁决 D，本脚本产出并冻结**唯一** `cluster_taxonomy_v1`：以 Rule V2 的
概念 cluster 为上位分类、逐标的映射、版本化。**本文件仅用于 O2 研究宇宙的准入与段级
充分性判定**，不改 Rule V2、不改 `universe_v1`、不参与任何评分或信号构造。

关于「8」的构造（可复算）
-------------------------
11 个 L2 cluster 中，有 **3 个不是行业/主题**：
`broad_beta`（基准宽基，`max_core_count=0`）、`growth_broad`（宽基成长）、
`gold_commodity`（商品/对冲）。11 − 3 = **8**。
等价地：`etf_master.sector` 共 10 个取值，其中 `broad` 与 `commodity` 非行业 ⇒ **8**。
两条路独立得到同一集合 ⇒ 本文件把「8」固定为该集合，并同时记录 9/10/11 三种读法供裁决。

用法
----
    python scripts/ml/build-cluster-taxonomy.py --out ml/gen2/universe/cluster_taxonomy_v1.json
    python scripts/ml/build-cluster-taxonomy.py --enum <clist 枚举 json>   # 附带 O2 候选指派
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIVERSE_DIR = ROOT / "ml" / "gen2" / "universe"
CLUSTERS_V1 = UNIVERSE_DIR / "clusters_v1.json"
MASTER = UNIVERSE_DIR / "etf_master.csv"
UNIVERSE_V1 = UNIVERSE_DIR / "universe_v1.json"

# ---------------------------------------------------------------- 分类学常量

#: 被冻结为「非行业/主题」的 L2 cluster（不计入 sector 覆盖分母）
NON_SECTOR_CLUSTERS = {
    "broad_beta": "基准宽基：max_core_count=0，且 510300 在 excluded_from_core_competition",
    "growth_broad": "宽基成长（sector=broad），非行业/主题",
    "gold_commodity": "商品/对冲资产（sector=commodity），非权益行业",
}

#: L2 cluster → L1 sector 概念（`etf_master.sector` 的取值域）
L2_TO_L1 = {
    "tech_hardware": "technology",
    "software_ai": "software_ai",
    "growth_broad": "broad",
    "broad_beta": "broad",
    "healthcare": "healthcare",
    "consumer": "consumer",
    "financial": "financial",
    "defensive_dividend": "defensive_dividend",
    "cyclical_resources": "cyclical_resources",
    "overseas_equity": "overseas_equity",
    "gold_commodity": "commodity",
}

#: 名称关键词 → (L2 cluster, 类别性质)。有序，首个命中生效。版本 = keyword_rule_v1。
#: ⚠ 仅为 O2 候选的**指派建议**（PROPOSED），既有 31 只池的成员关系一律以
#:   `clusters_v1.json` / `etf_master.csv` 为准，**不由本表改写**。
KEYWORD_RULES: list[tuple[str, str, str]] = [
    # --- 非权益（候选筛除用） ---
    ("货币", "MONEY_MARKET", "excluded"), ("快线", "MONEY_MARKET", "excluded"),
    ("快钱", "MONEY_MARKET", "excluded"), ("日利", "MONEY_MARKET", "excluded"),
    ("日日鑫", "MONEY_MARKET", "excluded"), ("添益", "MONEY_MARKET", "excluded"),
    ("天天金", "MONEY_MARKET", "excluded"), ("增益", "MONEY_MARKET", "excluded"),
    ("财富宝", "MONEY_MARKET", "excluded"), ("添利", "MONEY_MARKET", "excluded"),
    ("现金", "MONEY_MARKET", "excluded"), ("理财", "MONEY_MARKET", "excluded"),
    ("国债", "BOND", "excluded"), ("转债", "BOND", "excluded"),
    ("信用债", "BOND", "excluded"), ("短融", "BOND", "excluded"), ("债", "BOND", "excluded"),
    # --- 行业 / 主题 ---
    ("半导体", "tech_hardware", "sector"), ("芯片", "tech_hardware", "sector"),
    ("集成电路", "tech_hardware", "sector"), ("通信", "tech_hardware", "sector"),
    ("5G", "tech_hardware", "sector"), ("TMT", "tech_hardware", "sector"),
    ("信息技术", "tech_hardware", "sector"), ("信息科技", "tech_hardware", "sector"),
    ("电子", "tech_hardware", "sector"),
    ("人工智能", "software_ai", "sector"), ("软件", "software_ai", "sector"),
    ("机器人", "software_ai", "sector"), ("云计算", "software_ai", "sector"),
    ("大数据", "software_ai", "sector"), ("游戏", "software_ai", "sector"),
    ("医药", "healthcare", "sector"), ("生物", "healthcare", "sector"),
    ("医疗", "healthcare", "sector"), ("创新药", "healthcare", "sector"),
    ("疫苗", "healthcare", "sector"),
    ("酒", "consumer", "sector"), ("消费", "consumer", "sector"),
    ("食品", "consumer", "sector"), ("家电", "consumer", "sector"),
    ("传媒", "consumer", "sector"), ("旅游", "consumer", "sector"),
    ("银行", "financial", "sector"), ("证券", "financial", "sector"),
    ("券商", "financial", "sector"), ("保险", "financial", "sector"),
    ("金融", "financial", "sector"),
    ("红利", "defensive_dividend", "sector"), ("股息", "defensive_dividend", "sector"),
    ("低波", "defensive_dividend", "sector"), ("价值", "defensive_dividend", "sector"),
    ("军工", "cyclical_resources", "sector"), ("新能源", "cyclical_resources", "sector"),
    ("光伏", "cyclical_resources", "sector"), ("有色", "cyclical_resources", "sector"),
    ("煤炭", "cyclical_resources", "sector"), ("钢铁", "cyclical_resources", "sector"),
    ("化工", "cyclical_resources", "sector"), ("建材", "cyclical_resources", "sector"),
    ("资源", "cyclical_resources", "sector"), ("大宗商品", "cyclical_resources", "sector"),
    ("房地产", "cyclical_resources", "sector"), ("基建", "cyclical_resources", "sector"),
    ("环保", "cyclical_resources", "sector"), ("机械", "cyclical_resources", "sector"),
    ("能源", "cyclical_resources", "sector"), ("材料", "cyclical_resources", "sector"),
    ("恒生", "overseas_equity", "sector"), ("纳指", "overseas_equity", "sector"),
    ("纳斯达克", "overseas_equity", "sector"), ("标普", "overseas_equity", "sector"),
    ("德国", "overseas_equity", "sector"), ("法国", "overseas_equity", "sector"),
    ("日经", "overseas_equity", "sector"), ("亚太", "overseas_equity", "sector"),
    ("中概", "overseas_equity", "sector"), ("美国", "overseas_equity", "sector"),
    # --- 非行业（宽基 / 商品） ---
    ("黄金", "gold_commodity", "non_sector"), ("白银", "gold_commodity", "non_sector"),
    ("商品", "gold_commodity", "non_sector"),
    ("沪深300", "broad_beta", "non_sector"), ("中证500", "broad_beta", "non_sector"),
    ("中证1000", "broad_beta", "non_sector"), ("中证100", "broad_beta", "non_sector"),
    ("中证A", "broad_beta", "non_sector"), ("上证50", "broad_beta", "non_sector"),
    ("上证180", "broad_beta", "non_sector"), ("上证380", "broad_beta", "non_sector"),
    ("上证指数", "broad_beta", "non_sector"), ("上证中盘", "broad_beta", "non_sector"),
    ("深证100", "broad_beta", "non_sector"), ("深证成指", "broad_beta", "non_sector"),
    ("深成", "broad_beta", "non_sector"),
    ("深300", "broad_beta", "non_sector"), ("深成长", "broad_beta", "non_sector"),
    ("深价值", "broad_beta", "non_sector"), ("中小100", "broad_beta", "non_sector"),
    ("中创400", "broad_beta", "non_sector"), ("国证2000", "broad_beta", "non_sector"),
    ("超大盘", "broad_beta", "non_sector"), ("基本面", "broad_beta", "non_sector"),
    ("央企", "broad_beta", "non_sector"), ("国企", "broad_beta", "non_sector"),
    ("MSCI", "broad_beta", "non_sector"), ("治理", "broad_beta", "non_sector"),
    ("责任", "broad_beta", "non_sector"), ("产业升级", "broad_beta", "non_sector"),
    ("A50", "broad_beta", "non_sector"),
    ("科创50", "growth_broad", "non_sector"), ("科创板50", "growth_broad", "non_sector"),
    ("创业板", "growth_broad", "non_sector"), ("双创", "growth_broad", "non_sector"),
]

EXCLUDED_KINDS = ("excluded",)


def classify_name(name: str) -> tuple[str, str]:
    """返回 (L2 cluster, kind)；kind ∈ {sector, non_sector, excluded, unknown}。"""
    for kw, cl, kind in KEYWORD_RULES:
        if kw in name:
            return cl, kind
    return "UNMATCHED", "unknown"


# ---------------------------------------------------------------- 构建

def build(enum_path: Path | None, include_assignments: bool = False) -> dict:
    clusters_v1 = json.loads(CLUSTERS_V1.read_text(encoding="utf-8"))
    uni = json.loads(UNIVERSE_V1.read_text(encoding="utf-8"))
    with open(MASTER, encoding="utf-8-sig", newline="") as fh:
        master = {r["code"]: r for r in csv.DictReader(fh)}

    l2_by_cluster: dict[str, list[str]] = {
        c: list(v.get("codes", [])) for c, v in clusters_v1["clusters"].items()
    }
    l2_clusters = sorted(l2_by_cluster)

    # 逐标的映射（既有池：以 clusters_v1 + etf_master 为权威）
    members: dict[str, dict] = {}
    code_to_cluster = {c: cl for cl, codes in l2_by_cluster.items() for c in codes}
    for code, m in sorted(master.items()):
        cl_file = code_to_cluster.get(code)
        cl_master = (m.get("correlation_cluster") or "").strip()
        kw_cl, kw_kind = classify_name(m.get("name") or "")
        members[code] = {
            "name": m.get("name"),
            "l2_cluster": cl_master or cl_file,
            "l1_sector": L2_TO_L1.get(cl_master or cl_file, "UNKNOWN"),
            "coverage_eligible": (cl_master or cl_file) not in NON_SECTOR_CLUSTERS,
            "assignment_source": "clusters_v1.json + etf_master.correlation_cluster（权威）",
            "keyword_rule_would_say": kw_cl,
            "keyword_rule_agrees": kw_cl == (cl_master or cl_file),
            "in_universe_v1": code in uni["eligible_codes"],
            "incumbent": m.get("incumbent") == "1",
        }

    # 一致性告警：clusters_v1 与 etf_master 分歧
    disagreements = []
    for code, cl in sorted(code_to_cluster.items()):
        m = master.get(code)
        if not m:
            disagreements.append({"code": code, "issue": "在 clusters_v1 但不在 etf_master"})
            continue
        if (m.get("correlation_cluster") or "").strip() != cl:
            disagreements.append({"code": code, "clusters_v1": cl,
                                  "etf_master": m.get("correlation_cluster")})
    for code in sorted(master):
        if code_to_cluster.get(code) is None:
            disagreements.append({"code": code, "issue": "在 etf_master 但不在 clusters_v1",
                                  "etf_master": master[code].get("correlation_cluster")})

    # 四套口径的基数
    over_eligible = {L2_TO_L1.get(master[c]["correlation_cluster"], "?")
                     for c in uni["eligible_codes"] if c in master}
    readings = {
        "11_all_l2_clusters": {"value": len(l2_clusters), "members": l2_clusters,
                               "rule": "clusters_v1.json 的全部 L2 cluster"},
        "10_competitive_l2": {"value": len([c for c in l2_clusters if c not in NON_SECTOR_CLUSTERS]) + 2,
                              "rule": "L2 去除基准 broad_beta（保留 growth_broad / gold_commodity）",
                              "members": [c for c in l2_clusters if c != "broad_beta"]},
        "9_l2_minus_broad_commodity": {
            "value": len([c for c in l2_clusters if c not in NON_SECTOR_CLUSTERS]) + 1,
            "rule": "L2 去除基准与商品（保留 growth_broad）",
            "members": [c for c in l2_clusters
                        if c not in ("broad_beta", "gold_commodity")]},
        "8_sector_type_only": {
            "value": len([c for c in l2_clusters if c not in NON_SECTOR_CLUSTERS]),
            "rule": "L2 去除全部非行业/主题（broad_beta / growth_broad / gold_commodity）",
            "members": [c for c in l2_clusters if c not in NON_SECTOR_CLUSTERS]},
    }

    out = {
        "taxonomy_version": "cluster_taxonomy_v1",
        "created_at": date.today().isoformat(),
        "status": "FROZEN_RESEARCH_ONLY",
        "governing_ruling": ("用户裁决 D（2026-09-15）：M1-B 必须产出并冻结唯一 cluster_taxonomy_v1；"
                            "在此之前不做「≥6/8」合格判定"),
        "scope": [
            "用于 O2 研究宇宙的逐标的分类、sector 覆盖统计与段级充分性判定。",
            "不改 Rule V2（GEN2_RULE_V2_BUNDLE.json 未定义 cluster 成员，仅定义 tech_clusters 与每 cluster CORE 上限）。",
            "不改 universe_v1.json 的 eligible_codes / candidate_map。",
            "不参与任何评分、信号构造或权重计算；不得作策略参数。",
        ],
        "provenance": {
            "l2_membership_authority": "ml/gen2/universe/clusters_v1.json（clusters_v1_static_research, 2026-09-05）",
            "l2_membership_is_frozen_by_rule_v2": False,
            "note": ("⚠ 治理缺口：clusters_v1.json 与 universe_v1.json 均**不在** Rule V2 的 "
                     "immutable_set（8 项）内 ⇒ 成员关系可在 bundle 字节不变的前提下被改动。"
                     "本文件的冻结即为闭合该缺口（但**不**把 clusters_v1.json 纳入 LOCK，"
                     "那属于新 lock revision，需用户批准）。"),
            "keyword_rules_version": "keyword_rule_v1",
            "keyword_rules_scope": "仅用于 O2 候选（池外标的）的指派**建议**；既有 31 只池一律以文件为准。",
        },
        "layers": {
            "l1_sector": {
                "description": "上位概念层 = etf_master.sector 的取值域（10 个），其中 8 个为行业/主题",
                "values": sorted(set(L2_TO_L1.values())),
                "non_sector_values": ["broad", "commodity"],
            },
            "l2_cluster": {
                "description": "下位实现层 = clusters_v1.json 的 11 个 correlation_cluster",
                "values": l2_clusters,
                "max_core_count": {c: clusters_v1["clusters"][c].get("max_core_count")
                                   for c in l2_clusters},
                "to_l1": L2_TO_L1,
            },
        },
        "coverage_denominator": {
            "value": readings["8_sector_type_only"]["value"],
            "members": readings["8_sector_type_only"]["members"],
            "rule": readings["8_sector_type_only"]["rule"],
            "why_this_is_8": ("11 − 3 = 8；两条独立路径得同一集合："
                              "① 11 个 L2 cluster 去掉 3 个非行业 cluster；"
                              "② etf_master.sector 的 10 个取值去掉 broad / commodity。"),
            "unsourced_before_this_file": ("freeze §2.4/§2.6 与 taskbook §0.9 是「8」的唯一出处，"
                                           "此前无任何文件枚举过其成员。"),
            "alternative_readings": {k: {"value": v["value"], "rule": v["rule"]}
                                     for k, v in readings.items() if k != "8_sector_type_only"},
            "threshold_unchanged": "≥6 的门槛数值未改动；本文件只把分母的定义补成可复算。",
            "requires_user_confirmation": True,
        },
        "sector_cluster_definitions": {
            c: {"l1_sector": L2_TO_L1[c],
                "l2_members_existing": l2_by_cluster.get(c, []),
                "coverage_eligible": c not in NON_SECTOR_CLUSTERS}
            for c in l2_clusters
        },
        "members": members,
        "consistency": {
            "clusters_v1_vs_etf_master_disagreements": disagreements,
            "keyword_rule_mismatches_in_pool": [
                {"code": c, "authority": v["l2_cluster"], "keyword_said": v["keyword_rule_would_say"]}
                for c, v in members.items()
                if not v["keyword_rule_agrees"]
            ],
            "eligible_codes_sector_coverage": {
                "l1_sectors_covered": sorted(over_eligible),
                "n_l1": len(over_eligible),
                "n_coverage_eligible": len(over_eligible & set(
                    v["l1_sector"] for k, v in members.items() if v["coverage_eligible"])),
            },
        },
        "unresolved": [
            "「8」的原始出处仍未见文件枚举；本文件给出可复算构造，待用户确认。",
            "若用户确认分母应为 9 / 10 / 11，只需改 coverage_denominator.value 与 members，"
            "其余结构不变（阈值 ≥6 不动）。",
            "growth_broad 是否算「行业」需裁决：本文件按 sector=broad 判为非行业。",
        ],
    }

    if enum_path and enum_path.exists():
        enum = json.loads(enum_path.read_text(encoding="utf-8"))
        pool = set(master)
        assigned = []
        for r in enum:
            code = str(r.get("f12"))
            name = str(r.get("f14") or "")
            cl, kind = classify_name(name)
            assigned.append({
                "code": code, "name": name,
                "in_current_pool": code in pool,
                "l2_cluster": cl, "kind": kind,
                "l1_sector": L2_TO_L1.get(cl),
                "coverage_eligible": cl not in NON_SECTOR_CLUSTERS,
                "assignment_source": "keyword_rule_v1（PROPOSED，待复核）",
            })
        out["o2_candidate_assignment_stats"] = {
            "total": len(assigned),
            "by_kind": {k: sum(1 for a in assigned if a["kind"] == k)
                        for k in sorted({a["kind"] for a in assigned})},
            "unobserved_early_by_cluster": {},
        }
        def _f26(r: dict) -> str | None:
            v = r.get("f26")
            s = str(v) if v not in (None, "", "-", 0) else None
            return f"{s[:4]}-{s[4:6]}-{s[6:]}" if s else None

        early = [a for a in assigned if not a["in_current_pool"]
                 and a["kind"] in ("sector", "non_sector")]
        st: dict[str, int] = {}
        for a in early:
            st[a["l2_cluster"]] = st.get(a["l2_cluster"], 0) + 1
        out["o2_candidate_assignment_stats"]["unobserved_all_by_cluster"] = dict(sorted(st.items()))

        early_dated = [a for a in early if (_f26(next(
            r for r in enum if str(r.get("f12")) == a["code"])) or "9999") <= "2017-12-31"]
        st2: dict[str, int] = {}
        for a in early_dated:
            st2[a["l2_cluster"]] = st2.get(a["l2_cluster"], 0) + 1
        out["o2_candidate_assignment_stats"]["unobserved_early_by_cluster"] = dict(sorted(st2.items()))
        out["o2_candidate_assignment_stats"]["unobserved_early_total"] = len(early_dated)

        # ⚠ 未分类（keyword_rule 未命中）必须显式计数，不得静默丢弃
        early_dated_any = [a for a in assigned if not a["in_current_pool"]
                           and a["kind"] != "excluded"
                           and (_f26(next(r for r in enum
                                          if str(r.get("f12")) == a["code"])) or "9999") <= "2017-12-31"]
        unmatched = [a for a in early_dated_any if a["kind"] == "unknown"]
        out["o2_candidate_assignment_stats"]["unobserved_early_any_kind"] = len(early_dated_any)
        out["o2_candidate_assignment_stats"]["unobserved_early_unmatched"] = len(unmatched)
        out["o2_candidate_assignment_stats"]["unobserved_early_unmatched_codes"] = [
            {"code": a["code"], "name": a["name"]} for a in unmatched]
        if include_assignments:
            out["o2_candidate_assignments"] = assigned
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="构建 cluster_taxonomy_v1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--enum", default=None, help="clist 枚举 json（可选，附 O2 候选指派）")
    ap.add_argument("--include-assignments", action="store_true",
                    help="把全部 1604 只的逐只指派写入 JSON（体积大，默认不写）")
    a = ap.parse_args()
    enum_path = Path(a.enum) if a.enum else None
    doc = build(enum_path, include_assignments=bool(a.include_assignments))
    outp = Path(a.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    cd = doc["coverage_denominator"]
    print(f"[taxonomy] wrote {outp}")
    print(f"[taxonomy] L2 clusters = {len(doc['layers']['l2_cluster']['values'])}")
    print(f"[taxonomy] coverage denominator = {cd['value']} -> {cd['members']}")
    print(f"[taxonomy] 一致性分歧 = {len(doc['consistency']['clusters_v1_vs_etf_master_disagreements'])}，"
          f"关键词不一致 = {len(doc['consistency']['keyword_rule_mismatches_in_pool'])}")
    if "o2_candidate_assignments" in doc:
        print("[taxonomy] O2 候选指派 =",
              json.dumps(doc["o2_candidate_assignment_stats"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
