#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从回测 JSON 生成可视化报告 HTML（收益曲线/分月/动作分布）"""
import json, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "backtest-out")
json_files = [f for f in os.listdir(OUT_DIR) if f.startswith("full-engine") and f.endswith(".json")]
if not json_files:
    raise SystemExit("无回测结果")
src = os.path.join(OUT_DIR, sorted(json_files)[-1])
d = json.load(open(src, encoding="utf-8"))

# 组装数据
nav = d["navSeries"]
dates = [x["date"] for x in nav]
engine = [x["engine"] for x in nav]
equal = [x["equalWeight"] for x in nav]
monthly_items = sorted(d["monthly"].items())
m_dates = [k for k, _ in monthly_items]
m_engine = [v["engine"] for _, v in monthly_items]
m_equal = [v["equal"] for _, v in monthly_items]

pos = d["finalPositions"]
pos_names = {"513310": "中韩半导体", "515880": "通信ETF", "159582": "半导体设备", "518880": "黄金ETF", "159570": "创新药ETF"}
pos_labels = [pos_names.get(k, k) for k in pos]
pos_vals = [pos.get(k, 0) for k in pos]
pos_colors = ["#dc2626", "#2563eb", "#7c3aed", "#d97706", "#059669"]

per = d["perEtf"]
per_rows = []
for k in pos:
    p = per.get(k, {})
    per_rows.append([pos_names.get(k, k), p.get("buys", 0), p.get("sells", 0)])

html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>全链路回测 · V2.1.1</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
body {{ font-family: -apple-system, "PingFang SC", sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }}
h1 {{ font-size: 20px; margin: 0 0 4px; }}
.sub {{ color: #94a3b8; font-size: 13px; margin-bottom: 20px; }}
.grid {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }}
.kpi {{ background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; }}
.kpi .v {{ font-size: 22px; font-weight: 700; margin-top: 4px; }}
.kpi .l {{ color: #94a3b8; font-size: 12px; }}
.kpi .up {{ color: #f87171; }} .kpi .down {{ color: #34d399; }}
.card {{ background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 16px; }}
.card h3 {{ margin: 0 0 10px; font-size: 14px; color: #cbd5e1; }}
.chart {{ width: 100%; height: 340px; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
th, td {{ padding: 8px 10px; text-align: left; border-bottom: 1px solid #334155; }}
th {{ color: #94a3b8; font-weight: 500; }}
</style></head><body>
<h1>ETF 全链路仓位回测 · V2.1.1 真实链路</h1>
<div class="sub">{d['window']['start']} → {d['window']['end']} · {d['window']['days']} 交易日 · 五维评分→机会分→目标仓位→P0~P7→核心/交易仓拆分</div>

<div class="grid">
  <div class="kpi"><div class="l">引擎累计收益</div><div class="v up">{d['engine']['totalRet']}%</div></div>
  <div class="kpi"><div class="l">最大回撤</div><div class="v down">-{d['engine']['maxDD']}%</div></div>
  <div class="kpi"><div class="l">Sharpe（年化）</div><div class="v">{d['engine']['sharpe']}</div></div>
  <div class="kpi"><div class="l">期末总仓</div><div class="v">{round(100-d['cashRatio'],1)}%</div><div class="l">现金 {d['cashRatio']}%</div></div>
  <div class="kpi"><div class="l">等权累计</div><div class="v">{d['equalWeight']['totalRet']}%</div></div>
</div>

<div class="card"><h3>累计收益曲线（引擎 vs 五只等权买入持有）</h3><div id="nav" class="chart"></div></div>
<div class="card"><h3>分月收益</h3><div id="monthly" class="chart"></div></div>
<div class="grid" style="grid-template-columns: 1fr 1fr;">
  <div class="card"><h3>期末仓位分布</h3><div id="pie" class="chart" style="height:300px"></div></div>
  <div class="card"><h3>单票建仓/减仓次数</h3>
    <table><tr><th>标的</th><th>建/加</th><th>减仓</th></tr>
    {"".join(f"<tr><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>" for r in per_rows)}
    </table>
    <div style="margin-top:10px;color:#94a3b8;font-size:12px">动作分布：{json.dumps(d['actions'], ensure_ascii=False)} · 实际调仓 {d['trades']} 笔</div>
  </div>
</div>

<script>
const nav = echarts.init(document.getElementById('nav'));
nav.setOption({{
  tooltip: {{ trigger: 'axis' }},
  legend: {{ data: ['决策引擎', '等权持有'], textStyle: {{ color: '#94a3b8' }} }},
  grid: {{ left: 50, right: 20, top: 40, bottom: 30 }},
  xAxis: {{ type: 'category', data: {json.dumps(dates)}, axisLabel: {{ color: '#94a3b8' }} }},
  yAxis: {{ type: 'value', scale: true, axisLabel: {{ color: '#94a3b8' }} }},
  series: [
    {{ name: '决策引擎', type: 'line', data: {json.dumps(engine)}, smooth: true, symbol: 'none', lineStyle: {{ width: 2, color: '#f87171' }} }},
    {{ name: '等权持有', type: 'line', data: {json.dumps(equal)}, smooth: true, symbol: 'none', lineStyle: {{ width: 1.5, color: '#60a5fa', type: 'dashed' }} }}
  ]
}});

const mon = echarts.init(document.getElementById('monthly'));
mon.setOption({{
  tooltip: {{ trigger: 'axis' }},
  legend: {{ data: ['引擎', '等权'], textStyle: {{ color: '#94a3b8' }} }},
  grid: {{ left: 50, right: 20, top: 40, bottom: 30 }},
  xAxis: {{ type: 'category', data: {json.dumps(m_dates)}, axisLabel: {{ color: '#94a3b8' }} }},
  yAxis: {{ type: 'value', axisLabel: {{ color: '#94a3b8' }} }},
  series: [
    {{ name: '引擎', type: 'bar', data: {json.dumps(m_engine)}, itemStyle: {{ color: '#f87171' }} }},
    {{ name: '等权', type: 'bar', data: {json.dumps(m_equal)}, itemStyle: {{ color: '#60a5fa' }} }}
  ]
}});

const pie = echarts.init(document.getElementById('pie'));
pie.setOption({{
  tooltip: {{ trigger: 'item' }},
  series: [{{
    type: 'pie', radius: ['40%', '70%'],
    data: {json.dumps([{"name": pos_names.get(k,k), "value": v} for k,v in pos.items()] + [{"name": "现金", "value": d["cashRatio"]}])},
    label: {{ color: '#e2e8f0' }},
    itemStyle: {{ borderColor: '#1e293b', borderWidth: 2 }}
  }}]
}});
</script>
</body></html>"""

out_html = os.path.join(OUT_DIR, f"report-{datetime.date.today().isoformat()}.html")
with open(out_html, "w", encoding="utf-8") as f:
    f.write(html)
print("报告已生成:", out_html)
