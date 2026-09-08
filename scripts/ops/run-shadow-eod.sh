#!/usr/bin/env bash
# Production EOD Shadow observer (Fast Path OFF). Does not change V3.6.1 positions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DATE="${1:-}"
echo "=== Gen-1 immutability check ==="
python3 scripts/ml/assert-gen1-immutable.py

echo "=== Shadow daily log ==="
if [[ -n "$DATE" ]]; then
  python3 scripts/ml/shadow-daily-log.py --date="$DATE"
else
  python3 scripts/ml/shadow-daily-log.py
fi

echo "=== Reconcile outcomes (post-hoc only) ==="
python3 scripts/ml/shadow-reconcile-outcomes.py || true

echo "=== Signal half-life (observe) ==="
python3 scripts/ml/shadow-signal-halflife.py || true

echo "=== Summary ==="
python3 scripts/ml/shadow-summary.py

echo "=== Push Shadow signals to CloudBase (UI) ==="
node scripts/ml/push-shadow-signals.js ${DATE:-} || true

echo "Done. Fast Path remains NOT CONNECTED. Production remains V3.6.1 only."
