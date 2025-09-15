# app.py
import re, logging, datetime, os, requests, json
from typing import List, Tuple
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from flask_cors import CORS
import msal

from dotenv import load_dotenv  # <-- NUEVO

from ocr_despachos import extract_from_pdf
from ocr_facturas import extract_from_pdf as extract_factura  # OCR facturas

# Cargar variables desde .env si existe
load_dotenv()  # <-- NUEVO

logging.getLogger().setLevel(logging.DEBUG)

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------
# Configuración de la conexión a SQL Server (desde entorno)
# ---------------------------------------------------------------------
DB_URI = os.getenv("SQLALCHEMY_DATABASE_URI")
if not DB_URI:
    raise RuntimeError(
        "Falta SQLALCHEMY_DATABASE_URI en el entorno (.env). "
        "Ej: mssql+pyodbc://user:pass@host/db?driver=ODBC+Driver+17+for+SQL+Server"
    )

app.config['SQLALCHEMY_DATABASE_URI'] = DB_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Tamaño máximo de archivo (PDFs grandes)
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024  # 30 MB

# --- Configuración de SharePoint / Graph API (solo por entorno) ---
TENANT_ID     = os.getenv("AZ_TENANT_ID")
CLIENT_ID     = os.getenv("AZ_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZ_CLIENT_SECRET")
SITE_URL      = os.getenv("SP_SITE_URL")

_missing = [k for k, v in {
    "AZ_TENANT_ID": TENANT_ID,
    "AZ_CLIENT_ID": CLIENT_ID,
    "AZ_CLIENT_SECRET": CLIENT_SECRET,
    "SP_SITE_URL": SITE_URL,
}.items() if not v]
if _missing:
    raise RuntimeError(f"Faltan variables en .env: {', '.join(_missing)}")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]

# Inicialización ÚNICA de la instancia de SQLAlchemy
db = SQLAlchemy(app)

# === Toggle: sincronizar también la tabla ancha APP_Despachos_Resumen ===
USE_RESUMEN_ANCHO = True  # poné False si no querés mantener la tabla ancha


# ---------------------------------------------------------------------
# Helpers generales
# ---------------------------------------------------------------------
def normalize_despacho(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip()).upper()

