"""API endpoints related to despachos."""

from __future__ import annotations

import datetime
import json
import logging
from typing import Iterable

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func, text

from .. import extensions as ext
eng = ext.init_engine_asignador()
from ..extensions import db
from ..models import DespachoOC, DespachoResumen, Factura, FacturaDespacho, TipoGasto
from ..services.despachos import (
    add_links,
    parse_despachos_payload,
    recalc_for_despacho_ids,
    replace_links,
    resolve_despacho_ids,
    serializar_despacho,
    sp_rebuild_resumen_gasto_todos,
    sp_sync_resumen_ancho,
    sp_sync_resumen_ancho_todos,
    sp_upsert_resumen_gasto,
)
from ..services.sharepoint import ensure_folder, graph_put, upload_small
from ..services.tipos_gasto import resolve_tipogasto_id, resolve_tipogasto_name
from ..services.zf import import_zfi_lines_from_oc as import_zfi_lines_from_oc_service, oc_existe_en_asignador
from ..utils.parsing import as_bool, normalize_despacho, parse_float, safe_float, to_float_or_none

despachos_bp = Blueprint("despachos", __name__, url_prefix="/api")


def _site_ids() -> tuple[str | None, str | None]:
    return current_app.config.get("SITE_ID"), current_app.config.get("DRIVE_ID")


def _tipos_validos() -> Iterable[str]:
    return current_app.config.get("TIPOS_DESPACHO_VALIDOS", ("ZFI", "ZFE", "IC04", "IC05"))


_OC_ID_KEYS = ("oc_ids[]", "oc_ids", "ocIds[]", "ocIds", "OC_IDS", "OCIds")


