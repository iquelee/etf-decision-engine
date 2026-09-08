# Gen-2 Selection Shadow 消费接口契约（工作包 5 交付）

日期：2026-09-07。状态：后端消费端已实现并通过回归测试；前端观察页待接入（需动生产前端 web/）。

## 接口

`GET /api/admin/gen2/shadow`（adminGateway，需登录 token）

可选 query 参数：
- `date` / `trade_date`：指定读取某交易日的 completed 快照；不传则取「最新 completed」运行。

## 返回结构

```json
{
  "code": 0,
  "data": {
    "run": { "run_id": "...", "run_date": "2026-09-05", "status": "completed", ... },
    "selection": {
      "run_id": "...", "run_date": "...", "as_of_trade_date": "...",
      "mode": "LIVE", "engine_id": "gen2-rule-v2", "universe_version": "universe_v1",
      "eligible_count": 30, "ranked_count": 30,
      "selection_confidence": "FULL", "confidence_reason": null,
      "role_classification": "STANDARD", "universe_coverage": "30/30",
      "benchmark": "510300", "production_write": false, "status": "completed"
    },
    "rankings": [
      {
        "code": "513310", "name": "中韩半导体ETF", "correlation_cluster": "tech_hardware",
        "rank": 1, "alpha_score_v2": 91.0, "trend_gate": true, "regime": "RISK_ON",
        "proposed_role": "CORE", "role": "CORE", "persistence_days": 5,
        "reason_codes": "LEADERSHIP_TOP_QUINTILE|PROMOTION_CONFIRMED",
        "selection_share": 0.25, "candidate_weight": 0.25, "defense_state": "NORMAL"
      }
    ]
  }
}
```

## 消费契约（P1-2）

1. **先选同交易日 completed 运行，再按 run_id 读取**，禁止按每只 ETF 最新日期拼接。
2. `status` 非 `completed`（running / failed）的运行不返回、不被消费。
3. 字段分层：`selection_share`（池内相对份额）、`candidate_weight`（影子组合权重 0–1）由 Gen-2 观察权限产出；**`final_target_pct` 明确不在 Gen-2 权限内，本接口不产出**，最终建议由 V3.6.1 Safety Core（runDecisionEngine）产出。

## 边界（沿用工作包 1 冻结的权限表）

- Gen-2 管选池/角色/替换提案，仅观察；
- Gen-1 只在已定义模型域内参与机会判断；
- V3.6.1 Safety Core 保留风险与仓位最终约束；
- 执行由人完成，`production_write=false`、`auto_execution=false`。

## 回归测试

`tests/gen2-consumer.test.js`（6 项）：按 run_id 读取、跳过 running/failed、指定日期读取、无 completed 空返回。运行需 NODE_PATH 指向 `tests/mock_node_modules`（mock @cloudbase/node-sdk）。

## 未完成（前端观察页）

报告工作包 5 的完整交付含「管理端观察页」，需改生产前端 `web/`（V3.6.1 生产前端）。报告明确「观察页不得代替策略验收」，故前端 UI 留待策略验收通过后再接入；本接口已备好数据契约，前端可直接消费。
