# apps/backend/src/api/servicios.py

from __future__ import annotations

import os
from pathlib import Path
from decimal import Decimal, InvalidOperation

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import text

from .. import extensions as ext

bp = Blueprint("servicios", __name__, url_prefix="/api/servicios")

# Usamos el mismo engine "asignador" que en otros módulos
eng = ext.init_engine_asignador()


# ======== Helpers ========

def parse_decimal(value, field_name: str) -> Decimal:
    try:
        dec = Decimal(str(value).replace(",", "."))
        return dec
    except (InvalidOperation, TypeError):
        raise ValueError(f"Valor numérico inválido para {field_name}")


def get_upload_dir() -> Path:
    """
    Directorio donde se guardan los PDFs de facturas de servicio.
    Podés ajustar la ruta vía config: SERVICIOS_UPLOAD_DIR
    """
    base = current_app.config.get("SERVICIOS_UPLOAD_DIR")
    if not base:
        base = os.path.join(current_app.root_path, "..", "uploads", "servicios")
    path = Path(base).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_pdf_for_servicio(file_storage, serv_id: int) -> str:
    """
    Guarda el PDF en disco y devuelve una URL relativa o ruta.
    """
    upload_dir = get_upload_dir()
    filename = f"servicio_{serv_id}.pdf"
    full_path = upload_dir / filename
    file_storage.save(str(full_path))

    base_url = current_app.config.get("SERVICIOS_PUBLIC_BASE_URL", "/files/servicios")
    return f"{base_url.rstrip('/')}/{filename}"


# ======== 1) Crear factura de servicio ========

@bp.route("/facturas", methods=["POST"])
def crear_factura_servicio():
    try:
        form = request.form

        tipo = (form.get("TipoServicio") or "").strip().upper()
        proveedor = (form.get("Proveedor") or "").strip()
        nro = (form.get("NumeroFactura") or "").strip()
        fecha = (form.get("Fecha") or "").strip()
        desc = (form.get("Descripcion") or "").strip()

        if not tipo:
            return jsonify({"error": "El tipo de servicio es obligatorio."}), 400
        if not proveedor:
            return jsonify({"error": "El proveedor es obligatorio."}), 400
        if not nro:
            return jsonify({"error": "El número de factura es obligatorio."}), 400
        if not fecha:
            return jsonify({"error": "La fecha es obligatoria."}), 400

        cant = parse_decimal(form.get("CantidadTotal"), "CantidadTotal")
        imp = parse_decimal(form.get("ImporteTotal"), "ImporteTotal")

        if cant <= 0:
            return jsonify({"error": "La cantidad total debe ser mayor a 0."}), 400
        if imp <= 0:
            return jsonify({"error": "El importe total debe ser mayor a 0."}), 400

        pdf_file = request.files.get("pdf")

        usuario = getattr(request, "user", None)
        usuario_nombre = getattr(usuario, "name", None) if usuario else None

        with eng.begin() as conn:
            # Validamos que el tipo exista en SERV_TiposServicio y esté activo
            tipo_row = conn.execute(
                text("""
                    SELECT 1
                    FROM ordenes_comp.dbo.SERV_TiposServicio
                    WHERE Codigo = :cod AND Activo = 1
                """),
                {"cod": tipo},
            ).first()

            if not tipo_row:
                return jsonify({
                    "error": f"Tipo de servicio inválido: {tipo}",
                }), 400

            # Insertamos primero sin DocUrl

            insert_stmt = text("""
                INSERT INTO ordenes_comp.dbo.SERV_Facturas (
                    TipoServicio,
                    Proveedor,
                    NumeroFactura,
                    Fecha,
                    CantidadPagada,
                    CantidadAsignada,
                    ImporteTotal,
                    Descripcion,
                    HasDoc,
                    DocFileName,
                    DocUrl,
                    UsuarioAlta
                )
                OUTPUT INSERTED.ServID
                VALUES (
                    :tipo, :prov, :nro, :fecha,
                    :cant, 0, :imp,
                    :desc, 0, NULL, NULL,
                    :usuario
                );
            """)

            result = conn.execute(
                insert_stmt,
                {
                    "tipo": tipo,
                    "prov": proveedor,
                    "nro": nro,
                    "fecha": fecha,
                    "cant": cant,
                    "imp": imp,
                    "desc": desc or None,
                    "usuario": usuario_nombre,
                },
            )
            serv_id = int(result.fetchone()[0])

            if pdf_file:
                doc_url = save_pdf_for_servicio(pdf_file, serv_id)
                upd = text("""
                    UPDATE ordenes_comp.dbo.SERV_Facturas
                    SET HasDoc = 1,
                        DocFileName = :fname,
                        DocUrl = :url
                    WHERE ServID = :sid;
                """)
                conn.execute(
                    upd,
                    {"fname": pdf_file.filename, "url": doc_url, "sid": serv_id},
                )

            sel = text("""
                SELECT
                    ServID, TipoServicio, Proveedor, NumeroFactura, Fecha,
                    CantidadPagada AS CantidadTotal,
                    CantidadAsignada, CantidadDisponible,
                    ImporteTotal, CostoUnitario,
                    Descripcion, HasDoc, DocFileName, DocUrl, FechaAlta
                FROM ordenes_comp.dbo.SERV_Facturas
                WHERE ServID = :sid;
            """)

            nueva = conn.execute(sel, {"sid": serv_id}).mappings().first()

        return jsonify(dict(nueva)), 201

    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception:
        current_app.logger.exception("Error al crear factura de servicio")
        return jsonify({"error": "Error interno al crear la factura de servicio."}), 500


