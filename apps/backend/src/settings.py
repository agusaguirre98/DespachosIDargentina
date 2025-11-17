"""Environment-driven application settings (carga de variables del .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Tuple
from pathlib import Path
from dotenv import load_dotenv


# === Carga del archivo .env ===
# Este archivo vive en apps/backend/src/settings.py → subimos un nivel hasta apps/backend/.env
BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"

if not load_dotenv(ENV_PATH):
    print(f"⚠️  Advertencia: no se encontró .env en {ENV_PATH}")


# === Helpers ===
def _require_env(name: str) -> str:
    """Obtiene una variable obligatoria del entorno o lanza error si falta."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"❌ Falta la variable de entorno: {name} (ver .env)")
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


# === Configuración principal ===
@dataclass(frozen=True)
class Settings:
    # --- Bases de datos ---
    sql_alchemy_database_uri: str
    asignador_db_uri: str

    # --- Azure / SharePoint ---
    az_tenant_id: str
    az_client_id: str
    az_client_secret: str
    sp_site_url: str

    # --- Config generales ---
    max_content_length: int = 30 * 1024 * 1024
    use_resumen_ancho: bool = True
    tipos_despacho_validos: Tuple[str, ...] = ("ZFI", "ZFE", "IC04", "IC05")
    scope: Tuple[str, ...] = field(
        default_factory=lambda: ("https://graph.microsoft.com/.default",)
    )

    @property
    def authority(self) -> str:
        """URL de autoridad de Microsoft para autenticación."""
        return f"https://login.microsoftonline.com/{self.az_tenant_id}"


# === Función global para obtener settings ===
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Carga la configuración desde el entorno con validación y caché."""
    sql_uri = _require_env("SQLALCHEMY_DATABASE_URI")
    asignador_uri = _require_env("ASIGNADOR_DB_URI")

    tenant_id = _require_env("AZ_TENANT_ID")
    client_id = _require_env("AZ_CLIENT_ID")
    client_secret = _require_env("AZ_CLIENT_SECRET")
    site_url = _require_env("SP_SITE_URL")

    max_content_length = _env_int("MAX_CONTENT_LENGTH", 30 * 1024 * 1024)
    use_resumen_ancho = _env_bool("USE_RESUMEN_ANCHO", True)

    return Settings(
        sql_alchemy_database_uri=sql_uri,
        asignador_db_uri=asignador_uri,
        az_tenant_id=tenant_id,
        az_client_id=client_id,
        az_client_secret=client_secret,
        sp_site_url=site_url,
        max_content_length=max_content_length,
        use_resumen_ancho=use_resumen_ancho,
    )
