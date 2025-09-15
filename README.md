Despachos — Guía de ejecución (backend + frontend)

Este repo contiene una app Flask (Python) para el backend y React (Vite) para el frontend.

APP_DESPACHOS/
├─ backend/          # Flask + SQLAlchemy + MS Graph/SharePoint
├─ frontend/         # React (Vite), Tailwind, Headless UI
├─ .env              # credenciales locales (NO se versiona)
├─ .gitignore
└─ requirements.txt  # dependencias Python del backend

1) Requisitos

Python 3.10+

Node.js 18+ (y npm)

ODBC Driver 17 para SQL Server

Windows: Microsoft ODBC Driver 17 for SQL Server

Azure App Registration (para leer/escribir en SharePoint vía Microsoft Graph):

AZ_TENANT_ID, AZ_CLIENT_ID, AZ_CLIENT_SECRET

SP_SITE_URL (ej: https://<tu-tenant>.sharepoint.com/sites/<tu-sitio>)

En Windows te conviene usar PowerShell.

2) Variables de entorno (.env)

Crea un archivo .env en la raíz del repo con tus valores:

# Conexión a SQL Server (ajusta usuario/host/db/driver)
SQLALCHEMY_DATABASE_URI=mssql+pyodbc://usuario:password@SERVIDOR/BASE?driver=ODBC+Driver+17+for+SQL+Server

# Azure / Microsoft Graph
AZ_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZ_CLIENT_ID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
AZ_CLIENT_SECRET=******************************
SP_SITE_URL=https://tuorg.sharepoint.com/sites/NombreDelSitio

# Opcional
FLASK_ENV=development


El backend lee estas variables con os.getenv(...). No subas .env a GitHub (ya está ignorado en .gitignore).

3) Backend (Flask)
3.1 Crear y activar un virtualenv (recomendado fuera del repo)
# pararse en la carpeta del proyecto
cd C:\APP_Despachos

# crear venv fuera del repo (ejemplo: en C:\)
python -m venv C:\venvs\despachos
# activar
C:\venvs\despachos\Scripts\Activate.ps1


Si preferís, podés crear .venv dentro del proyecto (está ignorado por Git).

3.2 Instalar dependencias
pip install -r requirements.txt


Si pyodbc da error en Windows, instala “Microsoft C++ Build Tools” y confirmá que el ODBC Driver 17 esté instalado.

3.3 Ejecutar el backend
cd .\backend
# Opción A: ejecutar directamente (app.py ya hace app.run(...))
python app.py

# Opción B (si tuvieras FLASK_APP):
# set FLASK_APP=app.py
# flask run


Por defecto quedará en http://localhost:5000

CORS ya está habilitado para desarrollo.

4) Frontend (React + Vite)
4.1 Instalar dependencias
cd .\frontend
npm install

4.2 Proxy de desarrollo (Vite)

El frontend hace fetch('/api/...'). Para no hardcodear URLs, usa el proxy de Vite al backend.

Asegurate de que en frontend/vite.config.* exista algo así:

// vite.config.ts / vite.config.js
export default {
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000', // backend Flask
    },
  },
}


Si ya lo tenés, no hay que tocar nada.

4.3 Ejecutar el frontend
npm run dev


Abrí http://localhost:5173

5) Flujo de desarrollo

Abrir dos terminales:

Terminal A → activar venv y correr backend (python backend/app.py)

Terminal B → cd frontend && npm run dev

Trabajás en el código → el frontend recarga automáticamente, el backend reinicia por debug=True.

6) Build de producción (frontend)
cd frontend
npm run build
# archivos estáticos en frontend/dist


Podés servir dist/ detrás de un Nginx/Apache y apuntar el proxy de /api a tu Flask productivo (gunicorn, waitress, etc.).

7) Problemas comunes

“ODBC Driver 17 not found” → instalar driver 17 y reiniciar terminal.

Error de pyodbc al compilar → instalar C++ Build Tools de Microsoft.

Torch/EasyOCR muy pesado → el requirements.txt instala versión CPU. Si tu equipo no lo necesita, podés comentar EasyOCR/torch. El OCR seguirá intentando usar extracción por texto para facturas.

CORS en dev: ya está activo en Flask con CORS(app). En prod conviene restringir orígenes.

SharePoint/Graph: si get_site_and_drive() falla, revisá:

permisos del App Registration (Graph Files.ReadWrite.All, Sites.Read.All), Application (app-only)

has hecho Grant admin consent en Azure AD

SP_SITE_URL correcto.

8) Cheatsheet de comandos
# Backend
python -m venv C:\venvs\despachos
C:\venvs\despachos\Scripts\Activate.ps1
pip install -r requirements.txt
python backend/app.py

# Frontend
cd frontend
npm install
npm run dev
npm run build

9) GitHub (push)
# desde la raíz del proyecto
git add .
git commit -m "chore: initial setup backend+frontend"
git remote set-url origin https://github.com/AgustinNTissera/DespachosIDargentina
git push -u origin main


Asegurate de que .env, venv/ y node_modules/ no se suban (están en .gitignore).
