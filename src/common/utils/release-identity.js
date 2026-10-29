'use strict';

// A gateway can be deployed separately from the producer. Never use the gateway's
// package constant to claim the release identity of an older authoritative run.
function buildReleaseIdentity({runtime,manifest,history,decision,apiSource} = {}) {
  const m=manifest || {}, r=runtime || {};
  const h=history && history.run_id === m.run_id ? history : {};
  const strategy=decision && decision.engine_version || r.production_engine || m.strategy_version || null;
  const release=h.engine_version || m.engine_version || null;
  const contextHash=m.input_context_sha256 || h.input_context_sha256 || null;
  const commit=m.source_commit || h.source_commit || null;
  return {
    strategy_version:strategy,
    release_version:release,
    release_version_source:h.engine_version ? 'run_history.engine_version' : (m.engine_version ? 'run_manifest.engine_version' : 'NOT_PROVIDED'),
    source_commit:typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) ? commit : null,
    input_context_sha256:typeof contextHash === 'string' && /^[a-f0-9]{64}$/.test(contextHash) ? contextHash : null,
    input_context_hash_basis:'RUN_CONTEXT_METADATA; not a complete market-data content hash',
    legacy_input_identifier:m.input_hash || null,
    legacy_input_hash_kind:typeof m.input_hash === 'string' && m.input_hash.startsWith('engine:') ? 'RUN_IDENTITY' : 'UNSPECIFIED',
    api_release_version:apiSource && apiSource.release_version || null,
    api_source_commit:apiSource && !apiSource.source_dirty && /^[a-f0-9]{40}$/.test(apiSource.source_commit || '') ? apiSource.source_commit : null
  };
}
module.exports={buildReleaseIdentity};
