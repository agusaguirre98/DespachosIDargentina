# ocr_despachos.py
from __future__ import annotations

import re, logging, unicodedata
from typing import Dict, Tuple, List, Any, Optional

from dateutil import parser as dateparser
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np
import fitz  # PyMuPDF
import easyocr
import os
import sys

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["DISABLE_TQDM"] = "1"

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

try:
    import cv2
    _HAS_CV2 = True
except Exception:
    _HAS_CV2 = False

# ---------------- Config ----------------
DEFAULT_DPI = 320
MAX_PAGES = 4
EASYOCR_LANGS = ['es']   # sólo español para precisión

# -------------- Utilidades --------------
def _strip_accents(s: str) -> str:
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn')

def norm_money(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    s = s.strip().replace(' ', '').replace('.', '').replace(',', '.')
    try:
        return float(s)
    except Exception:
        return None

def norm_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    try:
        return dateparser.parse(s, dayfirst=True).date().isoformat()
    except Exception:
        return None

MONEY_RE = re.compile(
    r'\d{1,3}(?:[.\s]\d{3})*(?:,\d{2,6})'      # 24.148,69 / 1 046,500000
    r'|\d+(?:,\d{2,6})'
)
DATE_RE = re.compile(r'\b\d{1,2}[/\.-]\d{1,2}[/\.-]\d{2,4}\b')

# --------- PDF -> PIL (PyMuPDF) ---------
def pdf_to_pil_images(file_bytes: bytes, dpi: int = DEFAULT_DPI, max_pages: int = MAX_PAGES) -> List[Image.Image]:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    imgs: List[Image.Image] = []
    try:
        for i, page in enumerate(doc):
            if i >= max_pages: break
            mat = fitz.Matrix(dpi/72, dpi/72)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    finally:
        doc.close()
    return imgs

# --------------- Prepro -----------------
def preprocess_pil(pil: Image.Image) -> Image.Image:
    try:
        img = pil.convert("L")
        img = ImageEnhance.Contrast(img).enhance(2.0)
        img = ImageEnhance.Sharpness(img).enhance(2.0)
        img = img.filter(ImageFilter.MedianFilter(3))
        if _HAS_CV2:
            arr = np.array(img)
            bw = cv2.adaptiveThreshold(arr, 255,
                                       cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, 35, 11)
            return Image.fromarray(bw)
        return img
    except Exception:
        return pil

# -------- OCR con bounding boxes --------
_READER: Optional[easyocr.Reader] = None
def get_reader() -> easyocr.Reader:
    global _READER
    if _READER is None:
        _READER = easyocr.Reader(EASYOCR_LANGS, gpu=False, verbose=False)
    return _READER

def ocr_with_boxes(pil: Image.Image) -> List[dict]:
    results = get_reader().readtext(np.array(pil), detail=1, paragraph=False)
    items = []
    for box, text, conf in results:
        xs = [p[0] for p in box]; ys = [p[1] for p in box]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        items.append({
            "text": text,
            "norm": _strip_accents(text).upper(),
            "box": (x1, y1, x2, y2),
            "cx": (x1+x2)/2, "cy": (y1+y2)/2,
            "w": (x2-x1), "h": (y2-y1),
            "conf": conf
        })
    return items

#--------- Scoring por paginas --------# 

def score_items_for_despacho(items: List[dict]) -> tuple[float, dict]:
    """
    Devuelve (score_total, hits_por_token) para una página.
    Score alto => página relevante (tiene rótulos del formulario).
    """
    token_weights = [
        ('OFICIAL', 2.0),
        ('FOB', 1.6), ('TOTAL', 0.6),
        ('COTIZ', 1.6), ('COTI', 1.0),  # por si lee "COTI..."
        ('(010', 1.2), ('DERECHOS', 1.0), ('IMPORT', 0.8),
        ('(011', 1.2), ('ESTADIST', 1.0),
        ('(500', 1.0), ('ARANCEL', 0.8), ('SIM', 0.4), ('IMPO', 0.6),
        ('TIPO', 1.0), ('REG', 1.0), ('NREG', 1.0), ('DC', 0.8),
    ]
    score = 0.0
    hits = {}
    for it in items:
        norm = it['norm']
        for tok, w in token_weights:
            if tok in norm:
                score += w
                hits[tok] = hits.get(tok, 0) + 1
    return score, hits




# -------- Buscadores geométricos --------
def _find_label(items: List[dict], must_have: List[str]) -> List[dict]:
    return [it for it in items if all(tok in it["norm"] for tok in must_have)]

def _numbers_in(text: str) -> List[str]:
    return MONEY_RE.findall(text.replace('·','').replace('—',''))

def _right_value_same_row(items: List[dict], label: dict, dy: float = 28.0, min_dx: float = 10.0) -> Optional[str]:
    ly, lx = label["cy"], label["cx"]
    cand: List[tuple] = []
    for it in items:
        if abs(it["cy"] - ly) <= dy and it["cx"] > lx + min_dx:
            nums = _numbers_in(it["text"])
            if nums:
                score = (it["cx"], max(len(n) for n in nums))
                cand.append((score, nums[-1]))
    if cand:
        cand.sort(key=lambda x: (x[0][0], x[0][1]))
        return cand[-1][1]
    nums = _numbers_in(label["text"])
    return nums[-1] if nums else None

def _concat_below_band(items: List[dict], label: dict, dy_range=(8, 100), x_expand=0.8) -> str:
    x1, y1, x2, y2 = label["box"]
    lw = label["w"]
    top, bot = label["cy"] + dy_range[0], label["cy"] + dy_range[1]
    band_x1, band_x2 = x1 - lw*x_expand, x2 + lw*x_expand
    row = [it for it in items if top <= it["cy"] <= bot and band_x1 <= it["cx"] <= band_x2]
    row.sort(key=lambda it: (it["cy"], it["cx"]))
    return " ".join(it["text"] for it in row)

def _number_in_below_band(items: List[dict], label: dict, dy_range=(8, 100), x_expand=0.8) -> Optional[str]:
    text = _concat_below_band(items, label, dy_range, x_expand)
    nums = _numbers_in(text)
    return nums[-1] if nums else None

# ---- Texto global (fallback regex) ----
def build_full_text(items: List[dict]) -> str:
    # ordenar por fila: primero y (cy), luego x (cx)
    ordered = sorted(items, key=lambda it: (round(it["cy"]/12), it["cx"]))
    return " ".join(it["text"] for it in ordered)

# -------------- Extracción --------------
def extract_despacho_raw_fields_from_items(items: List[dict]) -> Dict[str, Any]:
    data = {
        'FOB_Total': None,
        'Cotiz': None,
        'Ano_Ad_Tipo_NReg_DC': None,
        'Derechos_Importacion': None,
        'Tasa_Estadistica': None,
        'Arancel': None,
        'Fecha': None,
    }

    # 1) Año / Ad. / Tipo / N°Reg. / DC  -> valor debajo
    lbls = _find_label(items, ['TIPO'])
    lbls = [l for l in lbls if ('REG' in l['norm'] or 'NREG' in l['norm']) and 'DC' in l['norm']]
    if lbls:
        band = _concat_below_band(items, lbls[0], dy_range=(8, 120), x_expand=0.9)
        m = re.search(r'\d{2}\s+\d{3,5}\s+[A-Za-z0-9]{3,6}\s+\d{5,8}\s+[A-Za-z]', band)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0).strip()

    # 2) Cotiz -> derecha o debajo
    lbl_c = [l for l in items if 'COTIZ' in l['norm']]
    if lbl_c:
        val = _right_value_same_row(items, lbl_c[0], dy=32)
        if not val:
            val = _number_in_below_band(items, lbl_c[0], dy_range=(6, 70), x_expand=0.6)
        data['Cotiz'] = val

    # 3) FOB Total -> normalmente debajo
    lbl_f = [l for l in items if 'FOB' in l['norm'] and 'TOTAL' in l['norm']]
    if lbl_f:
        val = _number_in_below_band(items, lbl_f[0], dy_range=(6, 90), x_expand=0.6)
        if not val:
            val = _right_value_same_row(items, lbl_f[0], dy=32)
        data['FOB_Total'] = val

    # 4) (010) Derechos
    lbl_010 = [l for l in items if '(010' in l['norm'] or ('DERECHOS' in l['norm'] and 'IMPORT' in l['norm'])]
    if lbl_010:
        data['Derechos_Importacion'] = _right_value_same_row(items, lbl_010[0], dy=24)

    # 5) (011) Estadística
    lbl_011 = [l for l in items if '(011' in l['norm'] or ('TASA' in l['norm'] and 'ESTADIST' in l['norm'])]
    if lbl_011:
        data['Tasa_Estadistica'] = _right_value_same_row(items, lbl_011[0], dy=24)

    # 6) (500) Arancel SIM IMPO
    lbl_500 = [l for l in items if '(500' in l['norm'] or ('ARANCEL' in l['norm'] and 'SIM' in l['norm'] and 'IMPO' in l['norm'])]
    if lbl_500:
        data['Arancel'] = _right_value_same_row(items, lbl_500[0], dy=24)

    # 7) Fecha (Oficialización debajo)
    lbl_of = [l for l in items if 'OFICIAL' in l['norm']]
    picked = None
    if lbl_of:
        m = DATE_RE.search(lbl_of[0]['text'])
        picked = m.group(0) if m else None
        if not picked:
            band = _concat_below_band(items, lbl_of[0], dy_range=(6, 90), x_expand=0.5)
            m = DATE_RE.search(band)
            picked = m.group(0) if m else None
    if not picked:
        for it in items:
            m = DATE_RE.search(it['text'])
            if m:
                picked = m.group(0); break
    data['Fecha'] = picked

       # ---------- Fallbacks por regex global ----------
    full_norm = _strip_accents(build_full_text(items)).upper()

    # FOB Total: aceptar FOD/FOM, con o sin "TOTAL" mal leído (TO[T7][A4]L, TOUAI, etc.)
    if not data['FOB_Total']:
        m = re.search(
            r'FO[BDOM]\s*(?:TO[T7][A4]L|TOU[AI]|TOTAL)?\s*(' + MONEY_RE.pattern + r')',
            full_norm
        )
        if m:
            data['FOB_Total'] = m.group(1)

    # Cotización: aceptar COTIZ con I/L/1 y Z/2, y permitir "=", ":" o "%" antes del número
    if not data['Cotiz']:
        m = re.search(
            r'CO[T7][IL1]?[Z2]?\s*[:=%]?\s*(' + MONEY_RE.pattern + r')',
            full_norm
        )
        if m:
            data['Cotiz'] = m.group(1)

        # Año / Ad. / Tipo / N°Reg. / DC:
        #  - 2 dígitos (año)
        #  - 3–5 caracteres alfanum (aduana)  ← permite 0J3
        #  - 3–6 alfanum (tipo: IC04 / ZFE1, etc.)
        #  - 5–8 dígitos (número)
        #  - 1 letra (DC)
    if not data['Ano_Ad_Tipo_NReg_DC']:
        m = re.search(r'\b\d{2}\s+[0-9A-Z]{3,5}\s+[A-Z0-9]{3,6}\s+\d{5,8}\s+[A-Z]\b', full_norm)
        if m:
            data['Ano_Ad_Tipo_NReg_DC'] = m.group(0)


    return data

