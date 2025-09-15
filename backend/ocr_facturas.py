# ocr_facturas.py
import io, re, logging
from typing import Dict, Tuple, Optional, List, TYPE_CHECKING

# -----------------------
#  Imports "suaves"
# -----------------------
try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

# --- módulos en runtime (no afectan al type checker) ---
try:
    import numpy as np_runtime
except Exception:
    np_runtime = None  # type: ignore[assignment]

try:
    import cv2 as cv2_runtime
except Exception:
    cv2_runtime = None  # type: ignore[assignment]

# --- imports solo para tipos (no se ejecutan en runtime) ---
if TYPE_CHECKING:
    import numpy as np  # pragma: no cover
    import cv2          # pragma: no cover

try:
    import easyocr
except Exception:
    easyocr = None

try:
    from dateparser import parse as parse_date
except Exception:
    parse_date = None

# ============================================================
#                UTILIDADES Y PATRONES
# ============================================================

def _normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()

def _parse_number(s: str) -> Optional[float]:
    if not s:
        return None
    t = re.sub(r"[^0-9,.\-]", "", s.strip())
    if not t:
        return None
    last_comma = t.rfind(",")
    last_dot   = t.rfind(".")
    # Sin separadores → parse directo
    if last_comma == -1 and last_dot == -1:
        try:
            return float(t)
        except Exception:
            return None
    # Elegimos el separador decimal por la última aparición
    decimal = "." if last_dot > last_comma else ","
    if decimal == ".":
        t = t.replace(",", "")
        if t.count(".") > 1:
            parts = t.split(".")
            t = "".join(parts[:-1]) + "." + parts[-1]
    else:
        t = t.replace(".", "").replace(",", ".")
        if t.count(".") > 1:
            parts = t.split(".")
            t = "".join(parts[:-1]) + "." + parts[-1]
    try:
        return float(t)
    except Exception:
        return None

def _detect_currency(blob: str) -> str:
    if re.search(r"\b(USD|U\$S|U\$\$|DOLARES|U\$D)\b", blob, re.IGNORECASE):
        return "USD"
    if re.search(r"\bARS|\bAR\$|\bPESOS?\b", blob, re.IGNORECASE):
        return "ARS"
    return "ARS"

def _first_date_iso(text: str) -> str:
    m = re.search(r"\b(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2,4})\b", text)
    if not m:
        return ""
    dd, mm, aa = m.group(1), m.group(2), m.group(3)
    if len(aa) == 2:
        aa = "20" + aa
    return f"{aa.zfill(4)}-{mm.zfill(2)}-{dd.zfill(2)}"

