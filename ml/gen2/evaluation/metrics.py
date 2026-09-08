from __future__ import annotations

import numpy as np
import pandas as pd


def cumulative_return(returns: pd.Series) -> float:
    return float((1.0 + returns.fillna(0.0)).prod() - 1.0)


def annualized_return(returns: pd.Series, periods_per_year: int = 252) -> float:
    r = returns.dropna()
    if r.empty:
        return np.nan
    total = cumulative_return(r)
    return float((1.0 + total) ** (periods_per_year / len(r)) - 1.0)


def sharpe(returns: pd.Series, periods_per_year: int = 252) -> float:
    r = returns.dropna()
    if r.empty or r.std() == 0:
        return np.nan
    return float(r.mean() / r.std() * np.sqrt(periods_per_year))


def max_drawdown(nav: pd.Series) -> float:
    if nav.empty:
        return np.nan
    return float((nav / nav.cummax() - 1.0).min())


def calmar(returns: pd.Series, periods_per_year: int = 252) -> float:
    ann = annualized_return(returns, periods_per_year)
    nav = (1 + returns.fillna(0)).cumprod()
    mdd = abs(max_drawdown(nav))
    return float(ann / mdd) if mdd > 0 else np.nan
