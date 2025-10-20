import { useEffect, useMemo, useState } from "react";

/** Utilidad básica para GET/JSON */
async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Error de red");
  return data;
}

/** Quitar ZFE de un grupo (AJUSTAR a tu endpoint real) */
async function removeZFEFromGroup({ groupId, zfeId }) {
  // Ejemplos de endpoints posibles:
  // await fetch(`/zf/grupos/${groupId}/zfe/${zfeId}`, { method: "DELETE" });
  // ó
  // await fetch(`/zf/grupo_zfe`, { method: "DELETE", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ZF_GroupID: groupId, ZFE_ID: zfeId })});
  const r = await fetch(`/zf/grupos/${groupId}/zfe/${encodeURIComponent(zfeId)}`, {
    method: "DELETE",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "No se pudo quitar el ZFE");
  return data;
}

export default function ZFGroupTable({ ocId }) {
  const [rows, setRows] = useState([]);          // [{ZF_GroupID, OC_ID, ZFI:{...}, ZFEs:[...]}]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(() => new Set()); // ids de filas abiertas
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const qs = ocId ? `?oc_id=${encodeURIComponent(ocId)}` : "";
      const data = await fetchJSON(`/zf/grupos${qs}`);
      // normalizar: si tu API devuelve {ok, items:[]}, ajusta aquí
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setRows(items);
    } catch (e) {
      setErr(e.message || "Error cargando grupos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [ocId]);

  const totalZFEs = useMemo(
    () => rows.reduce((acc, r) => acc + (Array.isArray(r?.ZFEs) ? r.ZFEs.length : 0), 0),
    [rows]
  );

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onRemoveZFE = async (groupId, zfeId) => {
    try {
      await removeZFEFromGroup({ groupId, zfeId });
      // reflejar cambio en memoria sin recargar todo
      setRows(prev =>
        prev.map(r => r.ZF_GroupID === groupId
          ? { ...r, ZFEs: (r.ZFEs || []).filter(z => (z.ZFE_ID ?? z.ID) !== zfeId) }
          : r
        )
      );
    } catch (e) {
      alert(e.message || "No se pudo quitar el ZFE");
    }
  };

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm opacity-75">
          {loading ? "Cargando grupos…" : `Grupos: ${rows.length} · ZFEs vinculados: ${totalZFEs}`}
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-md text-sm bg-slate-700 hover:bg-slate-600 transition disabled:opacity-60"
          disabled={refreshing || loading}
        >
          {refreshing ? "Actualizando…" : "Refrescar"}
        </button>
      </div>

      {err && (
        <div className="mb-3 text-red-400 text-sm">{err}</div>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-slate-700/60">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/60">
            <tr className="text-left">
              <th className="px-4 py-3 w-10"></th>
              <th className="px-4 py-3">Grupo</th>
              <th className="px-4 py-3">OC</th>
              <th className="px-4 py-3">ZFI (Despacho)</th>
              <th className="px-4 py-3">Fecha ZFI</th>
              <th className="px-4 py-3 text-center"># ZFEs</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {loading && (
              <tr>
                <td className="px-4 py-4 text-slate-300" colSpan={7}>
                  Cargando…
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-slate-300" colSpan={7}>
                  No hay grupos para mostrar.
                </td>
              </tr>
            )}

            {!loading && rows.map(r => {
              const id = r.ZF_GroupID;
              const isOpen = expanded.has(id);
              const zfi = r.ZFI || {};
              const zfes = Array.isArray(r.ZFEs) ? r.ZFEs : [];

              return (
                <Fragment key={id}>
                  <tr className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 align-top">
                      <button
                        onClick={() => toggle(id)}
                        className="rounded-md px-2 py-1 bg-slate-700 hover:bg-slate-600 transition"
                        title={isOpen ? "Contraer" : "Expandir"}
                      >
                        {isOpen ? "–" : "+"}
                      </button>
                    </td>
                    <td className="px-4 py-3 align-top">#{id}</td>
                    <td className="px-4 py-3 align-top">{r.OC_ID ?? "—"}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium">{zfi?.Despacho ?? "—"}</div>
                      <div className="opacity-60 text-xs">ZFI: {zfi?.ZFI_ID ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 align-top">{zfi?.Fecha ? String(zfi.Fecha).slice(0,10) : "—"}</td>
                    <td className="px-4 py-3 align-top text-center">{zfes.length}</td>
                    <td className="px-4 py-3 align-top">
                      <button
                        onClick={() => toggle(id)}
                        className="px-3 py-1.5 rounded-md bg-slate-700 hover:bg-slate-600 transition"
                      >
                        {isOpen ? "Ocultar ZFEs" : "Ver ZFEs"}
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-slate-900/40">
                      <td className="px-4 py-4" colSpan={7}>
                        {zfes.length === 0 ? (
                          <div className="text-slate-300 text-sm">Este grupo no tiene ZFEs vinculados.</div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {zfes.map(z => {
                              const chipId = z.ZFE_ID ?? z.ID ?? String(z);
                              const fecha = z.Fecha ? String(z.Fecha).slice(0,10) : null;
                              return (
                                <div
                                  key={chipId}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/70 border border-slate-700/60"
                                >
                                  <span className="font-medium">{chipId}</span>
                                  {fecha && <span className="opacity-60 text-xs">· {fecha}</span>}
                                  <button
                                    onClick={() => onRemoveZFE(id, chipId)}
                                    className="ml-1 text-xs px-2 py-0.5 rounded bg-red-700/80 hover:bg-red-700 transition"
                                    title="Quitar ZFE"
                                  >
                                    Quitar
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Necesario para usar <Fragment> arriba sin importar React completo */
import { Fragment } from "react";
