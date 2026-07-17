# Starts the Auto Apply server (backend + built frontend) on http://127.0.0.1:8000
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$here\backend"

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python venv and installing dependencies..."
    py -3 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}

if (-not (Test-Path "$here\frontend\dist")) {
    Write-Host "Building frontend..."
    Push-Location "$here\frontend"
    npm install
    npm run build
    Pop-Location
}

if (-not $env:AUTO_APPLY_PORT) { $env:AUTO_APPLY_PORT = "8787" }
Write-Host "Auto Apply running at http://127.0.0.1:$env:AUTO_APPLY_PORT"
.\.venv\Scripts\python.exe run.py
