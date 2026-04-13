"""API endpoints related to facturas and their vínculos."""

from __future__ import annotations

import datetime
import json
import logging
import os
import requests
from typing import List

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func, text
from ..extensions import db
from .. import extensions as ext
eng = ext.init_engine_asignador()

from ..models import DespachoResumen, Factura, FacturaDespacho
from ..services.despachos import (
    add_links,
    get_linked_despacho_ids,
    parse_despachos_payload,
    recalc_for_despacho_ids,
    replace_links,
    resolve_despacho_ids,
    serializar_factura,
    sp_sync_resumen_ancho,
    sp_upsert_resumen_gasto,
)
from ..services.sharepoint import delete_file_by_web_url, graph_put, get_access_token
from ..services.tipos_gasto import resolve_tipogasto_id, resolve_tipogasto_name
from ..utils.parsing import as_bool, normalize_despacho, safe_float, to_float_or_none

facturas_bp = Blueprint("facturas", __name__, url_prefix="/api")


def _site_ids() -> tuple[str | None, str | None]:
    try:
        print("🔍 DEBUG FACTURAS: entrando a _site_ids")

        token = get_access_token()
        print("✅ TOKEN obtenido")

        headers = {"Authorization": f"Bearer {token}"}

        SP_SITE_URL = os.getenv("SP_SITE_URL")

        if not SP_SITE_URL:
            raise Exception("SP_SITE_URL no configurado")

        print("🌐 SP_SITE_URL:", SP_SITE_URL)

        # 🔥 parse correcto (igual que despachos)
        clean = SP_SITE_URL.replace("https://", "")
        parts = clean.split("/")
        hostname = parts[0]
        site_path = "/".join(parts[1:])

        url = f"https://graph.microsoft.com/v1.0/sites/{hostname}:/{site_path}"

        print("🌐 URL SITE:", url)

        resp = requests.get(url, headers=headers)
        print("📡 RESPONSE SITE:", resp.status_code, resp.text)

        resp.raise_for_status()

        site_id = resp.json().get("id")
        print("📁 SITE_ID:", site_id)

        # 🔥 DRIVE
        resp = requests.get(
            f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive",
            headers=headers
        )

        print("📡 RESPONSE DRIVE:", resp.status_code, resp.text)

        resp.raise_for_status()

        drive_id = resp.json().get("id")
        print("📁 DRIVE_ID:", drive_id)

        return site_id, drive_id

    except Exception as e:
        print("❌ ERROR en _site_ids (facturas):", str(e))
        return None, None


def _use_resumen_ancho() -> bool:
    return bool(current_app.config.get("USE_RESUMEN_ANCHO", True))


def _normalize_duplicate_key(value: str) -> str:
    value = (value or "").strip().upper()
    for ch in (" ", ".", ",", "-", "_", "/", chr(92)):
        value = value.replace(ch, "")
    return value


def _factura_numero_duplicado(nro_factura: str, proveedor: str, exclude_id: int | None = None) -> bool:
    numero = _normalize_duplicate_key(nro_factura)
    proveedor_nombre = _normalize_duplicate_key(proveedor)
    if not numero or not proveedor_nombre:
        return False

    query = Factura.query.with_entities(Factura.ID, Factura.nroFactura, Factura.Proveedor)
    if exclude_id is not None:
        query = query.filter(Factura.ID != exclude_id)

    for row in query.all():
        if _normalize_duplicate_key(row.nroFactura or "") != numero:
            continue
        if _normalize_duplicate_key(row.Proveedor or "") != proveedor_nombre:
            continue
        return True
    return False


