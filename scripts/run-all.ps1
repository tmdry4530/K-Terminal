# Bring up auto-dom bridge (ingest_only by default — no orders) + K Terminal Finance on Windows.
# The Crypto Signal agent runs separately (it posts to the bridge). Live trading stays gated
# by auto-dom's own env double-lock; this script never enables it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\run-all.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\run-all.ps1 -AutoDomDir "D:\Develop\auto-dom"

param(
  [string]$AutoDomDir = "..\auto-dom",
  [string]$Python = "python",
  [int]$BridgePort = 8765
)
$ErrorActionPreference = "Stop"
$terminalDir = Split-Path -Parent $PSScriptRoot

Write-Host "[1/2] auto-dom bridge ($AutoDomDir) — mode comes from its .env (default ingest_only, no orders)"
if (Test-Path (Join-Path $AutoDomDir "src\auto_dom")) {
  $bridge = Start-Process -FilePath $Python `
    -ArgumentList "-m","auto_dom.bridge.http","--host","127.0.0.1","--port","$BridgePort" `
    -WorkingDirectory (Resolve-Path $AutoDomDir) `
    -Environment @{ PYTHONPATH = "src" } -PassThru
  Start-Sleep -Seconds 2
  try { (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$BridgePort/health").Content | Write-Host }
  catch { Write-Warning "bridge /health not ready yet (Python 3.13+ required)" }
} else {
  Write-Warning "auto-dom not found at $AutoDomDir. Clone it: git clone https://github.com/tmdry4530/auto-dom"
  Write-Warning "Terminal will still run; SIGNALS/GATE show 'offline' until the bridge is up."
}

Write-Host "[2/2] K Terminal Finance -> http://localhost:8080  (Ctrl+C to stop)"
Set-Location $terminalDir
npm start
