"""Blueprint with OC-related endpoints."""

# apps/backend/src/api/oc.py
from __future__ import annotations
import datetime
import html

from flask import Blueprint, jsonify, request
from sqlalchemy import text

# 👇 IMPORTA EL MÓDULO (no la variable)
from .. import extensions as ext

oc_bp = Blueprint("oc", __name__, url_prefix="/oc")





@oc_bp.get("/debug")
def oc_debug():
    """
    Página HTML mínima para ver las últimas 25 OCs (o buscar) sin depender del front.
    """
    q = (request.args.get("search") or "").strip()
    since = (request.args.get("since") or "2000-01-01").strip()
    try:
        eng = ext.init_engine_asignador()
        with eng.connect() as conn:
            rows = conn.execute(sql, {"q": q, "since": since}).mappings().all()
    except Exception:
        since = "2000-01-01"

    sql = text(
        """
        SELECT TOP 25
            A.OC_ID                    AS OC_ID
            A.REFERENCIA               AS INNVOICE,
            H.CODIGO                   AS CODPROVEEDOR,
            H.RAZON_SOCIAL             AS RAZON_SOCIAL,
            CONVERT(date, A.FECHA_ALTA) AS FECHAOC
        FROM dbo.ERP_ORDENES_COMPRA AS A
        LEFT JOIN dbo.ERP_PROVEEDORES AS H
               ON H.PROVEEDOR_ID = A.PROVEEDOR_ID
        WHERE A.ESTADO <> 'ANULADA' AND A.FECHA_ALTA >= :since
          AND (
                :q = '' OR
                CAST(A.REFERENCIA AS NVARCHAR(50)) LIKE '%' + :q + '%' OR
                H.CODIGO LIKE '%' + :q + '%' OR
                H.RAZON_SOCIAL LIKE '%' + :q + '%'
              ) 
        ORDER BY A.FECHA_ALTA DESC, A.REFERENCIA DESC
        """
    )

    try:
        with engine_asignador.connect() as conn:
            rows = conn.execute(sql, {"q": q, "since": since}).mappings().all()
        if not rows and q == "":
            sql2 = text(sql.text.replace("A.FECHA_ALTA >= :since AND", ""))
            with engine_asignador.connect() as conn:
                rows = conn.execute(sql2, {"q": q}).mappings().all()
        trs = "".join(
            "<tr><td>{OC_ID}</td><td>{CODPROVEEDOR}</td><td>{RAZON_SOCIAL}</td><td>{FECHAOC}</td></tr>".format(**row)
            for row in rows
        )
        since = html.escape(since)
        html_body = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>OC Debug</title>
<style>
body{{font-family:system-ui;background-color:#111827;color:#e5e7eb;margin:0;padding:32px;}}
.wrap{{max-width:960px;margin:0 auto}}
.card{{background:#1f2937;border-radius:16px;padding:24px}}
input{{background:#111827;border:1px solid #374151;color:#e5e7eb}}
button{{background:#4f46e5;border:0;color:white;cursor:pointer}}
table{{width:100%;border-collapse:collapse;margin-top:12px}}
th,td{{padding:8px;border-top:1px solid #374151}}
th{{text-align:left;color:#9ca3af}}
small{{color:#9ca3af}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Debug OC (TOP 25)</h1>
    <form method="get">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div><label>Buscar</label><br>
          <input name="search" value="{html.escape(q)}" placeholder="OC / código / razón social">
        </div>
        <div><label>Desde</label><br>
          <input type="date" name="since" value="{since}">
        </div>
        <div><button type="submit">Buscar / Recargar</button></div>
      </div>
    </form>
    <small>GET /oc/select?search={html.escape(q)}&since={since}</small>
    <table>
      <thead><tr><th>OC_ID</th><th>Cod. Prov.</th><th>Razón social</th><th>Fecha OC</th></tr></thead>
      <tbody>{trs or '<tr><td colspan="4">Sin resultados</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body></html>"""
        return html_body
    except Exception as exc:
        return f"<pre>⚠️ {html.escape(str(exc))}</pre>", 500


@oc_bp.get("/select")
def oc_select():
    q = (request.args.get("search") or "").strip()
    since = (request.args.get("since") or "2000-01-01").strip()
    try:
        datetime.datetime.strptime(since, "%Y-%m-%d")
    except Exception:
        since = "2000-01-01"

    sql = text("""
        SELECT TOP 25
            A.OC_ID                      AS OC_ID
            A.REFERENCIA                 AS INNVOICE,
            H.CODIGO                     AS CODPROVEEDOR,
            H.RAZON_SOCIAL               AS RAZON_SOCIAL,
            CONVERT(date, A.FECHA_ALTA)  AS FECHAOC
        FROM dbo.ERP_ORDENES_COMPRA AS A
        LEFT JOIN dbo.ERP_PROVEEDORES AS H
          ON H.PROVEEDOR_ID = A.PROVEEDOR_ID
        WHERE A.ESTADO <> 'ANULADA' AND A.FECHA_ALTA >= :since
          AND (
                :q = '' OR
                CAST(A.REFERENCIA AS NVARCHAR(50)) LIKE CONCAT('%', :q, '%') OR
                COALESCE(H.CODIGO,'') LIKE CONCAT('%', :q, '%') OR
                COALESCE(H.RAZON_SOCIAL,'') LIKE CONCAT('%', :q, '%')
              )
        ORDER BY A.FECHA_ALTA DESC, A.REFERENCIA DESC
    """)

    try:
        eng = ext.init_engine_asignador()
        with eng.connect() as conn:
            rows = conn.execute(sql, {"q": q, "since": since}).mappings().all()
        if not rows and q == "":
            sql2 = text(sql.text.replace("A.FECHA_ALTA >= :since AND", ""))
            eng = ext.init_engine_asignador()
            with eng.connect() as conn:
                rows = conn.execute(sql2, {"q": q}).mappings().all()
        return jsonify([dict(r) for r in rows])
    except Exception as exc:
        return jsonify({"error": f"OC/select failed: {str(exc)}"}), 500



@oc_bp.get("/ping")
def oc_ping():
    try:
        with engine_asignador.connect() as conn:
            value = conn.execute(text("SELECT 1 AS ok")).scalar()
        return jsonify({"ok": bool(value)})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
