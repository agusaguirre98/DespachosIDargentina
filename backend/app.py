# app.py
from __future__ import annotations

import re, logging, datetime, os, requests, json, html
from typing import List, Tuple, Optional
from urllib.parse import urlparse

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, text, create_engine, PrimaryKeyConstraint, bindparam
from sqlalchemy.exc import IntegrityError
from flask_cors import CORS
import msal

from dotenv import load_dotenv  # <-- .env

from ocr_despachos import extract_from_pdf
from ocr_facturas import extract_from_pdf as extract_factura  # OCR facturas

# Cargar variables desde .env si existe
load_dotenv()

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
db = SQLAlchemy(app)

# --- Conexión REMOTA (ASIGNADOR) SOLO LECTURA ---
ASIGNADOR_DB_URI = os.getenv("ASIGNADOR_DB_URI")
if not ASIGNADOR_DB_URI:
    raise RuntimeError(
        "Falta ASIGNADOR_DB_URI en .env (base ID_ASIGNADOR_V1_TEST)."
    )

# Engine independiente (read-only lógico a nivel de nuestra app)
engine_asignador = create_engine(
    ASIGNADOR_DB_URI,
    pool_pre_ping=True,        # evita conexiones muertas
    pool_recycle=1800          # recicla cada 30 min
)

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

# === Toggle: sincronizar también la tabla ancha APP_Despachos_Resumen ===
USE_RESUMEN_ANCHO = True  # poné False si no querés mantener la tabla ancha

# Tipos permitidos de despacho
TIPOS_DESPACHO_VALIDOS = {"ZFI", "ZFE", "IC04", "IC05"}

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
    try:
        return int(valor)
    except Exception:
        pass

    nombre = str(valor).strip()
    if not nombre:
        return None

    tg = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == nombre.lower()).first()
    if tg:
        return tg.IdGasto

    tg = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{nombre}%")).first()
    return tg.IdGasto if tg else None

def _resolve_tipogasto_name(valor):
    """
    Devuelve el nombre del tipo de gasto a partir de un id o nombre.
    """
    if valor is None:
        return None
    try:
        tg = TipoGasto.query.get(int(valor))
        return tg.TipoGasto if tg else None
    except Exception:
        pass
    nombre = str(valor).strip()
    if not nombre:
        return None
    tg = TipoGasto.query.filter(func.lower(TipoGasto.TipoGasto) == nombre.lower()).first()
    if tg:
        return tg.TipoGasto
    tg = TipoGasto.query.filter(TipoGasto.TipoGasto.ilike(f"%{nombre}%")).first()
    return tg.TipoGasto if tg else None

