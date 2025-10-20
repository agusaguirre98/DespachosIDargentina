// /src/components/ZFGroupAdmin.jsx
import { useEffect, useMemo, useState, Fragment } from "react";
import OCSearchSelect from "./OCSearchSelect";
import useApi from "../hooks/useApi";

export default function ZFGroupAdmin() {
  const { get, post, del } = useApi();

  const [oc, setOc] = useState(null);
  const [despachos, setDespachos] = useState([]);
  const [loadingDesp, setLoadingDesp] = useState(false);

  const [grupos, setGrupos] = useState([]);
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [creating, setCreating] = useState(false);

  // Para expandir filas de la tabla de grupos
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // === 1) Cargar despachos ===
  useEffect(() => {
    const load = async () => {
      setLoadingDesp(true);
      try {
        const data = await get("/api/despachos");
        if (Array.isArray(data)) setDespachos(data);
      } catch (e) {
        console.error(e);
        alert(e.message);
      } finally {
        setLoadingDesp(false);
      }
    };
    load();
  }, [get]);

  // === 2) Cargar grupos ===
  const loadGrupos = async (ocId) => {
    setLoadingGrupos(true);
    try {
      const qs = ocId ? `?oc_id=${encodeURIComponent(ocId)}` : "";
      const data = await get(`/zf/grupos${qs}`);
      setGrupos(data.items || []);
    } catch (e) {
      console.error(e);
      alert(e.message);
    } finally {
      setLoadingGrupos(false);
    }
  };

  useEffect(() => {
    loadGrupos(); // todos al inicio
  }, []);

  useEffect(() => {
    if (oc?.OC_ID) loadGrupos(oc.OC_ID);
  }, [oc?.OC_ID]);

  // === 3) Derivados ===
  const despachosDeOC = useMemo(() => {
    if (!oc) return [];
    return despachos.filter(
      (d) => (d.OC_ID || "").toString() === oc.OC_ID.toString()
    );
  }, [despachos, oc]);

  const zfis = useMemo(
    () =>
      despachosDeOC.filter(
        (d) => (d.TipoDespacho || "").toUpperCase() === "ZFI"
      ),
    [despachosDeOC]
  );

  const zfes = useMemo(
    () =>
      despachosDeOC.filter(
        (d) => (d.TipoDespacho || "").toUpperCase() === "ZFE"
      ),
    [despachosDeOC]
  );

  const groupsByZFI = useMemo(() => {
    const map = new Map();
    for (const g of grupos) {
      const zfiId = g?.ZFI?.ZFI_ID ?? g?.ZFI_ID;
      if (zfiId != null) map.set(zfiId, g);
    }
    return map;
  }, [grupos]);

  const zfesDisponiblesForGroup = (grp) => {
    const usados = new Set(grp?.ZFEs?.map((z) => z.ZFE_ID) || []);
    return zfes.filter((z) => !usados.has(z.ID));
  };

  // === 4) Acciones ===
  const crearGrupo = async (zfiId) => {
    setCreating(true);
    try {
      await post("/zf/grupos", { ZFI_ID: zfiId });
      await loadGrupos(oc?.OC_ID);
      alert("Grupo ZF creado correctamente.");
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const agregarZFE = async (gid, zfeId) => {
    try {
      await post(`/zf/grupos/${gid}/zfe`, { ZFE_ID: zfeId });
      await loadGrupos(oc?.OC_ID);
    } catch (e) {
      alert(e.message);
    }
  };

  const quitarZFE = async (gid, zfeId) => {
    try {
      await del(`/zf/grupos/${gid}/zfe/${zfeId}`);
      await loadGrupos(oc?.OC_ID);
    } catch (e) {
      alert(e.message);
    }
  };

  // === 5) Render ===
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Zona Franca — Grupos ZFI/ZFE</h2>

      {/* === Selector de OC === */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="text-xs text-slate-300 mb-2 block">
          Buscar OC (por Nº / Proveedor)
        </label>
        <OCSearchSelect value={oc} onChange={setOc} />
        {!oc && (
          <div className="text-slate-400 text-sm mt-2">Sin OC seleccionada</div>
        )}
      </div>

      {/* === Grupos existentes (TABLA EXPANDIBLE) === */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">
            {oc?.OC_ID ? `Grupos de la OC ${oc.OC_ID}` : "Grupos existentes"}
          </h3>
          <button
            onClick={() => loadGrupos(oc?.OC_ID)}
            disabled={loadingGrupos}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            {loadingGrupos ? "Actualizando…" : "Refrescar"}
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-slate-300">
              <tr className="text-left">
                <th className="p-2 w-10"></th>
                <th className="p-2">Grupo</th>
                <th className="p-2">OC</th>
                <th className="p-2">ZFI (Despacho)</th>
                <th className="p-2">Fecha ZFI</th>
                <th className="p-2 text-center"># ZFEs</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loadingGrupos && (
                <tr>
                  <td className="p-3 text-slate-400" colSpan={7}>
                    Cargando grupos…
                  </td>
                </tr>
              )}

              {!loadingGrupos && grupos.length === 0 && (
                <tr>
                  <td className="p-3 text-slate-400" colSpan={7}>
                    No hay grupos ZF.
                  </td>
                </tr>
              )}

              {!loadingGrupos &&
                grupos.map((grp) => {
                  const id = grp.ZF_GroupID;
                  const isOpen = expanded.has(id);
                  const zfi = grp.ZFI || {};
                  const zfesVinc = Array.isArray(grp.ZFEs) ? grp.ZFEs : [];
                  const disponibles = zfesDisponiblesForGroup(grp);

                  return (
                    <Fragment key={id}>
                      <tr className="hover:bg-white/5">
                        <td className="p-2 align-top">
                          <button
                            onClick={() => toggleExpand(id)}
                            className="rounded-md px-2 py-1 bg-white/10 hover:bg-white/20 transition"
                            title={isOpen ? "Contraer" : "Expandir"}
                          >
                            {isOpen ? "–" : "+"}
                          </button>
                        </td>
                        <td className="p-2 align-top">#{id}</td>
                        <td className="p-2 align-top">{grp.OC_ID ?? "—"}</td>
                        <td className="p-2 align-top">
                          <div className="font-mono">
                            {zfi?.Despacho ?? `ID ${zfi?.ZFI_ID ?? "—"}`}
                          </div>
                          <div className="text-xs text-slate-400">
                            ZFI: {zfi?.ZFI_ID ?? "—"}
                          </div>
                        </td>
                        <td className="p-2 align-top">
                          {zfi?.Fecha ? String(zfi.Fecha).slice(0, 10) : "—"}
                        </td>
                        <td className="p-2 align-top text-center">
                          {zfesVinc.length}
                        </td>
                        <td className="p-2 align-top">
                          <button
                            onClick={() => toggleExpand(id)}
                            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition"
                          >
                            {isOpen ? "Ocultar ZFEs" : "Ver ZFEs"}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-white/5">
                          <td className="p-3" colSpan={7}>
                            <div className="grid gap-3">
                              <div>
                                <strong>
                                  ZFEs vinculados ({zfesVinc.length}):
                                </strong>
                                {!zfesVinc.length ? (
                                  <div className="text-slate-400 text-sm mt-1">
                                    Este grupo no tiene ZFEs vinculados.
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {zfesVinc.map((z) => {
                                      const chipId = z.ZFE_ID;
                                      const fecha = z.Fecha
                                        ? String(z.Fecha).slice(0, 10)
                                        : null;
                                      return (
                                        <div
                                          key={chipId}
                                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/10"
                                        >
                                          <span className="font-mono">
                                            {z.Despacho ?? chipId}
                                          </span>
                                          {fecha && (
                                            <span className="opacity-70 text-xs">
                                              · {fecha}
                                            </span>
                                          )}
                                          <button
                                            onClick={() =>
                                              quitarZFE(id, chipId)
                                            }
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
                              </div>

                              {oc?.OC_ID && (
                                <div>
                                  <strong>Agregar ZFE disponible:</strong>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {disponibles.length ? (
                                      disponibles.map((zfe) => (
                                        <button
                                          key={zfe.ID}
                                          onClick={() =>
                                            agregarZFE(id, zfe.ID)
                                          }
                                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
                                        >
                                          + {zfe.Despacho}
                                        </button>
                                      ))
                                    ) : (
                                      <span className="text-slate-400 text-xs">
                                        No hay ZFE para agregar.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* === ZFIs de la OC (sección que ya tenías) === */}
      {oc && (
        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="font-semibold">ZFI de la OC {oc.OC_ID} y sus ZFE</h3>
          {loadingDesp ? (
            <div className="text-slate-400 mt-2">Cargando despachos…</div>
          ) : zfis.length === 0 ? (
            <div className="text-slate-400 mt-2">No hay ZFI para esta OC.</div>
          ) : (
            <div className="overflow-x-auto mt-3 rounded border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-slate-300">
                  <tr>
                    <th className="p-2 text-left">ZFI</th>
                    <th className="p-2 text-left">Fecha</th>
                    <th className="p-2 text-left">Grupo</th>
                    <th className="p-2 text-left">ZFE asociados</th>
                    <th className="p-2 text-left">Agregar ZFE</th>
                  </tr>
                </thead>
                <tbody>
                  {zfis.map((zfi) => {
                    const grp = groupsByZFI.get(zfi.ID);
                    const disponibles = grp ? zfesDisponiblesForGroup(grp) : [];
                    return (
                      <tr key={zfi.ID} className="border-t border-white/10 align-top">
                        <td className="p-2">
                          <div className="font-mono">{zfi.Despacho}</div>
                          <div className="text-xs text-slate-400">ID {zfi.ID}</div>
                        </td>
                        <td className="p-2">{zfi.Fecha || "—"}</td>
                        <td className="p-2">
                          {grp ? (
                            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-indigo-600/30 border border-indigo-400/40">
                              Grupo #{grp.ZF_GroupID}
                            </span>
                          ) : (
                            <button
                              className="px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-600 text-xs"
                              onClick={() => crearGrupo(zfi.ID)}
                              disabled={creating}
                            >
                              Crear grupo
                            </button>
                          )}
                        </td>
                        <td className="p-2">
                          {!grp || !grp.ZFEs?.length ? (
                            <span className="text-slate-400 text-xs">Sin ZFE</span>
                          ) : (
                            <ul className="space-y-1">
                              {grp.ZFEs.map((z) => (
                                <li key={z.ZFE_ID} className="flex items-center gap-2">
                                  <code>{z.Despacho}</code>
                                  <span className="text-xs text-slate-400">
                                    {z.Fecha || ""}
                                  </span>
                                  <button
                                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
                                    onClick={() => quitarZFE(grp.ZF_GroupID, z.ZFE_ID)}
                                  >
                                    Quitar
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="p-2">
                          {grp ? (
                            disponibles.length ? (
                              <div className="flex flex-wrap gap-2">
                                {disponibles.map((zfe) => (
                                  <button
                                    key={zfe.ID}
                                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
                                    onClick={() => agregarZFE(grp.ZF_GroupID, zfe.ID)}
                                  >
                                    + {zfe.Despacho}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">
                                No hay ZFE disponibles
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
