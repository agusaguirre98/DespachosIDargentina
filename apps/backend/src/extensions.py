"""Application extensions and external resources."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus

from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# ---------- Carga de .env ----------
# Este archivo vive en apps/backend/src/extensions.py
# .env está en apps/backend/.env  --> subimos 1 nivel desde src
BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")  # carga variables del .env

# Flask-SQLAlchemy (si lo usás en otros módulos)
db = SQLAlchemy()

# Engine cacheado (singleton simple)
engine_asignador: Optional[Engine] = None


def _build_asignador_uri_from_env() -> str:
    """
    Construye el URI de conexión desde variables del .env.
    Opción A: usar ASIGNADOR_DB_URI directo (completo).
    Opción B: armarlo con partes SQLSERVER_* (Server, DB, User, Pass, Driver).
    """
    # Opción A: URI completo ya armado
    direct_uri = os.getenv("ASIGNADOR_DB_URI")
    if direct_uri:
        return direct_uri

    # Opción B: armar con partes
    server = os.getenv("SQLSERVER_SERVER")
    database = os.getenv("SQLSERVER_DATABASE")
    user = os.getenv("SQLSERVER_USER")
    password = os.getenv("SQLSERVER_PASSWORD")
    driver = os.getenv("SQLSERVER_DRIVER", "ODBC Driver 17 for SQL Server")

    if not all([server, database, user, password]):
        raise RuntimeError(
            "Faltan variables en .env para armar la cadena de conexión. "
            "Definí ASIGNADOR_DB_URI o bien "
            "SQLSERVER_SERVER/SQLSERVER_DATABASE/SQLSERVER_USER/SQLSERVER_PASSWORD."
        )

    # Cadena ODBC y URI pyodbc
    odbc_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={user};PWD={password};"
        "TrustServerCertificate=yes;"
    )
    return f"mssql+pyodbc:///?odbc_connect={quote_plus(odbc_str)}"


def init_engine_asignador(uri: Optional[str] = None) -> Engine:
    """
    Crea (o reutiliza) el Engine de ASIGNADOR.
    Si no recibís uri, lo construye desde .env.
    """
    global engine_asignador
    if engine_asignador is None:
        final_uri = uri or _build_asignador_uri_from_env()
        if not final_uri:
            raise RuntimeError(
                "ASIGNADOR_DB_URI no está configurada (None o vacía). "
                "Revisa tu .env y get_settings()."
            )
        engine_asignador = create_engine(
            final_uri,
            pool_pre_ping=True,
            pool_recycle=1800,
            # fast_executemany=True,  # descomenta si haces inserts masivos
        )
    return engine_asignador


# Opcional: test rápido de conectividad (podés llamarlo en /oc/ping)
def test_asignador_connection() -> bool:
    try:
        eng = init_engine_asignador()  # ahora puede llamarse sin uri
        with eng.connect() as conn:
            return conn.execute(text("SELECT 1")).scalar() == 1
    except Exception:
        return False
