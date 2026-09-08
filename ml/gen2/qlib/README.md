# Qlib for Gen-2.1（暂缓）

Qlib 只在 Gen-2.0 Rule Leadership Baseline 证明动态 Universe 存在稳定 Selection Alpha 后接入。

当前阶段禁止：

- 直接训练 LightGBM / Transformer；
- Random Split；
- 用 ML 输出替代 Rule Baseline；
- 将 Qlib 结果写入生产 Target / Action。

未来 Gen-2.1 至少需要：

```text
dataset_adapter.py
walk_forward.py
experiment_runner.py
```

并固定对照：Logistic / ExtraTrees / LightGBM Ranker，全部使用 Purged Walk-Forward。
