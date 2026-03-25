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

def norm_money(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except:
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

def extract_despacho_raw_fields_from_items(items):

    data = {
        'FOB_Total': None,
        'Cotiz': None,
        'Ano_Ad_Tipo_NReg_DC': None,
        'Derechos_Importacion': None,
        'Tasa_Estadistica': None,
        'Arancel': None,
        'Fecha': None,
    }

    full = build_full_text(items)
    full_norm = _strip_accents(full).upper()

    # 🔥 FORMATO REAL
    m = re.search(r'\b\d{2}\s+\d{3}\s+ZFEI\s+\d{5,8}\b', full_norm)
    if m:
        data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    # 🔥 GENERICO
    if not data['Ano_Ad_Tipo_NReg_DC']:
        m = re.search(r'\b\d{2}\s+\d{3,5}\s+[A-Z0-9]{3,6}\s+\d{5,8}\b', full_norm)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    # 🔥 SIN ESPACIOS
    if not data['Ano_Ad_Tipo_NReg_DC']:
        m = re.search(r'\d{5}ZFE\d{6,8}', full_norm)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)

    # ---------------- FECHA ----------------
    m = DATE_RE.search(full)
    if m:
        data['Fecha'] = m.group(0)

    # ---------------- FOB ----------------
    m = re.search(r'FOB[^0-9]*(' + MONEY_RE + ')', full_norm)
    if m:
        data['FOB_Total'] = m.group(1)

    # ---------------- COTIZ ----------------
    m = re.search(r'COTIZ[^0-9]*(' + MONEY_RE + ')', full_norm)
    if m:
        data['Cotiz'] = m.group(1)

    return data

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
        "FOB": norm_money(raw.get("FOB_Total")),
        "Estadistica": norm_money(raw.get("Tasa_Estadistica")),
        "Derechos_Importacion": norm_money(raw.get("Derechos_Importacion")),
        "Tipo_Cambio": norm_money(raw.get("Cotiz")),
        "Arancel": norm_money(raw.get("Arancel")),
        "TipoDespacho": tipo,
    }

# ---------------- MAIN ----------------

def extract_from_pdf(file_bytes):

    pages = pdf_to_pil_images(file_bytes)

    all_items = []

    for p in pages:
        pre = preprocess_pil(p)
        items = ocr_with_boxes(pre)
        all_items.extend(items)

    raw = extract_despacho_raw_fields_from_items(all_items)

    full_text = build_full_text(all_items)

    suggested = map_raw_to_db_fields(raw, full_text)

    preview = full_text[:1000]

    return raw, suggested, preview, {}