@facturas_bp.get("/facturas/with-links")
def facturas_with_links():
    try:
        only_unlinked = as_bool(request.args.get("only_unlinked", "0"))
        query = (request.args.get("q") or "").strip()
        try:
            limit = max(1, min(5000, int(request.args.get("limit", 2000))))
        except Exception:
            limit = 2000
        try:
            offset = max(0, int(request.args.get("offset", 0)))
        except Exception:
            offset = 0

        order_key = (request.args.get("order") or "fecha_desc").lower()
        order_sql_map = {
            "fecha_desc": "f.Fecha DESC, f.ID DESC",
            "fecha_asc": "f.Fecha ASC, f.ID ASC",
            "proveedor_desc": "COALESCE(f.Proveedor, '') DESC, f.ID DESC",
            "proveedor_asc": "COALESCE(f.Proveedor, '') ASC, f.ID ASC",
            "factura_desc": "COALESCE(NULLIF(f.nroFactura, ''), f.Invoice, '') DESC, f.ID DESC",
            "factura_asc": "COALESCE(NULLIF(f.nroFactura, ''), f.Invoice, '') ASC, f.ID ASC",
            "tipo_gasto_desc": "COALESCE(tg.TipoGasto, '') DESC, f.ID DESC",
            "tipo_gasto_asc": "COALESCE(tg.TipoGasto, '') ASC, f.ID ASC",
            "moneda_desc": "COALESCE(f.Moneda, '') DESC, f.ID DESC",
            "moneda_asc": "COALESCE(f.Moneda, '') ASC, f.ID ASC",
            "importe_desc": "f.Importe DESC, f.ID DESC",
            "importe_asc": "f.Importe ASC, f.ID ASC",
            "adjunto_desc": "CASE WHEN f.HasDoc = 1 THEN 1 ELSE 0 END DESC, COALESCE(f.DocName, '') ASC, f.ID DESC",
            "adjunto_asc": "CASE WHEN f.HasDoc = 1 THEN 1 ELSE 0 END ASC, COALESCE(f.DocName, '') ASC, f.ID ASC",
            "despacho_desc": "COALESCE(f.Despacho, '') DESC, f.ID DESC",
            "despacho_asc": "COALESCE(f.Despacho, '') ASC, f.ID ASC",
            "registrado_desc": "CASE WHEN ISNULL(f.Registrado, 0) = 1 THEN 1 ELSE 0 END DESC, f.ID DESC",
            "registrado_asc": "CASE WHEN ISNULL(f.Registrado, 0) = 1 THEN 1 ELSE 0 END ASC, f.ID ASC",
            "vinculos_desc": "COUNT(fd.despacho_id) DESC, f.ID DESC",
            "vinculos_asc": "COUNT(fd.despacho_id) ASC, f.ID ASC",
            "id_desc": "f.ID DESC",
            "id_asc": "f.ID ASC",
        }
        order_clause = order_sql_map.get(order_key, "f.Fecha DESC, f.ID DESC")
        having_clause = "HAVING COUNT(fd.despacho_id) = 0" if only_unlinked else ""
        where_clause = ""
        params = {"offset": offset, "limit": limit}
        if query:
            where_clause = """
            WHERE
                UPPER(COALESCE(f.Proveedor, '')) LIKE UPPER(:query)
                OR UPPER(COALESCE(f.nroFactura, '')) LIKE UPPER(:query)
                OR UPPER(COALESCE(f.Invoice, '')) LIKE UPPER(:query)
                OR UPPER(COALESCE(f.Despacho, '')) LIKE UPPER(:query)
                OR CONVERT(varchar(10), f.Fecha, 23) LIKE :query
                OR UPPER(COALESCE(tg.TipoGasto, '')) LIKE UPPER(:query)
                OR CONVERT(varchar(50), f.Importe) LIKE :query
            """
            params["query"] = f"%{query}%"
        sql = f"""
        SELECT
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            CAST(ISNULL(f.Registrado, 0) AS bit) AS Registrado,
            f.Despacho,
            f.TipoGasto        AS TipoGastoId,
            tg.TipoGasto       AS TipoGastoNombre,
            CAST(COUNT(fd.despacho_id) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Detalles f
        LEFT JOIN dbo.Factura_Despacho fd ON fd.factura_id = f.ID
        LEFT JOIN dbo.TipoGastosBI tg     ON tg.IdGasto = f.TipoGasto
        {where_clause}
        GROUP BY
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Registrado, f.Despacho, f.TipoGasto, tg.TipoGasto
        {having_clause}
        ORDER BY {order_clause}
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY;
        """
        count_sql = f"""
        SELECT COUNT(*) AS Total
        FROM (
            SELECT f.ID
            FROM dbo.APP_Despachos_Detalles f
            LEFT JOIN dbo.Factura_Despacho fd ON fd.factura_id = f.ID
            LEFT JOIN dbo.TipoGastosBI tg     ON tg.IdGasto = f.TipoGasto
            {where_clause}
            GROUP BY f.ID
            {having_clause}
        ) q;
        """
        rows = db.session.execute(text(sql), params).mappings().all()
        total = db.session.execute(text(count_sql), params).scalar() or 0
        items = []
        for row in rows:
            data = dict(row)
            fecha = data.get("Fecha")
            if isinstance(fecha, (datetime.date, datetime.datetime)):
                data["Fecha"] = fecha.isoformat()
            items.append(data)
        return jsonify({"ok": True, "items": items, "total": int(total), "limit": limit, "offset": offset})
    except Exception as exc:
        logging.exception("facturas_with_links error: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.get("/facturas/links-count")
def facturas_links_count():
    try:
        sql = """
        SELECT
            f.ID,
            CAST(COUNT(fd.despacho_id) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Detalles f
        LEFT JOIN dbo.Factura_Despacho fd ON fd.factura_id = f.ID
        GROUP BY f.ID
        ORDER BY f.ID DESC;
        """
        rows = db.session.execute(text(sql)).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as exc:
        logging.exception("facturas_links_count error: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.route("/facturas", methods=["GET"])
def obtener_facturas():
    try:
        facturas = Factura.query.all()
        return jsonify([serializar_factura(f) for f in facturas])
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@facturas_bp.route("/facturas/<int:factura_id>", methods=["GET"])
def obtener_factura_por_id(factura_id: int):
    try:
        factura = Factura.query.get_or_404(factura_id)
        return jsonify(serializar_factura(factura))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 404


@facturas_bp.get("/facturas/<int:factura_id>/full")
def get_factura_full(factura_id: int):
    try:
        factura = Factura.query.get_or_404(factura_id)
        base = serializar_factura(factura)
        ids = get_linked_despacho_ids(factura_id)
        linked = []
        if ids:
            rows = (
                DespachoResumen.query.with_entities(
                    DespachoResumen.ID, DespachoResumen.Despacho, DespachoResumen.Fecha
                )
                .filter(DespachoResumen.ID.in_(ids))
                .all()
            )
            for row in rows:
                linked.append(
                    {
                        "ID": row.ID,
                        "Despacho": row.Despacho,
                        "Fecha": row.Fecha.isoformat() if row.Fecha else None,
                    }
                )
        base["DespachosLinked"] = linked
        return jsonify({"ok": True, "factura": base})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500



@facturas_bp.patch("/facturas/<int:factura_id>/registrado")
def actualizar_registrado_factura(factura_id: int):
    try:
        datos = request.get_json(silent=True) or {}
        if "registrado" not in datos and "Registrado" not in datos:
            return jsonify({"ok": False, "error": "Falta el campo registrado"}), 400

        factura = Factura.query.get_or_404(factura_id)
        valor = as_bool(datos.get("registrado", datos.get("Registrado")))
        factura.Registrado = valor
        db.session.commit()

        return jsonify({"ok": True, "id": factura.ID, "Registrado": bool(valor)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500

@facturas_bp.route("/facturas/<int:factura_id>", methods=["PUT"])
def actualizar_factura(factura_id: int):
    try:
        if not request.json:
            return jsonify({"error": "El cuerpo de la solicitud debe ser JSON"}), 400

        datos = request.json
        factura = Factura.query.get_or_404(factura_id)

        nro_factura = (datos.get("nroFactura") if "nroFactura" in datos else factura.nroFactura) or ""
        proveedor = (datos.get("Proveedor") if "Proveedor" in datos else factura.Proveedor) or ""
        nro_factura = nro_factura.strip()
        proveedor = proveedor.strip()
        if nro_factura and proveedor and _factura_numero_duplicado(nro_factura, proveedor, exclude_id=factura_id):
            return jsonify({"error": f"Ya existe una factura con el numero {nro_factura} para el proveedor {proveedor}."}), 400

        prev_link_ids = set(get_linked_despacho_ids(factura_id))
        prev_despacho_code = normalize_despacho(factura.Despacho or "")

        if "Fecha" in datos and datos.get("Fecha"):
            factura.Fecha = datetime.datetime.strptime(datos.get("Fecha"), "%Y-%m-%d").date()
        if "Invoice" in datos:
            factura.Invoice = (datos.get("Invoice") or "").strip()
        if "nroFactura" in datos:
            factura.nroFactura = (datos.get("nroFactura") or "").strip()
        if "OrdenPO" in datos:
            factura.OrdenPO = (datos.get("OrdenPO") or "").strip()
        if "Importe" in datos:
            factura.Importe = to_float_or_none(datos.get("Importe"))
        if "SIMI_SIRA" in datos:
            factura.SIMI_SIRA = (datos.get("SIMI_SIRA") or "").strip()
        if "Descripcion" in datos:
            factura.Descripcion = (datos.get("Descripcion") or "").strip()
        if "Despacho" in datos:
            factura.Despacho = normalize_despacho(datos.get("Despacho"))
        if "BL" in datos:
            factura.BL = (datos.get("BL") or "").strip()
        if "Mercaderia" in datos:
            factura.Mercaderia = (datos.get("Mercaderia") or "").strip()
        if "Proveedor" in datos:
            factura.Proveedor = (datos.get("Proveedor") or "").strip()
        if "nroProveedor" in datos:
            factura.nroProveedor = (datos.get("nroProveedor") or "").strip()
        if "TipoGasto" in datos:
            factura.TipoGasto = resolve_tipogasto_id(datos.get("TipoGasto"))
        if "Moneda" in datos:
            factura.Moneda = ((datos.get("Moneda") or "ARS").strip()[:3]).upper()
        if "Registrado" in datos:
            factura.Registrado = as_bool(datos.get("Registrado"))

        db.session.commit()

        new_link_ids: List[int]
        if "Despachos" in datos or "despachos" in datos:
            despachos_raw = parse_despachos_payload(datos)
            links = resolve_despacho_ids(despachos_raw)
            ids = [did for (did, _) in links]
            replace_links(factura.ID, ids)
            new_link_ids = ids
        elif "Despacho" in datos or "despacho" in datos:
            code = normalize_despacho(datos.get("Despacho") or datos.get("despacho") or "")
            if code:
                links = resolve_despacho_ids([code])
                if links:
                    replace_links(factura.ID, [links[0][0]])
                    new_link_ids = [links[0][0]]
                else:
                    replace_links(factura.ID, [])
                    new_link_ids = []
            else:
                replace_links(factura.ID, [])
                new_link_ids = []
        else:
            new_link_ids = list(prev_link_ids)

        gone = set(prev_link_ids) - set(new_link_ids)
        came = set(new_link_ids) - set(prev_link_ids)

        if gone:
            recalc_for_despacho_ids(list(gone))
        if came:
            recalc_for_despacho_ids(list(came))

        new_despacho_code = normalize_despacho(factura.Despacho or "")
        if prev_despacho_code and prev_despacho_code != new_despacho_code:
            sp_upsert_resumen_gasto(prev_despacho_code)
            if _use_resumen_ancho():
                sp_sync_resumen_ancho(prev_despacho_code)
        if new_despacho_code:
            sp_upsert_resumen_gasto(new_despacho_code)
            if _use_resumen_ancho():
                sp_sync_resumen_ancho(new_despacho_code)

        return jsonify({"mensaje": "Factura actualizada con éxito", "id": factura.ID}), 200

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al actualizar la factura: {exc}"}), 500


@facturas_bp.route("/facturas", methods=["POST"])
def crear_factura():
    try:
        datos = request.form if request.form else (request.get_json() or {})
        archivo = request.files.get("documento")

        tg_id = resolve_tipogasto_id(datos.get("TipoGasto"))
        tg_name = resolve_tipogasto_name(datos.get("TipoGasto")) or "Generales"

        nro_factura = (datos.get("nroFactura") or "").strip()
        proveedor = (datos.get("Proveedor") or "").strip()
        if nro_factura and proveedor and _factura_numero_duplicado(nro_factura, proveedor):
            return jsonify({"error": f"Ya existe una factura con el numero {nro_factura} para el proveedor {proveedor}."}), 400

        uploaded = None

        if archivo:
            try:
                print("📂 DEBUG FACTURA:")
                print("Archivo recibido:", archivo.filename)

                site_id, drive_id = _site_ids()
                print("SITE_ID:", site_id)
                print("DRIVE_ID:", drive_id)

                if site_id and drive_id:
                    file_bytes = archivo.read()

                    folder = f"Gastos/{tg_name}"
                    sp_path = f"/{folder}/{archivo.filename}"

                    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives/{drive_id}/root:{sp_path}:/content"

                    print("📤 Subiendo a SharePoint:", url)

                    uploaded = graph_put(url, file_bytes)

                    print("✅ Upload OK:", uploaded)

                else:
                    print("⚠ SharePoint no configurado")

            except Exception as e:
                print("❌ ERROR SHAREPOINT:", str(e))
                uploaded = None

        nueva = Factura(
            Fecha=datetime.datetime.strptime(datos.get("Fecha"), "%Y-%m-%d").date() if datos.get("Fecha") else None,
            Invoice=(datos.get("Invoice") or "").strip(),
            nroFactura=(datos.get("nroFactura") or "").strip(),
            OrdenPO=(datos.get("OrdenPO") or "").strip(),
            Importe=safe_float(datos.get("Importe")),
            SIMI_SIRA=(datos.get("SIMI_SIRA") or "").strip(),
            Descripcion=(datos.get("Descripcion") or "").strip(),
            Despacho=normalize_despacho(datos.get("Despacho")),
            BL=(datos.get("BL") or "").strip(),
            Mercaderia=(datos.get("Mercaderia") or "").strip(),
            TipoGasto=tg_id,
            Proveedor=(datos.get("Proveedor") or "").strip(),
            nroProveedor=(datos.get("nroProveedor") or "").strip(),
            Moneda=((datos.get("Moneda") or "ARS").strip()[:3]).upper(),
            Registrado=as_bool(datos.get("Registrado", 0)),
            DocUrl=(uploaded or {}).get("webUrl"),
            DocName=archivo.filename if archivo else None,
            HasDoc=bool(uploaded),
        )

        db.session.add(nueva)
        db.session.commit()

        despachos_raw = parse_despachos_payload(datos)
        links = resolve_despacho_ids(despachos_raw)

        if links:
            ids = [did for (did, _) in links]
            replace_links(nueva.ID, ids)
            recalc_for_despacho_ids(ids)
        elif nueva.Despacho:
            lk = resolve_despacho_ids([nueva.Despacho])
            if lk:
                replace_links(nueva.ID, [lk[0][0]])
                recalc_for_despacho_ids([lk[0][0]])

        nro = normalize_despacho(nueva.Despacho or "")
        if nro:
            sp_upsert_resumen_gasto(nro)
            if _use_resumen_ancho():
                sp_sync_resumen_ancho(nro)

        response = {"mensaje": "Factura creada con éxito", "id": nueva.ID}
        if uploaded:
            response["sharepoint"] = {"id": uploaded.get("id"), "webUrl": uploaded.get("webUrl")}
        return jsonify(response), 201

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Error creando factura: {exc}"}), 500


@facturas_bp.route("/facturas/<int:factura_id>", methods=["DELETE"])
def eliminar_factura(factura_id: int):
    try:
        factura = Factura.query.get_or_404(factura_id)
        link_ids = get_linked_despacho_ids(factura_id)
        code = normalize_despacho(factura.Despacho or "")
        doc_url = (factura.DocUrl or "").strip()

        if doc_url:
            try:
                delete_file_by_web_url(doc_url)
            except Exception as exc:
                return jsonify({"error": f"No se pudo eliminar el adjunto en SharePoint: {exc}"}), 500

        if link_ids:
            FacturaDespacho.query.filter(FacturaDespacho.factura_id == factura_id).delete(synchronize_session=False)

        db.session.delete(factura)
        db.session.commit()

        if link_ids:
            recalc_for_despacho_ids(link_ids)
        if code:
            sp_upsert_resumen_gasto(code)
            if _use_resumen_ancho():
                sp_sync_resumen_ancho(code)

        return jsonify({"ok": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.get("/facturas/<int:factura_id>/despachos")
def get_despachos_de_factura(factura_id: int):
    try:
        Factura.query.get_or_404(factura_id)
        ids = get_linked_despacho_ids(factura_id)
        if not ids:
            return jsonify({"ok": True, "items": []})
        rows = (
            DespachoResumen.query.with_entities(
                DespachoResumen.ID, DespachoResumen.Despacho, DespachoResumen.Fecha
            )
            .filter(DespachoResumen.ID.in_(ids))
            .all()
        )
        items = []
        for row in rows:
            items.append(
                {
                    "ID": row.ID,
                    "Despacho": row.Despacho,
                    "DespachoNormalizado": normalize_despacho(row.Despacho or ""),
                    "Fecha": row.Fecha.isoformat() if row.Fecha else None,
                }
            )
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.post("/facturas/<int:factura_id>/despachos")
def set_despachos_de_factura(factura_id: int):
    """
    Body JSON o form-data:
      { "despachos": [1, "25001IC040..."] }   # IDs o Códigos
    Query string: ?mode=replace|add (por defecto replace)
    """
    try:
        Factura.query.get_or_404(factura_id)
        datos = request.get_json(silent=True) or request.form or {}
        mode = (request.args.get("mode") or "replace").lower()

        raw = datos.get("despachos") or datos.get("Despachos")
        if raw is None:
            raw = parse_despachos_payload(datos)
        elif isinstance(raw, str):
            if raw.strip().startswith("["):
                raw = json.loads(raw)
            else:
                raw = [p.strip() for p in raw.split(",") if p.strip()]

        links = resolve_despacho_ids([str(x) for x in (raw or [])])
        ids = [did for (did, _) in links]

        if mode == "add":
            add_links(factura_id, ids)
        else:
            replace_links(factura_id, ids)

        recalc_for_despacho_ids(ids)
        return jsonify({"ok": True, "factura_id": factura_id, "linked_ids": ids})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.delete("/facturas/<int:factura_id>/despachos/<int:despacho_id>")
def remove_link(factura_id: int, despacho_id: int):
    try:
        Factura.query.get_or_404(factura_id)
        FacturaDespacho.query.filter_by(factura_id=factura_id, despacho_id=despacho_id).delete(
            synchronize_session=False
        )
        db.session.commit()
        recalc_for_despacho_ids([despacho_id])
        return jsonify({"ok": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500


@facturas_bp.get("/despachos/<int:despacho_id>/facturas-linked")
def get_facturas_linked_por_despacho(despacho_id: int):
    try:
        sql = """
        SELECT
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Despacho,
            f.TipoGasto        AS TipoGastoId,
            tg.TipoGasto       AS TipoGastoNombre
        FROM dbo.Factura_Despacho fd
        JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
        LEFT JOIN dbo.TipoGastosBI tg ON tg.IdGasto = f.TipoGasto
        WHERE fd.despacho_id = :did
        ORDER BY f.Fecha DESC, f.ID DESC;
        """
        rows = db.session.execute(text(sql), {"did": despacho_id}).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500