def safe_float(v):
    """Convierte strings con símbolos/espacios y separadores mixtos a float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == "" or s.lower() == "null":
        return None
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

# ----------------------------------------------------------------------
#  HELPERS ZF
# ----------------------------------------------------------------------
def _ensure_zfi(desp: DespachoResumen):
    if not desp or (desp.TipoDespacho or "").upper() != "ZFI":
        raise ValueError("El ID indicado no corresponde a un ZFI.")

def _ensure_zfe(desp: DespachoResumen):
    if not desp or (desp.TipoDespacho or "").upper() != "ZFE":
        raise ValueError("El ID indicado no corresponde a un ZFE.")

def zf_grupo_to_json(g: ZFGrupo, include_items=True):
    if not g:
        return None
    zfi = DespachoResumen.query.get(g.ZFI_ID)
    out = {
        "ZF_GroupID": g.ZF_GroupID,
        "OC_ID": g.OC_ID,
        "ZFI": {
            "ZFI_ID": g.ZFI_ID,
            "Despacho": zfi.Despacho if zfi else None,
            "Fecha": zfi.Fecha.isoformat() if (zfi and zfi.Fecha) else None,
        },
    }
    if include_items:
        q = db.session.query(
            ZFVinculo.ZFE_ID,
            DespachoResumen.Despacho,
            DespachoResumen.Fecha
        ).join(
            DespachoResumen, DespachoResumen.ID == ZFVinculo.ZFE_ID
        ).filter(
            ZFVinculo.ZF_GroupID == g.ZF_GroupID
        ).all()
        out["ZFEs"] = [{
            "ZFE_ID": r.ZFE_ID,
            "Despacho": r.Despacho,
            "Fecha": r.Fecha.isoformat() if r.Fecha else None
        } for r in q]
        out["ZFE_Count"] = len(out["ZFEs"])
    return out


def query_oc_lines(oc_id):
    # asegurar tipo numérico si aplica
    try:
        oc_id = int(str(oc_id))
    except Exception:
        pass

    sql = text("""
        SELECT
            C.CODIGO                       AS SKU,
            C.DESCRIPCION                  AS Descripcion,
            CAST(F.CANTIDAD AS float)      AS Cantidad,
            TAO.CODIGO             AS  Talle   
        FROM dbo.ERP_ORDENES_COMPRA_ARTICULOS AS B
        JOIN dbo.ERP_ORDENES_COMPRA_ARTICULOS_ITEMS AS F
          ON B.ORDEN_COMPRA_ARTICULO_ID = F.ORDEN_COMPRA_ARTICULO_ID
        JOIN dbo.ERP_ARTICULOS AS C
          ON B.ARTICULO_ID = C.ARTICULO_ID
        JOIN dbo.ERP_ORDENES_COMPRA AS A
          ON A.ORDEN_COMPRA_ID = B.ORDEN_COMPRA_ID
        LEFT JOIN dbo.ERP_ARTICULOS_ITEMS AS AI
          ON AI.ARTICULO_ITEM_ID = F.ARTICULO_ITEM_ID
        LEFT JOIN dbo.ERP_TALLES_ARTICULOS_OPCIONES AS TAO
          ON TAO.TALLE_ARTICULO_OPCION_ID = AI.TALLE_ARTICULO_OPCION_ID
        WHERE A.ORDEN_COMPRA_ID = :oc_id
    """)

    # ⚠️ Usar la conexión ASIGNADOR (no db.session)
    with engine_asignador.begin() as conn:
        rows = conn.execute(sql, {"oc_id": oc_id}).mappings().all()

    return [
        {
            "SKU": r["SKU"],
            "Descripcion": r["Descripcion"],
            "Talle": (r["Talle"] or "").strip(),
            "Cantidad": float(r["Cantidad"] or 0.0),
        }
        for r in rows
    ]



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
    """Busca en SharePoint (carpeta 'Despachos') un archivo cuyo nombre contenga el número."""
    if not (SITE_ID and DRIVE_ID and numero):
        return None
    try:
        q = re.sub(r"\s+", "", numero or "")
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
    # 1) form-data con claves repetidas
    if hasattr(datos, 'getlist'):
        items = datos.getlist('Despachos') or datos.getlist('despachos')
        if items:
            if len(items) == 1 and items[0].strip().startswith('['):
                try:
                    return [x for x in json.loads(items[0]) if x]
                except Exception:
                    pass
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
            return [p.strip() for p in s.split(',') if p.strip()]
    # 3) fallback a 'Despacho' único
    uno = datos.get('Despacho') or datos.get('despacho')
    return [uno] if uno else []

def _resolve_despacho_ids(mixed_values: List[str]) -> List[Tuple[int, str]]:
    res = []
    for v in mixed_values:
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        try:
            did = int(s)
            drow = DespachoResumen.query.get(did)
            if drow:
                res.append((drow.ID, normalize_despacho(drow.Despacho or "")))
                continue
        except Exception:
            pass
        code = normalize_despacho(s)
        drow = DespachoResumen.query.filter(
            func.replace(func.upper(func.ltrim(func.rtrim(DespachoResumen.Despacho))), ' ', '') == code
        ).first()
        if drow:
            res.append((drow.ID, normalize_despacho(drow.Despacho or "")))
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
            db.session.rollback()
    db.session.commit()

def _add_links(factura_id: int, more_ids: List[int]) -> None:
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
        parsed = urlparse(SITE_URL)
        host = parsed.netloc
        path = parsed.path or "/sites/root"

        site = graph_get(f"https://graph.microsoft.com/v1.0/sites/{host}:{path}")
        site_id = site["id"]

        drives = graph_get(f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives")
        drive_id = None

        for d in drives.get("value", []):
            if d.get("name") == "Documentos":
                drive_id = d["id"]; break
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
    OC_ID = db.Column('OC_ID', db.String(50), nullable=True)
    TipoDespacho = db.Column('TipoDespacho', db.String(10), nullable=True)
    FOB = db.Column('FOB', db.Float)
    Flete_Internacional = db.Column('Flete_Internacional', db.Float)
    Estadistica = db.Column('Estadistica', db.Float)
    Derechos_Importacion = db.Column('Derechos_Importacion', db.Float)
    Despachante = db.Column('Despachante', db.Float)
    Almacenaje = db.Column('Almacenaje', db.Float)
    Custodia = db.Column('Custodia', db.Float)
    Tipo_Cambio = db.Column('Tipo_Cambio', db.Float)
    Flete_Nacional = db.Column('Flete_Nacional', db.Float)
    Arancel = db.Column('Arancel', db.Float)
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
    Importe = db.Column('Importe', db.Float, nullable=True)  # (ideal DECIMAL(18,2))
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

class ZFGrupo(db.Model):
    __tablename__ = 'ZF_Grupo'
    __table_args__ = {'schema': 'dbo'}
    ZF_GroupID = db.Column('ZF_GroupID', db.Integer, primary_key=True)
    OC_ID      = db.Column('OC_ID', db.String(50), nullable=False)
    ZFI_ID     = db.Column('ZFI_ID', db.Integer, nullable=False)  # 1 grupo por ZFI (lo validamos en código)
    CreatedAt  = db.Column('CreatedAt', db.DateTime, server_default=func.sysdatetime())
    CreatedBy  = db.Column('CreatedBy', db.String(128), nullable=True)

class ZFVinculo(db.Model):
    __tablename__ = 'ZF_Vinculos'
    __table_args__ = (
        PrimaryKeyConstraint('ZF_GroupID', 'ZFE_ID', name='PK_ZF_Vinculos'),
        {'schema': 'dbo'}
    )
    ZF_GroupID = db.Column('ZF_GroupID', db.Integer, nullable=False)
    ZFE_ID     = db.Column('ZFE_ID', db.Integer, nullable=False)
    CreatedAt  = db.Column('CreatedAt', db.DateTime, server_default=func.sysdatetime())
    CreatedBy  = db.Column('CreatedBy', db.String(128), nullable=True)

# ---------------------------------------------------------------------
#  HELPERS SERIALIZACIÓN
# ---------------------------------------------------------------------
def serializar_despacho(despacho):
    d = {c.name: getattr(despacho, c.name) for c in despacho.__table__.columns}
    if 'Fecha' in d and isinstance(d['Fecha'], datetime.date):
        d['Fecha'] = d['Fecha'].isoformat()
    d['HasDoc'] = bool(d.get('HasDoc'))
    d['DocUrl'] = d.get('DocUrl')
    d['DocName'] = d.get('DocName')
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

# ---- OC SELECT (Asignador directo, sin staging) ----

@app.get("/oc/debug")
def oc_debug():
    """
    Página HTML mínima para ver las últimas 25 OCs (o buscar) sin depender del front.
    """
    q = (request.args.get("search") or "").strip()
    since = (request.args.get("since") or "2000-01-01").strip()
    try:
        datetime.datetime.strptime(since, "%Y-%m-%d")
    except Exception:
        since = "2000-01-01"

    sql = text("""
        SELECT TOP 25
            A.ORDEN_COMPRA_ID           AS OC_ID,
            H.CODIGO                    AS CODPROVEEDOR,
            H.RAZON_SOCIAL              AS RAZON_SOCIAL,
            CONVERT(date, A.FECHA_ALTA) AS FECHAOC
        FROM ERP_ORDENES_COMPRA A
        LEFT JOIN ERP_PROVEEDORES H
               ON H.PROVEEDOR_ID = A.PROVEEDOR_ID
        WHERE A.FECHA_ALTA >= :since
          AND (
                :q = '' OR
                CAST(A.ORDEN_COMPRA_ID AS NVARCHAR(50)) LIKE '%' + :q + '%' OR
                H.CODIGO LIKE '%' + :q + '%' OR
                H.RAZON_SOCIAL LIKE '%' + :q + '%'
              )
        ORDER BY A.FECHA_ALTA DESC, A.ORDEN_COMPRA_ID DESC
    """)

    try:
        with engine_asignador.connect() as conn:
            rows = conn.execute(sql, {"q": q, "since": since}).mappings().all()
        # fallback si está vacío y no hay búsqueda
        if not rows and q == "":
            sql2 = text(sql.text.replace("A.FECHA_ALTA >= :since AND", ""))
            with engine_asignador.connect() as conn:
                rows = conn.execute(sql2, {"q": q}).mappings().all()

        trs = "\n".join(
            f"<tr><td>{r['OC_ID']}</td>"
            f"<td>{(r['CODPROVEEDOR'] or '')}</td>"
            f"<td>{html.escape(r['RAZON_SOCIAL'] or '')}</td>"
            f"<td>{r['FECHAOC'] or ''}</td></tr>"
            for r in rows
        )
        return f"""<!doctype html>
