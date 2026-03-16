from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from dotenv import find_dotenv, load_dotenv

from .api.despachos import despachos_bp
from .api.facturas import facturas_bp
from .api.oc import oc_bp
from .api.ocr import ocr_bp
from .api.repositorio import repo_bp
from .api.zf import zf_bp
from .api.servicios import servicios_bp

from .extensions import db, init_engine_asignador
from .services import sharepoint as sp
from .settings import get_settings


# =========================
# CARGAR VARIABLES .ENV
# =========================

_ENV_CANDIDATES = []
detected = find_dotenv(usecwd=True)

if detected:
    _ENV_CANDIDATES.append(Path(detected))

_ENV_CANDIDATES.extend(
    [
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parent / ".env",
    ]
)

for env_path in _ENV_CANDIDATES:
    if env_path and env_path.exists():
        load_dotenv(env_path, override=True)


# =========================
# APP FACTORY
# =========================

def create_app() -> Flask:

    app = Flask(__name__)
    CORS(app)

    settings = get_settings()

    app.config["SQLALCHEMY_DATABASE_URI"] = settings.sql_alchemy_database_uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = settings.max_content_length

    db.init_app(app)
    init_engine_asignador(settings.asignador_db_uri)


    # =========================
    # SHAREPOINT / GRAPH
    # =========================

    authority = (os.getenv("AUTHORITY") or "").strip()
    tenant_id = (os.getenv("TENANT_ID") or os.getenv("AZ_TENANT_ID") or "").strip()

    if not authority and tenant_id:
        authority = f"https://login.microsoftonline.com/{tenant_id}"

    client_id = (os.getenv("CLIENT_ID") or os.getenv("AZ_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("CLIENT_SECRET") or os.getenv("AZ_CLIENT_SECRET") or "").strip()
    site_url = (os.getenv("SITE_URL") or os.getenv("SP_SITE_URL") or "").strip()
    scope = (os.getenv("SCOPE") or "https://graph.microsoft.com/.default").strip()

    sp.configure(
        authority=authority,
        client_id=client_id,
        client_secret=client_secret,
        scope=[scope],
        site_url=site_url,
    )

    missing = []

    if not authority:
        missing.append("AUTHORITY o TENANT_ID/AZ_TENANT_ID")
    if not client_id:
        missing.append("CLIENT_ID o AZ_CLIENT_ID")
    if not client_secret:
        missing.append("CLIENT_SECRET o AZ_CLIENT_SECRET")
    if not site_url:
        missing.append("SITE_URL o SP_SITE_URL")

    if missing:
        raise RuntimeError("[Graph] Faltan variables de entorno: " + ", ".join(missing))

    try:
        site_id, drive_id = sp.init_site_resources(force=True)
        app.logger.info("[Graph] SITE_ID=%s | DRIVE_ID=%s", site_id, drive_id)
    except Exception as exc:
        app.logger.warning("[Graph] init failed: %s", exc)


    # =========================
    # BLUEPRINTS API
    # =========================

    app.register_blueprint(oc_bp)
    app.register_blueprint(ocr_bp)
    app.register_blueprint(despachos_bp)
    app.register_blueprint(facturas_bp)
    app.register_blueprint(zf_bp)
    app.register_blueprint(repo_bp)
    app.register_blueprint(servicios_bp)

    for rule in app.url_map.iter_rules():
        app.logger.info("ROUTE %s -> %s", rule.rule, rule.endpoint)


    # =========================
    # RUTAS DE TEST
    # =========================

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/api/diagnostic/graph")
    def graph_diag():
        try:
            site_id, drive_id = sp.init_site_resources(force=True)
            return {"ok": True, "site_id": site_id, "drive_id": drive_id}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}, 500


    # =========================
    # SERVIR FRONTEND REACT (SPA FALLBACK)
    # =========================

    frontend_folder = Path(__file__).resolve().parents[1] / "static" / "frontend"

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react_app(path):

        # 🔥 No interceptar rutas de API
        if path.startswith("api") or path.startswith("oc") or path.startswith("repositorio"):
            return jsonify({"error": "Not found"}), 404

        file_path = frontend_folder / path

        # Si es un archivo real (js, css, img, etc.)
        if path != "" and file_path.exists():
            return send_from_directory(frontend_folder, path)

        # 🔥 Fallback a React Router
        return send_from_directory(frontend_folder, "index.html")


    return app