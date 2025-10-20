# Despachos

Proyecto monorepo para la plataforma de despachos. Contiene una API en Flask y una aplicación web en React, además de documentación, scripts operativos y recursos de datos.

## Estructura del proyecto

```
despachos/
├─ apps/
│  ├─ backend/
│  │  ├─ src/
│  │  │  ├─ app.py
│  │  │  ├─ api/
│  │  │  ├─ services/
│  │  │  ├─ repositories/
│  │  │  ├─ models/
│  │  │  ├─ schemas/
│  │  │  ├─ jobs/
│  │  │  └─ utils/
│  │  ├─ tests/
│  │  ├─ migrations/
│  │  ├─ requirements.txt
│  │  ├─ .env.example
│  │  └─ pyproject.toml
│  └─ frontend/
│     ├─ src/
│     │  ├─ components/
│     │  ├─ pages/
│     │  ├─ hooks/
│     │  ├─ lib/
│     │  ├─ store/
│     │  ├─ styles/
│     │  └─ types/
│     ├─ public/
│     ├─ tests/
│     ├─ package.json
│     ├─ .env.example
│     └─ vite.config.js
├─ data/
│  ├─ samples/
│  └─ dictionaries/
├─ docs/
│  ├─ index.md
│  ├─ arquitectura.md
│  ├─ api/
│  ├─ data-model.md
│  └─ powerbi/
├─ scripts/
│  ├─ dev.ps1
│  ├─ lint.ps1
│  ├─ seed_db.ps1
│  └─ export_openapi.py
├─ .github/
│  ├─ workflows/
│  │  ├─ backend-ci.yml
│  │  └─ frontend-ci.yml
│  ├─ ISSUE_TEMPLATE/
│  │  ├─ bug_report.md
│  │  └─ feature_request.md
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ CODEOWNERS
├─ .vscode/
│  ├─ settings.json
│  └─ extensions.json
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ LICENSE
└─ README.md
```

## Backend (Flask)

1. Crear entorno virtual e instalar dependencias:
   ```bash
   cd apps/backend
   python -m venv .venv
   source .venv/bin/activate  # En Windows: .venv\\Scripts\\Activate.ps1
   pip install -r requirements.txt
   ```
2. Duplicar `.env.example` como `.env` y completar las credenciales de base de datos, Azure y SharePoint.
3. Ejecutar la API:
   ```bash
   cd src
   python app.py
   ```

## Frontend (React + Vite)

1. Instalar dependencias:
   ```bash
   cd apps/frontend
   npm install
   ```
2. Crear `.env` a partir de `.env.example` para definir `VITE_API_BASE_URL`.
3. Levantar el entorno de desarrollo:
   ```bash
   npm run dev
   ```

## Scripts útiles

En la carpeta `scripts/` se incluyen utilidades para desarrolladores:

- `dev.ps1`: orquesta backend y frontend en Windows.
- `lint.ps1`: ejecuta chequeos de estilo (Black/Ruff para Python, ESLint para React).
- `seed_db.ps1`: carga datos iniciales en la base.
- `export_openapi.py`: genera el esquema OpenAPI desde la API Flask.

## Documentación y datos

- `docs/`: documentación viva del proyecto (MkDocs, arquitectura, modelo de datos y definiciones de BI).
- `data/`: insumos y muestras para pruebas funcionales.

## Contribuciones

Consulta `CONTRIBUTING.md` para conocer el flujo de trabajo, convenciones de código y lineamientos de revisión.