# ======== 2) Listado de facturas ========

@bp.route("/facturas", methods=["GET"])
def listar_facturas_servicio():
    tipo = (request.args.get("tipo") or "").strip().upper()
    con_saldo_raw = request.args.get("con_saldo") or request.args.get("conSaldo")

    con_saldo = None
    if con_saldo_raw is not None:
        con_saldo = con_saldo_raw.lower() in ("1", "true")

    try:
        with eng.connect() as conn:
            base_sql = """
                SELECT
                    ServID, TipoServicio, Proveedor, NumeroFactura, Fecha,
                    CantidadPagada AS CantidadTotal,
                    CantidadAsignada, CantidadDisponible,
                    ImporteTotal, CostoUnitario,
                    Descripcion, HasDoc, DocFileName, DocUrl, FechaAlta
                FROM ordenes_comp.dbo.SERV_Facturas
                WHERE 1 = 1
            """

            params = {}

            if tipo:
                base_sql += " AND TipoServicio = :tipo"
                params["tipo"] = tipo

            if con_saldo is True:
                base_sql += " AND CantidadDisponible > 0"
            elif con_saldo is False:
                base_sql += " AND CantidadDisponible <= 0"

            base_sql += " ORDER BY Fecha DESC, ServID DESC"

            rows = conn.execute(text(base_sql), params).mappings().all()

        return jsonify([dict(r) for r in rows])

    except Exception:
        current_app.logger.exception("Error al listar facturas de servicio")
        return jsonify({"error": "Error interno al listar facturas."}), 500


# ======== 3) Crear asignación de una factura a una OC ========

@bp.route("/asignaciones/oc", methods=["POST"])
def crear_asignacion_oc():
    data = request.get_json(silent=True) or {}

    try:
        serv_id = int(data.get("SERV_ID") or data.get("ServID") or 0)
    except:
        serv_id = 0

    oc_id = (data.get("OC_ID") or "").strip()
    cant_raw = data.get("CantidadAsignada")
    comentario = (data.get("Comentario") or "").strip()

    usuario = getattr(request, "user", None)
    usuario_nombre = getattr(usuario, "name", None) if usuario else None

    if not serv_id:
        return jsonify({"error": "SERV_ID es obligatorio."}), 400
    if not oc_id:
        return jsonify({"error": "OC_ID es obligatorio."}), 400

    cant = parse_decimal(cant_raw, "CantidadAsignada")
    if cant <= 0:
        return jsonify({"error": "La cantidad debe ser mayor a 0."}), 400

    try:
        with eng.begin() as conn:

            row = conn.execute(
                text("""
                    SELECT CantidadDisponible
                    FROM ordenes_comp.dbo.SERV_Facturas
                    WHERE ServID = :sid;
                """),
                {"sid": serv_id}
            ).first()

            if not row:
                return jsonify({"error": "Factura no encontrada."}), 404

            disponible = Decimal(row[0])
            if cant > disponible:
                return jsonify({"error": "Cantidad excede saldo disponible.", "disponible": float(disponible)}), 400

            conn.execute(
                text("""
                    INSERT INTO ordenes_comp.dbo.SERV_AsignacionesOC (
                        ServID, OC_ID, CantidadAsignada,
                        FechaAsignacion, UsuarioAsignacion, Notas
                    )
                    VALUES (:sid, :oc, :cant, GETDATE(), :usr, :notas);
                """),
                {"sid": serv_id, "oc": oc_id, "cant": cant, "usr": usuario_nombre, "notas": comentario or None},
            )

            conn.execute(
                text("""
                    UPDATE ordenes_comp.dbo.SERV_Facturas
                    SET CantidadAsignada = CantidadAsignada + :cant
                    WHERE ServID = :sid;
                """),
                {"cant": cant, "sid": serv_id}
            )

            factura = conn.execute(
                text("""
                    SELECT
                        ServID, TipoServicio, Proveedor, NumeroFactura, Fecha,
                        CantidadPagada AS CantidadTotal,
                        CantidadAsignada, CantidadDisponible,
                        ImporteTotal, CostoUnitario, Descripcion
                    FROM ordenes_comp.dbo.SERV_Facturas
                    WHERE ServID = :sid;
                """),
                {"sid": serv_id}
            ).mappings().first()

        return jsonify({"ok": True, "factura": dict(factura)}), 201

    except Exception:
        current_app.logger.exception("Error en asignación OC")
        return jsonify({"error": "Error interno."}), 500

