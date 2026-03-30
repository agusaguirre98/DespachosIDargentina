"""SharePoint / Microsoft Graph helpers."""

from __future__ import annotations

import base64
import logging
import re
from typing import Iterable, Optional, Tuple
from urllib.parse import quote, unquote, urlparse

import msal
import requests

GRAPH = "https://graph.microsoft.com/v1.0"

# Session with sane defaults for Graph write operations.
_session = requests.Session()
DEFAULT_TIMEOUT = (10, 40)  # connect, read

# Configuration set at runtime
AUTHORITY: Optional[str] = None
CLIENT_ID: Optional[str] = None
CLIENT_SECRET: Optional[str] = None
SCOPE: Iterable[str] = ()
SITE_URL: Optional[str] = None

# Cached site artefacts
SITE_ID: Optional[str] = None
DRIVE_ID: Optional[str] = None


def configure(authority: str, client_id: str, client_secret: str, scope: Iterable[str], site_url: str) -> None:
    """Configure credentials and target site for Graph operations."""
    global AUTHORITY, CLIENT_ID, CLIENT_SECRET, SCOPE, SITE_URL
    AUTHORITY = authority
    CLIENT_ID = client_id
    CLIENT_SECRET = client_secret
    SCOPE = tuple(scope)
    SITE_URL = site_url


def get_access_token() -> str:
    print("🔍 DEBUG MSAL CONFIG:")
    print("CLIENT_ID:", CLIENT_ID)
    print("CLIENT_SECRET:", CLIENT_SECRET[:5] + "..." if CLIENT_SECRET else None)
    print("AUTHORITY:", AUTHORITY)
    print("SCOPE:", SCOPE)

    if not (CLIENT_ID and CLIENT_SECRET and AUTHORITY):
        raise RuntimeError("SharePoint service not configured with client credentials.")

    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        client_credential=CLIENT_SECRET,
    )

    result = app.acquire_token_for_client(
        scopes=list(SCOPE) or ["https://graph.microsoft.com/.default"]
    )

    print("🔐 TOKEN RESPONSE:", result)

    if "access_token" not in result:
        logging.error("Error en la autenticación Graph: %s", result.get("error_description"))
        raise RuntimeError(f"Error obteniendo token Graph: {result}")

    print("✅ TOKEN OK")

    return result["access_token"]


