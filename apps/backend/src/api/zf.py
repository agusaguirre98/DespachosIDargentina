"""Endpoints for ZF inventory and movement workflows."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from flask import Blueprint, jsonify, request
from sqlalchemy import bindparam, func, text

from .. import extensions as ext
eng = ext.init_engine_asignador()
from ..extensions import db
from ..models import DespachoResumen, ZFGrupo, ZFVinculo
from ..services.zf import (
    ensure_zfe,
    ensure_zfi,
    import_zfi_lines_from_oc as import_zfi_lines_from_oc_service,
    oc_existe_en_asignador,
    query_oc_lines,
    zf_grupo_to_json,
)

zf_bp = Blueprint("zf", __name__, url_prefix="/zf")


@zf_bp.get("/grupos")
def zf_grupos():
    oc_id = (request.args.get("oc_id") or "").strip()
    params = {}
    where = ""
    if oc_id:
        where = "WHERE UPPER(LTRIM(RTRIM(dzfi.OC_ID))) = UPPER(LTRIM(RTRIM(:oc_id)))"
        params["oc_id"] = oc_id

    sql_grupos = f"""
    SELECT
      g.ZF_GroupID,
      g.ZFI_ID,
      dzfi.Despacho               AS ZFI_Despacho,
      CAST(dzfi.Fecha AS date)    AS ZFI_Fecha,
      dzfi.OC_ID
    FROM dbo.ZF_Grupo AS g
    JOIN dbo.APP_Despachos_Resumen AS dzfi
      ON dzfi.ID = g.ZFI_ID
    {where}
    ORDER BY g.ZF_GroupID;
    """
    grupos = [dict(row) for row in db.session.execute(text(sql_grupos), params).mappings().all()]
    if not grupos:
        return jsonify(ok=True, items=[])

    zfi_ids = [g["ZFI_ID"] for g in grupos]

    if len(zfi_ids) == 1:
        sql_zfes = text(
            """
            SELECT DISTINCT
              l.ZFI_ID,
              zfe.ID            AS ZFE_ID,
              zfe.Despacho      AS Despacho,
              CAST(zfe.Fecha AS date) AS Fecha
            FROM dbo.ZF_ZFE_Lines AS l
            JOIN dbo.APP_Despachos_Resumen AS zfe
              ON zfe.ID = l.ZFE_ID
            WHERE l.ZFI_ID = :id
            ORDER BY zfe.Fecha DESC, zfe.Despacho;
            """
        )
        zfe_rows = [dict(row) for row in db.session.execute(sql_zfes, {"id": zfi_ids[0]}).mappings().all()]
    else:
        sql_zfes = text(
            """
            SELECT DISTINCT
              l.ZFI_ID,
              zfe.ID            AS ZFE_ID,
              zfe.Despacho      AS Despacho,
              CAST(zfe.Fecha AS date) AS Fecha
            FROM dbo.ZF_ZFE_Lines AS l
            JOIN dbo.APP_Despachos_Resumen AS zfe
              ON zfe.ID = l.ZFE_ID
            WHERE l.ZFI_ID IN :ids
            ORDER BY zfe.Fecha DESC, zfe.Despacho;
            """
        ).bindparams(bindparam("ids", expanding=True))
        zfe_rows = [dict(row) for row in db.session.execute(sql_zfes, {"ids": list(zfi_ids)}).mappings().all()]

    by_zfi: Dict[int, List[Dict[str, Optional[str]]]] = {}
    for row in zfe_rows:
        by_zfi.setdefault(row["ZFI_ID"], []).append(
            {
                "ZFE_ID": row["ZFE_ID"],
                "Despacho": row["Despacho"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
            }
        )

    items = []
    for grupo in grupos:
        items.append(
            {
                "ZF_GroupID": grupo["ZF_GroupID"],
                "OC_ID": grupo["OC_ID"],
                "ZFI": {
                    "ZFI_ID": grupo["ZFI_ID"],
                    "Despacho": grupo["ZFI_Despacho"],
                    "Fecha": grupo["ZFI_Fecha"].isoformat() if grupo["ZFI_Fecha"] else None,
                },
                "ZFEs": by_zfi.get(grupo["ZFI_ID"], []),
            }
        )

    return jsonify(ok=True, items=items)


@zf_bp.get("/zfis")
def zf_list_zfis():
    oc_id = (request.args.get("oc_id") or "").strip()
    try:
        sql = """
        SELECT d.ID AS ZFI_ID, d.Despacho, d.Fecha
        FROM dbo.APP_Despachos_Resumen d
        WHERE UPPER(LTRIM(RTRIM(d.TipoDespacho))) = 'ZFI'
          AND (:oc = '' OR d.OC_ID = :oc)
        ORDER BY d.Fecha DESC, d.ID DESC
        """
        rows = db.session.execute(text(sql), {"oc": oc_id}).mappings().all()
        items = [
            {
                "ZFI_ID": row["ZFI_ID"],
                "Despacho": row["Despacho"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
            }
            for row in rows
        ]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logging.exception("zf_list_zfis")
        return jsonify({"ok": False, "error": str(exc)}), 500


@zf_bp.post("/grupos")
def zf_create_group():
    try:
        data = request.get_json(silent=True) or {}
        zfi_id = int(data.get("ZFI_ID") or 0)
        oc_id = (data.get("OC_ID") or "").strip()
        user = "api"

        if not zfi_id:
            return jsonify({"ok": False, "error": "ZFI_ID requerido"}), 400

        row = db.session.execute(
            text(
                """
            SELECT ID, OC_ID, TipoDespacho
            FROM dbo.APP_Despachos_Resumen
            WHERE ID = :id
            """
            ),
            {"id": zfi_id},
        ).mappings().first()
        if not row or (row["TipoDespacho"] or "").upper() != "ZFI":
            return jsonify({"ok": False, "error": "El despacho indicado no es un ZFI"}), 400

        if oc_id and oc_id != (row["OC_ID"] or ""):
            return jsonify({"ok": False, "error": "El OC_ID no coincide con el ZFI indicado"}), 400

        existing = db.session.execute(
            text("SELECT ZF_GroupID FROM dbo.ZF_Grupo WHERE ZFI_ID = :zfi_id"),
            {"zfi_id": zfi_id},
        ).first()
        if existing:
            return jsonify({"ok": False, "error": "El ZFI ya tiene un grupo asignado."}), 409

        db.session.execute(
            text(
                """
            INSERT INTO dbo.ZF_Grupo (ZFI_ID, OC_ID, CreatedBy)
            VALUES (:zfi, :oc, :user)
            """
            ),
            {"zfi": zfi_id, "oc": row["OC_ID"], "user": user},
        )
        db.session.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500


@zf_bp.post("/grupos/<int:group_id>/items")
def zf_attach_zfe(group_id: int):
    data = request.get_json(silent=True) or {}
    zfe_id = int(data.get("ZFE_ID") or 0)
    user = "api"

    grupo = ZFGrupo.query.get_or_404(group_id)
    ensure_zfi(DespachoResumen.query.get(grupo.ZFI_ID))

    zfe = DespachoResumen.query.get_or_404(zfe_id)
    ensure_zfe(zfe)

    existing = (
        db.session.query(ZFVinculo)
        .filter(ZFVinculo.ZF_GroupID == group_id, ZFVinculo.ZFE_ID == zfe_id)
        .first()
    )
    if existing:
        return jsonify({"ok": False, "error": "El ZFE ya está vinculado a este grupo."}), 409

    db.session.add(ZFVinculo(ZF_GroupID=group_id, ZFE_ID=zfe_id, CreatedBy=user))
    db.session.commit()
    return jsonify({"ok": True, "group": zf_grupo_to_json(grupo)})


@zf_bp.get("/zfi/<int:zfi_id>/lines")
def zfi_lines(zfi_id: int):
    sql = """
    SELECT
        l.ZFI_LINEID,
        l.SKU,
        l.Talle,
        l.Descripcion,
        l.Cantidad
    FROM dbo.ZF_ZFI_Lines l
    WHERE l.ZFI_ID = :zfi
    ORDER BY l.SKU, l.Talle;
    """
    rows = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().all()
    items = [dict(r) for r in rows]
    return jsonify({"ok": True, "items": items})



@zf_bp.post("/zfi/<int:zfi_id>/import-from-oc")
def import_zfi_lines_from_oc(zfi_id: int):
    # Acepta oc_id en query (?oc_id=...), en body {"oc_id": "..."} o {"OC_ID": "..."}
    data = request.get_json(silent=True) or {}
    oc_id = (
        (request.args.get("oc_id") or "").strip()
        or (data.get("oc_id") or data.get("OC_ID") or "").strip()
    )

    if not oc_id:
        return jsonify({"ok": False, "error": "OC_ID requerido"}), 400

    try:
        imported = import_zfi_lines_from_oc_service(zfi_id, oc_id)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        logging.exception("Error importing ZFI lines from OC: %s", exc)
        return jsonify({"ok": False, "error": "No se pudo importar desde la OC."}), 500

    return jsonify({"ok": True, "imported": imported})

@zf_bp.get("/zfi/<int:zfi_id>/summary")
def zfi_summary(zfi_id: int):
    sql = """
    SELECT
        SUM(CAST(l.Cantidad AS float)) AS TotalCantidad,
        SUM(CAST(l.CostoTotal AS float)) AS TotalCosto
    FROM dbo.ZF_ZFI_Lines l
    WHERE l.ZFI_ID = :zfi
    """
    row = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().first()
    return jsonify(
        {
            "ok": True,
            "totalCantidad": float(row["TotalCantidad"] or 0),
            "totalCosto": float(row["TotalCosto"] or 0),
        }
    )


@zf_bp.get("/zfe/<int:zfe_id>/lines")
def get_zfe_lines(zfe_id: int):
    sql = """
    SELECT
        l.ID,
        l.ZF_GroupID,
        l.ZFI_ID,
        l.ZFE_ID,
        l.SKU,
        l.Talle,
        l.Descripcion,
        l.CantidadRetiro
    FROM dbo.ZF_ZFE_Lines l
    WHERE l.ZFE_ID = :zfe
    ORDER BY l.SKU, l.Talle;
    """
    rows = db.session.execute(text(sql), {"zfe": zfe_id}).mappings().all()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


@zf_bp.post("/zfe/<int:zfe_id>/lines")
def save_zfe_lines(zfe_id: int):
    data = request.get_json(silent=True) or {}
    items: List[Dict[str, object]] = data.get("items") or []
    user = data.get("user") or "api"

    zfe = DespachoResumen.query.get_or_404(zfe_id)
    ensure_zfe(zfe)

    group_id = int(data.get("ZF_GroupID") or 0)
    if group_id:
        grupo = ZFGrupo.query.get(group_id)
        if not grupo:
            return jsonify({"ok": False, "error": "ZF_GroupID inexistente."}), 400
        if grupo.ZFI_ID != (data.get("ZFI_ID") or grupo.ZFI_ID):
            return jsonify({"ok": False, "error": "El grupo no corresponde al ZFI indicado."}), 400

    db.session.execute(text("DELETE FROM dbo.ZF_ZFE_Lines WHERE ZFE_ID = :zfe"), {"zfe": zfe_id})

    for item in items:
        db.session.execute(
            text(
                """
            INSERT INTO dbo.ZF_ZFE_Lines
              (ZFE_ID, ZF_GroupID, ZFI_ID, SKU, Talle, Descripcion, CantidadRetiro, CreatedBy)
            VALUES
              (:zfe, :group, :zfi, :sku, :talle, :descripcion, :cantidad, :user)
            """
            ),
            {
                "zfe": zfe_id,
                "group": group_id or item.get("ZF_GroupID"),
                "zfi": item.get("ZFI_ID"),
                "sku": item.get("SKU"),
                "talle": item.get("Talle"),
                "descripcion": item.get("Descripcion"),
                "cantidad": item.get("CantidadRetiro"),
                "user": user,
            },
        )
    db.session.commit()
    return jsonify({"ok": True})


@zf_bp.get("/zfi/<int:zfi_id>/saldo")
def zfi_saldo(zfi_id: int):
    sql = """
    SELECT
        SUM(CAST(Cantidad AS float)) AS Ingresado
    FROM dbo.ZF_ZFI_Lines
    WHERE ZFI_ID = :zfi
    """
    ingreso = db.session.execute(text(sql), {"zfi": zfi_id}).scalar() or 0

    sql_retiro = """
    SELECT
        SUM(CAST(CantidadRetiro AS float)) AS Retirado
    FROM dbo.ZF_ZFE_Lines
    WHERE ZFI_ID = :zfi
    """
    retiro = db.session.execute(text(sql_retiro), {"zfi": zfi_id}).scalar() or 0

    return jsonify({"ok": True, "ingresado": float(ingreso), "retirado": float(retiro), "saldo": float(ingreso - retiro)})


@zf_bp.get("/inventario")
def zf_inventario():
    sql = """
    SELECT
        zfi.ZFI_ID,
        dzfi.Despacho,
        dzfi.OC_ID,
        dzfi.Fecha,
        SUM(CAST(zfi.Cantidad AS float)) AS Ingresado
    FROM dbo.ZF_ZFI_Lines zfi
    JOIN dbo.APP_Despachos_Resumen dzfi ON dzfi.ID = zfi.ZFI_ID
    GROUP BY zfi.ZFI_ID, dzfi.Despacho, dzfi.OC_ID, dzfi.Fecha
    ORDER BY dzfi.Fecha DESC, dzfi.Despacho;
    """
    rows = db.session.execute(text(sql)).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "ZFI_ID": row["ZFI_ID"],
                "Despacho": row["Despacho"],
                "OC_ID": row["OC_ID"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
                "Ingresado": float(row["Ingresado"] or 0),
            }
        )
    return jsonify({"ok": True, "items": items})


@zf_bp.get("/movimientos")
def zf_movimientos():
    sql = """
    SELECT
        rr.ZFE_ID,
        zfe.Despacho                           AS DespachoZFE,
        zfe.OC_ID,
        CAST(zfe.Fecha AS date)                AS Fecha,
        SUM(CAST(rr.CantidadRetiro AS float))  AS TotalRetirado,
        COUNT(*)                               AS Items,
        zfi.Despacho                           AS DespachoZFI
    FROM dbo.ZF_ZFE_Lines AS rr
    JOIN dbo.APP_Despachos_Resumen AS zfe
      ON zfe.ID = rr.ZFE_ID
    LEFT JOIN dbo.APP_Despachos_Resumen AS zfi      -- 👈 tomamos el ZFI por la FK que ya existe en las líneas
      ON zfi.ID = rr.ZFI_ID
    GROUP BY
        rr.ZFE_ID, zfe.Despacho, zfe.OC_ID, CAST(zfe.Fecha AS date), zfi.Despacho
    ORDER BY Fecha DESC, DespachoZFE;
    """
    rows = db.session.execute(text(sql)).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "ZFE_ID": row["ZFE_ID"],
                "Despacho": row["DespachoZFE"],
                "OC_ID": row["OC_ID"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
                "Items": int(row["Items"] or 0),
                "TotalRetirado": float(row["TotalRetirado"] or 0),
                "DespachoZFI": row["DespachoZFI"],  # puede ser None si alguna línea no tiene ZFI_ID
            }
        )
    return jsonify({"ok": True, "items": items})



@zf_bp.get("/zfi/<int:zfi_id>/detalle")
def zf_zfi_detalle(zfi_id: int):
    sql = """
    SELECT
        zfi.ID,
        zfi.ZF_GroupID,
        zfi.ZFI_ID,
        zfi.ZFE_ID,
        zfi.SKU,
        zfi.Talle,
        zfi.Descripcion,
        zfi.CantidadRetiro
    FROM dbo.ZF_ZFE_Lines zfi
    WHERE zfi.ZFI_ID = :zfi
    ORDER BY zfi.SKU, zfi.Talle;
    """
    rows = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "ID": row["ID"],
                "ZF_GroupID": row["ZF_GroupID"],
                "ZFE_ID": row["ZFE_ID"],
                "SKU": row["SKU"],
                "Talle": row["Talle"],
                "Descripcion": row["Descripcion"],
                "CantidadRetiro": float(row["CantidadRetiro"] or 0),
            }
        )
    return jsonify({"ok": True, "items": items})


@zf_bp.get("/zfi/<int:zfi_id>/zfe")
def zf_zfi_zfes(zfi_id: int):
    sql = """
    SELECT DISTINCT
        zfe.ID            AS ZFE_ID,
        zfe.Despacho      AS Despacho,
        zfe.OC_ID,
        CAST(zfe.Fecha AS date) AS Fecha
    FROM dbo.ZF_ZFE_Lines rl
    JOIN dbo.APP_Despachos_Resumen zfe ON zfe.ID = rl.ZFE_ID
    WHERE rl.ZFI_ID = :zfi
    ORDER BY zfe.Fecha DESC, zfe.Despacho;
    """
    rows = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "ZFE_ID": row["ZFE_ID"],
                "Despacho": row["Despacho"],
                "OC_ID": row["OC_ID"],
                "Fecha": row["Fecha"].isoformat() if row["Fecha"] else None,
            }
        )
    return jsonify({"ok": True, "items": items})


@zf_bp.get("/zfe/<int:zfe_id>/lines/detail")
def zf_zfe_lines(zfe_id: int):
    hdr_sql = """
    SELECT
        rl.ZF_GroupID,
        g.ZFI_ID,
        zfi.Despacho AS DespachoZFI,
        zfe.Despacho AS DespachoZFE,
        zfe.OC_ID,
        CAST(zfe.Fecha AS date) AS Fecha
    FROM dbo.ZF_ZFE_Lines rl
    JOIN dbo.ZF_Grupo g ON g.ZF_GroupID = rl.ZF_GroupID
    JOIN dbo.APP_Despachos_Resumen zfi ON zfi.ID = g.ZFI_ID
    JOIN dbo.APP_Despachos_Resumen zfe ON zfe.ID = rl.ZFE_ID
    WHERE rl.ZFE_ID = :zfe
    """
    header = db.session.execute(text(hdr_sql), {"zfe": zfe_id}).mappings().first()
    if not header:
        zfe_sql = """
        SELECT ID, Despacho, OC_ID, CAST(Fecha AS date) AS Fecha
        FROM dbo.APP_Despachos_Resumen
        WHERE ID = :zfe
        """
        zfe = db.session.execute(text(zfe_sql), {"zfe": zfe_id}).mappings().first()
        if not zfe:
            return jsonify(ok=False, error="ZFE no encontrado."), 404
        return jsonify(
            ok=True,
            header={
                "ZFE_ID": zfe["ID"],
                "DespachoZFE": zfe["Despacho"],
                "OC_ID": zfe["OC_ID"],
                "Fecha": zfe["Fecha"].isoformat() if zfe["Fecha"] else None,
                "ZFI_ID": None,
                "DespachoZFI": None,
                "ZF_GroupID": None,
            },
            items=[],
        )

    det_sql = """
    SELECT SKU, Talle, Descripcion, CantidadRetiro
    FROM dbo.ZF_ZFE_Lines
    WHERE ZFE_ID = :zfe
    ORDER BY SKU, Talle
    """
    items = db.session.execute(text(det_sql), {"zfe": zfe_id}).mappings().all()

    return jsonify(
        ok=True,
        header={
            "ZFE_ID": zfe_id,
            "ZF_GroupID": header["ZF_GroupID"],
            "ZFI_ID": header["ZFI_ID"],
            "DespachoZFI": header["DespachoZFI"],
            "DespachoZFE": header["DespachoZFE"],
            "OC_ID": header["OC_ID"],
            "Fecha": header["Fecha"].isoformat() if header["Fecha"] else None,
        },
        items=items,
    )


@zf_bp.get("/inventario/<int:zfi_id>/items")
def zf_inventario_items(zfi_id: int):
    sql = """
    ;WITH Ingr AS (
        SELECT
            l.ZFI_ID,
            l.SKU,
            l.Talle,
            l.Descripcion,
            SUM(l.Cantidad) AS Ingresado
        FROM dbo.ZF_ZFI_Lines AS l
        WHERE l.ZFI_ID = :zfi_id
        GROUP BY l.ZFI_ID, l.SKU, l.Talle, l.Descripcion
    ),
    Ret AS (
        SELECT
            r.ZFI_ID,
            r.SKU,
            r.Talle,
            SUM(r.CantidadRetiro) AS Retirado
        FROM dbo.ZF_ZFE_Lines AS r
        WHERE r.ZFI_ID = :zfi_id
        GROUP BY r.ZFI_ID, r.SKU, r.Talle
    )
    SELECT
        i.SKU,
        i.Talle,
        i.Descripcion,
        i.Ingresado,
        COALESCE(ret.Retirado, 0) AS Retirado,
        CASE
          WHEN i.Ingresado - COALESCE(ret.Retirado, 0) < 0 THEN 0
          ELSE i.Ingresado - COALESCE(ret.Retirado, 0)
        END AS CantidadActual
    FROM Ingr AS i
    LEFT JOIN Ret AS ret
      ON ret.ZFI_ID = i.ZFI_ID
     AND ret.SKU    = i.SKU
     AND ISNULL(ret.Talle,'') = ISNULL(i.Talle,'')
    ORDER BY i.SKU, i.Talle;
    """
    rows = db.session.execute(text(sql), {"zfi_id": zfi_id}).mappings().all()
    items = []
    for row in rows:
        items.append(
            {
                "SKU": row["SKU"],
                "Talle": row["Talle"],
                "Descripcion": row["Descripcion"],
                "Ingresado": float(row["Ingresado"] or 0),
                "Retirado": float(row["Retirado"] or 0),
                "CantidadActual": float(row["CantidadActual"] or 0),
            }
        )
    return jsonify(ok=True, items=items)


@zf_bp.get("/movimientos/<int:zfe_id>/items")
def zf_movimientos_items(zfe_id: int):
    sql = """
    SELECT
      l.SKU,
      l.Talle,
      l.Descripcion,
      SUM(CAST(l.CantidadRetiro AS float)) AS Cantidad
    FROM dbo.ZF_ZFE_Lines AS l
    WHERE l.ZFE_ID = :zfe_id
    GROUP BY l.SKU, l.Talle, l.Descripcion
    ORDER BY l.SKU, l.Talle;
    """
    rows = db.session.execute(text(sql), {"zfe_id": zfe_id}).mappings().all()
    return jsonify(ok=True, items=[
        {
            "SKU": r["SKU"],
            "Talle": r["Talle"],
            "Descripcion": r["Descripcion"],
            "Cantidad": float(r["Cantidad"] or 0)
        }
        for r in rows
    ])