# ======== 4) Tipos de Servicios ========


@bp.route("/tipos", methods=["GET"])
def listar_tipos_servicio():
    """
    GET /api/servicios/tipos

    Devuelve la lista de tipos de servicio activos:
    [
      { "codigo": "AVIOS", "descripcion": "Avíos" },
      ...
    ]
    """
    try:
        with eng.connect() as conn:
            rows = conn.execute(text("""
                SELECT
                    Codigo       AS codigo,
                    Descripcion  AS descripcion,
                    Activo       AS activo,
                    ISNULL(Orden, 9999) AS orden
                FROM ordenes_comp.dbo.SERV_TiposServicio
                WHERE Activo = 1
                ORDER BY orden, descripcion
            """)).mappings().all()

        return jsonify([dict(r) for r in rows])
    except Exception:
        current_app.logger.exception("Error al listar tipos de servicio")
        return jsonify({"error": "Error interno al listar tipos de servicio."}), 500



# ======== 5) Inventario de servicios ========

@bp.route("/inventario", methods=["GET"])
def inventario_servicios():
    try:
        with eng.connect() as conn:

            r_global = conn.execute(text("""
                SELECT
                    SUM(CantidadPagada)      AS totalPagado,
                    SUM(CantidadAsignada)    AS totalAsignado,
                    SUM(CantidadDisponible)  AS saldoDisponible
                FROM ordenes_comp.dbo.SERV_Facturas;
            """)).mappings().first() or {}

            resumen_global = {
                "totalPagado": float(r_global.get("totalPagado") or 0),
                "totalAsignado": float(r_global.get("totalAsignado") or 0),
                "saldoDisponible": float(r_global.get("saldoDisponible") or 0),
            }

            rows_tipo = conn.execute(text("""
                SELECT
                    TipoServicio AS tipo,
                    SUM(CantidadPagada) AS pagado,
                    SUM(CantidadAsignada) AS asignado,
                    SUM(CantidadDisponible) AS disponible
                FROM ordenes_comp.dbo.SERV_Facturas
                GROUP BY TipoServicio
                ORDER BY TipoServicio;
            """)).mappings().all()

            resumen_tipo = [
                {
                    "tipo": r["tipo"],
                    "pagado": float(r["pagado"] or 0),
                    "asignado": float(r["asignado"] or 0),
                    "disponible": float(r["disponible"] or 0),
                }
                for r in rows_tipo
            ]

            rows_fact = conn.execute(text("""
                SELECT TOP 10
                    ServID           AS servId,
                        TipoServicio     AS tipo,
                        Proveedor        AS proveedor,
                        NumeroFactura    AS numero,
                        Fecha            AS fecha,        -- 👈 alias en minúscula
                        CantidadPagada   AS pagado,
                        CantidadAsignada AS asignado
                    FROM ordenes_comp.dbo.SERV_Facturas
                    WHERE CantidadDisponible > 0
                    ORDER BY CantidadDisponible DESC, Fecha DESC;
                            """)).mappings().all()

            resumen_fact = [
                {
                    "servId": int(r["servId"]),
                        "tipo": r["tipo"],
                        "proveedor": r["proveedor"],
                        "numero": r["numero"],
                        "fecha": (
                            r["fecha"].isoformat()
                            if hasattr(r["fecha"], "isoformat")
                            else r["fecha"]
                        ),
                        "pagado": float(r["pagado"] or 0),
                        "asignado": float(r["asignado"] or 0),
                                }
                for r in rows_fact
            ]

            rows_oc = conn.execute(text("""
                SELECT
                    a.OC_ID AS ocId,
                    f.TipoServicio AS tipo,
                    SUM(a.CantidadAsignada) AS totalAsignado,
                    COUNT(DISTINCT a.ServID) AS facturasOrigen,
                    MAX(a.FechaAsignacion) AS ultimaFecha
                FROM ordenes_comp.dbo.SERV_AsignacionesOC a
                JOIN ordenes_comp.dbo.SERV_Facturas f ON f.ServID = a.ServID
                GROUP BY a.OC_ID, f.TipoServicio
                ORDER BY MAX(a.FechaAsignacion) DESC;
            """)).mappings().all()

            resumen_oc = [
                {
                    "ocId": r["ocId"],
                    "tipo": r["tipo"],
                    "totalAsignado": float(r["totalAsignado"] or 0),
                    "facturasOrigen": int(r["facturasOrigen"] or 0),
                    "ultimaFecha": r["ultimaFecha"].isoformat()
                        if hasattr(r["ultimaFecha"], "isoformat")
                        else r["ultimaFecha"],
                }
                for r in rows_oc
            ]

        return jsonify(
            {
                "resumenGlobal": resumen_global,
                "resumenPorTipo": resumen_tipo,
                "resumenPorFactura": resumen_fact,
                "resumenPorOC": resumen_oc,
            }
        )

    except Exception:
        current_app.logger.exception("Error inventario servicios")
        return jsonify({"error": "Error interno al obtener inventario."}), 500


# ======== Blueprint export ========
servicios_bp = bp