def map_raw_to_db_fields(raw: Dict[str, Any]) -> Dict[str, Any]:
    pretty = (raw.get("Ano_Ad_Tipo_NReg_DC") or "").strip()
    return {
        "Despacho": pretty or None,
        "Fecha": norm_date(raw.get("Fecha")),
        "FOB": norm_money(raw.get("FOB_Total")),
        "Estadistica": norm_money(raw.get("Tasa_Estadistica")),
        "Derechos_Importacion": norm_money(raw.get("Derechos_Importacion")),
        "Tipo_Cambio": norm_money(raw.get("Cotiz")),
        "Arancel": norm_money(raw.get("Arancel")),  # <--- nuevo
    }

# ------------- API principal -------------
def extract_from_pdf(file_bytes: bytes, dpi: int = DEFAULT_DPI, max_pages: int = MAX_PAGES):
    """
    - Convierte las primeras `max_pages` a imágenes
    - Corre OCR por página
    - PUNTÚA cada página por rótulos del formulario
    - Extrae SOLO de la mejor página (y opcionalmente de la 2da si aporta)
    """
    pages = pdf_to_pil_images(file_bytes, dpi=dpi, max_pages=max_pages)

    per_page_items: List[List[dict]] = []
    page_scores: List[tuple] = []  # (idx, score, hits)

    for idx, p in enumerate(pages):
        pre = preprocess_pil(p)
        items = ocr_with_boxes(pre)
        per_page_items.append(items)
        sc, hits = score_items_for_despacho(items)
        page_scores.append((idx, sc, hits))

    # Elegimos la mejor página
    page_scores.sort(key=lambda x: x[1], reverse=True)
    if page_scores:
        best_idx, best_score, best_hits = page_scores[0]
        chosen_items = per_page_items[best_idx]
        # Si la 2da página también tiene buen score (>= 60% de la mejor), la combinamos
        if len(page_scores) > 1 and page_scores[1][1] >= 0.6 * best_score:
            chosen_items = chosen_items + per_page_items[page_scores[1][0]]
    else:
        # Fallback: sin páginas (PDF vacío)
        chosen_items = []

    preview_text = " ".join(it["text"] for it in chosen_items)[:1200]

    raw = extract_despacho_raw_fields_from_items(chosen_items)
    suggested = map_raw_to_db_fields(raw)

    # devolvemos también info de debug para inspección rápida
    debug = {
        "page_scores": [
            {"page": idx, "score": float(sc), "hits": hits}
            for (idx, sc, hits) in page_scores
        ],
        "chosen_pages": [page_scores[0][0]] if page_scores else [],
    }

    return raw, suggested, preview_text, debug

