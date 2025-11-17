"""OCR endpoints for despachos and facturas."""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..services.ocr_despachos import extract_from_pdf
from ..services.ocr_facturas import extract_from_pdf as extract_factura

ocr_bp = Blueprint("ocr", __name__, url_prefix="/api/ocr")


@ocr_bp.post("/despacho")
def ocr_despacho():
    archivo = request.files.get("file") or request.files.get("documento")
    if not archivo:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    try:
        contenido = archivo.read()
        try:
            max_pages = int(request.args.get("max_pages", 4))
        except Exception:
            max_pages = 4
        max_pages = max(1, min(4, max_pages))
        try:
            dpi = int(request.args.get("dpi", 300))
        except Exception:
            dpi = 300
        raw, suggested, preview, debug = extract_from_pdf(contenido, dpi=dpi, max_pages=max_pages)
        return jsonify(
            {
                "ok": True,
                "source": "easyocr",
                "raw": raw,
                "suggested": suggested,
                "previewText": preview,
                "debug": debug if request.args.get("debug") else None,
            }
        )
    except Exception as exc:
        logging.exception("Error en /api/ocr/despacho: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@ocr_bp.post("/factura")
def ocr_factura():
    archivo = request.files.get("file") or request.files.get("documento")
    if not archivo:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    try:
        contenido = archivo.read()
        try:
            dpi = int(request.args.get("dpi", 300))
        except Exception:
            dpi = 300
        raw, suggested, preview, debug = extract_factura(contenido, dpi=dpi)
        return jsonify(
            {
                "ok": True,
                "source": "easyocr",
                "raw": raw,
                "suggested": suggested,
                "previewText": preview,
                "debug": debug if request.args.get("debug") else None,
            }
        )
    except Exception as exc:
        logging.exception("Error en /api/ocr/factura: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
