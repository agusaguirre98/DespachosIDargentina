# ocr_despachos.py
from __future__ import annotations

import re, unicodedata
from typing import Dict, List, Any, Optional

from dateutil import parser as dateparser
from PIL import Image, ImageEnhance
import numpy as np
import fitz
import easyocr
import os
import sys

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["DISABLE_TQDM"] = "1"

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

DEFAULT_DPI = 180
MAX_PAGES = 1
EASYOCR_LANGS = ['es', 'en']

# ---------------- UTIL ----------------

def _strip_accents(s: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')

def norm_money(s: Optional[str], decimal_places: Optional[int] = None) -> Optional[float]:
    if not s:
        return None

    text = re.sub(r"[^0-9,.-]", "", str(s)).strip()
    if not text:
        return None

    last_comma = text.rfind(",")
    last_dot = text.rfind(".")

    try:
        if last_comma != -1 and last_dot != -1:
            decimal_sep = "," if last_comma > last_dot else "."
            thousands_sep = "." if decimal_sep == "," else ","
            normalized = text.replace(thousands_sep, "").replace(decimal_sep, ".")
            return float(normalized)

        if "," in text:
            whole, frac = text.split(",", 1)
            whole_digits = re.sub(r"\D", "", whole)
            frac_digits = re.sub(r"\D", "", frac)
            if decimal_places is not None and len(frac_digits) > decimal_places:
                digits = whole_digits + frac_digits
                normalized = f"{digits[:-decimal_places]}.{digits[-decimal_places:]}"
                return float(normalized)
            normalized = f"{whole_digits}.{frac_digits}" if frac_digits else whole_digits
            return float(normalized)

        if "." in text:
            if text.count(".") == 1:
                whole, frac = text.split(".", 1)
                whole_digits = re.sub(r"\D", "", whole)
                frac_digits = re.sub(r"\D", "", frac)
                if decimal_places is not None and len(frac_digits) > decimal_places:
                    digits = whole_digits + frac_digits
                    normalized = f"{digits[:-decimal_places]}.{digits[-decimal_places:]}"
                    return float(normalized)
                normalized = f"{whole_digits}.{frac_digits}" if frac_digits else whole_digits
                return float(normalized)

            digits = re.sub(r"\D", "", text)
            if decimal_places is not None and len(digits) > decimal_places:
                normalized = f"{digits[:-decimal_places]}.{digits[-decimal_places:]}"
                return float(normalized)
            return float(digits)

        digits = re.sub(r"\D", "", text)
        if decimal_places is not None and len(digits) > decimal_places:
            normalized = f"{digits[:-decimal_places]}.{digits[-decimal_places:]}"
            return float(normalized)
        return float(digits)
    except Exception:
        return None


def norm_tipo_cambio(s: Optional[str]) -> Optional[float]:
    if not s:
        return None

    text = re.sub(r"[^0-9,.-]", "", str(s)).strip()
    if not text:
        return None

    if "," in text or "." in text:
        return norm_money(text)

    digits = re.sub(r"\D", "", text)
    if not digits:
        return None

    try:
        if len(digits) >= 5:
            return float(f"{digits[:-1]}.{digits[-1:]}")
        return float(digits)
    except Exception:
        return None

def norm_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    try:
        return dateparser.parse(s, dayfirst=True).date().isoformat()
    except:
        return None

MONEY_RE = r'\d{1,3}(?:[.\s]\d{3})*(?:,\d{2,6})|\d+(?:,\d{2,6})'
DATE_RE = re.compile(r'\b\d{1,2}[/\.-]\d{1,2}[/\.-]\d{2,4}\b')
DESPACHO_SUFFIX_RE = r'(?:\s*[A-Z])?'
FOB_RE = re.compile(r'FOB(?:\s+TOTAL)?[^0-9]{0,25}(' + MONEY_RE + r')')
COTIZ_RE = re.compile(r'COTIZ[^0-9]{0,25}(' + MONEY_RE + r')')

# ---------------- PDF ----------------

def pdf_to_pil_images(file_bytes: bytes):
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    imgs = []
    for i, page in enumerate(doc):
        if i >= MAX_PAGES:
            break
        mat = fitz.Matrix(DEFAULT_DPI/72, DEFAULT_DPI/72)
        pix = page.get_pixmap(matrix=mat)
        imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    doc.close()
    return imgs

# ---------------- PREPROCESS (OPTIMIZADO) ----------------


def pdf_to_text(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    texts = []
    for i, page in enumerate(doc):
        if i >= MAX_PAGES:
            break
        texts.append(page.get_text("text") or "")
    doc.close()
    return " ".join(texts)

def preprocess_pil(img):
    img = img.convert("L")

    # 🔥 RECORTE (clave performance)
    w, h = img.size
    img = img.crop((0, 0, w, int(h * 0.6)))

    img = ImageEnhance.Contrast(img).enhance(2.0)

    return img

# ---------------- OCR (OPTIMIZADO) ----------------

_READER = None

def get_reader():
    global _READER
    if _READER is None:
        _READER = easyocr.Reader(
            EASYOCR_LANGS,
            gpu=False,
            verbose=False,
            detector=True,
        )
    return _READER

def ocr_with_boxes(img):
    try:
        texts = get_reader().readtext(np.array(img), detail=0)
        if not texts:
            return []
        return [{"text": str(t), "norm": _strip_accents(str(t)).upper()} for t in texts]
    except Exception as e:
        print("❌ OCR ERROR:", e)
        return []

# ---------------- BUILD TEXT ----------------

def build_full_text(items):
    return " ".join(it["text"] for it in items)

# ---------------- EXTRACT ----------------

def extract_tipo_despacho(full_text: str) -> Optional[str]:
    txt = full_text.upper()

    if "ZFI" in txt:
        return "ZFI"

    if "ZFE" in txt:
        return "ZFE"

    if "IC04" in txt:
        return "IC04"

    if "IC05" in txt:
        return "IC05"

    return None

def extract_despacho_raw_fields_from_items(items, extra_text: str = ""):

    data = {
        'FOB_Total': None,
        'Cotiz': None,
        'Ano_Ad_Tipo_NReg_DC': None,
        'Derechos_Importacion': None,
        'Tasa_Estadistica': None,
        'Arancel': None,
        'Fecha': None,
    }

    ocr_text = build_full_text(items)
    full = " ".join(part for part in [extra_text, ocr_text] if part)
    full_norm = _strip_accents(full).upper()
    ocr_norm = _strip_accents(ocr_text).upper()

    m = re.search(r'\b\d{2}\s+\d{3}\s+ZFEI\s+\d{5,8}' + DESPACHO_SUFFIX_RE + r'\b', full_norm)
    if m:
        data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    if not data['Ano_Ad_Tipo_NReg_DC']:
        m = re.search(r'\b\d{2}\s+\d{3,5}\s+[A-Z0-9]{3,6}\s+\d{5,8}' + DESPACHO_SUFFIX_RE + r'\b', full_norm)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    if not data['Ano_Ad_Tipo_NReg_DC']:
        m = re.search(r'\d{5}ZFE\d{6,8}' + DESPACHO_SUFFIX_RE + r'\b', full_norm)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    m = DATE_RE.search(full)
    if m:
        data['Fecha'] = m.group(0)

    for text_norm in [ocr_norm, full_norm]:
        m = FOB_RE.search(text_norm)
        if m:
            data['FOB_Total'] = m.group(1)
            break

    for text_norm in [ocr_norm, full_norm]:
        m = COTIZ_RE.search(text_norm)
        if m:
            data['Cotiz'] = m.group(1)
            break

    return data


def needs_ocr_fallback(raw: Dict[str, Any]) -> bool:
    required_fields = ["Ano_Ad_Tipo_NReg_DC", "Fecha", "FOB_Total", "Cotiz"]
    return any(not raw.get(field) for field in required_fields)

# ---------------- MAP ----------------

def map_raw_to_db_fields(raw: Dict[str, Any], full_text: str = "") -> Dict[str, Any]:

    pretty = (raw.get("Ano_Ad_Tipo_NReg_DC") or "").replace(" ", "")

    tipo = extract_tipo_despacho(full_text)

    # 🔥 NORMALIZAR ZFEI
    if tipo == "ZFEI":
        tipo = "ZFE"

    return {
        "Despacho": pretty or None,
        "Fecha": norm_date(raw.get("Fecha")),
        "FOB": norm_money(raw.get("FOB_Total"), decimal_places=2),
        "Estadistica": norm_money(raw.get("Tasa_Estadistica"), decimal_places=2),
        "Derechos_Importacion": norm_money(raw.get("Derechos_Importacion"), decimal_places=2),
        "Tipo_Cambio": norm_tipo_cambio(raw.get("Cotiz")),
        "Arancel": norm_money(raw.get("Arancel"), decimal_places=2),
        "TipoDespacho": tipo,
    }

# ---------------- MAIN ----------------

def extract_from_pdf(file_bytes):

    pdf_text = pdf_to_text(file_bytes)
    raw = extract_despacho_raw_fields_from_items([], extra_text=pdf_text)
    all_items = []

    if needs_ocr_fallback(raw):
        pages = pdf_to_pil_images(file_bytes)

        for p in pages:
            pre = preprocess_pil(p)
            items = ocr_with_boxes(pre)
            all_items.extend(items)

        raw = extract_despacho_raw_fields_from_items(all_items, extra_text=pdf_text)

    full_text = " ".join(part for part in [pdf_text, build_full_text(all_items)] if part)

    suggested = map_raw_to_db_fields(raw, full_text)

    preview = full_text[:1000]

    return raw, suggested, preview, {}