def graph_get(url: str) -> dict:
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    response = _session.get(url, headers=headers, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    return response.json()


def graph_put(url: str, data, content_type: str = "application/octet-stream") -> dict:
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
    }
    response = _session.put(url, headers=headers, data=data, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    return response.json()


def graph_post(url: str, json: dict) -> dict:
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    response = _session.post(url, headers=headers, json=json, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    return response.json()


def graph_delete(url: str, ignore_not_found: bool = False) -> bool:
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    response = _session.delete(url, headers=headers, timeout=DEFAULT_TIMEOUT)
    if response.status_code == 404 and ignore_not_found:
        return False
    response.raise_for_status()
    return True


def delete_file_by_web_url(web_url: str) -> bool:
    if not web_url:
        return False

    global DRIVE_ID
    if not DRIVE_ID:
        init_site_resources()
    if not DRIVE_ID:
        raise RuntimeError("No se pudo resolver el drive de SharePoint.")

    parsed = urlparse(web_url)
    doc_url_no_query = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")

    # Intento principal: resolver exactamente el driveItem a partir de la webUrl.
    share_token = base64.urlsafe_b64encode(doc_url_no_query.encode("utf-8")).decode("ascii").rstrip("=")
    share_url = f"{GRAPH}/shares/u!{share_token}/driveItem?$select=id,parentReference"
    try:
        item = graph_get(share_url)
        item_id = item.get("id")
        drive_id = (item.get("parentReference") or {}).get("driveId") or DRIVE_ID
        if item_id and drive_id:
            delete_url = f"{GRAPH}/drives/{drive_id}/items/{item_id}"
            return graph_delete(delete_url, ignore_not_found=True)
    except Exception:
        logging.warning("delete_file_by_web_url: fallback a borrado por ruta para %s", doc_url_no_query)

    # Fallback: reconstruir la ruta dentro de la biblioteca.
    drive = graph_get(f"{GRAPH}/drives/{DRIVE_ID}")
    drive_web_url = (drive.get("webUrl") or "").rstrip("/")
    relative_path = ""

    if drive_web_url and doc_url_no_query.lower().startswith(drive_web_url.lower()):
        relative_path = doc_url_no_query[len(drive_web_url):].lstrip("/")
    else:
        decoded_path = unquote(parsed.path or "")
        markers = ("/Documentos compartidos/", "/Shared Documents/", "/Documentos/")
        for marker in markers:
            idx = decoded_path.lower().find(marker.lower())
            if idx >= 0:
                relative_path = decoded_path[idx + len(marker):].lstrip("/")
                break

    if not relative_path:
        raise RuntimeError("No se pudo determinar la ruta del archivo en SharePoint.")

    delete_url = f"{GRAPH}/drives/{DRIVE_ID}/root:/{quote(relative_path, safe='/')}:"
    return graph_delete(delete_url, ignore_not_found=True)


def ensure_folder(path: str) -> dict:
    if not DRIVE_ID:
        init_site_resources()

    parent = "root"
    parts = [p for p in path.strip("/").split("/") if p]
    for name in parts:
        filter_name = name.replace("'", "''")
        url = f"{GRAPH}/drives/{DRIVE_ID}/items/{parent}/children?$filter=name eq '{filter_name}'"
        res = graph_get(url)

        found = next((it for it in res.get("value", []) if it.get("name") == name and "folder" in it), None)
        if found:
            parent = found["id"]
            continue

        create_url = f"{GRAPH}/drives/{DRIVE_ID}/items/{parent}/children"
        payload = {"name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "replace"}
        created = graph_post(create_url, payload)
        parent = created["id"]

    return {"id": parent, "path": path}


def upload_small(path_with_filename: str, data: bytes, content_type: str = "application/octet-stream") -> dict:
    """
    Subida simple (< 4 MB) a /drives/{DRIVE_ID}/root:/path:/content
    Asegura la carpeta antes de subir.
    """
    global SITE_ID, DRIVE_ID
    if not (SITE_ID and DRIVE_ID):
        init_site_resources()

    folder = "/".join(path_with_filename.strip("/").split("/")[:-1])
    if folder:
        ensure_folder(folder)

    url = f"{GRAPH}/drives/{DRIVE_ID}/root:/{path_with_filename.lstrip('/')}:/content"
    return graph_put(url, data, content_type)


def list_children(path: str = "Despachos", top: int = 50, skiptoken: Optional[str] = None) -> dict:
    """
    List files/folders within `path`. Supports $top and $skiptoken.
    """
    global SITE_ID, DRIVE_ID
    if not (SITE_ID and DRIVE_ID):
        init_site_resources()

    path = (path or "").strip().strip("/")
    try:
        top_int = int(top or 50)
    except (TypeError, ValueError):
        top_int = 50
    top_int = max(1, min(200, top_int))

    if path:
        try:
            ensure_folder(path)
        except Exception:
            pass
        base = f"{GRAPH}/drives/{DRIVE_ID}/root:/{quote(path)}:/children?$top={top_int}"
    else:
        base = f"{GRAPH}/drives/{DRIVE_ID}/root/children?$top={top_int}"

    if skiptoken:
        base += f"&$skiptoken={quote(skiptoken)}"

    return graph_get(base)


def _discover_site_and_drive() -> Tuple[Optional[str], Optional[str]]:
    if not SITE_URL:
        raise RuntimeError("SharePoint service not configured with site url.")

    parsed = urlparse(SITE_URL)
    host = parsed.netloc
    path = parsed.path or "/sites/root"

    site = graph_get(f"https://graph.microsoft.com/v1.0/sites/{host}:{path}")
    site_id = site["id"]

    drives = graph_get(f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives")
    drive_id = None
    for drive in drives.get("value", []):
        if drive.get("name") == "Documentos":
            drive_id = drive["id"]
            break
    if not drive_id:
        for drive in drives.get("value", []):
            if drive.get("name") in ("Shared Documents", "Documentos compartidos"):
                drive_id = drive["id"]
                break

    if not drive_id:
        raise RuntimeError("No se encontró la biblioteca de Documentos en el sitio.")

    logging.info("Graph site discovered: site_id=%s drive_id=%s", site_id, drive_id)
    return site_id, drive_id


def init_site_resources(force: bool = False) -> Tuple[Optional[str], Optional[str]]:
    """Ensure SITE_ID and DRIVE_ID are set and return them."""
    global SITE_ID, DRIVE_ID
    if force or not SITE_ID or not DRIVE_ID:
        SITE_ID, DRIVE_ID = _discover_site_and_drive()
    return SITE_ID, DRIVE_ID


def find_sharepoint_doc_for_despacho(numero: str) -> Optional[dict]:
    """Busca en SharePoint (carpeta 'Despachos') un archivo cuyo nombre contenga el número."""
    if not numero:
        return None
    if not (SITE_ID and DRIVE_ID):
        init_site_resources()
    if not (SITE_ID and DRIVE_ID):
        return None

    try:
        query = re.sub(r"\s+", "", numero or "")
        results = graph_get(
            f"https://graph.microsoft.com/v1.0/sites/{SITE_ID}/drives/{DRIVE_ID}"
            f"/root:/Despachos:/search(q='{query}')"
        )
        for item in results.get("value", []):
            if "file" in item:
                return {"url": item.get("webUrl"), "name": item.get("name")}
    except Exception as exc:
        logging.warning("find_sharepoint_doc_for_despacho: %s", exc)
    return None

def get_site_and_drive():
    try:
        print("🔍 Obteniendo SITE_ID y DRIVE_ID...")

        token = get_access_token()

        headers = {
            "Authorization": f"Bearer {token}"
        }

        # 🔹 SITE
        site_url = SP_SITE_URL.replace("https://", "")
        url_site = f"https://graph.microsoft.com/v1.0/sites/{site_url}"

        resp_site = requests.get(url_site, headers=headers)
        resp_site.raise_for_status()

        site_id = resp_site.json().get("id")
        print("✅ SITE_ID:", site_id)

        # 🔹 DRIVE
        url_drive = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive"

        resp_drive = requests.get(url_drive, headers=headers)
        resp_drive.raise_for_status()

        drive_id = resp_drive.json().get("id")
        print("✅ DRIVE_ID:", drive_id)

        return site_id, drive_id

    except Exception as e:
        print("❌ ERROR obteniendo SITE/DRIVE:", str(e))
        return None, None


__all__ = [
    "configure",
    "init_site_resources",
    "graph_get",
    "graph_put",
    "graph_post",
    "graph_delete",
    "delete_file_by_web_url",
    "ensure_folder",
    "list_children",
    "find_sharepoint_doc_for_despacho",
]