def _flatten_oc_values(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        flattened: list[str] = []
        for item in value:
            flattened.extend(_flatten_oc_values(item))
        return flattened
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                parsed = json.loads(stripped)
                return _flatten_oc_values(parsed)
            except Exception:
                pass
        return [stripped]
    return [str(value)]


def _extract_oc_ids(datos) -> tuple[list[str], bool]:
    provided = False
    collected: list[str] = []
    for key in _OC_ID_KEYS:
        values: list[str] = []
        present = False

        if hasattr(datos, "getlist"):
            try:
                listed = list(datos.getlist(key))
            except Exception:
                listed = []
            if listed:
                values.extend(listed)
                present = True

        if not present and hasattr(datos, "__contains__"):
            try:
                present = key in datos
            except Exception:
                present = False

        if not values and hasattr(datos, "get"):
            try:
                value = datos.get(key)
            except TypeError:
                value = datos.get(key)
            if value is not None:
                values.append(value)
                present = True

        if present:
            provided = True
        if values:
            for entry in values:
                collected.extend(_flatten_oc_values(entry))

    sanitized: list[str] = []
    seen = set()
    for value in collected:
        val = str(value).strip()
        if not val or val in seen:
            continue
        sanitized.append(val)
        seen.add(val)

    return sanitized, provided


def _replace_despacho_oc_links(despacho_id: int, oc_ids: Iterable[str]) -> None:
    db.session.query(DespachoOC).filter(DespachoOC.despacho_id == despacho_id).delete(synchronize_session=False)
    for oc_id in oc_ids:
        db.session.add(DespachoOC(despacho_id=despacho_id, oc_id=oc_id))


def _get_oc_ids_for_despacho(despacho_id: int) -> list[str]:
    rows = (
        db.session.query(DespachoOC.oc_id)
        .filter(DespachoOC.despacho_id == despacho_id)
        .order_by(DespachoOC.id.asc())
        .all()
    )
    return [row.oc_id for row in rows]


@despachos_bp.delete("/despachos/<int:despacho_id>")
def eliminar_despacho(despacho_id: int):
    try:
        despacho = DespachoResumen.query.get_or_404(despacho_id)
        code = normalize_despacho(despacho.Despacho or "")
        tipo = (despacho.TipoDespacho or "").upper()

        linked_count = (
            db.session.query(func.count())
            .select_from(FacturaDespacho)
            .filter(FacturaDespacho.despacho_id == despacho_id)
            .scalar()
            or 0
        )

        # 1️⃣ Borrar facturas vinculadas
        if linked_count:
            FacturaDespacho.query.filter(
                FacturaDespacho.despacho_id == despacho_id
            ).delete(synchronize_session=False)

        # ==========================================
        # 🔥 LIMPIEZA ZF SEGÚN TIPO
        # ==========================================

        if tipo == "ZFI":

            # 2️⃣ Borrar líneas ZFI
            db.session.execute(
                text("DELETE FROM dbo.ZF_ZFI_Lines WHERE ZFI_ID = :id"),
                {"id": despacho_id},
            )

            # 3️⃣ Obtener grupos del ZFI
            grupos = db.session.execute(
                text("SELECT ZF_GroupID FROM dbo.ZF_Grupo WHERE ZFI_ID = :id"),
                {"id": despacho_id},
            ).fetchall()

            group_ids = [g[0] for g in grupos]

            if group_ids:
                # 4️⃣ Borrar vínculos asociados a esos grupos
                db.session.execute(
                    text("DELETE FROM dbo.ZF_Vinculos WHERE ZF_GroupID IN :groups")
                    .bindparams(groups=tuple(group_ids))
                )

            # 5️⃣ Borrar grupos
            db.session.execute(
                text("DELETE FROM dbo.ZF_Grupo WHERE ZFI_ID = :id"),
                {"id": despacho_id},
            )

        elif tipo == "ZFE":

            # 2️⃣ Borrar vínculos donde este despacho sea ZFE
            db.session.execute(
                text("DELETE FROM dbo.ZF_Vinculos WHERE ZFE_ID = :id"),
                {"id": despacho_id},
            )

        # ==========================================
        # 🔥 BORRAR RELACIONES OC
        # ==========================================

        db.session.query(DespachoOC).filter(
            DespachoOC.despacho_id == despacho_id
        ).delete(synchronize_session=False)

        # ==========================================
        # 🔥 BORRAR RESUMEN GASTO
        # ==========================================

        db.session.execute(
            text("""
                DELETE FROM dbo.App_Despachos_ResumenGasto
                WHERE REPLACE(UPPER(LTRIM(RTRIM(NroDespacho))), ' ', '') = :nro
            """),
            {"nro": code},
        )

        # ==========================================
        # 🔥 BORRAR DESPACHO
        # ==========================================

        db.session.execute(
            text("DELETE FROM dbo.APP_Despachos_Resumen WHERE ID = :id"),
            {"id": despacho_id},
        )

        db.session.commit()

        return jsonify({
            "ok": True,
            "deleted_id": despacho_id,
            "linked_deleted": int(linked_count)
        })

    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500

@despachos_bp.get("/despachos/links-count")
def despachos_links_count():
    try:
        sql = """
        ;WITH Links AS (
          SELECT fd.despacho_id AS DespachoId, f.ID AS FacturaId
          FROM dbo.Factura_Despacho fd
          JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
          UNION
          SELECT d.ID AS DespachoId, f.ID AS FacturaId
          FROM dbo.APP_Despachos_Resumen d
          JOIN dbo.APP_Despachos_Detalles f
            ON REPLACE(UPPER(LTRIM(RTRIM(f.Despacho))), ' ', '') =
               REPLACE(UPPER(LTRIM(RTRIM(d.Despacho))), ' ', '')
        )
        SELECT d.ID,
               CAST(COUNT(DISTINCT l.FacturaId) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Resumen d
        LEFT JOIN Links l ON l.DespachoId = d.ID
        GROUP BY d.ID
        ORDER BY d.ID DESC;
        """
        rows = db.session.execute(text(sql)).mappings().all()
        return jsonify({"ok": True, "items": [dict(row) for row in rows]})
    except Exception as exc:
        logging.exception("despachos_links_count error: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 500


@despachos_bp.route("/despachos/exists", methods=["GET"])
def despacho_existe():
    nro = normalize_despacho(request.args.get("despacho") or "")
    if not nro:
        return jsonify({"exists": False})
    exists = (
        db.session.query(DespachoResumen.ID)
        .filter(func.replace(func.upper(func.ltrim(func.rtrim(DespachoResumen.Despacho))), " ", "") == nro)
        .first()
        is not None
    )
    return jsonify({"exists": exists})


@despachos_bp.route("/tipos-gasto", methods=["GET"])
def obtener_tipos_gasto():
    try:
        tipos = TipoGasto.query.all()
        return jsonify([{"IdGasto": t.IdGasto, "TipoGasto": t.TipoGasto} for t in tipos])
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@despachos_bp.route("/despachos", methods=["GET"])
def obtener_despachos():
    try:
        despachos = DespachoResumen.query.all()
        return jsonify([serializar_despacho(d) for d in despachos])
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@despachos_bp.get("/despachos/search")
def search_despachos():
    try:
        query = (request.args.get("q") or "").strip().upper()
        if not query:
            return jsonify({"items": []})
        rows = (
            db.session.query(DespachoResumen.ID, DespachoResumen.Despacho)
            .filter(func.upper(DespachoResumen.Despacho).like(f"%{query}%"))
            .order_by(DespachoResumen.Despacho)
            .limit(20)
            .all()
        )
        return jsonify({"items": [{"ID": row.ID, "Despacho": row.Despacho} for row in rows]})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@despachos_bp.route("/despachos", methods=["POST"])
def crear_despacho():
    try:
        datos = request.form if request.form else (request.get_json(silent=True) or {})
        archivo = request.files.get("documento")

        nro = normalize_despacho(datos.get("Despacho"))
        if not nro:
            return jsonify({"error": "El campo 'Despacho' es obligatorio."}), 400

        tipo = (datos.get("TipoDespacho") or "").strip().upper()
        if tipo not in _tipos_validos():
            return jsonify({"error": "TipoDespacho inválido. Use ZFI/ZFE/IC04/IC05"}), 400

        oc_ids, _ = _extract_oc_ids(datos)
        fallback_oc = (datos.get("OC_ID") or datos.get("oc_id") or "").strip()
        if not oc_ids and fallback_oc:
            oc_ids = [fallback_oc]
        if not oc_ids:
            return jsonify({"error": "OC_ID es obligatorio."}), 400
        for oc_id in oc_ids:
            if not oc_existe_en_asignador(oc_id):
                return jsonify({"error": f"OC_ID inexistente en Asignador: {oc_id}"}), 404
        primary_oc_id = oc_ids[0]

        # Referencia opcional (complemento del OC_ID)
        referencia = (datos.get("Referencia") or datos.get("referencia") or "").strip() or None

        exists = (
            db.session.query(DespachoResumen.ID)
            .filter(func.replace(DespachoResumen.Despacho, " ", "") == nro)
            .first()
        )
        if exists:
            return jsonify({"error": "El despacho ya existe.", "exists": True, "id": exists.ID}), 409

        uploaded = None
        if archivo:
            site_id, drive_id = _site_ids()
            if not site_id or not drive_id:
                return jsonify(
                    {"error": "No se pudo conectar a SharePoint. Verifique las credenciales y permisos en el servidor."}
                ), 500
            file_bytes = archivo.read()
            url = (
                f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives/{drive_id}"
                f"/root:/Despachos/{archivo.filename}:/content"
            )
            uploaded = graph_put(url, file_bytes)

        arancel_str = datos.get("Arancel_Sim_Impo") or datos.get("Arancel")

        nuevo = DespachoResumen(
            Despacho=nro,
            Fecha=datetime.datetime.strptime(datos.get("Fecha"), "%Y-%m-%d").date() if datos.get("Fecha") else None,
            FOB=parse_float(datos.get("FOB")),
            Estadistica=parse_float(datos.get("Estadistica")),
            Derechos_Importacion=parse_float(datos.get("Derechos_Importacion")),
            Tipo_Cambio=parse_float(datos.get("Tipo_Cambio")),
            Arancel=parse_float(arancel_str),
            DocUrl=(uploaded or {}).get("webUrl"),
            DocName=archivo.filename if archivo else None,
            HasDoc=bool(uploaded),
            OC_ID=primary_oc_id,
            TipoDespacho=(tipo[:10] or None),
            Referencia=referencia,
        )
        db.session.add(nuevo)
        db.session.flush()
        _replace_despacho_oc_links(nuevo.ID, oc_ids)
        db.session.commit()

        autoload = None
        if tipo == "ZFI" and primary_oc_id:
            try:
                imported = import_zfi_lines_from_oc_service(nuevo.ID, primary_oc_id)
                autoload = {"ok": True, "imported": imported}
            except Exception as exc:
                logging.exception("Auto-import ZFI desde OC falló: %s", exc)
                autoload = {"ok": False, "error": str(exc)}

        response_payload = {"mensaje": "Despacho creado con éxito", "id": nuevo.ID}
        if autoload is not None:
            response_payload["zfi_autoload"] = autoload
        return jsonify(response_payload), 201

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al crear el despacho: {exc}"}), 500


@despachos_bp.route("/despachos/<int:despacho_id>", methods=["GET"])
def obtener_despacho_por_id(despacho_id: int):
    try:
        despacho = DespachoResumen.query.get_or_404(despacho_id)
        data = serializar_despacho(despacho)
        oc_links = _get_oc_ids_for_despacho(despacho.ID)
        if not oc_links and despacho.OC_ID:
            oc_links = [despacho.OC_ID]
        data["oc_ids"] = oc_links
        return jsonify(data), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 404


@despachos_bp.route("/despachos/<int:despacho_id>", methods=["PUT"])
def actualizar_despacho(despacho_id: int):
    try:
        datos = request.form if request.form else (request.get_json(silent=True) or {})
        archivo = request.files.get("documento")
        despacho = DespachoResumen.query.get_or_404(despacho_id)

        nro = normalize_despacho(datos.get("Despacho") or despacho.Despacho)
        tipo = (datos.get("TipoDespacho") or despacho.TipoDespacho or "").strip().upper()
        if tipo not in _tipos_validos():
            return jsonify({"error": "TipoDespacho inválido."}), 400
        oc_ids, oc_ids_provided = _extract_oc_ids(datos)
        if oc_ids_provided:
            for oc_id in oc_ids:
                if not oc_existe_en_asignador(oc_id):
                    return jsonify({"error": f"OC_ID inexistente en Asignador: {oc_id}"}), 404

        if archivo:
            site_id, drive_id = _site_ids()
            if not site_id or not drive_id:
                return jsonify({"error": "No se pudo conectar a SharePoint"}), 500
            file_bytes = archivo.read()
            sp_path = f"/Despachos/{archivo.filename}"
            url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives/{drive_id}/root:{sp_path}:/content"
            uploaded = graph_put(url, file_bytes)
            despacho.DocUrl = uploaded.get("webUrl")
            despacho.DocName = archivo.filename
            despacho.HasDoc = True

        if datos.get("Fecha"):
            try:
                despacho.Fecha = datetime.datetime.strptime(datos["Fecha"], "%Y-%m-%d").date()
            except Exception:
                pass
        despacho.Despacho = nro
        despacho.TipoDespacho = tipo
        despacho.FOB = parse_float(datos.get("FOB")) if "FOB" in datos else despacho.FOB
        despacho.Flete_Internacional = (
            parse_float(datos.get("Flete_Internacional")) if "Flete_Internacional" in datos else despacho.Flete_Internacional
        )
        despacho.Estadistica = parse_float(datos.get("Estadistica")) if "Estadistica" in datos else despacho.Estadistica
        despacho.Derechos_Importacion = (
            parse_float(datos.get("Derechos_Importacion")) if "Derechos_Importacion" in datos else despacho.Derechos_Importacion
        )
        despacho.Despachante = parse_float(datos.get("Despachante")) if "Despachante" in datos else despacho.Despachante
        despacho.Almacenaje = parse_float(datos.get("Almacenaje")) if "Almacenaje" in datos else despacho.Almacenaje
        despacho.Custodia = parse_float(datos.get("Custodia")) if "Custodia" in datos else despacho.Custodia
        despacho.Tipo_Cambio = parse_float(datos.get("Tipo_Cambio")) if "Tipo_Cambio" in datos else despacho.Tipo_Cambio
        despacho.Flete_Nacional = parse_float(datos.get("Flete_Nacional")) if "Flete_Nacional" in datos else despacho.Flete_Nacional
        despacho.Arancel = parse_float(datos.get("Arancel") or datos.get("Arancel_Sim_Impo")) if (
            "Arancel" in datos or "Arancel_Sim_Impo" in datos
        ) else despacho.Arancel

        # Actualizar Referencia si viene en el payload
        if "Referencia" in datos or "referencia" in datos:
            ref_val = (datos.get("Referencia") or datos.get("referencia") or "").strip()
            despacho.Referencia = ref_val or None

        if oc_ids_provided:
            _replace_despacho_oc_links(despacho.ID, oc_ids)
            despacho.OC_ID = oc_ids[0] if oc_ids else None
        elif "OC_ID" in datos or "oc_id" in datos:
            fallback_oc = (datos.get("OC_ID") or datos.get("oc_id") or "").strip()
            if fallback_oc or fallback_oc == "":
                despacho.OC_ID = fallback_oc or None

        db.session.commit()

        return jsonify({"mensaje": "Despacho actualizado con éxito"}), 200

    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al actualizar el despacho: {exc}"}), 500


@despachos_bp.route("/despachos/list", methods=["GET"])
def obtener_lista_despachos():
    try:
        despachos = (
            db.session.query(
                DespachoResumen.ID,
                DespachoResumen.Despacho,
                DespachoResumen.TipoDespacho,
                DespachoResumen.OC_ID,
                DespachoResumen.Referencia,
                DespachoResumen.Fecha,
            )
            .order_by(DespachoResumen.Fecha.desc())
            .all()
        )
        return jsonify(
            [
                {
                    "ID": row.ID,
                    "Despacho": row.Despacho,
                    "TipoDespacho": row.TipoDespacho,
                    "OC_ID": row.OC_ID,
                    "Referencia": row.Referencia,
                    "Fecha": row.Fecha.isoformat() if row.Fecha else None,
                }
                for row in despachos
            ]
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@despachos_bp.get("/despachos/<string:nro>/resumen-gasto")
def get_resumen_gasto(nro: str):
    nro_norm = normalize_despacho(nro)
    sql = text(
        """
        SELECT
            rg.TipoGastoId,
            tg.TipoGasto,
            rg.Total
        FROM dbo.App_Despachos_ResumenGasto rg
        LEFT JOIN dbo.TipoGastosBI tg ON tg.IdGasto = rg.TipoGastoId
        WHERE REPLACE(UPPER(LTRIM(RTRIM(rg.NroDespacho))), ' ', '') = :nro
        ORDER BY tg.TipoGasto
        """
    )
    rows = db.session.execute(sql, {"nro": nro_norm}).mappings().all()
    resumen = [
        {"TipoGastoId": row["TipoGastoId"], "TipoGasto": row["TipoGasto"], "Total": float(row["Total"] or 0)} for row in rows
    ]
    return jsonify({"nro": nro_norm, "items": resumen})


@despachos_bp.post("/despachos/<string:nro>/recalc")
def recalc_un_despacho(nro: str):
    nro_norm = normalize_despacho(nro)
    sp_upsert_resumen_gasto(nro_norm)
    sp_sync_resumen_ancho(nro_norm)
    return jsonify({"ok": True, "nro": nro_norm})


@despachos_bp.post("/resumen/rebuild")
def rebuild_global():
    sp_rebuild_resumen_gasto_todos()
    sp_sync_resumen_ancho_todos()
    return jsonify({"ok": True})


@despachos_bp.get("/despachos/<string:nro>/facturas")
def get_facturas_por_despacho(nro: str):
    nro_norm = normalize_despacho(nro)
    sql = text(
        """
        SELECT
            f.ID,
            f.Fecha,
            f.Proveedor,
            f.nroFactura,
            f.Invoice,
            f.Moneda,
            f.Importe,
            f.DocUrl,
            f.DocName,
            f.HasDoc,
            fd.despacho_id,
            dr.Despacho AS DespachoRegistro
        FROM dbo.Factura_Despacho fd
        JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
        JOIN dbo.APP_Despachos_Resumen dr ON dr.ID = fd.despacho_id
        WHERE REPLACE(UPPER(LTRIM(RTRIM(dr.Despacho))), ' ', '') = :nro
        ORDER BY f.Fecha DESC, f.ID DESC
        """
    )
    rows = db.session.execute(sql, {"nro": nro_norm}).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "ID": row["ID"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
                "Proveedor": row["Proveedor"],
                "nroFactura": row["nroFactura"],
                "Invoice": row["Invoice"],
                "Moneda": row["Moneda"],
                "Importe": float(row["Importe"] or 0),
                "DocUrl": row["DocUrl"],
                "DocName": row["DocName"],
                "HasDoc": bool(row["HasDoc"]),
                "despacho_id": row["despacho_id"],
                "DespachoRegistro": row["DespachoRegistro"],
            }
        )
    return jsonify({"ok": True, "items": items})


@despachos_bp.get("/despachos/<int:despacho_id>/facturas-linked")
def get_facturas_linked_por_despacho(despacho_id: int):
    rows = (
        db.session.query(
            FacturaDespacho.id,
            FacturaDespacho.factura_id,
            FacturaDespacho.created_at,
            FacturaDespacho.created_by,
            Factura.Despacho.label("FacturaDespacho"),
            Factura.Fecha,
            Factura.Proveedor,
            Factura.Importe,
        )
        .join(Factura, Factura.ID == FacturaDespacho.factura_id)
        .filter(FacturaDespacho.despacho_id == despacho_id)
        .order_by(FacturaDespacho.created_at.desc())
        .all()
    )
    items = []
    for row in rows:
        items.append(
            {
                "id": row.id,
                "factura_id": row.factura_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "created_by": row.created_by,
                "FacturaDespacho": row.FacturaDespacho,
                "Fecha": row.Fecha.isoformat() if row.Fecha else None,
                "Proveedor": row.Proveedor,
                "Importe": float(row.Importe or 0),
            }
        )
    return jsonify({"ok": True, "items": items})
