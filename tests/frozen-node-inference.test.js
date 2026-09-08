'use strict';

const assert = require('assert');
const { predictProbability } = require('../cloudfunctions/runGen1ShadowEod/frozen-node-inference');

// This row is the 2026-09-01 frozen feature row for 513310.  Its expected
// value is produced by the original sklearn CalibratedClassifierCV artifact.
const fixture = {
  ma20_slope: 1.54, px_ma20: -0.0205491421581224, px_ma60: -0.1121133900532106,
  price_position: 0.2267657992565056, volume_ratio: 0.803854529160724,
  sideway_days: 19, sideway_range: 13.39, consolidation_score: 42,
  atr20: 0.17225, change_5d: 0.9535918626827702, bias_20d: -2.0549142158122464,
  breakout: 0, ret_5d: 0.0095359186268277, ret_20d: 0.0329575021682567,
  rs_20d: null, w_state: 'W3', d_state: 'D5', h_state: 'H4', v_state: 'V2', sector: 'storage'
};

const probability = predictProbability(fixture);
assert.ok(Math.abs(probability - 0.010837022981235504) < 1e-12, `unexpected probability ${probability}`);
console.log(`frozen node inference parity passed: ${probability}`);