def parse_float(val):
    """Convierte '55.393,56' o '55393.56' a float. Si falla, retorna None."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s_norm = s.replace(".", "").replace(",", ".")
    try:
        return float(s_norm)
    except Exception:
        try:
            return float(s)  # intento directo
        except Exception:
            return None

def _to_float_or_none(val):
    if val is None or str(val).strip() == "":
        return None
    s = str(val).strip()
    # eliminar todo lo que no sea dígito, punto, coma o signo menos
    s = re.sub(r"[^0-9,.\-]", "", s)
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except Exception:
        return None

def _resolve_tipogasto_id(valor):
    """
    Acepta un Id (string/int) o el nombre del tipo de gasto.
    Devuelve el IdGasto (int) o None si no se encuentra.
    """
    if valor is None:
        return None
    # ¿ya viene como id?
    try:
        return int(valor)
    except Exception:
        pass

    nombre = str(valor).strip()
    if not nombre:
        return None

    # comparación exacta (case-insensitive)
    tg = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == nombre.lower()).first()
    if tg:
        return tg.IdGasto

    # intento flexible (contiene)
    tg = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{nombre}%")).first()
    return tg.IdGasto if tg else None

def _resolve_tipogasto_name(valor):
    """
    Devuelve el nombre del tipo de gasto a partir de un id o nombre.
    """
    if valor is None:
        return None
    # si es id
    try:
        tg = TipoGasto.query.get(int(valor))
        return tg.TipoGasto if tg else None
    except Exception:
        pass
    # si es nombre
    nombre = str(valor).strip()
    if not nombre:
        return None
    tg = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == nombre.lower()).first()
    if tg:
        return tg.TipoGasto
    tg = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{nombre}%")).first()
    return tg.TipoGasto if tg else None

def safe_float(v):
    """
    Convierte strings con símbolos/espacios y separadores mixtos a float.
    Ej: 'AR$ 2.142.234,31' -> 2142234.31
    """
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == "" or s.lower() == "null":
        return None
    # eliminar todo lo que no sea dígito, punto, coma o signo menos
    s = re.sub(r"[^0-9,.\-]", "", s)
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except Exception:
        return None


# ---------------------------------------------------------------------
#  AUTENTICACIÓN GRAPH API
# ---------------------------------------------------------------------
def get_access_token():
    app_auth = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET
    )
    result = app_auth.acquire_token_for_client(scopes=SCOPE)
    if "access_token" not in result:
        print("Error en la autenticación:")
        print(result.get("error_description"))
        raise Exception(f"Error obteniendo token: {result}")
    return result["access_token"]

def graph_get(url):
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    return resp.json()

def graph_put(url, data, content_type="application/octet-stream"):
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type
    }
    resp = requests.put(url, headers=headers, data=data)
    resp.raise_for_status()
    return resp.json()

def find_sharepoint_doc_for_despacho(numero: str):
    """
    Busca en SharePoint (carpeta 'Despachos') un archivo cuyo nombre contenga el número
    de despacho (sin espacios). Devuelve {url, name} o None.
    """
    if not (SITE_ID and DRIVE_ID and numero):
        return None
    try:
        q = re.sub(r"\s+", "", numero or "")
        # Busca dentro de la carpeta /Despachos
        res = graph_get(
            f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}"
            f"/root:/Despachos:/search(q='{q}')"
        )
        for it in res.get("value", []):
            if "file" in it:
                return {"url": it.get("webUrl"), "name": it.get("name")}
    except Exception as e:
        logging.warning("find_sharepoint_doc_for_despacho: %s", e)
    return None


# ---------------------------------------------------------------------
#  Helpers de vínculos Factura↔Despacho (tabla puente)
# ---------------------------------------------------------------------
def _parse_despachos_payload(datos) -> List[str]:
    """
    Acepta múltiples formatos:
      - clave 'Despachos' como lista JSON, o string CSV, o lista en form-data (repetida)
      - si no viene 'Despachos', usa 'Despacho' (string único) como fallback
    Devuelve lista de IDs o códigos (strings).
    """
    # 1) si hay form-data repetido tipo Despachos=... varias veces
    if hasattr(datos, 'getlist'):
        items = datos.getlist('Despachos') or datos.getlist('despachos')
        if items:
            # a veces un único item trae un JSON
            if len(items) == 1 and items[0].strip().startswith('['):
                try:
                    return [x for x in json.loads(items[0]) if x]
                except Exception:
                    pass
            # si son varios, devolvemos tal cual
            flat = []
            for it in items:
                if it is None:
                    continue
                if isinstance(it, str) and ',' in it:
                    flat.extend([p.strip() for p in it.split(',') if p.strip()])
                else:
                    flat.append(it)
            if flat:
                return flat

    # 2) JSON o dict normal
    raw = datos.get('Despachos') or datos.get('despachos')
    if raw:
        if isinstance(raw, list):
            return [str(x).strip() for x in raw if str(x).strip()]
        if isinstance(raw, str):
            s = raw.strip()
            if s.startswith('['):
                try:
                    arr = json.loads(s)
                    return [str(x).strip() for x in arr if str(x).strip()]
                except Exception:
                    pass
            # CSV
            return [p.strip() for p in s.split(',') if p.strip()]

    # 3) fallback a 'Despacho' único
    uno = datos.get('Despacho') or datos.get('despacho')
    return [uno] if uno else []

def _resolve_despacho_ids(mixed_values: List[str]) -> List[Tuple[int, str]]:
    """
    Recibe lista de IDs (int/str) o códigos texto de despacho.
    Devuelve lista de tuplas (despacho_id, codigo_normalizado).
    Omite los que no se puedan resolver.
    """
    res = []
    for v in mixed_values:
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        # ¿viene como ID?
        try:
            did = int(s)
            drow = DespachoResumen.query.get(did)
            if drow:
                res.append((drow.ID, normalize_despacho(drow.Despacho or "")))
                continue
        except Exception:
            pass
        # si no es ID, lo tratamos como código
        code = normalize_despacho(s)
        drow = DespachoResumen.query.filter(
            func.replace(func.upper(func.ltrim(func.rtrim(DespachoResumen.Despacho))), ' ', '') == code
        ).first()
        if drow:
            res.append((drow.ID, normalize_despacho(drow.Despacho or "")))
    # deduplicar por ID
    seen = set()
    uniq = []
    for t in res:
        if t[0] not in seen:
            uniq.append(t); seen.add(t[0])
    return uniq

def _get_linked_despacho_ids(factura_id: int) -> List[int]:
    rows = FacturaDespacho.query.with_entities(FacturaDespacho.despacho_id)\
        .filter(FacturaDespacho.factura_id == factura_id).all()
    return [r[0] for r in rows]

def _replace_links(factura_id: int, new_ids: List[int]) -> None:
    """Reemplaza completamente el set de vínculos de una factura."""
    current_ids = set(_get_linked_despacho_ids(factura_id))
    target_ids  = set(new_ids)

    to_delete = current_ids - target_ids
    to_add    = target_ids - current_ids

    if to_delete:
        FacturaDespacho.query.filter(
            FacturaDespacho.factura_id == factura_id,
            FacturaDespacho.despacho_id.in_(list(to_delete))
        ).delete(synchronize_session=False)

    for did in to_add:
        try:
            db.session.add(FacturaDespacho(factura_id=factura_id, despacho_id=did))
            db.session.flush()
        except IntegrityError:
            db.session.rollback()  # par por si ya existía
    db.session.commit()

def _add_links(factura_id: int, more_ids: List[int]) -> None:
    """Agrega vínculos (sin borrar los existentes)."""
    current_ids = set(_get_linked_despacho_ids(factura_id))
    for did in more_ids:
        if did in current_ids:
            continue
        try:
            db.session.add(FacturaDespacho(factura_id=factura_id, despacho_id=did))
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
    db.session.commit()

def _recalc_for_despacho_ids(despacho_ids: List[int]) -> None:
    """Llama a los SPs para todos los códigos de esos despachos."""
    if not despacho_ids:
        return
    rows = DespachoResumen.query.with_entities(DespachoResumen.Despacho)\
        .filter(DespachoResumen.ID.in_(despacho_ids)).all()
    for (code,) in rows:
        if code:
            nro = normalize_despacho(code)
            sp_upsert_resumen_gasto(nro)
            if USE_RESUMEN_ANCHO:
                sp_sync_resumen_ancho(nro)


# ---------------------------------------------------------------------
#  HELPERS SHAREPOINT (Graph)
# ---------------------------------------------------------------------
def get_site_and_drive():
    """Obtiene el siteId y driveId de la biblioteca de Documentos a partir de SP_SITE_URL."""
    try:
        parsed = urlparse(SITE_URL)  # p.ej. https://netorg...sharepoint.com/sites/Despachos-Test
        host = parsed.netloc
        path = parsed.path or "/sites/root"  # incluye /sites/NombreSitio

        site = graph_get(f"https://graph.microsoft.com/v1.0/sites/{host}:{path}")
        site_id = site["id"]

        drives = graph_get(f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives")
        drive_id = None

        # intento 1: "Documentos" (ES)
        for d in drives.get("value", []):
            if d.get("name") == "Documentos":
                drive_id = d["id"]; break
        # intento 2: "Shared Documents" (EN) o "Documentos compartidos"
        if not drive_id:
            for d in drives.get("value", []):
                if d.get("name") in ("Shared Documents", "Documentos compartidos"):
                    drive_id = d["id"]; break

        if not drive_id:
            raise RuntimeError("No se encontró la biblioteca de Documentos en el sitio.")

        print(f"IDs obtenidos: Site ID = {site_id}, Drive ID = {drive_id}")
        return site_id, drive_id
    except Exception as e:
        import traceback
        print(f"Error al obtener Site ID o Drive ID: {e}")
        print(traceback.format_exc())
        return None, None

# Obtener los IDs al iniciar la aplicación
SITE_ID, DRIVE_ID = get_site_and_drive()


# ---------------------------------------------------------------------
#  MODELOS DE BASE DE DATOS
# ---------------------------------------------------------------------
class DespachoResumen(db.Model):
    __tablename__ = 'APP_Despachos_Resumen'
    __table_args__ = {'schema': 'dbo'}
    ID = db.Column('ID', db.Integer, primary_key=True)
    Despacho = db.Column('Despacho', db.String(50))
    Fecha = db.Column('Fecha', db.Date)
    FOB = db.Column('FOB', db.Float)
    Flete_Internacional = db.Column('Flete_Internacional', db.Float)
    Estadistica = db.Column('Estadistica', db.Float)
    Derechos_Importacion = db.Column('Derechos_Importacion', db.Float)
    Despachante = db.Column('Despachante', db.Float)
    Almacenaje = db.Column('Almacenaje', db.Float)
    Custodia = db.Column('Custodia', db.Float)
    Tipo_Cambio = db.Column('Tipo_Cambio', db.Float)
    Flete_Nacional = db.Column('Flete_Nacional', db.Float)
    Arancel = db.Column('Arancel', db.Float)  # mapea Arancel SIM IMPO
    DocUrl  = db.Column('DocUrl',  db.String(500), nullable=True)
    DocName = db.Column('DocName', db.String(255), nullable=True)
    HasDoc  = db.Column('HasDoc',  db.Boolean, default=False, nullable=False)

class TipoGasto(db.Model):
    __tablename__ = 'TipoGastosBI'
    __table_args__ = {'schema': 'dbo'}
    IdGasto = db.Column('IdGasto', db.Integer, primary_key=True)
    TipoGasto = db.Column('TipoGasto', db.String(50))

class Factura(db.Model):
    __tablename__ = 'APP_Despachos_Detalles'
    __table_args__ = {'schema': 'dbo'}
    ID = db.Column('ID', db.Integer, primary_key=True)
    Fecha = db.Column('Fecha', db.Date, nullable=True)
    Invoice = db.Column('Invoice', db.String(50), nullable=True)
    nroFactura = db.Column('nroFactura', db.String(50), nullable=True)
    OrdenPO = db.Column('OrdenPO', db.String(50), nullable=True)
    Importe = db.Column('Importe', db.Float, nullable=True)  # si podés, migrá a DECIMAL(18,2)
    SIMI_SIRA = db.Column('SIMI_SIRA', db.String(25), nullable=True)
    Descripcion = db.Column('Descripcion', db.String(100), nullable=True)
    Despacho = db.Column('Despacho', db.String(50), nullable=True)
    BL = db.Column('BL', db.String(50), nullable=True)
    Mercaderia = db.Column('Mercaderia', db.String(50), nullable=True)
    TipoGasto = db.Column('TipoGasto', db.Integer, nullable=True)  # IdGasto (FK lógica)
    Proveedor = db.Column('Proveedor', db.String(100), nullable=True)
    nroProveedor = db.Column('nroProveedor', db.String(50), nullable=True)
    Moneda = db.Column('Moneda', db.String(3), nullable=True)  # "ARS"/"USD"
    DocUrl  = db.Column('DocUrl',  db.String(500), nullable=True)
    DocName = db.Column('DocName', db.String(255), nullable=True)
    HasDoc  = db.Column('HasDoc',  db.Boolean, default=False, nullable=False)

# Tabla dinámica de totales
class ResumenGasto(db.Model):
    __tablename__ = 'App_Despachos_ResumenGasto'
    __table_args__ = {'schema': 'dbo'}
    NroDespacho = db.Column('NroDespacho', db.String(50), primary_key=True)
    TipoGastoId = db.Column('TipoGastoId', db.Integer, primary_key=True)
    Total       = db.Column('Total', db.Numeric(18, 2), nullable=False)

class FacturaDespacho(db.Model):
    __tablename__ = 'Factura_Despacho'
    __table_args__ = (
        db.UniqueConstraint('factura_id', 'despacho_id', name='UQ_Factura_Despacho_pair'),
        {'schema': 'dbo'}
    )
    id          = db.Column('id', db.Integer, primary_key=True)
    factura_id  = db.Column('factura_id', db.Integer, db.ForeignKey('dbo.APP_Despachos_Detalles.ID'), nullable=False)
    despacho_id = db.Column('despacho_id', db.Integer, db.ForeignKey('dbo.APP_Despachos_Resumen.ID'), nullable=False)
    created_at  = db.Column('created_at', db.DateTime, server_default=func.sysdatetime())
    created_by  = db.Column('created_by', db.String(128))


# ---------------------------------------------------------------------
#  HELPERS SERIALIZACIÓN
# ---------------------------------------------------------------------
def serializar_despacho(despacho):
    d = {c.name: getattr(despacho, c.name) for c in despacho.__table__.columns}
    if 'Fecha' in d and isinstance(d['Fecha'], datetime.date):
        d['Fecha'] = d['Fecha'].isoformat()

    # Añade info del adjunto (best-effort vía búsqueda en SharePoint)
    doc = find_sharepoint_doc_for_despacho(d.get("Despacho"))
    d["HasDoc"] = bool(doc)
    d["DocUrl"] = doc["url"] if doc else None
    d["DocName"] = doc["name"] if doc else None
    return d

def serializar_factura(factura):
    d = {c.name: getattr(factura, c.name) for c in factura.__table__.columns}
    if 'Fecha' in d and isinstance(d['Fecha'], datetime.date):
        d['Fecha'] = d['Fecha'].isoformat()
    return d


# ---------------------------------------------------------------------
#  WRAPPERS PARA SP
# ---------------------------------------------------------------------
def sp_upsert_resumen_gasto(nro_despacho: str):
    if not nro_despacho:
        return
    db.session.execute(text("EXEC dbo.SP_UpsertResumenGasto :nro"), {"nro": nro_despacho})
    db.session.commit()

def sp_sync_resumen_ancho(nro_despacho: str):
    """Sincroniza APP_Despachos_Resumen desde la tabla dinámica (si se usa)."""
    if not USE_RESUMEN_ANCHO or not nro_despacho:
        return
    db.session.execute(text("EXEC dbo.SP_Sync_Resumen_Desde_ResumenGasto :nro"), {"nro": nro_despacho})
    db.session.commit()

def sp_rebuild_resumen_gasto_todos():
    db.session.execute(text("EXEC dbo.SP_Rebuild_ResumenGasto_Todos"))
    db.session.commit()

def sp_sync_resumen_ancho_todos():
    if not USE_RESUMEN_ANCHO:
        return
    db.session.execute(text("EXEC dbo.SP_Sync_Resumen_Desde_ResumenGasto_Todos"))
    db.session.commit()


# ---------------------------------------------------------------------
#  RUTAS DE LA API
# ---------------------------------------------------------------------

# Buscar despachos por texto (para autocomplete server-side)
@app.post("/api/ocr/despacho")
def ocr_despacho():
    f = request.files.get("file") or request.files.get("documento")
    if not f:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    try:
        file_bytes = f.read()

        # parámetros opcionales
        try:
            max_pages = int(request.args.get("max_pages", 4))
        except:
            max_pages = 4
        max_pages = max(1, min(4, max_pages))

        try:
            dpi = int(request.args.get("dpi", 300))
        except:
            dpi = 300

        raw, suggested, preview, debug = extract_from_pdf(file_bytes, dpi=dpi, max_pages=max_pages)

        return jsonify({
            "ok": True,
            "source": "easyocr",
            "raw": raw,
            "suggested": suggested,
            "previewText": preview,
            "debug": debug if request.args.get("debug") else None
        })
    except Exception as e:
        logging.exception("Error en /api/ocr/despacho: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/ocr/factura")
def ocr_factura():
    f = request.files.get("file") or request.files.get("documento")
    if not f:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    try:
        file_bytes = f.read()
        max_pages = int(request.args.get("max_pages", 1) or 1)
        max_pages = max(1, min(2, max_pages))
        dpi = int(request.args.get("dpi", 300) or 300)
        raw, suggested, preview, debug = extract_factura(file_bytes, dpi=dpi, max_pages=max_pages)
        return jsonify({"ok": True, "source": "pdf-text+regex", "raw": raw, "suggested": suggested, "previewText": preview, "debug": debug})
    except Exception as e:
        logging.exception("Error en /api/ocr/factura: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500
    

# ======= HELPER: parseo de booleano desde querystring =======
def _as_bool(v) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("1", "true", "t", "yes", "y", "si", "sí")

# ======= ENDPOINT: listado con conteo de vínculos, ultrarrápido =======
@app.get("/api/despachos/links-count")
def despachos_links_count():
    try:
        sql = """
        ;WITH Links AS (
          -- Por tabla puente
          SELECT fd.despacho_id AS DespachoId, f.ID AS FacturaId
          FROM dbo.Factura_Despacho fd
          JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
          UNION
          -- Por columna texto (compat)
          SELECT d.ID AS DespachoId, f.ID AS FacturaId
          FROM dbo.APP_Despachos_Resumen d
          JOIN dbo.APP_Despachos_Detalles f
            ON REPLACE(UPPER(LTRIM(RTRIM(f.Despacho))), ' ', '') =
               REPLACE(UPPER(LTRIM(RTRIM(d.Despacho))), ' ', '')
        )
        SELECT d.ID,
               CAST(COUNT(DISTINCT l.FacturaId) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Resumen d
        LEFT JOIN Links l ON l.DespachoId = d.ID
        GROUP BY d.ID
        ORDER BY d.ID DESC;
        """
        rows = db.session.execute(text(sql)).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as e:
        logging.exception("despachos_links_count error: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.get("/api/facturas/with-links")
def facturas_with_links():
    """
    Devuelve facturas + cantidad de despachos vinculados (LinkedCount) en una sola consulta.

    Parámetros opcionales:
      - only_unlinked=1        -> devuelve solo las que no tienen vínculos
      - limit=200              -> cantidad de filas (default 500)
      - offset=0               -> desplazamiento para paginación
      - order=fecha_desc       -> uno de: fecha_desc | fecha_asc | id_desc | id_asc | importe_desc | importe_asc
    """
    try:
        only_unlinked = _as_bool(request.args.get("only_unlinked", "0"))
        try:
            limit = max(1, min(5000, int(request.args.get("limit", 500))))
        except Exception:
            limit = 500
        try:
            offset = max(0, int(request.args.get("offset", 0)))
        except Exception:
            offset = 0

        order_key = (request.args.get("order") or "fecha_desc").lower()
        order_sql_map = {
            "fecha_desc":   "f.Fecha DESC, f.ID DESC",
            "fecha_asc":    "f.Fecha ASC,  f.ID ASC",
            "id_desc":      "f.ID DESC",
            "id_asc":       "f.ID ASC",
            "importe_desc": "f.Importe DESC, f.ID DESC",
            "importe_asc":  "f.Importe ASC,  f.ID ASC",
        }
        order_clause = order_sql_map.get(order_key, "f.Fecha DESC, f.ID DESC")

        # Nota: HAVING va después del GROUP BY (y antes del ORDER BY)
        having_clause = "HAVING COUNT(fd.despacho_id) = 0" if only_unlinked else ""

        sql = f"""
        SELECT
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Despacho,
            f.TipoGasto        AS TipoGastoId,
            tg.TipoGasto       AS TipoGastoNombre,
            CAST(COUNT(fd.despacho_id) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Detalles f
        LEFT JOIN dbo.Factura_Despacho fd ON fd.factura_id = f.ID
        LEFT JOIN dbo.TipoGastosBI tg     ON tg.IdGasto = f.TipoGasto
        GROUP BY
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Despacho, f.TipoGasto, tg.TipoGasto
        {having_clause}
        ORDER BY {order_clause}
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY;
        """

        rows = db.session.execute(text(sql), {"offset": offset, "limit": limit}).mappings().all()
        items = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("Fecha"), (datetime.date, datetime.datetime)):
                d["Fecha"] = d["Fecha"].isoformat()
            items.append(d)

        return jsonify({"ok": True, "items": items})

    except Exception as e:
        logging.exception("facturas_with_links error: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


# ======= (Opcional) ENDPOINT: solo mapa de conteos por ID, mínimo payload =======
@app.get("/api/facturas/links-count")
def facturas_links_count():
    """
    Devuelve { ID, LinkedCount } para todas las facturas en una sola consulta.
    Útil si querés seguir usando tu listado actual y solo refrescar los conteos.
    """
    try:
        sql = """
        SELECT
            f.ID,
            CAST(COUNT(fd.despacho_id) AS INT) AS LinkedCount
        FROM dbo.APP_Despachos_Detalles f
        LEFT JOIN dbo.Factura_Despacho fd ON fd.factura_id = f.ID
        GROUP BY f.ID
        ORDER BY f.ID DESC;
        """
        rows = db.session.execute(text(sql)).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as e:
        logging.exception("facturas_links_count error: %s", e)
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/despachos/exists', methods=['GET'])
def despacho_existe():
    """
    Verifica si un despacho ya existe (ignorando espacios).
    GET /api/despachos/exists?numero=25001IC040...  -> { ok: true, exists: bool, id: int|None, numero: "..." }
    """
    numero = (request.args.get('numero') or "").strip()
    if not numero:
        return jsonify({"ok": False, "error": "Parámetro 'numero' requerido."}), 400

    normalizado = "".join(numero.split())  # quita espacios
    row = (
        db.session.query(DespachoResumen.ID, DespachoResumen.Despacho)
        .filter(func.replace(DespachoResumen.Despacho, ' ', '') == normalizado)
        .first()
    )

    return jsonify({
        "ok": True,
        "exists": bool(row),
        "id": row.ID if row else None,
        "numero": row.Despacho if row else normalizado
    }), 200

@app.route('/api/repositorio/')
@app.route('/api/repositorio/<path:folder_path>', methods=['GET'])
def consultar_repositorio(folder_path=''):
    try:
        if not SITE_ID or not DRIVE_ID:
            return jsonify({"error": "No se pudo conectar a SharePoint. Verifique las credenciales y permisos en el servidor."}), 500

        if folder_path == '':
            url = f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}/root/children"
        else:
            url = f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}/root:/{folder_path}:/children"

        items = graph_get(url)

        archivos_y_carpetas = []
        for item in items.get("value", []):
            if "name" in item:
                archivos_y_carpetas.append({
                    "nombre": item["name"],
                    "tipo": "Archivo" if "file" in item else "Carpeta",
                    "url": item["webUrl"],
                    "modificado_por": item.get("lastModifiedBy", {}).get("user", {}).get("displayName", "Desconocido")
                })
        return jsonify(archivos_y_carpetas), 200

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return jsonify({"error": f"Ocurrió un error al consultar el repositorio: {str(e)}"}), 500

@app.route('/api/tipos-gasto', methods=['GET'])
def obtener_tipos_gasto():
    try:
        tipos = TipoGasto.query.all()
        tipos_serializados = [{"IdGasto": t.IdGasto, "TipoGasto": t.TipoGasto} for t in tipos]
        return jsonify(tipos_serializados), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/despachos', methods=['GET'])
def obtener_despachos():
    try:
        despachos = DespachoResumen.query.all()
        despachos_serializados = [serializar_despacho(d) for d in despachos]
        return jsonify(despachos_serializados), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Autocompletado server-side opcional (para listas grandes)
@app.get("/api/despachos/search")
def search_despachos():
    try:
        q = (request.args.get("q") or "").strip().upper()
        if not q:
            return jsonify({"items": []})
        rows = db.session.query(DespachoResumen.ID, DespachoResumen.Despacho)\
            .filter(func.upper(DespachoResumen.Despacho).like(f"%{q}%"))\
            .order_by(DespachoResumen.Despacho).limit(20).all()
        return jsonify({"items": [{"ID": r.ID, "Despacho": r.Despacho} for r in rows]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/despachos', methods=['POST'])
def crear_despacho():
    try:
        datos = request.form
        archivo = request.files.get('documento')

        # Normalizamos Nro. Despacho y validamos duplicado antes de guardar
        nro = normalize_despacho(datos.get('Despacho'))
        if not nro:
            return jsonify({"error": "El campo 'Despacho' es obligatorio."}), 400

        dup = (
            db.session.query(DespachoResumen.ID)
            .filter(func.replace(DespachoResumen.Despacho, ' ', '') == nro)
            .first()
        )
        if dup:
            return jsonify({"error": "El despacho ya existe.", "exists": True, "id": dup.ID}), 409

        # Subida opcional a SharePoint
        uploaded = None
        if archivo:
            if not SITE_ID or not DRIVE_ID:
                return jsonify({"error": "No se pudo conectar a SharePoint. Verifique las credenciales y permisos en el servidor."}), 500
            file_bytes = archivo.read()
            url = f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}/root:/Despachos/{archivo.filename}:/content"
            uploaded = graph_put(url, file_bytes)
            print(f"Archivo subido a SharePoint: {uploaded.get('id')}")

        arancel_str = datos.get('Arancel_Sim_Impo') or datos.get('Arancel')

        nuevo = DespachoResumen(
            Despacho=nro,
            Fecha=datetime.datetime.strptime(datos.get('Fecha'), '%Y-%m-%d').date() if datos.get('Fecha') else None,
            FOB=parse_float(datos.get('FOB')),
            Estadistica=parse_float(datos.get('Estadistica')),
            Derechos_Importacion=parse_float(datos.get('Derechos_Importacion')),
            Tipo_Cambio=parse_float(datos.get('Tipo_Cambio')),
            Arancel=parse_float(arancel_str),
            DocUrl  =(uploaded or {}).get("webUrl"),
            DocName =archivo.filename if archivo else None,
            HasDoc  =True if uploaded else False,
        )
        db.session.add(nuevo)
        db.session.commit()

        return jsonify({"mensaje": "Despacho creado con éxito y documento subido a SharePoint", "id": nuevo.ID}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al crear el despacho o subir el documento: {str(e)}"}), 500

# Forzar entero en la ruta para no chocar con '/exists'
@app.route('/api/despachos/<int:id>', methods=['GET'])
def obtener_despacho_por_id(id):
    try:
        despacho = DespachoResumen.query.get_or_404(id)
        return jsonify(serializar_despacho(despacho)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route('/api/despachos/<int:id>', methods=['PUT'])
def actualizar_despacho(id):
    try:
        if not request.json:
            return jsonify({"error": "El cuerpo de la solicitud debe ser JSON"}), 400

        d = request.json
        despacho_a_actualizar = DespachoResumen.query.get_or_404(id)

        if 'Despacho' in d and d.get('Despacho'):
            despacho_a_actualizar.Despacho = normalize_despacho(d.get('Despacho'))

        if 'Fecha' in d and d.get('Fecha'):
            despacho_a_actualizar.Fecha = datetime.datetime.strptime(d.get('Fecha'), '%Y-%m-%d').date()

        if 'FOB' in d:
            despacho_a_actualizar.FOB = parse_float(d.get('FOB'))
        if 'Flete_Internacional' in d:
            despacho_a_actualizar.Flete_Internacional = parse_float(d.get('Flete_Internacional'))
        if 'Estadistica' in d:
            despacho_a_actualizar.Estadistica = parse_float(d.get('Estadistica'))
        if 'Derechos_Importacion' in d:
            despacho_a_actualizar.Derechos_Importacion = parse_float(d.get('Derechos_Importacion'))
        if 'Despachante' in d:
            despacho_a_actualizar.Despachante = parse_float(d.get('Despachante'))
        if 'Almacenaje' in d:
            despacho_a_actualizar.Almacenaje = parse_float(d.get('Almacenaje'))
        if 'Custodia' in d:
            despacho_a_actualizar.Custodia = parse_float(d.get('Custodia'))
        if 'Tipo_Cambio' in d:
            despacho_a_actualizar.Tipo_Cambio = parse_float(d.get('Tipo_Cambio'))
        if 'Flete_Nacional' in d:
            despacho_a_actualizar.Flete_Nacional = parse_float(d.get('Flete_Nacional'))
        if 'Arancel' in d or 'Arancel_Sim_Impo' in d:
            despacho_a_actualizar.Arancel = parse_float(d.get('Arancel') or d.get('Arancel_Sim_Impo'))

        db.session.commit()
        return jsonify({"mensaje": "Despacho actualizado con éxito", "id": despacho_a_actualizar.ID}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al actualizar el despacho: {str(e)}"}), 500

@app.route('/api/despachos/list', methods=['GET'])
def obtener_lista_despachos():
    try:
        despachos = db.session.query(DespachoResumen.ID, DespachoResumen.Despacho).all()
        lista_despachos = [{"ID": d.ID, "Despacho": d.Despacho} for d in despachos]
        return jsonify(lista_despachos), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/facturas', methods=['GET'])
def obtener_facturas():
    try:
        facturas = Factura.query.all()
        facturas_serializadas = [serializar_factura(f) for f in facturas]
        return jsonify(facturas_serializadas), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/facturas/<int:id>', methods=['GET'])
def obtener_factura_por_id(id):
    try:
        factura = Factura.query.get_or_404(id)
        return jsonify(serializar_factura(factura)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 404

# Factura + vínculos (para pantallas de edición)
@app.get("/api/facturas/<int:id>/full")
def get_factura_full(id):
    try:
        f = Factura.query.get_or_404(id)
        base = serializar_factura(f)
        ids = _get_linked_despacho_ids(id)
        linked = []
        if ids:
            rows = DespachoResumen.query.with_entities(
                DespachoResumen.ID, DespachoResumen.Despacho, DespachoResumen.Fecha
            ).filter(DespachoResumen.ID.in_(ids)).all()
            for r in rows:
                linked.append({
                    "ID": r.ID,
                    "Despacho": r.Despacho,
                    "Fecha": r.Fecha.isoformat() if r.Fecha else None
                })
        base["DespachosLinked"] = linked
        return jsonify({"ok": True, "factura": base})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/facturas/<int:id>', methods=['PUT'])
def actualizar_factura(id):
    try:
        if not request.json:
            return jsonify({"error": "El cuerpo de la solicitud debe ser JSON"}), 400

        datos = request.json
        f = Factura.query.get_or_404(id)

        # vínculos actuales (para recalcular después)
        prev_link_ids = set(_get_linked_despacho_ids(id))
        prev_despacho_code = normalize_despacho(f.Despacho or "")

        if 'Fecha' in datos and datos.get('Fecha'):
            f.Fecha = datetime.datetime.strptime(datos.get('Fecha'), '%Y-%m-%d').date()
        if 'Invoice' in datos:        f.Invoice = (datos.get('Invoice') or "").strip()
        if 'nroFactura' in datos:     f.nroFactura = (datos.get('nroFactura') or "").strip()
        if 'OrdenPO' in datos:        f.OrdenPO = (datos.get('OrdenPO') or "").strip()
        if 'Importe' in datos:        f.Importe = _to_float_or_none(datos.get('Importe'))
        if 'SIMI_SIRA' in datos:      f.SIMI_SIRA = (datos.get('SIMI_SIRA') or "").strip()
        if 'Descripcion' in datos:    f.Descripcion = (datos.get('Descripcion') or "").strip()

        # normalizar siempre
        if 'Despacho' in datos:
            f.Despacho = normalize_despacho(datos.get('Despacho'))

        if 'BL' in datos:             f.BL = (datos.get('BL') or "").strip()
        if 'Mercaderia' in datos:     f.Mercaderia = (datos.get('Mercaderia') or "").strip()
        if 'Proveedor' in datos:      f.Proveedor = (datos.get('Proveedor') or "").strip()
        if 'nroProveedor' in datos:   f.nroProveedor = (datos.get('nroProveedor') or "").strip()
        if 'TipoGasto' in datos:      f.TipoGasto = _resolve_tipogasto_id(datos.get('TipoGasto'))
        if 'Moneda' in datos:         f.Moneda = ((datos.get('Moneda') or "ARS").strip()[:3]).upper()

        db.session.commit()

        # ----- VÍNCULOS FACTURA↔DESPACHO -----
        new_link_ids: List[int] = None  # type: ignore

        if 'Despachos' in datos or 'despachos' in datos:
            despachos_raw = _parse_despachos_payload(datos)
            links = _resolve_despacho_ids(despachos_raw)
            ids = [did for (did, _) in links]
            _replace_links(f.ID, ids)
            new_link_ids = ids
        elif 'Despacho' in datos or 'despacho' in datos:
            # sincronizar a 1 solo vínculo basado en el texto
            code = normalize_despacho(datos.get('Despacho') or datos.get('despacho') or "")
            if code:
                links = _resolve_despacho_ids([code])
                if links:
                    _replace_links(f.ID, [links[0][0]])
                    new_link_ids = [links[0][0]]
                else:
                    _replace_links(f.ID, [])
                    new_link_ids = []
            else:
                _replace_links(f.ID, [])
                new_link_ids = []
        else:
            # sin cambios explícitos
            new_link_ids = list(prev_link_ids)

        # ----- RECÁLCULOS -----
        gone = set(prev_link_ids) - set(new_link_ids or [])
        came = set(new_link_ids or []) - set(prev_link_ids)

        if gone:
            _recalc_for_despacho_ids(list(gone))
        if came:
            _recalc_for_despacho_ids(list(came))

        # además, compatibilidad por columna texto
        new_despacho_code = normalize_despacho(f.Despacho or "")
        if prev_despacho_code and prev_despacho_code != new_despacho_code:
            sp_upsert_resumen_gasto(prev_despacho_code)
            if USE_RESUMEN_ANCHO:
                sp_sync_resumen_ancho(prev_despacho_code)
        if new_despacho_code:
            sp_upsert_resumen_gasto(new_despacho_code)
            if USE_RESUMEN_ANCHO:
                sp_sync_resumen_ancho(new_despacho_code)

        return jsonify({"mensaje": "Factura actualizada con éxito", "id": f.ID}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al actualizar la factura: {str(e)}"}), 500

@app.route('/api/facturas', methods=['POST'])
def crear_factura():
    try:
        datos = request.form if request.form else (request.get_json() or {})
        archivo = request.files.get('documento')

        tg_id = _resolve_tipogasto_id(datos.get('TipoGasto'))
        tg_name = _resolve_tipogasto_name(datos.get('TipoGasto')) or "Generales"

        uploaded = None
        file_bytes = None
        if archivo:
            if not SITE_ID or not DRIVE_ID:
                return jsonify({"error": "No se pudo conectar a SharePoint. Verifique las credenciales y permisos en el servidor."}), 500
            file_bytes = archivo.read()
            folder = f"Gastos/{tg_name}"
            sp_path = f"/{folder}/{archivo.filename}"
            url = f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}/root:{sp_path}:/content"
            uploaded = graph_put(url, file_bytes)

        nueva = Factura(
            Fecha=datetime.datetime.strptime(datos.get('Fecha'), '%Y-%m-%d').date() if datos.get('Fecha') else None,
            Invoice=(datos.get('Invoice') or "").strip(),
            nroFactura=(datos.get('nroFactura') or "").strip(),
            OrdenPO=(datos.get('OrdenPO') or "").strip(),
            Importe=safe_float(datos.get('Importe')),
            SIMI_SIRA=(datos.get('SIMI_SIRA') or "").strip(),
            Descripcion=(datos.get('Descripcion') or "").strip(),
            Despacho=normalize_despacho(datos.get('Despacho')),
            BL=(datos.get('BL') or "").strip(),
            Mercaderia=(datos.get('Mercaderia') or "").strip(),
            TipoGasto=tg_id,
            Proveedor=(datos.get('Proveedor') or "").strip(),
            nroProveedor=(datos.get('nroProveedor') or "").strip(),
            Moneda=((datos.get('Moneda') or "ARS").strip()[:3]).upper(),
            DocUrl  = (uploaded or {}).get("webUrl"),
            DocName = archivo.filename if archivo else None,
            HasDoc  = True if uploaded else False,
        )

        db.session.add(nueva)
        db.session.commit()

        # ----- VÍNCULOS FACTURA↔DESPACHO -----
        despachos_raw = _parse_despachos_payload(datos)
        links = _resolve_despacho_ids(despachos_raw)

        if links:
            ids = [did for (did, _) in links]
            _replace_links(nueva.ID, ids)
            _recalc_for_despacho_ids(ids)
        else:
            # fallback: si se guardó en columna texto y existe, crear 1 vínculo
            if nueva.Despacho:
                lk = _resolve_despacho_ids([nueva.Despacho])
                if lk:
                    _replace_links(nueva.ID, [lk[0][0]])
                    _recalc_for_despacho_ids([lk[0][0]])

        # recálculo por compatibilidad (columna texto)
        nro = normalize_despacho(nueva.Despacho or "")
        if nro:
            sp_upsert_resumen_gasto(nro)
            if USE_RESUMEN_ANCHO:
                sp_sync_resumen_ancho(nro)

        resp = {"mensaje": "Factura creada con éxito", "id": nueva.ID}
        if uploaded:
            resp["sharepoint"] = {"id": uploaded.get("id"), "webUrl": uploaded.get("webUrl")}
        return jsonify(resp), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Error creando factura: {str(e)}"}), 500

@app.route('/api/facturas/<int:id>', methods=['DELETE'])
def eliminar_factura(id):
    try:
        f = Factura.query.get_or_404(id)

        # vínculos antes de borrar
        link_ids = _get_linked_despacho_ids(id)

        # código texto (compat)
        code = normalize_despacho(f.Despacho or "")

        # borrar vínculos primero (por si no hay cascade)
        if link_ids:
            FacturaDespacho.query.filter(FacturaDespacho.factura_id == id).delete(synchronize_session=False)

        db.session.delete(f)
        db.session.commit()

        # recalcular para todos los despachos vinculados + el código de texto
        if link_ids:
            _recalc_for_despacho_ids(link_ids)
        if code:
            sp_upsert_resumen_gasto(code)
            if USE_RESUMEN_ANCHO:
                sp_sync_resumen_ancho(code)

        return jsonify({"ok": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500

# Resumen por tipo de gasto (normalizado por código)
@app.get("/api/despachos/<string:nro>/resumen-gasto")
def get_resumen_gasto(nro):
    try:
        sql = """
        DECLARE @n NVARCHAR(50) = :nro;

        SELECT rg.TipoGastoId, tg.TipoGasto AS TipoGastoNombre, rg.Total
        FROM dbo.App_Despachos_ResumenGasto rg
        JOIN dbo.TipoGastosBI tg ON tg.IdGasto = rg.TipoGastoId
        WHERE REPLACE(UPPER(LTRIM(RTRIM(rg.NroDespacho))), ' ', '')
              = REPLACE(UPPER(LTRIM(RTRIM(@n))), ' ', '')
        ORDER BY tg.TipoGasto;
        """
        rows = db.session.execute(text(sql), {"nro": nro}).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Recalculo manual de un despacho
@app.post("/api/despachos/<string:nro>/recalc")
def recalc_un_despacho(nro):
    try:
        sp_upsert_resumen_gasto(nro)
        if USE_RESUMEN_ANCHO:
            sp_sync_resumen_ancho(nro)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Rebuild masivo
@app.post("/api/resumen/rebuild")
def rebuild_global():
    try:
        sp_rebuild_resumen_gasto_todos()
        if USE_RESUMEN_ANCHO:
            sp_sync_resumen_ancho_todos()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Facturas (compat) por código de despacho (columna texto)
@app.get("/api/despachos/<string:nro>/facturas")
def get_facturas_por_despacho(nro):
    try:
        sql = """
        DECLARE @n NVARCHAR(50) = :nro;

        SELECT
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Despacho,
            f.TipoGasto        AS TipoGastoId,
            tg.TipoGasto       AS TipoGastoNombre
        FROM dbo.APP_Despachos_Detalles f
        LEFT JOIN dbo.TipoGastosBI tg ON tg.IdGasto = f.TipoGasto
        WHERE REPLACE(UPPER(LTRIM(RTRIM(f.Despacho))), ' ', '') 
              = REPLACE(UPPER(LTRIM(RTRIM(@n))), ' ', '')
        ORDER BY f.Fecha DESC, f.ID DESC;
        """
        rows = db.session.execute(text(sql), {"nro": nro}).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ======= ENDPOINTS PARA MANEJAR VÍNCULOS FACTURA↔DESPACHO =======

# Lista de despachos vinculados a una factura (por ID)
@app.get("/api/facturas/<int:fid>/despachos")
def get_despachos_de_factura(fid):
    try:
        _ = Factura.query.get_or_404(fid)
        ids = _get_linked_despacho_ids(fid)
        if not ids:
            return jsonify({"ok": True, "items": []})

        rows = DespachoResumen.query.with_entities(
            DespachoResumen.ID.label("ID"),
            DespachoResumen.Despacho.label("Despacho"),
            DespachoResumen.Fecha.label("Fecha")
        ).filter(DespachoResumen.ID.in_(ids)).all()

        items = []
        for r in rows:
            items.append({
                "ID": r.ID,
                "Despacho": r.Despacho,
                "DespachoNormalizado": normalize_despacho(r.Despacho or ""),
                "Fecha": r.Fecha.isoformat() if r.Fecha else None
            })
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Alta/actualización de vínculos (replace o add)
@app.post("/api/facturas/<int:fid>/despachos")
def set_despachos_de_factura(fid):
    """
    Body JSON o form-data:
      { "despachos": [1, "25001IC040..."] }   # IDs o Códigos
    Query string: ?mode=replace|add (por defecto replace)
    """
    try:
        Factura.query.get_or_404(fid)  # valida que exista
        datos = request.get_json(silent=True) or request.form or {}
        mode = (request.args.get("mode") or "replace").lower()

        raw = datos.get("despachos") or datos.get("Despachos")
        if raw is None:
            raw = _parse_despachos_payload(datos)
        elif isinstance(raw, str):
            if raw.strip().startswith('['):
                raw = json.loads(raw)
            else:
                raw = [p.strip() for p in raw.split(',') if p.strip()]

        links = _resolve_despacho_ids([str(x) for x in (raw or [])])
        ids = [did for (did, _) in links]

        if mode == "add":
            _add_links(fid, ids)
        else:
            _replace_links(fid, ids)

        _recalc_for_despacho_ids(ids)
        return jsonify({"ok": True, "factura_id": fid, "linked_ids": ids})
    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500

# Quitar un vínculo puntual
@app.delete("/api/facturas/<int:fid>/despachos/<int:despacho_id>")
def remove_link(fid, despacho_id):
    try:
        Factura.query.get_or_404(fid)
        FacturaDespacho.query.filter_by(factura_id=fid, despacho_id=despacho_id).delete(synchronize_session=False)
        db.session.commit()
        _recalc_for_despacho_ids([despacho_id])
        return jsonify({"ok": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500

# Facturas vinculadas a un despacho (por ID) usando la tabla puente
@app.get("/api/despachos/<int:despacho_id>/facturas-linked")
def get_facturas_linked_por_despacho(despacho_id):
    try:
        sql = """
        SELECT
            f.ID, f.Fecha, f.Proveedor, f.nroFactura, f.Invoice,
            f.Moneda, f.Importe, f.DocUrl, f.DocName, f.HasDoc,
            f.Despacho,
            f.TipoGasto        AS TipoGastoId,
            tg.TipoGasto       AS TipoGastoNombre
        FROM dbo.Factura_Despacho fd
        JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
        LEFT JOIN dbo.TipoGastosBI tg ON tg.IdGasto = f.TipoGasto
        WHERE fd.despacho_id = :did
        ORDER BY f.Fecha DESC, f.ID DESC;
        """
        rows = db.session.execute(text(sql), {"did": despacho_id}).mappings().all()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ---------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=True)

