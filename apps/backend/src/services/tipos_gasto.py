"""Helpers to resolve TipoGasto identifiers."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func

from ..models import TipoGasto


def resolve_tipogasto_id(value: Any) -> Optional[int]:
    """
    Accept an id or string name and return the matching TipoGasto.IdGasto.
    """
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        pass

    name = str(value).strip()
    if not name:
        return None

    tipo = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == name.lower()).first()
    if tipo:
        return tipo.IdGasto

    tipo = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{name}%")).first()
    return tipo.IdGasto if tipo else None


def resolve_tipogasto_name(value: Any) -> Optional[str]:
    """
    Return the TipoGasto name for either an id or a textual hint.
    """
    if value is None:
        return None
    try:
        tipo = TipoGasto.query.get(int(value))
        return tipo.TipoGasto if tipo else None
    except Exception:
        pass

    name = str(value).strip()
    if not name:
        return None

    tipo = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == name.lower()).first()
    if tipo:
        return tipo.TipoGasto

    tipo = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{name}%")).first()
    return tipo.TipoGasto if tipo else None


__all__ = ["resolve_tipogasto_id", "resolve_tipogasto_name"]
