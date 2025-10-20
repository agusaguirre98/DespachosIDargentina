$ErrorActionPreference = 'Stop'

Write-Host "Ejecutando lint backend..." -ForegroundColor Cyan
if (Test-Path apps/backend/.venv/Scripts/Activate.ps1) {
    & apps/backend/.venv/Scripts/Activate.ps1
}
python -m black apps/backend/src
python -m isort apps/backend/src
python -m ruff check apps/backend/src

Write-Host "Ejecutando lint frontend..." -ForegroundColor Cyan
Push-Location apps/frontend
npm run lint
Pop-Location
