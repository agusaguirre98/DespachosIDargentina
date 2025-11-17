"""Business helpers for despachos and facturas."""

from __future__ import annotations

import datetime
import json
from typing import Iterable, List, Tuple

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import DespachoResumen, Factura, FacturaDespacho
from ..utils.parsing import normalize_despacho

USE_RESUMEN_ANCHO: bool = True


def configure_resumen_ancho(enabled: bool) -> None:
    """Toggle whether the wide resumen table needs to stay in sync."""
    global USE_RESUMEN_ANCHO
    USE_RESUMEN_ANCHO = enabled


def parse_despachos_payload(datos) -> List[str]:
    """Normalize the despachos payload supporting different request formats."""
    if hasattr(datos, "getlist"):
        items = datos.getlist("Despachos") or datos.getlist("despachos")
        if items:
            if len(items) == 1 and isinstance(items[0], str) and items[0].strip().startswith("["):
                try:
                    return [x for x in json.loads(items[0]) if x]
                except Exception:
                    pass
            flattened: List[str] = []
            for element in items:
                if element is None:
                    continue
                if isinstance(element, str) and "," in element:
                    flattened.extend([p.strip() for p in element.split(",") if p.strip()])
                else:
                    flattened.append(element)
            if flattened:
                return flattened

    raw = datos.get("Despachos") or datos.get("despachos")
    if raw:
        if isinstance(raw, list):
            return [str(x).strip() for x in raw if str(x).strip()]
        if isinstance(raw, str):
            stripped = raw.strip()
            if stripped.startswith("["):
                try:
                    arr = json.loads(stripped)
                    return [str(x).strip() for x in arr if str(x).strip()]
                except Exception:
                    pass
            return [p.strip() for p in stripped.split(",") if p.strip()]

    single = datos.get("Despacho") or datos.get("despacho")
    return [single] if single else []


def resolve_despacho_ids(mixed_values: Iterable[str]) -> List[Tuple[int, str]]:
    """Translate potential despacho identifiers into (ID, normalised codigo) tuples."""
    found: List[Tuple[int, str]] = []
    for value in mixed_values:
        if value is None:
            continue
        string_value = str(value).strip()
        if not string_value:
            continue
        try:
            despacho_id = int(string_value)
            despacho = DespachoResumen.query.get(despacho_id)
            if despacho:
                found.append((despacho.ID, normalize_despacho(despacho.Despacho or "")))
                continue
        except Exception:
            pass

        code = normalize_despacho(string_value)
        despacho = DespachoResumen.query.filter(
            func.replace(func.upper(func.ltrim(func.rtrim(DespachoResumen.Despacho))), " ", "") == code
        ).first()
        if despacho:
            found.append((despacho.ID, normalize_despacho(despacho.Despacho or "")))

    unique: List[Tuple[int, str]] = []
    seen = set()
    for despacho_id, code in found:
        if despacho_id not in seen:
            unique.append((despacho_id, code))
            seen.add(despacho_id)
    return unique


def get_linked_despacho_ids(factura_id: int) -> List[int]:
    rows = (
        FacturaDespacho.query.with_entities(FacturaDespacho.despacho_id)
        .filter(FacturaDespacho.factura_id == factura_id)
        .all()
    )
    return [row[0] for row in rows]


def replace_links(factura_id: int, new_ids: Iterable[int]) -> None:
    current_ids = set(get_linked_despacho_ids(factura_id))
    target_ids = set(new_ids)
    to_delete = current_ids - target_ids
    to_add = target_ids - current_ids

    if to_delete:
        FacturaDespacho.query.filter(
            FacturaDespacho.factura_id == factura_id,
            FacturaDespacho.despacho_id.in_(list(to_delete)),
        ).delete(synchronize_session=False)

    for despacho_id in to_add:
        try:
            db.session.add(FacturaDespacho(factura_id=factura_id, despacho_id=despacho_id))
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
    db.session.commit()


def add_links(factura_id: int, more_ids: Iterable[int]) -> None:
    current_ids = set(get_linked_despacho_ids(factura_id))
    for despacho_id in more_ids:
        if despacho_id in current_ids:
            continue
        try:
            db.session.add(FacturaDespacho(factura_id=factura_id, despacho_id=despacho_id))
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
    db.session.commit()


def recalc_for_despacho_ids(despacho_ids: Iterable[int]) -> None:
    dispatcher_ids = list(despacho_ids)
    if not dispatcher_ids:
        return
    rows = (
        DespachoResumen.query.with_entities(DespachoResumen.Despacho)
        .filter(DespachoResumen.ID.in_(dispatcher_ids))
        .all()
    )
    for (code,) in rows:
        if not code:
            continue
        numero = normalize_despacho(code)
        sp_upsert_resumen_gasto(numero)
        if USE_RESUMEN_ANCHO:
            sp_sync_resumen_ancho(numero)


def serializar_despacho(despacho: DespachoResumen) -> dict:
    data = {column.name: getattr(despacho, column.name) for column in despacho.__table__.columns}
    if "Fecha" in data and isinstance(data["Fecha"], datetime.date):
        data["Fecha"] = data["Fecha"].isoformat()
    data["HasDoc"] = bool(data.get("HasDoc"))
    data["DocUrl"] = data.get("DocUrl")
    data["DocName"] = data.get("DocName")
    return data


def serializar_factura(factura: Factura) -> dict:
    data = {column.name: getattr(factura, column.name) for column in factura.__table__.columns}
    if "Fecha" in data and isinstance(data["Fecha"], datetime.date):
        data["Fecha"] = data["Fecha"].isoformat()
    return data


def sp_upsert_resumen_gasto(nro_despacho: str) -> None:
    if not nro_despacho:
        return
    db.session.execute(text("EXEC dbo.SP_UpsertResumenGasto :nro"), {"nro": nro_despacho})
    db.session.commit()


def sp_sync_resumen_ancho(nro_despacho: str) -> None:
    if not USE_RESUMEN_ANCHO or not nro_despacho:
        return
    db.session.execute(text("EXEC dbo.SP_Sync_Resumen_Desde_ResumenGasto :nro"), {"nro": nro_despacho})
    db.session.commit()


def sp_rebuild_resumen_gasto_todos() -> None:
    db.session.execute(text("EXEC dbo.SP_Rebuild_ResumenGasto_Todos"))
    db.session.commit()


def sp_sync_resumen_ancho_todos() -> None:
    if not USE_RESUMEN_ANCHO:
        return
    db.session.execute(text("EXEC dbo.SP_Sync_Resumen_Desde_ResumenGasto_Todos"))
    db.session.commit()


__all__ = [
    "add_links",
    "configure_resumen_ancho",
    "get_linked_despacho_ids",
    "parse_despachos_payload",
    "recalc_for_despacho_ids",
    "replace_links",
    "resolve_despacho_ids",
    "serializar_despacho",
    "serializar_factura",
    "sp_rebuild_resumen_gasto_todos",
    "sp_sync_resumen_ancho",
    "sp_sync_resumen_ancho_todos",
    "sp_upsert_resumen_gasto",
]
