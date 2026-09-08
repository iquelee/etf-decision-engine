from __future__ import annotations

import numpy as np
import pandas as pd


def block_bootstrap_mean(values: pd.Series, n_boot: int = 1000, block: int = 20, seed: int = 42) -> dict:
    """Simple block bootstrap for time-series mean estimates."""
    x = values.dropna().to_numpy()
    if len(x) == 0:
        return {"mean": np.nan, "ci_low": np.nan, "ci_high": np.nan, "n": 0}
    rng = np.random.default_rng(seed)
    stats = []
    for _ in range(n_boot):
        sample = []
        while len(sample) < len(x):
            start = int(rng.integers(0, max(1, len(x) - block + 1)))
            sample.extend(x[start:start + block])
        stats.append(float(np.mean(sample[:len(x)])))
    return {
        "mean": float(np.mean(x)),
        "ci_low": float(np.percentile(stats, 2.5)),
        "ci_high": float(np.percentile(stats, 97.5)),
        "n": int(len(x)),
    }
