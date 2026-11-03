#!/usr/bin/env node
'use strict';

/**
 * V3.6.5 · C-021 —— DEPLOYMENT CANDIDATE MANIFEST（§4 · 只读 · 纯本地）
 *
 * 目的（owner §4）：
 *   当前 `HEAD = c6bd006f…` **不能单独代表待部署的 V3.6.5 源码**
 *   —— V3.6.5 有大量 working-tree / untracked change。
 *   因此建立 `V365_DEPLOYMENT_CANDIDATE_MANIFEST`，把「待部署的字节」完整绑定。
 *
 * 不变量（铁律）：
 *     same deployment_candidate_manifest_sha ⇒ same production source bytes
 *
 * 说明：
 *   · 本 manifest 绑定的是 **source-side** 字节（cloudfunctions/<fn> + src/common + extra），
 *     即 `V365_DEPLOYMENT_REQUIRED_FILES` 的逐文件 SHA256。
 *   · ⛔ 不从 mutable working tree 直接部署 —— manifest 的作用正是把工作区**钉住**；
 *     真正 deploy 时必须先按 §5 的 freeze 机制固化（tag/commit 或 canonical bundle）。
 *   · ⛔ 本脚本只读：不写 git 对象、不 commit、不 tag、不 build。
 *
 * 产出：`deliverables/v365-production-history/c021/deployment-candidate-manifest.json`
 *
 * 用法：
 *   node scripts/v365-deployment-candidate-manifest.js [--out <path>]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const FN = 'runDecisionEngine';
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1]
    : path.join(REPO, 'deliverables', 'v365-production-history', 'c021', 'deployment-candidate-manifest.json');
})();
const SCOPE_JSON = path.join(REPO, 'deliverables', 'v365-production-history', 'c021', 'deployment-scope.json');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha256File = (p) => sha256(fs.readFileSync(p));

/* ---------- 前置：必须有 §3 的 scope 结果 ---------- */
if (!fs.existsSync(SCOPE_JSON)) {
  console.error('[FATAL] 缺少 deployment-scope.json —— 请先运行 scripts/v365-deployment-scope.js');
  process.exit(2);
}
const scope = JSON.parse(fs.readFileSync(SCOPE_JSON, 'utf8'));

/* ---------- 工具版本 ---------- */
function toolVersion(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000 });
    return ((r.stdout || '') + (r.stderr || '')).trim().split('\n')[0] || null;
  } catch (e) { return null; }
}
const nodeVer = process.version;
const tcbVer = toolVersion(process.execPath, [
  path.join(process.env.HOME || '', '.npm-global', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  '--version'
]);

/* ---------- base HEAD ---------- */
const baseHead = execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim();

/* ---------- 逐文件 SHA256（部署必需集） ---------- */
const requiredWithSha = scope.V365_DEPLOYMENT_REQUIRED_FILES.map((p) => ({
  path: p,
  sha256: sha256File(path.join(REPO, p)),
  bytes: fs.statSync(path.join(REPO, p)).size
}));

/* ---------- 三类子 SHA ---------- */
const groupSha = (prefix) => sha256(
  requiredWithSha.filter((x) => x.path.startsWith(prefix))
    .map((x) => `${x.path}:${x.sha256}`).join('\n'));

const productionCodeSha = groupSha('cloudfunctions/' + FN + '/');
const commonClosureSha = groupSha('src/common/');
const extraArtifactsSha = sha256(
  requiredWithSha.filter((x) => x.path.startsWith('ml/manifests/'))
    .map((x) => `${x.path}:${x.sha256}`).join('\n'));

/* ---------- candidate_content_sha（全候选面，用于区分于 HEAD） ---------- */
const candidateContentSha = sha256(
  requiredWithSha.map((x) => `${x.path}:${x.sha256}`).join('\n'));

/* ---------- manifest sha（最终绑定） ---------- */
const manifestCore = {
  schema: 'v365-deployment-candidate-manifest/v1',
  function: FN,
  base_head_sha: baseHead,
  candidate_content_sha: candidateContentSha,
  dependency_closure_sha: scope.dependency_closure_sha,
  production_code_sha: productionCodeSha,
  common_closure_sha: commonClosureSha,
  extra_artifacts_sha: extraArtifactsSha,
  expected_runtime: scope.deployment_model.runtime,
  expected_handler: scope.deployment_model.handler,
  build_method: scope.deployment_model.build_tool,
  build_tool_versions: { node: nodeVer, tcb_cli: tcbVer },
  deployment_required_files_count: requiredWithSha.length
};
const candidateManifestSha = sha256(JSON.stringify(manifestCore));

const manifest = {
  artifact: 'v365-deployment-candidate-manifest',
  generated_at: new Date().toISOString(),
  phase: 'C-021',
  read_only: true,
  deployed: false,
  note: '⛔ source-side 绑定；真正 deploy 前必须按 §5 freeze 机制固化（tag/commit 或 canonical bundle）',

  base_head_sha: baseHead,
  candidate_content_sha: candidateContentSha,

  deployment_required_files: requiredWithSha,
  deployment_required_files_count: requiredWithSha.length,

  dependency_closure_sha: scope.dependency_closure_sha,
  production_code_sha: productionCodeSha,
  common_closure_sha: commonClosureSha,
  extra_artifacts_sha: extraArtifactsSha,

  expected_runtime: scope.deployment_model.runtime,
  expected_handler: scope.deployment_model.handler,
  build_method: scope.deployment_model.build_tool,
  build_tool_versions: { node: nodeVer, tcb_cli: tcbVer },

  candidate_manifest_sha: candidateManifestSha,

  invariant: 'same deployment_candidate_manifest_sha ⇒ same production source bytes',
  mutable_working_tree_deploy_forbidden: true,

  excluded_files_count: scope.V365_DEPLOYMENT_EXCLUDED_FILES.length,
  excluded_summary: (() => {
    const m = {};
    scope.V365_DEPLOYMENT_EXCLUDED_FILES.forEach((e) => { m[e.category] = (m[e.category] || 0) + 1; });
    return m;
  })()
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

console.log('== C-021 Deployment Candidate Manifest（只读）==\n');
console.log('function                 =', FN);
console.log('base_head_sha            =', baseHead);
console.log('candidate_content_sha    =', candidateContentSha);
console.log('dependency_closure_sha   =', scope.dependency_closure_sha);
console.log('production_code_sha      =', productionCodeSha);
console.log('common_closure_sha       =', commonClosureSha);
console.log('extra_artifacts_sha      =', extraArtifactsSha);
console.log('required files           =', requiredWithSha.length);
console.log('expected runtime/handler =', manifest.expected_runtime, '/', manifest.expected_handler);
console.log('build tool               =', manifest.build_method);
console.log('  node =', nodeVer, ' · tcb =', tcbVer);
console.log('excluded (not in package)=', manifest.excluded_files_count, JSON.stringify(manifest.excluded_summary));
console.log('');
console.log('★ candidate_manifest_sha =', candidateManifestSha);
console.log('  invariant: same sha ⇒ same production source bytes');
console.log('');
console.log('written =>', path.relative(REPO, OUT));