# --- FECHAS: priorizar Emisión/Comprobante sobre Vencimiento y evitar "Inicio de actividades" ---
RE_FECHA_LABELS = [
    re.compile(r"Fecha\s+Comprobante\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.I),
    re.compile(r"Fecha\s+de\s+Emisi[oó]n\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.I),
    re.compile(r"\bFECHA\b\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.I),
    re.compile(r"\bFecha\b\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.I),
]
RE_VTO = re.compile(r"(?:Vencimiento|Vto\.?)\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{2,4})", re.I)
RE_INICIO_ACT = re.compile(r"inicio\s+de\s+actividades", re.I)

def _prefer_date_from_text(text: str) -> str:
    # 1) Preferencia absoluta: Fecha de Comprobante / Emisión / Fecha
    for rx in RE_FECHA_LABELS:
        m = rx.search(text)
        if m:
            ctx = text[max(0, m.start()-40):m.end()+40]
            if RE_INICIO_ACT.search(ctx):
                continue
            return _first_date_iso(m.group(1))
    # 2) (Opcional) Vencimiento si no se encontró emisión
    m = RE_VTO.search(text)
    if m:
        return _first_date_iso(m.group(1))
    # 3) Fallback: primera fecha que no esté en contexto de "inicio de actividades"
    for m in re.finditer(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", text):
        ctx = text[max(0, m.start()-40):m.end()+40]
        if RE_INICIO_ACT.search(ctx):
            continue
        dd, mm, aa = m.group(1), m.group(2), m.group(3)
        if len(aa) == 2:
            aa = "20" + aa
        return f"{aa.zfill(4)}-{mm.zfill(2)}-{dd.zfill(2)}"
    return ""

# -----------------------
#  Catálogo Proveedores
# -----------------------
PROVEEDORES = [
    ("FOLLOW UP TRANSPORT SRL",           "Flete nacional",
        [r"FOLLOW\s*UP(?:\s*TRANSPORT)?\s*SRL", r"\bFOLLOW\s*UP\b"]),
    ("GESTION FORWARD SRL",               "Flete internacional",
        [r"GESTI[ÓO]N\s+FORWARD"]),
    ("UNLIMITED WORLD S.A.",              "Flete internacional",
        [r"UNLIMITED\s+WORLD"]),
    ("TRANSPORTES SAGRILO LTDA S.E.",     "Flete internacional",
        [r"SAGRILO"]),
    ("ARM Services / A.R.M. CARGO S.A.",  "Custodia",
        [r"A\.?\s*R\.?\s*M\.?\s*CARGO", r"\bARM\s+Services\b"]),
    ("LOGISTICA AZ",                      "Zona Franca",
        [r"LOG[ÍI]STICA?\s+AZ"]),
    ("VAZQUEZ IACOVINO S.R.L.",           "Despachante",
        [r"V[ÁA]ZQUEZ\s+IACOVINO"]),
    ("DHL EXPRESS (ARGENTINA) S.A.",      "Muestras & Documentos",
        [r"\bDHL\s+EXPRESS\b"]),
    ("UPS DE ARGENTINA S.A.",             "Muestras & Documentos",
        [r"\bUPS\s+DE\s+ARGENTINA\b", r"\bUPS\b"]),
    ("FIANZAS Y CREDITO",                 "Seguros caucion",
        [r"FIANZAS\s+Y\s+CREDITO"]),
    ("DODERO COMPAÑIA GRAL. DE SERVICIOS", "Terminales Portuarias- Depositos",
        [r"\bDODERO\b"]),
]

# Proveedores de flete internacional donde el importe válido es "NO GRAVADO"
INTL_NO_GRAVADO_PROVS = {
    "GESTION FORWARD SRL",
    "TRANSPORTES SAGRILO LTDA S.E.",
    "UNLIMITED WORLD S.A.",
}

def _detect_proveedor(text: str) -> Tuple[str, str]:
    for razon, tipo, pats in PROVEEDORES:
        for p in pats:
            if re.search(p, text, re.IGNORECASE):
                return razon, tipo
    return "", ""

# -----------------------
#  Nº de factura
# -----------------------
RE_FACT_NUM = [
    # Cerca del header "FACTURA" (tolerante: guiones, espacios o saltos)
    r"(?:FACTURA|FCA|FA|FC|FSA)[^\d]{0,25}(\d{4,5})[^\d]{0,12}(\d{7,9})",
    # Genérico con guion/espacio opcional
    r"\b(\d{4,5})\s*[-–]?\s*(\d{7,9})\b",
]

def _detect_fact_number(text: str, pages_words: Optional[List[list]] = None) -> str:
    """
    Devuelve 'PPPP-NNNNNNNN' priorizando layout (palabras cerca de 'FACTURA')
    y, si falla, usando regex con contexto. Último recurso: patrón genérico.
    """
    # --- 1) Por layout ---
    try:
        if pages_words:
            for words in pages_words:
                fac = [w for w in words if re.search(r'FACTURA', w[4], re.I)]
                header_y = fac[0][1] if fac else None

                c4 = [w for w in words if re.fullmatch(r"\d{4}", w[4])]
                c8 = [w for w in words if re.fullmatch(r"\d{8}", w[4])]

                pairs = []
                for a in c4:
                    for b in c8:
                        dy = abs(((a[1]+a[3])/2) - ((b[1]+b[3])/2))
                        dx = b[0] - a[2]
                        if -10 <= dx <= 120 and dy <= 20:
                            score = dy*2 + abs(dx)
                            if header_y is not None:
                                cy = (a[1]+a[3]+b[1]+b[3]) / 4
                                score += abs(cy - header_y) * 0.5
                            pairs.append((score, a[4], b[4]))
                if pairs:
                    pairs.sort(key=lambda t: t[0])
                    pv, num = pairs[0][1], pairs[0][2]
                    return f"{pv[-4:]}-{num[-8:]}"
    except Exception:
        pass

    # --- 2) Regex con contexto (cerca de FACTURA / N°) ---
    m = re.search(
        r'FACTURA\s*[A-Z]?(?:\s*N[°º]?:?)?[\s\-]*'
        r'(\d{4})\D{0,12}(\d{8})',
        text, re.I | re.S
    )
    if not m:
        m = re.search(
            r'FACTURA\s*[A-Z]?(?:\s*[-:])?\s*(\d{8})\D{0,12}(\d{4})',
            text, re.I | re.S
        )
        if m:
            num, pv = m.group(1), m.group(2)
            return f"{pv[-4:]}-{num[-8:]}"

    if m:
        pv, num = m.group(1), m.group(2)
        return f"{pv[-4:]}-{num[-8:]}"

    # --- 3) Último recurso: patrón genérico, estrictamente 4-8 ---
    m = re.search(r'\b(\d{4})\s*[-–]\s*(\d{8})\b', text)
    if m:
        return f"{m.group(1)}-{m.group(2)}"

    return ""

# -----------------------
#  Totales
# -----------------------
RE_TOTAL_LINES = [
    r"\bTOTAL\s*A\s*PAGAR\s*[:\-]?\s*(?:AR(?:S|\$)|USD|U(?:\$|S)S?)?\s*([\d\.,]+)",
    r"\bTOTAL\s*[:\-]?\s*(?:AR(?:S|\$)|USD|U(?:\$|S)S?)\s*([\d\.,]+)",
    r"\bTOTAL\s*[:\-]?\s*([\d\.,]+)",
    r"\bImporte\s+Total\s*[:\-]?\s*([\d\.,]+)",
    r"\bPremio\s+Total\s*[:\-]?\s*([\d\.,]+)",
    r"\bAR(?:S|\$)\s*([\d\.,]+)",
]

def _detect_total_and_currency(text: str) -> Tuple[Optional[float], str]:
    m = re.search(r"(?i)\bTotal\s*[:\-]?\s*(AR(?:S|\$)|USD|U(?:\$|S)S?)?\s*([\d\.,]+)", text)
    if m:
        total = _parse_number(m.group(2))
        if total is not None:
            cur = m.group(1) or ""
            cur = "USD" if re.search(r"USD|U(?:\$|S)S?", cur, re.I) else ("ARS" if re.search(r"AR(?:S|\$)", cur, re.I) else _detect_currency(text))
            return total, cur

    for pat in RE_TOTAL_LINES:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            total = _parse_number(m.group(1))
            if total is not None:
                return total, _detect_currency(m.group(0) + " " + text)

    blocks = list(re.finditer(r"(?<!SUB)\bTOTAL\b.*?$", text, re.IGNORECASE | re.DOTALL))
    if blocks:
        blk = blocks[-1].group(0)
        nums = re.findall(r"[\d\.,]{4,}", blk)
        if nums:
            total = _parse_number(nums[-1])
            if total is not None:
                return total, _detect_currency(blk)

    return None, _detect_currency(text)

# --- NUEVO: detectar específicamente "NO GRAVADO" ---
def _detect_no_gravado_from_text(text: str) -> Optional[float]:
    """
    Intenta capturar el importe asociado a 'NO GRAVADO' en la misma línea
    o en una ventana corta a su derecha.
    """
    # 1) Misma línea
    for line in text.splitlines():
        if re.search(r"\bNO\s*GRAVADO\b", line, re.I):
            m = re.search(r"([\d\.,]{4,})", line)
            if m:
                v = _parse_number(m.group(1))
                if v is not None:
                    return v
    # 2) Ventana pequeña a la derecha del label (texto plano)
    m = re.search(r"(?i)NO\s*GRAVADO", text)
    if m:
        start = max(0, m.end())
        window = text[start:start+120]  # ventana corta
        m2 = re.search(r"([\d\.,]{4,})", window)
        if m2:
            v = _parse_number(m2.group(1))
            if v is not None:
                return v
    return None

# ============================================================
#              EXTRACCIÓN DE TEXTO (BACKUPS)
# ============================================================

def _extract_text_pdfminer(file_bytes: bytes) -> str:
    """Fallback para PDFs con texto embebido (si falta PyMuPDF)."""
    try:
        from pdfminer.high_level import extract_text
    except Exception as e:
        logging.warning(f"pdfminer import error: {e}")
        return ""
    try:
        return extract_text(io.BytesIO(file_bytes))
    except Exception as e:
        logging.warning(f"pdfminer error: {e}")
        return ""

def _easyocr_reader():
    if not easyocr:
        return None
    if not hasattr(_easyocr_reader, "_r"):
        _easyocr_reader._r = easyocr.Reader(['es', 'en'], gpu=False)
    return _easyocr_reader._r

def _extract_text_easyocr_full(file_bytes: bytes, dpi: int = 300, max_pages: int = 1) -> str:
    """OCR de página completa (fallback final)."""
    text = ""
    rdr = _easyocr_reader()
    if not rdr:
        return text
    try:
        pages_imgs: List["np.ndarray"] = []
        if fitz and np_runtime is not None:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = min(max_pages, len(doc)) if max_pages else len(doc)
            for i in range(pages):
                pix = doc[i].get_pixmap(dpi=dpi, alpha=False)
                img = np_runtime.frombuffer(pix.samples, dtype=np_runtime.uint8).reshape(
                    pix.height, pix.width, pix.n
                )
                pages_imgs.append(img)
        else:
            from pdf2image import convert_from_bytes
            pil_pages = convert_from_bytes(file_bytes, dpi=dpi, first_page=1, last_page=max_pages)
            if np_runtime is not None:
                pages_imgs = [np_runtime.array(p) for p in pil_pages]
            else:
                pages_imgs = []

        for img in pages_imgs:
            res = rdr.readtext(img, detail=0, paragraph=True)
            text += "\n".join(res) + "\n"
    except Exception as e:
        logging.error(f"easyocr full error: {e}")
    return text

# ------------------------------------------------------------
#      OCR ZONAL (región a la derecha de una "ancla")
# ------------------------------------------------------------
def _preprocess_for_ocr(img_bgr: "np.ndarray") -> "np.ndarray":
    if cv2_runtime is None or np_runtime is None:
        return img_bgr
    g = cv2_runtime.cvtColor(img_bgr, cv2_runtime.COLOR_BGR2GRAY)
    g = cv2_runtime.fastNlMeansDenoising(g, h=7)
    th = cv2_runtime.adaptiveThreshold(
        g, 255,
        cv2_runtime.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2_runtime.THRESH_BINARY, 31, 8
    )
    coords = np_runtime.column_stack(np_runtime.where(th < 255))
    if len(coords):
        angle = cv2_runtime.minAreaRect(coords)[-1]
        angle = -(90 + angle) if angle < -45 else -angle
        (h, w) = th.shape[:2]
        M = cv2_runtime.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
        th = cv2_runtime.warpAffine(
            th, M, (w, h),
            flags=cv2_runtime.INTER_CUBIC,
            borderMode=cv2_runtime.BORDER_REPLICATE
        )
    return th

def _ocr_np(reader, np_img: "np.ndarray") -> str:
    try:
        res = reader.readtext(np_img, detail=1, paragraph=True)
        res.sort(key=lambda r: (r[0][0][1], r[0][0][0]))  # y,x
        return " ".join([t for _, t, conf in res if conf >= 0.35]).strip()
    except Exception as e:
        logging.warning(f"easyocr region error: {e}")
        return ""

def _extract_near(page, words, label_re: str, dpi: int = 400, xpad: int = 420, ypad: int = 18) -> str:
    """
    Busca una ancla (label_re) en la página y lee a su derecha.
    1) intenta texto embebido dentro del rectángulo,
    2) si no hay, rasteriza solo esa región y hace OCR.
    """
    try:
        if fitz is None:
            return ""
        cands = [w for w in words if re.search(label_re, w[4], re.IGNORECASE)]
        if not cands:
            return ""
        x0, y0, x1, y1 = cands[0][:4]
        rect = fitz.Rect(x1 + 5, y0 - ypad, x1 + xpad, y1 + ypad)

        local = page.get_textbox(rect) or ""
        if local.strip():
            return _normalize_spaces(local)

        if np_runtime is None or easyocr is None:
            return ""
        rdr = _easyocr_reader()
        pix = page.get_pixmap(dpi=dpi, clip=rect, alpha=False)
        img = np_runtime.frombuffer(pix.samples, dtype=np_runtime.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        pre = _preprocess_for_ocr(img)
        txt = _ocr_np(rdr, pre)
        return _normalize_spaces(txt)
    except Exception as e:
        logging.warning(f"_extract_near error: {e}")
        return ""

# ============================================================
#                     API PRINCIPAL
# ============================================================
def extract_from_pdf(file_bytes: bytes, dpi: int = 300, max_pages: int = 1):
    """
    Devuelve: (raw_text, suggested, previewText, debug)
    suggested: { Razon_Social, TipoGasto, nroFactura, Total, TotalNum, Moneda, Fecha, Detalle }
    """
    debug: Dict = {"engine": [], "pages": []}
    all_text = ""
    pages_words: List[list] = []

    # 1) PyMuPDF (texto embebido + OCR zonal)
    if fitz is not None:
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = min(max_pages, len(doc)) if max_pages else len(doc)
            for i in range(pages):
                page = doc[i]
                words = page.get_text("words")
                pages_words.append(words)

                page_text = page.get_text("text") or ""
                all_text += page_text + "\n"

                # Zonas útiles
                near_fecha       = _extract_near(page, words, r'(fecha|emisi[oó]n|date)')
                near_moneda      = _extract_near(page, words, r'(moneda|currency|divisa)')
                near_total       = _extract_near(page, words, r'(total|importe\s*total|total\s*a\s*pagar)')
                # NUEVO: “NO GRAVADO”
                near_no_gravado  = _extract_near(page, words, r'(no\s*gravado)')

                debug["pages"].append({
                    "i": i,
                    "len_words": len(words),
                    "near_fecha": near_fecha,
                    "near_moneda": near_moneda,
                    "near_total": near_total,
                    "near_no_gravado": near_no_gravado,  # ← nuevo
                })
            debug["engine"].append("pymupdf")
        except Exception as e:
            logging.warning(f"PyMuPDF parse error: {e}")

    # 2) OCR full si el texto embebido es poco
    clean = _normalize_spaces(all_text)
    if not clean or len(clean) < 60:
        ocr_full = _extract_text_easyocr_full(file_bytes, dpi=dpi, max_pages=max_pages)
        if ocr_full:
            debug["engine"].append("easyocr-full")
            all_text = (all_text + "\n" + ocr_full).strip()
            clean = _normalize_spaces(all_text)

    # 3) Parse de campos
    razon, tipo = _detect_proveedor(clean)
    nro = _detect_fact_number(clean, pages_words=pages_words)

    # Fecha
    fecha_iso = ""
    if parse_date and debug.get("pages"):
        for p in debug["pages"]:
            if p.get("near_fecha"):
                dt = parse_date(p["near_fecha"], settings={'DATE_ORDER': 'DMY'})
                if dt:
                    fecha_iso = dt.date().isoformat()
                    break
    if not fecha_iso:
        fecha_iso = _prefer_date_from_text(clean)

    # Moneda
    moneda = "ARS"
    if debug.get("pages"):
        for p in debug["pages"]:
            if p.get("near_moneda"):
                moneda = _detect_currency(p["near_moneda"])
                break
    if not moneda:
        moneda = _detect_currency(clean)

    # Total (general)
    total = None
    if debug.get("pages"):
        for p in debug["pages"]:
            if p.get("near_total"):
                total = _parse_number(p["near_total"])
                if total is not None:
                    break
    if total is None:
        t, mny = _detect_total_and_currency(clean)
        total = t
        if mny:
            moneda = mny or moneda

    # -------------------------
    # OVERRIDE para NO GRAVADO
    # -------------------------
    if tipo.lower() == "flete internacional" and razon in INTL_NO_GRAVADO_PROVS:
        no_gravado_val: Optional[float] = None

        # 1) Por layout (zona a la derecha de 'NO GRAVADO')
        if debug.get("pages"):
            for p in debug["pages"]:
                raw = p.get("near_no_gravado") or ""
                m = re.search(r"([\d\.,]{4,})", raw)
                if m:
                    v = _parse_number(m.group(1))
                    if v is not None:
                        no_gravado_val = v
                        break

        # 2) Si no, parse textual cerca del label
        if no_gravado_val is None:
            no_gravado_val = _detect_no_gravado_from_text(clean)

        # 3) Si encontramos un valor razonable, lo usamos
        if no_gravado_val is not None:
            total = no_gravado_val

    suggested = {
        "Razon_Social": razon,
        "TipoGasto": tipo,
        "nroFactura": nro,
        "Total": total,
        "TotalNum": total,
        "Moneda": moneda or "ARS",
        "Fecha": fecha_iso,
        "Detalle": "",
    }

    debug.update({
        "matchedProveedor": razon,
        "matchedTipo": tipo,
        "rawLen": len(all_text),
        "rawPreview": clean[:600],
    })

    preview = all_text[:3000]
    return all_text, suggested, preview, debug
