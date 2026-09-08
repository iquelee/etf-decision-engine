"use strict";

// Read-only implementation of the frozen HVT-A-ET ExtraTrees + isotonic CV3
// artifact exported by scripts/ml/export-gen1-node-model.py.
const model = require('./frozen-model.json');

function finite(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function encodeRow(row, fold) {
  const numeric = model.features_core.map((name, index) => finite(row[name], fold.numeric_medians[index]));
  const categorical = model.features_cat.map((name, index) => {
    const value = row[name] == null || row[name] === '' ? fold.categorical_modes[index] : String(row[name]);
    const encoded = fold.categories[index].indexOf(value);
    return encoded >= 0 ? encoded : -1;
  });
  return numeric.concat(categorical);
}

function treeProbability(nodes, values) {
  let node = 0;
  // Node ids are always within the serialized tree. The guard protects the
  // scheduled job from a corrupted deployment artifact.
  for (let depth = 0; depth < 128; depth += 1) {
    const current = nodes[node];
    if (!current) throw new Error('Invalid frozen Gen-1 tree node');
    if (current.left < 0) return current.p1;
    node = values[current.feature] <= current.threshold ? current.left : current.right;
  }
  throw new Error('Frozen Gen-1 tree depth exceeded guard');
}

function isotonic(raw, calibration) {
  const { x, y } = calibration;
  if (raw <= x[0]) return y[0];
  const last = x.length - 1;
  if (raw >= x[last]) return y[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (x[mid] <= raw) low = mid;
    else high = mid;
  }
  const fraction = (raw - x[low]) / (x[high] - x[low]);
  return y[low] + (y[high] - y[low]) * fraction;
}

function predictProbability(row) {
  const foldProbabilities = model.folds.map((fold) => {
    const values = encodeRow(row, fold);
    const raw = fold.trees.reduce((sum, tree) => sum + treeProbability(tree, values), 0) / fold.trees.length;
    return isotonic(raw, fold.isotonic);
  });
  return foldProbabilities.reduce((sum, probability) => sum + probability, 0) / foldProbabilities.length;
}

module.exports = { modelId: model.model_id, predictProbability };
