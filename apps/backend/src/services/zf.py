"""Helpers for ZF workflows (inventario/movimientos)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import text

from ..extensions import db, engine_asignador
from ..models import DespachoResumen, ZFGrupo, ZFVinculo
from ..utils.parsing import normalize_despacho


def ensure_zfi(despacho: Optional[DespachoResumen]) -> None:
    if not despacho or (despacho.TipoDespacho or "").upper() != "ZFI":
        raise ValueError("El ID indicado no corresponde a un ZFI.")


def ensure_zfe(despacho: Optional[DespachoResumen]) -> None:
    if not despacho or (despacho.TipoDespacho or "").upper() != "ZFE":
        raise ValueError("El ID indicado no corresponde a un ZFE.")


def zf_grupo_to_json(grupo: Optional[ZFGrupo], include_items: bool = True) -> Optional[Dict[str, Any]]:
    if not grupo:
        return None
    zfi = DespachoResumen.query.get(grupo.ZFI_ID)
    payload: Dict[str, Any] = {
        "ZF_GroupID": grupo.ZF_GroupID,
        "OC_ID": grupo.OC_ID,
        "ZFI": {
            "ZFI_ID": grupo.ZFI_ID,
            "Despacho": zfi.Despacho if zfi else None,
            "Fecha": zfi.Fecha.isoformat() if (zfi and zfi.Fecha) else None,
        },
    }
    if include_items:
        rows = (
            db.session.query(ZFVinculo.ZFE_ID, DespachoResumen.Despacho, DespachoResumen.Fecha)
            .join(DespachoResumen, DespachoResumen.ID == ZFVinculo.ZFE_ID)
            .filter(ZFVinculo.ZF_GroupID == grupo.ZF_GroupID)
            .all()
        )
        payload["ZFEs"] = [
            {
                "ZFE_ID": row.ZFE_ID,
                "Despacho": row.Despacho,
                "Fecha": row.Fecha.isoformat() if row.Fecha else None,
            }
            for row in rows
        ]
        payload["ZFE_Count"] = len(payload["ZFEs"])
    return payload


def query_oc_lines(oc_id: str) -> List[Dict[str, Any]]:
    """
    Devuelve 1 fila por (SKU, Talle) con la cantidad consolidada de la OC indicada por REFERENCIA.
    """
    if engine_asignador is None:
        raise RuntimeError("engine_asignador not initialised")

    oc_id = (oc_id or "").strip()

    sql = text("""
        SELECT
            C.CODIGO                                           AS SKU,
            C.DESCRIPCION                                      AS Descripcion,
            COALESCE(NULLIF(LTRIM(RTRIM(TAO.CODIGO)), ''), '') AS Talle,
            CAST(SUM(F.CANTIDAD) AS int)                       AS Cantidad
        FROM dbo.ERP_ORDENES_COMPRA              AS A
        JOIN dbo.ERP_ORDENES_COMPRA_ARTICULOS    AS B
             ON B.ORDEN_COMPRA_ID = A.ORDEN_COMPRA_ID
        JOIN dbo.ERP_ORDENES_COMPRA_ARTICULOS_ITEMS AS F
             ON F.ORDEN_COMPRA_ARTICULO_ID = B.ORDEN_COMPRA_ARTICULO_ID
        JOIN dbo.ERP_ARTICULOS                   AS C
             ON C.ARTICULO_ID = B.ARTICULO_ID
        LEFT JOIN dbo.ERP_ARTICULOS_ITEMS        AS AI
             ON AI.ARTICULO_ID = C.ARTICULO_ID
            AND AI.ARTICULO_ITEM_ID = F.ARTICULO_ITEM_ID       -- evita multiplicar talles
        LEFT JOIN dbo.ERP_TALLES_ARTICULOS_OPCIONES AS TAO
             ON TAO.TALLE_ARTICULO_OPCION_ID = AI.TALLE_ARTICULO_OPCION_ID
        WHERE A.REFERENCIA = :oc_id
          AND (A.ESTADO IS NULL OR A.ESTADO <> 'ANULADA')
        GROUP BY
            C.CODIGO,
            COALESCE(NULLIF(LTRIM(RTRIM(TAO.CODIGO)), ''), ''),
            C.DESCRIPCION
        ORDER BY C.CODIGO, COALESCE(NULLIF(LTRIM(RTRIM(TAO.CODIGO)), ''), '');
    """)

    with engine_asignador.begin() as conn:
        rows = conn.execute(sql, {"oc_id": oc_id}).mappings().all()

    return [
        {
            "SKU":           row["SKU"],
            "Descripcion":   row["Descripcion"],
            "Talle":         (row["Talle"] or "").strip(),
            "Cantidad":      int(row["Cantidad"] or 0),
        }
        for row in rows
    ]


def import_zfi_lines_from_oc(zfi_id: int, oc_id: str) -> int:
    """
    Reemplaza las líneas del ZFI indicado con las que provienen de la OC dada.
    Devuelve la cantidad de líneas insertadas.
    """
    despacho = DespachoResumen.query.get(zfi_id)
    ensure_zfi(despacho)

    oc_value = (oc_id or "").strip()
    if not oc_value:
        raise ValueError("OC_ID requerido")

    if not oc_existe_en_asignador(oc_value):
        raise ValueError(f"OC_ID inexistente en Asignador: {oc_value}")

    items = query_oc_lines(oc_value)

    db.session.execute(text("DELETE FROM dbo.ZF_ZFI_Lines WHERE ZFI_ID = :zfi"), {"zfi": zfi_id})

    for item in items:
        db.session.execute(
            text(
                """
                INSERT INTO dbo.ZF_ZFI_Lines (ZFI_ID, SKU, Talle, Descripcion, Cantidad)
                VALUES (:zfi, :sku, :talle, :descripcion, :cantidad)
                """
            ),
            {
                "zfi": zfi_id,
                "sku": item["SKU"],
                "talle": item.get("Talle") or "",
                "descripcion": item.get("Descripcion") or "",
                "cantidad": int(item.get("Cantidad") or 0),
            },
        )

    db.session.commit()
    return len(items)



def oc_existe_en_asignador(oc_id: str) -> bool:
    if engine_asignador is None:
        raise RuntimeError("engine_asignador not initialised")
    sql = text(
        """
        SELECT 1
        FROM dbo.ERP_ORDENES_COMPRA A
        WHERE A.REFERENCIA = :oc
        """
    )
    with engine_asignador.connect() as conn:
        return conn.execute(sql, {"oc": oc_id}).first() is not None


__all__ = [
    "ensure_zfe",
    "ensure_zfi",
    "import_zfi_lines_from_oc",
    "oc_existe_en_asignador",
    "query_oc_lines",
    "zf_grupo_to_json",
]
