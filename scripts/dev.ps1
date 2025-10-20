param(
    [switch]$NoFrontend,
    [switch]$NoBackend
)

$ErrorActionPreference = 'Stop'

Write-Host "Iniciando entorno de desarrollo..." -ForegroundColor Cyan

if (-not $NoBackend) {
    Write-Host "Lanzando backend (Flask)" -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/backend/src; if (Test-Path ..\\.venv) { ..\\.venv\\Scripts\\Activate.ps1 }; python app.py"
}

if (-not $NoFrontend) {
    Write-Host "Lanzando frontend (Vite)" -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd apps/frontend; npm run dev"
}
