"""Blueprint with OC-related endpoints."""

# apps/backend/src/api/oc.py
from __future__ import annotations
import datetime
import html

from flask import Blueprint, jsonify, request
from sqlalchemy import text

from .. import extensions as ext

oc_bp = Blueprint("oc", __name__, url_prefix="/oc")


# ---------------------------------------------------
# SELECT OCs (usado por OCSearchSelect)
# ---------------------------------------------------
@oc_bp.get("/select")
def oc_select():
    q = (request.args.get("search") or "").strip()
    since = (request.args.get("since") or "2000-01-01").strip()

    try:
        datetime.datetime.strptime(since, "%Y-%m-%d")
    except Exception:
        since = "2000-01-01"

    if not q:
        return jsonify([])

    pattern = f"%{q}%"

    sql = text("""
        SELECT TOP 25
            A.ORDEN_COMPRA_ID                      AS OC_ID,
            A.REFERENCIA                 AS INNVOICE,
            H.CODIGO                     AS CODPROVEEDOR,
            H.RAZON_SOCIAL               AS RAZON_SOCIAL,
            CONVERT(date, A.FECHA_ALTA)  AS FECHAOC
        FROM dbo.ERP_ORDENES_COMPRA AS A
        LEFT JOIN dbo.ERP_PROVEEDORES AS H
          ON H.PROVEEDOR_ID = A.PROVEEDOR_ID
        WHERE A.ESTADO <> 'ANULADA'
          AND A.FECHA_ALTA >= :since
          AND (
                CAST(A.ORDEN_COMPRA_ID AS NVARCHAR(50)) LIKE :pattern
                OR CAST(A.REFERENCIA AS NVARCHAR(50)) LIKE :pattern
                OR COALESCE(H.CODIGO,'') LIKE :pattern
                OR COALESCE(H.RAZON_SOCIAL,'') LIKE :pattern
              )
        ORDER BY A.ORDEN_COMPRA_ID DESC
    """)

    try:
        eng = ext.init_engine_asignador()
        with eng.connect() as conn:
            rows = conn.execute(
                sql,
                {"pattern": pattern, "since": since}
            ).mappings().all()

        return jsonify([dict(r) for r in rows])

    except Exception as exc:
        return jsonify({
            "error": "OC/select failed",
            "detail": str(exc)
        }), 500


# ---------------------------------------------------
# DEBUG VIEW
# ---------------------------------------------------
@oc_bp.get("/debug-db")
def oc_debug_db():
    try:
        eng = ext.init_engine_asignador()
        with eng.connect() as conn:
            db_name = conn.execute(text("SELECT DB_NAME()")).scalar()
            server_name = conn.execute(text("SELECT @@SERVERNAME")).scalar()

        return jsonify({
            "database": db_name,
            "server": server_name
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------
# PING
# ---------------------------------------------------
@oc_bp.get("/ping")
def oc_ping():
    try:
        eng = ext.init_engine_asignador()
        with eng.connect() as conn:
            value = conn.execute(text("SELECT 1")).scalar()
        return jsonify({"ok": bool(value)})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500