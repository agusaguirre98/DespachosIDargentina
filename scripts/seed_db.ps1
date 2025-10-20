param(
    [string]$SeedFile = "data/samples/seed.sql"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SeedFile)) {
    throw "No se encontró el archivo de semillas: $SeedFile"
}

Write-Host "Cargando semillas desde $SeedFile" -ForegroundColor Cyan
$envPath = Join-Path (Get-Location) "apps/backend/.env"
if (Test-Path $envPath) {
    Write-Host "Cargando variables desde .env" -ForegroundColor Yellow
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^(?<key>[^#=]+)=(?<value>.+)$') {
            $parts = $_ -split '=', 2
            $env:$($parts[0].Trim()) = $parts[1]
        }
    }
}

python apps/backend/src/app.py seed $SeedFile
