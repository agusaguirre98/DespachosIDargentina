"""Genera el esquema OpenAPI de la API Flask."""
from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from flask import Flask

try:
    from apps.backend.src.app import app as flask_app  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit("No se pudo importar la aplicación Flask: " + str(exc))


def generate_openapi(app: Flask) -> dict:
    """Devuelve un diccionario con la especificación OpenAPI."""
    if not hasattr(app, "openapi_spec"):
        raise RuntimeError("La aplicación no expone 'openapi_spec'. Implementa la generación antes de usar este script.")
    spec = app.openapi_spec
    return spec() if callable(spec) else spec


def main() -> None:
    spec = generate_openapi(flask_app)
    output = Path("docs/api/openapi.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spec, indent=2, ensure_ascii=False))
    print(f"Esquema OpenAPI exportado a {output}")


if __name__ == "__main__":
    main()
