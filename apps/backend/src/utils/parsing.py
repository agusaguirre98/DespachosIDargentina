"""General parsing helpers used across the backend."""

from __future__ import annotations

import re
from typing import Any, Optional


def normalize_despacho(value: Optional[str]) -> str:
    """Remove blanks and normalise despacho identifiers to upper-case."""
    return re.sub(r"\s+", "", (value or "").strip()).upper()


def parse_float(value: Any) -> Optional[float]:
    """Parse values that may use either comma or dot separators into float."""
    if value is None:
        return None
    string_value = str(value).strip()
    if not string_value:
        return None
    normalised = string_value.replace(".", "").replace(",", ".")
    try:
        return float(normalised)
    except Exception:
        try:
            return float(string_value)
        except Exception:
            return None


def to_float_or_none(value: Any) -> Optional[float]:
    """Best-effort conversion to float ignoring non-numeric symbols."""
    if value is None or str(value).strip() == "":
        return None
    string_value = str(value).strip()
    string_value = re.sub(r"[^0-9,.\-]", "", string_value)
    if "," in string_value and "." in string_value:
        string_value = string_value.replace(".", "").replace(",", ".")
    elif "," in string_value and "." not in string_value:
        string_value = string_value.replace(",", ".")
    else:
        string_value = string_value.replace(",", "")
    try:
        return float(string_value)
    except Exception:
        return None


def safe_float(value: Any) -> Optional[float]:
    """More permissive float conversion used by factura payloads."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    string_value = str(value).strip()
    if string_value == "" or string_value.lower() == "null":
        return None
    string_value = re.sub(r"[^0-9,.\-]", "", string_value)
    if "." in string_value and "," in string_value:
        string_value = string_value.replace(".", "").replace(",", ".")
    elif "," in string_value and "." not in string_value:
        string_value = string_value.replace(",", ".")
    else:
        string_value = string_value.replace(",", "")
    try:
        return float(string_value)
    except Exception:
        return None


def as_bool(value: Any, default: bool = False) -> bool:
    """Interpret different truthy representations coming from queries/forms."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    string_value = str(value).strip().lower()
    if string_value in {"", "null"}:
        return default
    if string_value in {"1", "true", "yes", "y", "on"}:
        return True
    if string_value in {"0", "false", "no", "n", "off"}:
        return False
    return default


__all__ = ["normalize_despacho", "parse_float", "to_float_or_none", "safe_float", "as_bool"]
