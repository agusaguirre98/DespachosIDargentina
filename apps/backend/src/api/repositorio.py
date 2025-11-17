from __future__ import annotations

import os

from flask import Blueprint, current_app, jsonify, request

from ..services import sharepoint as sp

repo_bp = Blueprint("repo", __name__, url_prefix="/api")


@repo_bp.get("/repositorio")
@repo_bp.get("/repositorio/")
def listar_repositorio():

    try:
        sp.init_site_resources()

        raw_path = (request.args.get("path") or "").strip()
        path = "Despachos" if raw_path in ("", "null", "undefined") else raw_path

        raw_top = request.args.get("top")
        try:
            top = int(raw_top) if raw_top not in (None, "", "null", "undefined") else 50
        except Exception:
            top = 50
        top = max(1, min(200, top))

        token = request.args.get("token")
        if token in ("", "null", "undefined"):
            token = None

        current_app.logger.info(f"[repo] path={path!r} top={top} token={(token[:24]+'...') if token else None}")

        data = sp.list_children(path=path, top=top, skiptoken=token)

        items = [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "isFolder": "folder" in it,
                "size": it.get("size"),
                "webUrl": it.get("webUrl"),
                "lastModifiedDateTime": it.get("lastModifiedDateTime"),
                "nextPath": f"{path.rstrip('/')}/{it.get('name')}" if "folder" in it else None,
            }
            for it in data.get("value", [])
        ]

        next_token = None
        next_link = data.get("@odata.nextLink")
        if next_link and "$skiptoken=" in next_link:
            next_token = next_link.split("$skiptoken=", 1)[1]

        return jsonify({"ok": True, "path": path, "count": len(items), "items": items, "next": next_token})

    except Exception as exc:
        current_app.logger.exception("Error en /api/repositorio")
        return jsonify({"ok": False, "error": str(exc)}), 500


@repo_bp.get("/repositorio/_diag")
def repo_diag():
    cfg = {
        "authority_ok": bool(os.getenv("AUTHORITY")),
        "client_id_suffix": (os.getenv("CLIENT_ID", "") or "")[-6:],
        "site_url": os.getenv("SITE_URL", ""),
    }
    try:
        site_id, drive_id = sp.init_site_resources(force=True)
        return {"ok": True, "site_id": site_id, "drive_id": drive_id, "cfg": cfg}
    except Exception as exc:
        current_app.logger.exception("Repo diag failed")
        return {"ok": False, "error": str(exc), "cfg": cfg}, 500
