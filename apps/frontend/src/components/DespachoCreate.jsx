import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import OCSearchSelectMulti from "./OCSearchSelectMulti";
import useApi from "../hooks/useApi";
import ZFERetiroPanel from "./ZFERetiroPanel";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const normalizeDespacho = (s = "") => s.replace(/\s+/g, "").trim().toUpperCase();

const TIPO_OPCIONES = [
  { value: "ZFI", label: "ZFI", hint: "Ingreso a Zona Franca" },
  { value: "ZFE", label: "ZFE", hint: "Nacionalización" },
  { value: "IC04", label: "IC04", hint: "Importación directa" },
  { value: "IC05", label: "IC05", hint: "Importación directa" },
];

export default function CreateDespacho({ volverAtras, onCreado, irAEditar }) {
  const { get, post, upload } = useApi();

  const [formData, setFormData] = useState({
    Despacho: "",
    Fecha: "",
    FOB: "",
    Estadistica: "",
    Derechos_Importacion: "",
    Tipo_Cambio: "",
    Arancel: "",
    TipoDespacho: "",
    OC_ID: "",
  });

  // === OCs seleccionadas ===
  const [ocIds, setOcIds] = useState([]);

  // ZF groups / ZFIs (para ZFE)
  const [zfGroups, setZfGroups] = useState([]);   // [{ZF_GroupID, ZFI:{ZFI_ID, Despacho, Fecha}}]
  const [zfGroupId, setZfGroupId] = useState("");   // grupo elegido (si existe)
  const [zfiList, setZfiList] = useState([]);   // ZFIs disponibles para crear grupo
  const [zfiId, setZfiId] = useState("");   // ZFI elegido para crear grupo auto

  // Duplicado
  const [dupChecking, setDupChecking] = useState(false);
  const [dupInfo, setDupInfo] = useState(null);
  const [dupError, setDupError] = useState("");

  // OCR/PDF
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);

  const [mensaje, setMensaje] = useState("");

  const setField = (name, value) => {
    const v = name === "Despacho" ? normalizeDespacho(value) : value;
    setFormData((p) => ({ ...p, [name]: v }));
  };

  const ocIdList = useMemo(
    () =>
      Array.isArray(ocIds)
        ? ocIds
          .map((o) => (typeof o === "string" ? o : o?.OC_ID))
          .filter((id) => !!id)
        : [],
    [ocIds]
  );

  // OC “principal” (primera de la lista)
  const primaryOcId = ocIdList[0] || formData.OC_ID || "";

  const [draftRetiros, setDraftRetiros] = useState([]);

  // ====== visor PDF
  useEffect(() => {
    const calc = () => {
      if (!panelRef.current) return;
      const r = panelRef.current.getBoundingClientRect();
      setPanelWidth(Math.max(320, r.width - 16));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("resize", calc);
      ro.disconnect();
    };
  }, []);

  useEffect(() => () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); }, [pdfPreviewUrl]);

  // ====== duplicado (depende sólo del campo)
  useEffect(() => {
    const n = normalizeDespacho(formData.Despacho);
    setDupError(""); setDupInfo(null);
    if (!n) return;
    const t = setTimeout(async () => {
      try {
        setDupChecking(true);
        const j = await get(`/api/despachos/exists?numero=${encodeURIComponent(n)}`);
        if (j?.ok === false) { setDupError(j?.error || "Error verificando duplicado."); return; }
        setDupInfo({ exists: j.exists, id: j.id, numero: j.numero });
      } catch { setDupError("Error de red al verificar duplicado."); }
      finally { setDupChecking(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [formData.Despacho]); // <- sólo cambia cuando cambia el número

  const esZFE = (formData.TipoDespacho || "").toUpperCase() === "ZFE";

  // ====== cargar grupos ZF y ZFIs cuando sea ZFE y haya OC
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!esZFE || !primaryOcId) {
        // limpiar estado si no corresponde
        if (alive) {
          setZfGroups([]);
          setZfGroupId("");
          setZfiList([]);
          setZfiId("");
        }
        return;
      }

      try {
        // 1) grupos ZF
        const j1 = await get(`/zf/grupos?oc_id=${encodeURIComponent(primaryOcId)}`);
        if (!alive) return;
        const groupsLocal = Array.isArray(j1?.items) ? j1.items : [];
        setZfGroups(groupsLocal);
        if (groupsLocal.length) {
          setZfGroupId(String(groupsLocal[0].ZF_GroupID));
        }
      } catch {
        if (alive) {
          setZfGroups([]);
          setZfGroupId("");
        }
      }

      try {
        // 2) ZFIs vinculados a esa OC
        const j2 = await get(`/zf/zfis?oc_id=${encodeURIComponent(primaryOcId)}`);
        if (!alive) return;
        const arr = Array.isArray(j2?.items) ? j2.items : [];
        setZfiList(arr);
        if (!zfGroups.length && arr.length) {
          setZfiId(String(arr[0].ZFI_ID));
        }
      } catch {
        if (alive) {
          setZfiList([]);
          setZfiId("");
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [esZFE, primaryOcId, get]);

  // ====== archivo / OCR
  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setArchivo(f);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(f && f.type === "application/pdf" ? URL.createObjectURL(f) : "");
  };

  const procesarOCR = async () => {
    if (!archivo) { setMensaje("Seleccioná un PDF primero."); return; }
    try {
      setProcesando(true);
      setMensaje("Procesando OCR...");
      const fd = new FormData(); fd.append("file", archivo);
      const j = await upload("/api/ocr/despacho?max_pages=4&dpi=300", fd);
      if (!j?.ok) throw new Error(j?.error || "Error en OCR");
      const sug = j.suggested || {};
      setFormData(prev => ({
        ...prev,
        Despacho: prev.Despacho || normalizeDespacho(sug.Despacho ?? ""),
        Fecha: prev.Fecha || (sug.Fecha ?? ""),
        FOB: prev.FOB || (sug.FOB ?? ""),
        Estadistica: prev.Estadistica || (sug.Estadistica ?? ""),
        Derechos_Importacion: prev.Derechos_Importacion || (sug.Derechos_Importacion ?? ""),
        Tipo_Cambio: prev.Tipo_Cambio || (sug.Tipo_Cambio ?? ""),
        Arancel: prev.Arancel || (sug.Arancel ?? ""),
      }));
      setMensaje("OCR completado. Revisá los datos.");
    } catch (e) {
      setMensaje(`Error OCR: ${e.message}`);
    } finally {
      setProcesando(false);
    }
  };

  // ====== helpers ZF
  const createGroupForZFI = async (zfi) => {
    if (!primaryOcId) throw new Error("Seleccioná una OC válida antes de crear el grupo.");
    const j = await post(`/zf/grupos`, { ZFI_ID: Number(zfi), OC_ID: primaryOcId });
    if (j?.ZF_GroupID || j?.id) return j.ZF_GroupID || j.id;

    const jx = await get(`/zf/grupos?oc_id=${encodeURIComponent(primaryOcId)}`);
    const items = Array.isArray(jx?.items) ? jx.items : [];
    const found = items.find(g => Number(g?.ZFI?.ZFI_ID) === Number(zfi));
    if (found?.ZF_GroupID) return found.ZF_GroupID;

    throw new Error(j?.error || "No se pudo crear/obtener el Grupo ZF.");
  };

  // ====== submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    if (!formData.Despacho?.trim())
      return setMensaje("El Nº de Despacho es obligatorio.");
    if (!formData.Fecha)
      return setMensaje("La Fecha es obligatoria.");
    if (!formData.TipoDespacho)
      return setMensaje("Seleccioná el Tipo de despacho.");
    if (!ocIdList.length)
      return setMensaje("Seleccioná al menos una Orden de Compra.");

    try {
      const payload = {
        ...formData,
        Despacho: normalizeDespacho(formData.Despacho),
        TipoDespacho: (formData.TipoDespacho || "").toUpperCase(),
        OC_ID: primaryOcId || "",
        // todas las OCs seleccionadas como strings
        oc_ids: ocIdList,
      };

      const fd = new FormData();

      Object.entries(payload).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach((item) => fd.append(`${k}[]`, item ?? ""));
        } else {
          fd.append(k, v ?? "");
        }
      });

      fd.append("tipoDocumento", "Despacho");
      if (archivo) {
        fd.append("documento", archivo);
      }

      const resp = await upload("/api/despachos", fd);
      if (!resp || resp.ok === false || !resp.id) {
        throw new Error(resp?.error || "No se pudo crear el despacho.");
      }

      const newId = resp.id;
      setMensaje("✅ Despacho creado con éxito.");

      // ====== ZFE: asociar grupo y retiros (lo que ya tenías) ======
      if (esZFE) {
        let gid = zfGroupId;
        if (!gid && zfiId) {
          gid = await createGroupForZFI(zfiId);
        }
        if (gid) {
          const jj = await post(`/zf/grupos/${gid}/items`, { ZFE_ID: Number(newId) });
          if (jj?.ok === false) {
            throw new Error(jj?.error || "Se creó el ZFE pero no se pudo asociar al ZFI.");
          }
        }
      }

      if (esZFE && draftRetiros?.length) {
        try {
          const respLines = await post(`/zf/zfe/${newId}/lines`, { items: draftRetiros });
          console.log(`… ${respLines?.inserted || 0} líneas de retiro cargadas automáticamente.`);
        } catch (e) {
          console.warn("??? Error guardando retiros del ZFE recién creado:", e.message);
        }
      }

      // limpiar formulario
      setFormData({
        Despacho: "",
        Fecha: "",
        FOB: "",
        Estadistica: "",
        Derechos_Importacion: "",
        Tipo_Cambio: "",
        Arancel: "",
        TipoDespacho: "",
        OC_ID: "",
      });
      setOcIds([]);
      setArchivo(null);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl("");

      if (typeof onCreado === "function") onCreado(newId);
      else if (typeof irAEditar === "function") irAEditar(newId);
      else volverAtras?.();
    } catch (err) {
      setMensaje(`❌ ${err.message || "No se pudo conectar con el servidor."}`);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-8">
      <button onClick={volverAtras} className="mb-4 rounded-md bg-white/10 px-4 py-2 border border-white/10 hover:bg-white/20">
        Volver a la tabla
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* IZQUIERDA */}
        <div className="relative z-10 lg:col-span-5">
          {/* OCR */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <input id="pdfInput" type="file" accept="application/pdf" onChange={handleFileChange} className="sr-only" />
              <label htmlFor="pdfInput" className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500">
                Seleccionar archivo
              </label>
              <div className="text-sm text-slate-300 truncate max-w-[280px]">{archivo ? archivo.name : "Ningún archivo seleccionado"}</div>
              <button
                type="button"
                onClick={procesarOCR}
                disabled={!archivo || procesando}
                className="ml-auto px-4 py-2 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-500 disabled:opacity-50"
              >
                {procesando ? "Procesando..." : "Procesar OCR"}
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">Campos completados con OCR. Revisá y confirmá.</p>
          </div>

          {/* FORM */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            {/* Paso 1 */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <header className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-400">Paso 1</div>
                <h3 className="text-lg font-semibold">Identificación</h3>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Nº Despacho *</label>
                  <input
                    value={formData.Despacho}
                    onChange={(e) => setField("Despacho", e.target.value)}
                    className={`w-full rounded-md bg-white/10 border px-3 py-2 outline-none focus:ring-2 ${dupInfo?.exists ? "border-red-500 focus:ring-red-400" : "border-white/10 focus:ring-indigo-400"
                      }`}
                  />
                  {dupChecking && <p className="text-xs text-slate-400 mt-1">Verificando duplicado…</p>}
                  {dupError && <p className="text-xs text-amber-400 mt-1">{dupError}</p>}
                  {dupInfo?.exists && (
                    <p className="text-xs text-red-400 mt-1">
                      Ya existe un despacho con este número{dupInfo.id ? <> (ID <b>{dupInfo.id}</b>)</> : null}. Revisá antes de guardar.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Fecha *</label>
                  <input
                    type="date"
                    value={formData.Fecha}
                    onChange={(e) => setField("Fecha", e.target.value)}
                    className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
            </section>

            {/* Paso 2: tipo */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <header className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-400">Paso 2</div>
                <h3 className="text-lg font-semibold">Tipo de despacho *</h3>
              </header>
              <div className="flex flex-wrap gap-2">
                {TIPO_OPCIONES.map(t => {
                  const active = (formData.TipoDespacho || "").toUpperCase() === t.value;
                  return (
                    <button
                      type="button"
                      key={t.value}
                      onClick={() => setField("TipoDespacho", t.value)}
                      className={`px-3 py-2 rounded-xl border text-sm ${active ? "bg-indigo-600 border-indigo-500 text-white" : "bg-white/10 border-white/20 hover:bg-white/20"
                        }`}
                      title={t.hint}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Paso 3: OC */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <header className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  PASO 3
                </div>
                <h3 className="text-lg font-semibold">Orden de compra *</h3>
              </header>

              {/* chips + buscador */}
              <OCSearchSelectMulti
                value={ocIds}
                onChange={setOcIds}
                placeholder="Buscar OC (por Nro / Proveedor)"
              />

              <div className="mt-2 text-xs text-slate-400">
                {ocIdList.length === 0 ? (
                  <>Sin OC seleccionada</>
                ) : (
                  <>
                    OCs seleccionadas:{" "}
                    <strong>{ocIdList.join(", ")}</strong>
                  </>
                )}
              </div>
            </section>

            {/* Paso 3B: asociar ZFI / crear grupo auto */}
            {esZFE && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <header className="mb-3">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Paso 3B</div>
                  <h3 className="text-lg font-semibold">Asociar a ZFI</h3>
                </header>
                {esZFE && (
                  <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <header className="mb-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Paso 3B</div>
                      <h3 className="text-lg font-semibold">Asociar a ZFI</h3>
                    </header>
                    ...
                  </section>
                )}

                {esZFE && (
                  <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mt-4">
                    <header className="mb-3">
                      <div className="text-xs uppercase tracking-wide text-slate-400">Zona Franca</div>
                      <h3 className="text-lg font-semibold">Artículos retirados</h3>
                    </header>

                    {!primaryOcId ? (
                      <div className="text-sm text-slate-400">
                        Seleccioná una OC para ver los artículos disponibles.
                      </div>
                    ) : (
                      <ZFERetiroPanel
                        zfeId={null}
                        ocId={primaryOcId}
                        modoCreacion={true}
                        onDraftChange={(items) => setDraftRetiros(items)}  // guardalo en state del padre
                      />
                    )}
                  </section>
                )}


                {!primaryOcId ? (
                  <div className="text-sm text-slate-400">Primero seleccioná una OC para listar sus ZFIs.</div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm mb-1">Grupo/ZFI existente</label>
                      <div className="flex items-center gap-2">
                        <select
                          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                          value={zfGroupId}
                          onChange={(e) => setZfGroupId(e.target.value)}
                        >
                          {zfGroups.length === 0 ? (
                            <option value="">(No hay grupos para esta OC)</option>
                          ) : (
                            zfGroups.map(g => (
                              <option key={g.ZF_GroupID} value={g.ZF_GroupID}>
                                {g?.ZFI?.Despacho ? `ZFI ${g.ZFI.Despacho}` : `Grupo ${g.ZF_GroupID}`}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const j = await get(`/zf/grupos?oc_id=${encodeURIComponent(primaryOcId)}`);
                              const groups = Array.isArray(j?.items) ? j.items : [];
                              setZfGroups(groups);
                              setZfGroupId(groups[0]?.ZF_GroupID ? String(groups[0].ZF_GroupID) : "");
                              const j2 = await get(`/zf/zfis?oc_id=${encodeURIComponent(primaryOcId)}`);
                              const arr = Array.isArray(j2?.items) ? j2.items : [];
                              setZfiList(arr);
                              if (!groups.length && arr.length) setZfiId(String(arr[0].ZFI_ID));
                            } catch { }
                          }}
                          className="px-2 py-1 text-xs rounded bg-white/10 border border-white/20"
                        >
                          Refrescar
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm mb-1">…o elegir un ZFI y crear el grupo</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                        value={zfiId}
                        onChange={(e) => setZfiId(e.target.value)}
                      >
                        <option value="">(Elegir ZFI)</option>
                        {zfiList.map(z => (
                          <option key={z.ZFI_ID} value={z.ZFI_ID}>
                            {z.Despacho ? `ZFI ${z.Despacho}` : `ZFI #${z.ZFI_ID}`}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Si no existe grupo para ese ZFI, se creará automáticamente al guardar.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Paso 4: montos */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <header className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-400">Paso 4</div>
                <h3 className="text-lg font-semibold">Montos (opcional)</h3>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {[
                  ["FOB", "FOB"], ["Estadistica", "Estadística"],
                  ["Derechos_Importacion", "Derechos de Importación"],
                  ["Tipo_Cambio", "Tipo de Cambio"], ["Arancel", "Arancel SIM IMPO"],
                ].map(([name, label]) => (
                  <div key={name}>
                    <label className="block text-sm text-slate-300 mb-1">{label}</label>
                    <input
                      type="text"
                      name={name}
                      value={formData[name]}
                      onChange={(e) => setField(name, e.target.value)}
                      placeholder="Ej: 2.142.234,31"
                      className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={procesando || dupChecking || dupInfo?.exists}
                className={`px-4 py-2 rounded-md text-white font-medium ${dupInfo?.exists ? "bg-gray-600 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
              >
                Guardar Despacho
              </button>
              <button type="button" onClick={volverAtras} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600">
                Cancelar
              </button>
            </div>

            {mensaje && <p className="mt-3 text-sm text-slate-300">{mensaje}</p>}
          </form>
        </div>

        {/* DERECHA: preview */}
        <div className="relative z-0 lg:col-span-7">
          <div className="sticky top-20 h-[calc(100vh-120px)]">
            <div ref={panelRef} className="h-full rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col">
              <div className="text-sm text-slate-300 mb-2 shrink-0">Vista previa PDF — Página 3</div>
              <div className="flex-1 overflow-auto rounded-md bg-black/60">
                {pdfPreviewUrl ? (
                  <Document file={pdfPreviewUrl} loading={<div className="text-slate-300 p-4">Cargando PDF…</div>}>
                    <Page pageNumber={3} width={panelWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                  </Document>
                ) : (
                  <div className="text-slate-400 p-4">Seleccioná un PDF para ver la página 3 aquí.</div>
                )}
              </div>
              {pdfPreviewUrl && (
                <div className="mt-2 text-right shrink-0">
                  <a href={`${pdfPreviewUrl}#page=3&zoom=page-width`} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 underline">
                    Abrir en pestaña nueva
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
