[CmdletBinding()]
param(
  [string]$AsOf = ''
)

# Frozen Gen-1 EOD observer.  It only writes local shadow ledgers and the
# CloudBase ml_shadow_signal collection; it never calls the V3 decision writer
# and cannot enable execution.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = Join-Path $root '.venv-gen1\Scripts\python.exe'
$node = 'C:\Users\iquel\.local\node-v22\node.exe'
$modelId = 'HVT-A-ET-20260830'
$logDir = Join-Path $root "ml\shadow\$modelId\logs"

if (-not (Test-Path -LiteralPath $python)) { throw "Gen-1 venv missing: $python" }
if (-not (Test-Path -LiteralPath $node)) { throw "Node runtime missing: $node" }
if (-not $AsOf) { $AsOf = (Get-Date).ToString('yyyy-MM-dd') }

# The credentials remain outside the repository.  An existing TCB_AUTH_PATH
# wins, which makes the task portable to a different local account.
if (-not $env:TCB_AUTH_PATH) {
  $candidate = 'C:\Users\iquel\Nutstore\1\我的坚果云\Agent\Workbuddy\投资决策引擎\.tcb-home\.config\.cloudbase\auth.json'
  if (-not (Test-Path -LiteralPath $candidate)) { throw 'TCB_AUTH_PATH is not set and no local CloudBase auth file was found.' }
  $env:TCB_AUTH_PATH = $candidate
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("shadow-eod-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
Start-Transcript -Path $logFile -Append | Out-Null

try {
  Push-Location $root
  Write-Host "[1/6] Export CloudBase official EOD bars"
  & $node 'scripts/ml/export-etf-daily-cloudbase.js'
  if ($LASTEXITCODE -ne 0) { throw "EOD bar export failed ($LASTEXITCODE)" }

  Write-Host "[2/6] Build Main5 stage panel"
  & $node 'scripts/ml/export-daily-stage-panel.js' '--inference' '--from=2024-01-01' ("--to={0}" -f $AsOf) '--codes=513310,515880,159582,518880,159570,510300'
  if ($LASTEXITCODE -ne 0) { throw "Stage-panel export failed ($LASTEXITCODE)" }

  Write-Host "[3/6] Build frozen Gen-1 inference features"
  $featureOutput = & $python 'scripts/ml/build-shadow-live-events.py'
  $featureOutput | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "Feature build failed ($LASTEXITCODE)" }
  $match = [regex]::Match(($featureOutput -join "`n"), 'source_trade_date=(\d{4}-\d{2}-\d{2})')
  if (-not $match.Success) { throw 'Could not determine source_trade_date from feature build output.' }
  $signalDate = $match.Groups[1].Value

  Write-Host "[4/6] Verify frozen Gen-1 artifact"
  & $python 'scripts/ml/assert-gen1-immutable.py'
  if ($LASTEXITCODE -ne 0) { throw "Frozen artifact check failed ($LASTEXITCODE)" }

  Write-Host "[5/6] Run frozen model for $signalDate"
  & $python 'scripts/ml/shadow-daily-log.py' ("--date={0}" -f $signalDate)
  if ($LASTEXITCODE -ne 0) { throw "Shadow inference failed ($LASTEXITCODE)" }

  Write-Host "[6/6] Upload observe-only signal rows"
  & $node 'scripts/ml/push-shadow-signals.js' $signalDate
  if ($LASTEXITCODE -ne 0) { throw "Signal upload failed ($LASTEXITCODE)" }
  Write-Host "SUCCESS source_trade_date=$signalDate; execution remains disabled."
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  Stop-Transcript | Out-Null
}

