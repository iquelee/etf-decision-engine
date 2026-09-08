/**
 * 天天基金 ETF 持仓 HTML 行解析（无网络依赖，便于单测）
 */
'use strict';

function parseHoldingRow(tr) {
  const rankM = String(tr || '').match(/<td[^>]*>(\d+)<\/td>/);
  if (!rankM) return null;
  const rank = Number(rankM[1]);
  if (!(rank >= 1 && rank <= 20)) return null;

  let stockCode = null;
  let market = 'cn';
  let secid = '';
  const unify = tr.match(/unify\/r\/([\d.]+)'[^>]*>([^<]+)</);
  const spanCode = tr.match(/data-texch=''>([^<]+)</);
  if (unify) {
    secid = unify[1];
    stockCode = unify[2];
    if (secid.startsWith('116.')) market = 'hk';
    else if (/^10[5-7]\./.test(secid)) market = 'us';
    else market = 'cn';
  } else if (spanCode) {
    stockCode = spanCode[1];
    market = 'kr';
  } else {
    return null;
  }

  let stockName = '';
  const tol = tr.match(/class='tol'[^>]*>[\s\S]*?>([^<]+)</);
  const tocName = tr.match(/line-height:18px'[^>]*>[\s\S]*?<(?:a|span)[^>]*>([^<]+)</);
  if (tol) stockName = tol[1];
  else if (tocName) stockName = tocName[1];
  else {
    const names = [...tr.matchAll(/unify\/r\/[^']+'>([^<]+)</g)].map((x) => x[1]);
    stockName = names[1] || names[0] || stockCode;
  }

  const w = tr.match(/>([\d.]+)%<\/td>/);
  const weight = w ? Number(w[1]) : null;
  if (weight == null || Number.isNaN(weight)) return null;
  return {
    rank,
    stock_code: String(stockCode).replace(/\s/g, ''),
    stock_name: String(stockName).replace(/-B$/, '').trim(),
    weight,
    market,
    secid
  };
}

module.exports = { parseHoldingRow };
