# Starts Auto Apply on http://127.0.0.1:8787
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm ci
}

if (-not (Test-Path ".next")) {
    Write-Host "Building the app..."
    npm run build
}

if (-not $env:PORT) { $env:PORT = "8787" }
Write-Host "Auto Apply running at http://127.0.0.1:$env:PORT"
npm run start