<html><head><meta charset="utf-8">
<title>Debug OC</title>
<style>
body{{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0b1220;color:#e5e7eb}}
.wrap{{max-width:1024px;margin:24px auto;padding:16px}}
.card{{background:#111827;border:1px solid #374151;border-radius:12px;padding:16px}}
h1{{margin:0 0 16px 0;font-size:20px}}
label{{font-size:12px;color:#9ca3af}}
input,button{{border-radius:8px;padding:8px}}
input{{background:#111827;border:1px solid #374151;color:#e5e7eb}}
button{{background:#4f46e5;border:0;color:white;cursor:pointer}}
table{{width:100%;border-collapse:collapse;margin-top:12px}}
th,td{{padding:8px;border-top:1px solid #374151}}
th{{text-align:left;color:#9ca3af}}
small{{color:#9ca3af}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Debug OC (TOP 25)</h1>
    <form method="get">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div><label>Buscar</label><br>
          <input name="search" value="{html.escape(q)}" placeholder="OC / código / razón social">
        </div>
        <div><label>Desde</label><br>
          <input type="date" name="since" value="{since}">
        </div>
        <div><button type="submit">Buscar / Recargar</button></div>
      </div>
    </form>
    <small>GET /oc/select?search={html.escape(q)}&since={since}</small>
    <table>
      <thead><tr><th>OC_ID</th><th>Cod. Prov.</th><th>Razón social</th><th>Fecha OC</th></tr></thead>
      <tbody>{trs or '<tr><td colspan="4">Sin resultados</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body></html>"""
    except Exception as e:
        logging.exception("oc_debug failed")
        return f"<pre>❌ {html.escape(str(e))}</pre>", 500

@app.get("/oc/select")
def oc_select():
    """
    GET /oc/select?search=<texto>&since=YYYY-MM-DD
    - search matchea por OC_ID, CODPROVEEDOR o RAZON_SOCIAL
    - since por defecto 2000-01-01
    """
    q = (request.args.get("search") or "").strip()
    since = (request.args.get("since") or "2000-01-01").strip()

    # validar fecha
    try:
        datetime.datetime.strptime(since, "%Y-%m-%d")
    except Exception:
        since = "2000-01-01"

    sql = text("""
        SELECT TOP 25
            A.ORDEN_COMPRA_ID           AS OC_ID,
            H.CODIGO                    AS CODPROVEEDOR,
            H.RAZON_SOCIAL              AS RAZON_SOCIAL,
            CONVERT(date, A.FECHA_ALTA) AS FECHAOC
        FROM ERP_ORDENES_COMPRA A
        LEFT JOIN ERP_PROVEEDORES H
               ON H.PROVEEDOR_ID = A.PROVEEDOR_ID
        WHERE A.FECHA_ALTA >= :since
          AND (
                :q = '' OR
                CAST(A.ORDEN_COMPRA_ID AS NVARCHAR(50)) LIKE '%' + :q + '%' OR
                H.CODIGO LIKE '%' + :q + '%' OR
                H.RAZON_SOCIAL LIKE '%' + :q + '%'
              )
        ORDER BY A.FECHA_ALTA DESC, A.ORDEN_COMPRA_ID DESC
    """)

    try:
        with engine_asignador.connect() as conn:
            rows = conn.execute(sql, {"q": q, "since": since}).mappings().all()
        # fallback sin filtro de fecha si no hay resultados y no hay búsqueda puntual
        if not rows and q == "":
            sql2 = text(sql.text.replace("A.FECHA_ALTA >= :since AND", ""))  # quita filtro fecha
            with engine_asignador.connect() as conn:
                rows = conn.execute(sql2, {"q": q}).mappings().all()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        logging.exception("oc_select failed")
        return jsonify({"error": str(e)}), 500

def oc_existe_en_asignador(oc_id: str) -> bool:
    sql = """
    SELECT 1
    FROM ERP_ORDENES_COMPRA
    WHERE ORDEN_COMPRA_ID = :oc
    """
    with engine_asignador.connect() as conn:
        return conn.execute(text(sql), {"oc": oc_id}).first() is not None

# Buscar despachos por texto (para autocomplete server-side)
@app.post("/api/ocr/despacho")
def ocr_despacho():
    f = request.files.get("file") or request.files.get("documento")
    if not f:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    try:
        file_bytes = f.read()
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

@app.delete('/api/despachos/<int:id>')
def eliminar_despacho(id):
    try:
        d = DespachoResumen.query.get_or_404(id)
        code = normalize_despacho(d.Despacho or "")
        force = _as_bool(request.args.get('force', '0'))

        # vínculos actuales
        linked_count = db.session.query(func.count()).select_from(FacturaDespacho)\
            .filter(FacturaDespacho.despacho_id == id).scalar() or 0

        if linked_count and not force:
            # pedir confirmación desde el front
            return jsonify({
                "ok": False,
                "error": "El despacho tiene facturas vinculadas.",
                "linked_count": int(linked_count)
            }), 409

        # borrar vínculos si existen
        if linked_count:
            FacturaDespacho.query.filter(FacturaDespacho.despacho_id == id)\
                                 .delete(synchronize_session=False)

        # borrar despacho
        db.session.delete(d)
        db.session.commit()

        # limpieza opcional del resumen dinámico para ese despacho
        try:
            db.session.execute(text("""
                DELETE FROM dbo.App_Despachos_ResumenGasto
                WHERE REPLACE(UPPER(LTRIM(RTRIM(NroDespacho))), ' ', '') = :nro
            """), {"nro": code})
            db.session.commit()
        except Exception:
            db.session.rollback()  # no bloquear por limpieza

        return jsonify({"ok": True, "deleted_id": id, "linked_deleted": int(linked_count)})

    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/oc/ping")
def oc_ping():
    try:
        with engine_asignador.connect() as conn:
            v = conn.execute(text("SELECT 1 AS ok")).scalar()
        return jsonify({"ok": True, "db_ok": bool(v), "has_uri": bool(ASIGNADOR_DB_URI)})
    except Exception as e:
        logging.exception("oc_ping failed")
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
          SELECT fd.despacho_id AS DespachoId, f.ID AS FacturaId
          FROM dbo.Factura_Despacho fd
          JOIN dbo.APP_Despachos_Detalles f ON f.ID = fd.factura_id
          UNION
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
    numero = (request.args.get('numero') or "").strip()
    if not numero:
        return jsonify({"ok": False, "error": "Parámetro 'numero' requerido."}), 400
    normalizado = "".join(numero.split())
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
    """
    Crea un despacho. Requiere: Despacho, Fecha, OC_ID, TipoDespacho (ZFI/ZFE/IC04/IC05)
    Soporta form-data (con archivo) o JSON.
    """
    try:
        datos = request.form if request.form else (request.get_json() or {})
        archivo = request.files.get('documento')

        nro = normalize_despacho(datos.get('Despacho'))
        if not nro:
            return jsonify({"error": "El campo 'Despacho' es obligatorio."}), 400

        tipo = (datos.get('TipoDespacho') or "").strip().upper()
        if tipo not in TIPOS_DESPACHO_VALIDOS:
            return jsonify({"error": "TipoDespacho inválido. Use ZFI/ZFE/IC04/IC05"}), 400

        oc_id = (datos.get('OC_ID') or "").strip()
        if not oc_id:
            return jsonify({"error": "OC_ID es obligatorio."}), 400
        if not oc_existe_en_asignador(oc_id):
            return jsonify({"error": "OC_ID inexistente en Asignador"}), 404

        dup = (
            db.session.query(DespachoResumen.ID)
            .filter(func.replace(DespachoResumen.Despacho, ' ', '') == nro)
            .first()
        )
        if dup:
            return jsonify({"error": "El despacho ya existe.", "exists": True, "id": dup.ID}), 409

        uploaded = None
        if archivo:
            if not SITE_ID or not DRIVE_ID:
                return jsonify({"error": "No se pudo conectar a SharePoint. Verifique las credenciales y permisos en el servidor."}), 500
            file_bytes = archivo.read()
            url = f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}/root:/Despachos/{archivo.filename}:/content"
            uploaded = graph_put(url, file_bytes)

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
            OC_ID=(datos.get('OC_ID') or None),
            TipoDespacho=((datos.get('TipoDespacho') or '').strip()[:10].upper() or None),
        )
        db.session.add(nuevo)
        db.session.commit()

        return jsonify({"mensaje": "Despacho creado con éxito", "id": nuevo.ID}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Ocurrió un error al crear el despacho: {str(e)}"}), 500

@app.route('/api/despachos/<int:id>', methods=['GET'])
def obtener_despacho_por_id(id):
    try:
        despacho = DespachoResumen.query.get_or_404(id)
        return jsonify(serializar_despacho(despacho)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route('/api/despachos/<int:id>', methods=['PUT'])
def actualizar_despacho(id):
    """Actualiza un despacho. Permite actualizar OC_ID y TipoDespacho con validaciones."""
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

        if 'OC_ID' in d:
            ocid = (d.get('OC_ID') or "").strip()
            if ocid:
                if not oc_existe_en_asignador(ocid):
                    return jsonify({"error": "OC_ID inexistente en Asignador"}), 404
                despacho_a_actualizar.OC_ID = ocid
            else:
                despacho_a_actualizar.OC_ID = None

        if 'TipoDespacho' in d:
            td = (d.get('TipoDespacho') or "").strip().upper()
            if td and td not in TIPOS_DESPACHO_VALIDOS:
                return jsonify({"error": "TipoDespacho inválido. Use ZFI/ZFE/IC04/IC05"}), 400
            despacho_a_actualizar.TipoDespacho = td or None

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

        if 'Despacho' in datos:
            f.Despacho = normalize_despacho(datos.get('Despacho'))

        if 'BL' in datos:             f.BL = (datos.get('BL') or "").strip()
        if 'Mercaderia' in datos:     f.Mercaderia = (datos.get('Mercaderia') or "").strip()
        if 'Proveedor' in datos:      f.Proveedor = (datos.get('Proveedor') or "").strip()
        if 'nroProveedor' in datos:   f.nroProveedor = (datos.get('nroProveedor') or "").strip()
        if 'TipoGasto' in datos:      f.TipoGasto = _resolve_tipogasto_id(datos.get('TipoGasto'))
        if 'Moneda' in datos:         f.Moneda = ((datos.get('Moneda') or "ARS").strip()[:3]).upper()

        db.session.commit()

        new_link_ids: List[int] = None  # type: ignore

        if 'Despachos' in datos or 'despachos' in datos:
            despachos_raw = _parse_despachos_payload(datos)
            links = _resolve_despacho_ids(despachos_raw)
            ids = [did for (did, _) in links]
            _replace_links(f.ID, ids)
            new_link_ids = ids
        elif 'Despacho' in datos or 'despacho' in datos:
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
            new_link_ids = list(prev_link_ids)

        gone = set(prev_link_ids) - set(new_link_ids or [])
        came = set(new_link_ids or []) - set(prev_link_ids)

        if gone:
            _recalc_for_despacho_ids(list(gone))
        if came:
            _recalc_for_despacho_ids(list(came))

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

        despachos_raw = _parse_despachos_payload(datos)
        links = _resolve_despacho_ids(despachos_raw)

        if links:
            ids = [did for (did, _) in links]
            _replace_links(nueva.ID, ids)
            _recalc_for_despacho_ids(ids)
        else:
            if nueva.Despacho:
                lk = _resolve_despacho_ids([nueva.Despacho])
                if lk:
                    _replace_links(nueva.ID, [lk[0][0]])
                    _recalc_for_despacho_ids([lk[0][0]])

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
        link_ids = _get_linked_despacho_ids(id)
        code = normalize_despacho(f.Despacho or "")

        if link_ids:
            FacturaDespacho.query.filter(FacturaDespacho.factura_id == id).delete(synchronize_session=False)

        db.session.delete(f)
        db.session.commit()

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

@app.post("/api/despachos/<string:nro>/recalc")
def recalc_un_despacho(nro):
    try:
        sp_upsert_resumen_gasto(nro)
        if USE_RESUMEN_ANCHO:
            sp_sync_resumen_ancho(nro)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/resumen/rebuild")
def rebuild_global():
    try:
        sp_rebuild_resumen_gasto_todos()
        if USE_RESUMEN_ANCHO:
            sp_sync_resumen_ancho_todos()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

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

@app.post("/api/facturas/<int:fid>/despachos")
def set_despachos_de_factura(fid):
    """
    Body JSON o form-data:
      { "despachos": [1, "25001IC040..."] }   # IDs o Códigos
    Query string: ?mode=replace|add (por defecto replace)
    """
    try:
        Factura.query.get_or_404(fid)
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

# ======= ZF: Endpoints (coinciden con el front) =======

from sqlalchemy import text, bindparam

@app.get("/zf/grupos")
def zf_grupos():
    oc_id = request.args.get("oc_id")
    params = {}

    # 1) Grupos + datos del ZFI
    where = ""
    if oc_id:
        where = "WHERE dzfi.OC_ID = :oc_id"
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
    grupos = [dict(r) for r in db.session.execute(text(sql_grupos), params).mappings().all()]
    if not grupos:
        return jsonify(ok=True, items=[])

    # 2) Buscar ZFEs que tengan líneas contra esos ZFI_ID
    zfi_ids = [g["ZFI_ID"] for g in grupos]

    if len(zfi_ids) == 1:
        # Versión simple cuando hay un solo ID
        sql_zfes = text("""
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
        """)
        zfe_rows = [dict(r) for r in db.session.execute(sql_zfes, {"id": zfi_ids[0]}).mappings().all()]
    else:
        # Expanding bindparam para listas (evita el error del TVP)
        sql_zfes = text("""
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
        """).bindparams(bindparam("ids", expanding=True))
        zfe_rows = [dict(r) for r in db.session.execute(sql_zfes, {"ids": list(zfi_ids)}).mappings().all()]

    # 3) Mapear ZFI_ID -> ZFEs
    by_zfi = {}
    for r in zfe_rows:
        by_zfi.setdefault(r["ZFI_ID"], []).append({
            "ZFE_ID":   r["ZFE_ID"],
            "Despacho": r["Despacho"],
            "Fecha":    r["Fecha"].isoformat() if r["Fecha"] else None,
        })

    # 4) Payload final
    out = []
    for g in grupos:
        out.append({
            "ZF_GroupID": g["ZF_GroupID"],
            "OC_ID":      g["OC_ID"],
            "ZFI": {
                "ZFI_ID":   g["ZFI_ID"],
                "Despacho": g["ZFI_Despacho"],
                "Fecha":    g["ZFI_Fecha"].isoformat() if g["ZFI_Fecha"] else None,
            },
            "ZFEs": by_zfi.get(g["ZFI_ID"], []),
        })

    return jsonify(ok=True, items=out)


@app.get("/zf/zfis")
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
        items = [{
            "ZFI_ID": r["ZFI_ID"],
            "Despacho": r["Despacho"],
            "Fecha": r["Fecha"].isoformat() if r["Fecha"] else None
        } for r in rows]
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        logging.exception("zf_list_zfis")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/zf/grupos")
def zf_create_group():
    try:
        data = request.get_json(silent=True) or {}
        zfi_id = int(data.get("ZFI_ID") or 0)
        oc_id  = (data.get("OC_ID") or "").strip()
        user   = "api"  # si querés, tomalo de auth

        if not zfi_id:
            return jsonify({"ok": False, "error": "ZFI_ID requerido"}), 400

        # Validar ZFI y obtener su OC_ID
        row = db.session.execute(text("""
            SELECT ID, OC_ID, TipoDespacho
            FROM dbo.APP_Despachos_Resumen
            WHERE ID = :id
        """), {"id": zfi_id}).mappings().first()
        if not row or (row["TipoDespacho"] or "").upper() != "ZFI":
            return jsonify({"ok": False, "error": "ZFI_ID inválido"}), 404

        zfi_oc = (row["OC_ID"] or "").strip()
        if not oc_id:
            oc_id = zfi_oc
        if not oc_id or oc_id != zfi_oc:
            return jsonify({"ok": False, "error": "OC_ID no coincide con el ZFI"}), 400

        # Ya existe grupo para ese ZFI?
        ex = db.session.execute(text("""
            SELECT ZF_GroupID FROM dbo.ZF_Grupo WHERE ZFI_ID = :zfi
        """), {"zfi": zfi_id}).scalar()
        if ex:
            return jsonify({"ok": True, "ZF_GroupID": int(ex), "already_exists": True})

        # Crear
        new_id = db.session.execute(text("""
            INSERT INTO dbo.ZF_Grupo (OC_ID, ZFI_ID, CreatedAt, CreatedBy)
            OUTPUT inserted.ZF_GroupID
            VALUES (:oc, :zfi, SYSDATETIME(), :usr);
        """), {"oc": oc_id, "zfi": zfi_id, "usr": user}).scalar()
        db.session.commit()
        return jsonify({"ok": True, "ZF_GroupID": int(new_id)})
    except Exception as e:
        db.session.rollback()
        logging.exception("zf_create_group")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/zf/grupos/<int:gid>/items")
def zf_attach_zfe(gid):
    try:
        data = request.get_json(silent=True) or {}
        zfe_id = int(data.get("ZFE_ID") or 0)
        user   = "api"

        if not zfe_id:
            return jsonify({"ok": False, "error": "ZFE_ID requerido"}), 400

        # Grupo
        g = db.session.execute(text("""
            SELECT ZF_GroupID, OC_ID, ZFI_ID
            FROM dbo.ZF_Grupo
            WHERE ZF_GroupID = :gid
        """), {"gid": gid}).mappings().first()
        if not g:
            return jsonify({"ok": False, "error": "Grupo no encontrado"}), 404

        # ZFE válido y misma OC
        z = db.session.execute(text("""
            SELECT ID, TipoDespacho, OC_ID
            FROM dbo.APP_Despachos_Resumen
            WHERE ID = :id
        """), {"id": zfe_id}).mappings().first()
        if not z or (z["TipoDespacho"] or "").upper() != "ZFE":
            return jsonify({"ok": False, "error": "ZFE_ID inválido"}), 404
        if (z["OC_ID"] or "").strip() != (g["OC_ID"] or "").strip():
            return jsonify({"ok": False, "error": "La OC del ZFE no coincide con la del grupo"}), 400

        # Insertar vínculo
        try:
            db.session.execute(text("""
                INSERT INTO dbo.ZF_Vinculos (ZF_GroupID, ZFE_ID, CreatedAt, CreatedBy)
                VALUES (:gid, :zfe, SYSDATETIME(), :usr)
            """), {"gid": gid, "zfe": zfe_id, "usr": user})
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            # Ya vinculado (PK compuesta), lo consideramos OK idempotente
            return jsonify({"ok": True, "already_linked": True})

        return jsonify({"ok": True})
    except Exception as e:
        db.session.rollback()
        logging.exception("zf_attach_zfe")
        return jsonify({"ok": False, "error": str(e)}), 500

#Ver líneas

@app.get("/zf/zfi/<int:zfi_id>/lines")
def zfi_lines(zfi_id):
    rows = db.session.execute(text("""
        SELECT ZFI_LineID, SKU, Descripcion, Talle, Cantidad, Fuente
        FROM dbo.ZF_ZFI_Lines WHERE ZFI_ID = :zfi
        ORDER BY SKU,Talle
    """), {"zfi": zfi_id}).mappings().all()
    return {"ok": True, "items": [dict(r) for r in rows]}

#Importar desde OC
@app.post("/zf/zfi/<int:zfi_id>/import-from-oc")
def import_zfi_lines_from_oc(zfi_id):
    # validar ZFI y OC asignada
    with db.engine.begin() as conn:
        zfi = conn.execute(text("""
            SELECT ID, TipoDespacho, OC_ID
            FROM dbo.APP_Despachos_Resumen
            WHERE ID = :id
        """), {"id": zfi_id}).mappings().first()
        if not zfi:
            return jsonify({"ok": False, "error": "ZFI inexistente."}), 404
        if (zfi["TipoDespacho"] or "").upper() != "ZFI":
            return jsonify({"ok": False, "error": "El despacho no es ZFI."}), 400
        if not zfi["OC_ID"]:
            return jsonify({"ok": False, "error": "El ZFI no tiene OC asignada."}), 400

    # traer líneas de la OC
    oc_lines = query_oc_lines(zfi["OC_ID"])
    if not oc_lines:
        return jsonify({"ok": False, "error": "La OC no tiene líneas."}), 404

    # reemplazo total
    with db.engine.begin() as conn:
        conn.execute(text("DELETE FROM dbo.ZF_ZFI_Lines WHERE ZFI_ID = :zfi"), {"zfi": zfi_id})
        for r in oc_lines:
            conn.execute(text("""
                INSERT INTO dbo.ZF_ZFI_Lines (ZFI_ID, SKU, Descripcion, Talle, Cantidad, Fuente)
                VALUES (:zfi, :sku, :desc, :talle, :cant, 'OC')
            """), {
                "zfi": zfi_id,
                "sku": r["SKU"],
                "desc": r["Descripcion"],
                "talle": (r["Talle"] or "").strip(),
                "cant": r["Cantidad"],
            })

    return jsonify({"ok": True, "inserted": len(oc_lines)})


#Ver resumen

@app.get("/zf/zfi/<int:zfi_id>/summary")
def zfi_summary(zfi_id):
    sql = """
    SELECT COUNT(*) AS Articulos, SUM(Cantidad) AS TotalUnidades
    FROM dbo.ZF_ZFI_Lines WHERE ZFI_ID = :zfi
    """
    row = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().first()
    return {"ok": True, **dict(row)}

@app.get("/zf/zfe/<int:zfe_id>/lines")
def get_zfe_lines(zfe_id):
    with db.engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT ZFE_LineID, ZFE_ID, ZFI_ID, SKU, Talle, Descripcion, CantidadRetiro, CreatedAt
            FROM dbo.ZF_ZFE_Lines
            WHERE ZFE_ID = :id
            ORDER BY SKU, Talle, ZFE_LineID
        """), {"id": zfe_id}).mappings().all()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})



@app.post("/zf/zfe/<int:zfe_id>/lines")
def save_zfe_lines(zfe_id):
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items") or []  # [{ZFI_ID, SKU, Talle, Descripcion?, CantidadRetiro}]
    if not isinstance(items, list) or not items:
        return jsonify({"ok": False, "error": "Payload vacío."}), 400

    # 1) chequear que el despacho sea ZFE
    with db.engine.begin() as conn:
        zfe = conn.execute(text("""
            SELECT ID, TipoDespacho FROM dbo.APP_Despachos_Resumen WHERE ID = :id
        """), {"id": zfe_id}).mappings().first()
        if not zfe or (zfe["TipoDespacho"] or "").upper() != "ZFE":
            return jsonify({"ok": False, "error": "El ID no corresponde a un ZFE."}), 400

    # 2) agrupar por (ZFI_ID, SKU, Talle) para validar de una sola vez
    from collections import defaultdict
    pedir = defaultdict(float)
    meta = {}  # para conservar descripciones (opcional)
    for it in items:
        zfi_id = int(it.get("ZFI_ID") or 0)
        sku    = (it.get("SKU") or "").strip()
        talle  = (it.get("Talle") or "").strip()
        cant   = float(it.get("CantidadRetiro") or 0)
        if not zfi_id or not sku or cant <= 0:
            return jsonify({"ok": False, "error": "Faltan ZFI_ID/SKU o cantidades > 0."}), 400
        key = (zfi_id, sku, talle)
        pedir[key] += cant
        if key not in meta:
            meta[key] = (it.get("Descripcion") or None)

    # 3) obtener saldos actuales del ZFI para esos keys
    keys = list(pedir.keys())
    where = " OR ".join([ "(ZFI_ID = :zfi%d AND SKU = :sku%d AND ISNULL(Talle,'') = :tal%d)" % (i,i,i) for i in range(len(keys)) ]) or "1=0"
    params = {}
    for i, (zfi_id, sku, talle) in enumerate(keys):
        params[f"zfi{i}"] = zfi_id
        params[f"sku{i}"] = sku
        params[f"tal{i}"] = talle or ""

    with db.engine.begin() as conn:
        # totales de ingreso
        q_ing = conn.execute(text(f"""
            SELECT ZFI_ID, SKU, ISNULL(Talle,'') AS Talle, SUM(Cantidad) AS CantidadTotal
            FROM dbo.ZF_ZFI_Lines
            WHERE {where}
            GROUP BY ZFI_ID, SKU, ISNULL(Talle,'')
        """), params).mappings().all()
        tot = { (r["ZFI_ID"], r["SKU"], r["Talle"]): float(r["CantidadTotal"] or 0) for r in q_ing }

        # retiros ya cargados (en cualquier ZFE)
        q_out = conn.execute(text(f"""
            SELECT ZFI_ID, SKU, ISNULL(Talle,'') AS Talle, SUM(CantidadRetiro) AS CantidadRet
            FROM dbo.ZF_ZFE_Lines
            WHERE {where}
            GROUP BY ZFI_ID, SKU, ISNULL(Talle,'')
        """), params).mappings().all()
        sal = { k: tot.get(k,0) - float(r["CantidadRet"] or 0) for k,r in
                (( (row["ZFI_ID"], row["SKU"], row["Talle"]), row) for row in q_out) }
        # completar saldos con los que no tenían retiros
        for k in tot:
            sal.setdefault(k, tot[k])

        # validar que lo pedido no exceda saldo
        for k, qty in pedir.items():
            disponible = sal.get((k[0], k[1], k[2] or ""), 0.0)
            if qty > disponible + 1e-6:
                zfi_id, sku, talle = k
                return jsonify({"ok": False, "error": f"Sin saldo suficiente para {sku} {talle or ''}. Pide {qty}, saldo {disponible}."}), 400

        # 4) reemplazo total de líneas del ZFE y reinsertar
        conn.execute(text("DELETE FROM dbo.ZF_ZFE_Lines WHERE ZFE_ID = :id"), {"id": zfe_id})
        inserted = 0
        for (zfi_id, sku, talle), cant in pedir.items():
            conn.execute(text("""
                INSERT INTO dbo.ZF_ZFE_Lines (ZFE_ID, ZFI_ID, SKU, Talle, Descripcion, CantidadRetiro)
                VALUES (:zfe, :zfi, :sku, :talle, :desc, :cant)
            """), {
                "zfe": zfe_id, "zfi": zfi_id, "sku": sku,
                "talle": talle or "", "desc": meta[(zfi_id,sku,talle)],
                "cant": cant
            })
            inserted += 1

    return jsonify({"ok": True, "inserted": inserted})


@app.get("/zf/zfi/<int:zfi_id>/saldo")
def zfi_saldo(zfi_id):
    with db.engine.begin() as conn:
        rows = conn.execute(text("""
            SELECT
                base.SKU,
                base.Talle,
                base.CantidadTotal,
                COALESCE(outt.CantidadRetirada,0) AS CantidadRetirada,
                base.CantidadTotal - COALESCE(outt.CantidadRetirada,0) AS Saldo
            FROM (
                SELECT SKU, ISNULL(Talle,'') AS Talle, SUM(Cantidad) AS CantidadTotal
                FROM dbo.ZF_ZFI_Lines
                WHERE ZFI_ID = :zfi
                GROUP BY SKU, ISNULL(Talle,'')
            ) base
            LEFT JOIN (
                SELECT SKU, ISNULL(Talle,'') AS Talle, SUM(CantidadRetiro) AS CantidadRetirada
                FROM dbo.ZF_ZFE_Lines
                WHERE ZFI_ID = :zfi
                GROUP BY SKU, ISNULL(Talle,'')
            ) outt
              ON outt.SKU = base.SKU AND outt.Talle = base.Talle
            ORDER BY base.SKU, base.Talle
        """), {"zfi": zfi_id}).mappings().all()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})

@app.get("/zf/inventario")
def zf_inventario():
    try:
        sql = """
        SELECT
            g.ZF_GroupID,
            g.ZFI_ID,
            d.Despacho                AS ZFI_Despacho,
            d.OC_ID,
            CAST(d.Fecha AS date)     AS Fecha,
            COALESCE(li.Ingresado, 0) AS Ingresado,
            COALESCE(rl.Retirado,  0) AS Retirado
        FROM dbo.ZF_Grupo AS g
        JOIN dbo.APP_Despachos_Resumen AS d
          ON d.ID = g.ZFI_ID
        OUTER APPLY (
          SELECT SUM(l.Cantidad) AS Ingresado
          FROM dbo.ZF_ZFI_Lines AS l
          WHERE l.ZFI_ID = g.ZFI_ID
        ) AS li
        OUTER APPLY (
          SELECT SUM(r.CantidadRetiro) AS Retirado
          FROM dbo.ZF_ZFE_Lines AS r
          WHERE r.ZFI_ID = g.ZFI_ID
        ) AS rl
        ORDER BY d.Fecha DESC;
        """

        rows = db.session.execute(text(sql)).mappings().all()

        items = []
        for r in rows:
            ingresado = float(r["Ingresado"] or 0)
            retirado  = float(r["Retirado"]  or 0)
            items.append({
                "ZF_GroupID":  r["ZF_GroupID"],
                "ZFI_ID":      r["ZFI_ID"],
                "ZFI_Despacho": r["ZFI_Despacho"],   # nombre ajustado
                "OC_ID":       r["OC_ID"],
                "Fecha":       r["Fecha"].isoformat() if r["Fecha"] else None,
                "Ingresado":   ingresado,
                "Retirado":    retirado,
                "Saldo":       ingresado - retirado,
            })

        return jsonify(ok=True, items=items)

    except Exception as e:
        current_app.logger.exception("Error en /zf/inventario")
        return jsonify({"error": str(e)}), 500


@app.get("/zf/movimientos")
def zf_movimientos():
    oc_id  = request.args.get("oc_id")
    zfi_id = request.args.get("zfi_id")
    fmin   = request.args.get("from")  # YYYY-MM-DD
    fmax   = request.args.get("to")    # YYYY-MM-DD

    where = []
    params = {}

    # OC de la OC del ZFI (grupo)
    if oc_id:
        where.append("dzfi.OC_ID = :oc_id")
        params["oc_id"] = oc_id

    if zfi_id:
        where.append("g.ZFI_ID = :zfi_id")
        params["zfi_id"] = zfi_id

    # Rango por fecha del movimiento (fecha del ZFE)
    if fmin:
        where.append("dzfe.Fecha >= :fmin")
        params["fmin"] = fmin
    if fmax:
        where.append("dzfe.Fecha < dateadd(day, 1, :fmax)")
        params["fmax"] = fmax

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sql = f"""
    SELECT
        l.ZFE_ID,
        dzfe.Despacho             AS DespachoZFE,
        dzfi.OC_ID,               -- OC del ZFI (grupo)
        CAST(dzfe.Fecha AS date)  AS Fecha,
        g.ZFI_ID,
        SUM(l.CantidadRetiro)     AS TotalRetirado
    FROM dbo.ZF_ZFE_Lines AS l
    JOIN dbo.ZF_Grupo AS g
      ON g.ZFI_ID = l.ZFI_ID                    -- << unión por ZFI_ID
    JOIN dbo.APP_Despachos_Resumen AS dzfe
      ON dzfe.ID = l.ZFE_ID                     -- datos del ZFE (fecha del retiro)
    JOIN dbo.APP_Despachos_Resumen AS dzfi
      ON dzfi.ID = g.ZFI_ID                     -- datos del ZFI (OC del grupo)
    {where_sql}
    GROUP BY l.ZFE_ID, dzfe.Despacho, dzfi.OC_ID, dzfe.Fecha, g.ZFI_ID
    ORDER BY dzfe.Fecha DESC;
    """

    rows = db.session.execute(text(sql), params).mappings().all()
    return jsonify(ok=True, items=[dict(r) for r in rows])


@app.get("/zf/zfi/<int:zfi_id>/detalle")
def zf_zfi_detalle(zfi_id: int):
    # Cabecera del ZFI (despacho, fecha, OC y grupo)
    hdr_sql = """
    SELECT g.ZF_GroupID, d.ID AS ZFI_ID, d.Despacho AS DespachoZFI,
           d.OC_ID, CAST(d.Fecha AS date) AS Fecha
    FROM dbo.ZF_Grupo g
    JOIN dbo.APP_Despachos_Resumen d ON d.ID = g.ZFI_ID
    WHERE g.ZFI_ID = :zfi
    """
    hdr = db.session.execute(text(hdr_sql), {"zfi": zfi_id}).mappings().first()
    if not hdr:
        return jsonify(ok=False, error="ZFI no encontrado."), 404

    # Líneas del ZFI (ingresado) + retiros por SKU/Talle (desde su grupo) + saldo
    det_sql = """
    SELECT
        l.SKU,
        l.Talle,
        MAX(l.Descripcion) AS Descripcion,
        SUM(l.Cantidad)    AS Ingresado,
        COALESCE((
           SELECT SUM(rl.CantidadRetiro)
           FROM dbo.ZF_ZFE_Lines rl
           WHERE rl.ZF_GroupID = :gid
             AND rl.SKU = l.SKU
             AND COALESCE(rl.Talle,'') = COALESCE(l.Talle,'')
        ), 0) AS Retirado
    FROM dbo.ZF_ZFI_Lines l
    WHERE l.ZFI_ID = :zfi
    GROUP BY l.SKU, l.Talle
    ORDER BY l.SKU, l.Talle
    """
    rows = db.session.execute(
        text(det_sql),
        {"zfi": zfi_id, "gid": hdr["ZF_GroupID"]}
    ).mappings().all()

    items = []
    tot_ing, tot_ret = 0.0, 0.0
    for r in rows:
        ingresado = float(r["Ingresado"] or 0)
        retirado  = float(r["Retirado"]  or 0)
        saldo     = ingresado - retirado
        tot_ing  += ingresado
        tot_ret  += retirado
        items.append({
            "SKU": r["SKU"],
            "Talle": r["Talle"],
            "Descripcion": r["Descripcion"],
            "Ingresado": ingresado,
            "Retirado": retirado,
            "Saldo": saldo,
        })

    return jsonify(ok=True, header={
        "ZF_GroupID": hdr["ZF_GroupID"],
        "ZFI_ID": hdr["ZFI_ID"],
        "DespachoZFI": hdr["DespachoZFI"],
        "OC_ID": hdr["OC_ID"],
        "Fecha": hdr["Fecha"].isoformat() if hdr["Fecha"] else None,
        "IngresadoTotal": tot_ing,
        "RetiradoTotal": tot_ret,
        "SaldoTotal": tot_ing - tot_ret,
    }, items=items)


@app.get("/zf/zfi/<int:zfi_id>/zfe")
def zf_zfi_zfes(zfi_id: int):
    sql = """
    SELECT
        rl.ZFE_ID,
        d.Despacho AS DespachoZFE,
        CAST(d.Fecha AS date) AS Fecha,
        SUM(rl.CantidadRetiro) AS TotalRetirado
    FROM dbo.ZF_ZFE_Lines rl
    JOIN dbo.ZF_Grupo g ON g.ZF_GroupID = rl.ZF_GroupID
    JOIN dbo.APP_Despachos_Resumen d ON d.ID = rl.ZFE_ID
    WHERE g.ZFI_ID = :zfi
    GROUP BY rl.ZFE_ID, d.Despacho, d.Fecha
    ORDER BY d.Fecha DESC
    """
    rows = db.session.execute(text(sql), {"zfi": zfi_id}).mappings().all()
    return jsonify(ok=True, items=rows)

@app.get("/zf/zfe/<int:zfe_id>/lines")
def zf_zfe_lines(zfe_id: int):
    # Cabecera: ZFE + ZFI origen (por el grupo)
    hdr_sql = """
    SELECT TOP 1
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
    hdr = db.session.execute(text(hdr_sql), {"zfe": zfe_id}).mappings().first()
    if not hdr:
        # Puede no tener líneas aún; devolvemos la cabecera básica del ZFE
        zfe_sql = "SELECT ID, Despacho, OC_ID, CAST(Fecha AS date) AS Fecha FROM dbo.APP_Despachos_Resumen WHERE ID = :zfe"
        zfe = db.session.execute(text(zfe_sql), {"zfe": zfe_id}).mappings().first()
        if not zfe:
            return jsonify(ok=False, error="ZFE no encontrado."), 404
        return jsonify(ok=True, header={
            "ZFE_ID": zfe["ID"],
            "DespachoZFE": zfe["Despacho"],
            "OC_ID": zfe["OC_ID"],
            "Fecha": zfe["Fecha"].isoformat() if zfe["Fecha"] else None,
            "ZFI_ID": None,
            "DespachoZFI": None,
            "ZF_GroupID": None,
        }, items=[])

    # Líneas del ZFE (retiros)
    det_sql = """
    SELECT SKU, Talle, Descripcion, CantidadRetiro
    FROM dbo.ZF_ZFE_Lines
    WHERE ZFE_ID = :zfe
    ORDER BY SKU, Talle
    """
    items = db.session.execute(text(det_sql), {"zfe": zfe_id}).mappings().all()

    return jsonify(ok=True, header={
        "ZFE_ID": zfe_id,
        "ZF_GroupID": hdr["ZF_GroupID"],
        "ZFI_ID": hdr["ZFI_ID"],
        "DespachoZFI": hdr["DespachoZFI"],
        "DespachoZFE": hdr["DespachoZFE"],
        "OC_ID": hdr["OC_ID"],
        "Fecha": hdr["Fecha"].isoformat() if hdr["Fecha"] else None,
    }, items=items)


@app.get("/zf/inventario/<int:zfi_id>/items")
def zf_inventario_items(zfi_id):
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
    for r in rows:
        items.append({
            "SKU": r["SKU"],
            "Talle": r["Talle"],
            "Descripcion": r["Descripcion"],
            "Ingresado": float(r["Ingresado"] or 0),
            "Retirado": float(r["Retirado"] or 0),
            "CantidadActual": float(r["CantidadActual"] or 0),
        })
    return jsonify(ok=True, items=items)


# GET /zf/movimientos/<zfe_id>/items  -> líneas del ZFE (retiros)
@app.get("/zf/movimientos/<int:zfe_id>/items")
def zf_movimientos_items(zfe_id):
    sql = """
    SELECT
      l.SKU,
      l.Talle,
      l.Descripcion,
      SUM(l.CantidadRetiro) AS Cantidad
    FROM dbo.ZF_ZFE_Lines AS l
    WHERE l.ZFE_ID = :zfe_id
    GROUP BY l.SKU, l.Talle, l.Descripcion
    ORDER BY l.SKU, l.Talle;
    """
    rows = db.session.execute(text(sql), {"zfe_id": zfe_id}).mappings().all()
    return jsonify(ok=True, items=[dict(r) for r in rows])



# ---------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=True)
