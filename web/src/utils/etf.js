import { ETF_NAMES } from './constants.js';

/** 名称为主；没有名单时回退代码 */
export function etfName(code, list) {
  if (!code || code === 'ALL') return '全部 ETF';
  const hit = (list || []).find((e) => e.code === code);
  if (hit && hit.name) return hit.name;
  return ETF_NAMES[code] || code;
}

/** 下拉/确认框：名称（代码） */
export function etfLabel(code, list) {
  if (!code || code === 'ALL') return '全部 ETF';
  const name = etfName(code, list);
  return name === code ? code : `${name}（${code}）`;
}
