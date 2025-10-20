import React, { useEffect, useState } from "react";
import OCSearchSelect from "./OCSearchSelect";
import useApi from "../hooks/useApi";
import ZFILinesPanel from "./ZFILinesPanel";

const TIPO_OPCIONES = [
  { value: "ZFI",  label: "ZFI",  hint: "Ingreso a Zona Franca" },
  { value: "ZFE",  label: "ZFE",  hint: "Nacionalización" },
  { value: "IC04", label: "IC04", hint: "Importación directa" },
  { value: "IC05", label: "IC05", hint: "Importación directa" },
];

const normalizeDespacho = (s = "") => s.replace(/\s+/g, "").trim().toUpperCase();

export default function FormularioEditarDespacho({ id, volverAtras, showOCR }) {
  const { get, upload, del, put } = useApi();

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

  const [ocSel, setOcSel] = useState(null);
  const [mensaje, setMensaje] = useState("");
  const [errors, setErrors] = useState({});
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  // info de documento guardado
  const [docInfo, setDocInfo] = useState({ HasDoc: false, DocUrl: "", DocName: "" });

  // OCR (opcional)
  const [ocrFile, setOcrFile] = useState(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrPreviewText, setOcrPreviewText] = useState("");

  const setField = (name, value) => {
    setFormData((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  // ====== Carga inicial
  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const d = await get(`/api/despachos/${id}`);

        setFormData({
          Despacho: d.Despacho ?? "",
          Fecha: d.Fecha ?? "",
          FOB: d.FOB ?? "",
          Estadistica: d.Estadistica ?? "",
          Derechos_Importacion: d.Derechos_Importacion ?? "",
          Tipo_Cambio: d.Tipo_Cambio ?? "",
          Arancel: d.Arcanel ?? d.Arancel ?? "",
          TipoDespacho: (d.TipoDespacho ?? "").toUpperCase(),
          OC_ID: d.OC_ID ?? "",
        });
        setOcSel(d.OC_ID ? { OC_ID: d.OC_ID } : null);
        setDocInfo({
          HasDoc: !!d.HasDoc,
          DocUrl: d.DocUrl || "",
          DocName: d.DocName || "",
        });
      } catch (e) {
        setMensaje(`❌ ${e.message}`);
      } finally {
        setCargando(false);
      }
    })();
  }, [id]); // <- sólo cambia cuando cambia el id

  // ====== Validación
  const validate = () => {
    const e = {};
    if (!formData.Despacho?.trim()) e.Despacho = "El número de despacho es obligatorio.";
    if (!formData.Fecha) e.Fecha = "La fecha es obligatoria.";
    return e;
  };

  // ====== Guardar (PUT /api/despachos/:id)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    const eVal = validate();
    if (Object.keys(eVal).length) { setErrors(eVal); return; }

    setEnviando(true);
    try {
      const payload = {
        Despacho: normalizeDespacho(formData.Despacho),
        Fecha: formData.Fecha,
        FOB: formData.FOB,
        Estadistica: formData.Estadistica,
        Derechos_Importacion: formData.Derechos_Importacion,
        Tipo_Cambio: formData.Tipo_Cambio,
        Arancel: formData.Arancel,
        TipoDespacho: (formData.TipoDespacho || "").toUpperCase() || undefined,
        OC_ID: ocSel?.OC_ID || undefined,
      };

      const resp = await put(`/api/despachos/${id}`, payload);
      if (!resp || resp.ok === false) throw new Error(resp?.error || "Error al actualizar.");
      setMensaje("✅ Despacho actualizado con éxito.");
      volverAtras?.();
    } catch (err) {
      setMensaje(`❌ ${err.message || "No se pudo conectar con el servidor."}`);
    } finally {
      setEnviando(false);
    }
  };

  // ====== Borrar
  const handleDelete = async () => {
    if (!window.confirm("¿Seguro que querés borrar este despacho? Esta acción no se puede deshacer.")) return;
    setEliminando(true);
    setMensaje("");
    try {
      await del(`/api/despachos/${id}`);
      setMensaje("🗑️ Despacho eliminado.");
      volverAtras?.();
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
    } finally {
      setEliminando(false);
    }
  };

  // ====== OCR (opcional)
  const applyOcrSuggestions = (sug = {}) => {
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
  };

  const runOcrDespacho = async () => {
    if (!ocrFile) { setMensaje("Subí un PDF del despacho para correr OCR."); return; }
    try {
      setOcrRunning(true);
      setMensaje("Procesando OCR del despacho…");
      const fd = new FormData();
      fd.append("file", ocrFile);
      const j = await upload("/api/ocr/despacho?max_pages=3", fd);
      if (!j?.ok) throw new Error(j?.error || "Error en OCR.");
      setOcrPreviewText(j.previewText || "");
      applyOcrSuggestions(j.suggested || {});
      setMensaje("OCR completado. Revisá los datos prellenados.");
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
    } finally {
      setOcrRunning(false);
    }
  };

  if (cargando) return <div>Cargando datos del despacho…</div>;

  const esZFE = (formData.TipoDespacho || "").toUpperCase() === "ZFE";
  const esZFI = (formData.TipoDespacho || "").toUpperCase() === "ZFI";

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold">Editar despacho #{id}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={enviando || eliminando}
            className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50"
            title="Borrar este despacho"
          >
            {eliminando ? "Borrando…" : "Borrar"}
          </button>

          <button
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600"
            onClick={volverAtras}
            disabled={enviando || eliminando}
          >
            Volver
          </button>
          <button
            form="form-editar-desp"
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
            disabled={enviando || eliminando}
          >
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {mensaje && <div className="mb-4 text-sm p-3 rounded-lg bg-black/30">{mensaje}</div>}

      {/* Documento adjunto visible */}
      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm text-slate-300">Documento adjunto</div>
        {docInfo.HasDoc && docInfo.DocUrl ? (
          <div className="mt-1 flex items-center gap-3">
            <a
              href={docInfo.DocUrl}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 hover:text-indigo-200 underline"
              title={docInfo.DocName || "Ver documento"}
            >
              📎 {docInfo.DocName || "Abrir adjunto"}
            </a>
            <span className="text-xs text-slate-400">(se abrirá en una pestaña nueva)</span>
          </div>
        ) : (
          <div className="mt-1 text-slate-400 text-sm">No hay documento adjunto.</div>
        )}
      </div>

      {/* OCR Opcional */}
      {showOCR && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
          <header className="mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">OCR</div>
            <h3 className="text-lg font-semibold">Extraer datos desde PDF del despacho</h3>
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <input
              id="ocrDespFile"
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setOcrFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="ocrDespFile" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
              Seleccionar PDF
            </label>
            <span className="text-sm text-slate-300 truncate max-w-[280px]">
              {ocrFile ? ocrFile.name : "Ningún archivo seleccionado"}
            </span>
            <button
              type="button"
              onClick={runOcrDespacho}
              disabled={!ocrFile || ocrRunning || enviando || eliminando}
              className="ml-auto px-3 py-2 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50"
            >
              {ocrRunning ? "Procesando…" : "Ejecutar OCR"}
            </button>
          </div>

          {ocrPreviewText && (
            <pre className="mt-3 max-h-40 overflow-auto text-xs rounded-lg bg-black/40 p-3">
{ocrPreviewText}
            </pre>
          )}
          <p className="text-xs text-slate-400 mt-2">
            El OCR prellena campos vacíos como Nº Despacho, Fecha y montos (si se detectan). Revisá antes de guardar.
          </p>
        </section>
      )}

      <form id="form-editar-desp" onSubmit={handleSubmit} className="space-y-6">
        {/* Paso 1: Identificación */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <header className="mb-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Paso 1</div>
            <h3 className="text-lg font-semibold">Identificación</h3>
          </header>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">Nº Despacho *</label>
              <input
                value={formData.Despacho}
                onChange={(e)=>setField("Despacho", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                  errors.Despacho ? "border-red-500" : "border-white/20"
                }`}
              />
              {errors.Despacho && <p className="text-red-400 text-xs mt-1">{errors.Despacho}</p>}
            </div>
            <div>
              <label className="block text-sm mb-1">Fecha *</label>
              <input
                type="date"
                value={formData.Fecha}
                onChange={(e)=>setField("Fecha", e.target.value)}
                className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                  errors.Fecha ? "border-red-500" : "border-white/20"
                }`}
              />
              {errors.Fecha && <p className="text-red-400 text-xs mt-1">{errors.Fecha}</p>}
            </div>
          </div>
        </section>

        {/* Paso 2: Tipo */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <header className="mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Paso 2</div>
            <h3 className="text-lg font-semibold">Tipo de despacho</h3>
          </header>
          <div className="flex flex-wrap gap-2">
            {TIPO_OPCIONES.map(t => {
              const active = (formData.TipoDespacho || "").toUpperCase() === t.value;
              return (
                <button
                  type="button"
                  key={t.value}
                  onClick={()=>setField("TipoDespacho", t.value)}
                  className={`px-3 py-2 rounded-xl border text-sm
                    ${active ? "bg-indigo-600 border-indigo-500 text-white" : "bg-white/10 border-white/20 hover:bg-white/20"}`}
                  title={t.hint}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Paso 3: OC */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <header className="mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Paso 3</div>
            <h3 className="text-lg font-semibold">Orden de compra</h3>
          </header>
        <OCSearchSelect value={ocSel} onChange={setOcSel} />
          {ocSel && <div className="mt-2 text-xs text-slate-400">OC seleccionada: <strong>{ocSel.OC_ID}</strong></div>}
        </section>

        {/* Zona Franca: Artículos del ZFI (cuando es ZFI) */}
        {(formData.TipoDespacho || "").toUpperCase() === "ZFI" && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <ZFILinesPanel zfiId={Number(id)} ocId={ocSel?.OC_ID || formData.OC_ID} />
          </section>
        )}

        {/* ZF: asociar ZFE a ZFI (cuando es ZFE) */}
        {esZFE && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <header className="mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-400">Zona Franca</div>
              <h3 className="text-lg font-semibold">Asociar a ZFI</h3>
            </header>

            {!ocSel?.OC_ID ? (
              <div className="text-sm text-slate-400">Seleccioná una OC para listar sus ZFIs.</div>
            ) : (
              <ZFEAttachToZFI ocId={ocSel.OC_ID} zfeId={Number(id)} />
            )}
          </section>
        )}

        {/* Paso 4: Montos */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <header className="mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Paso 4</div>
            <h3 className="text-lg font-semibold">Montos (opcional)</h3>
          </header>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              ["FOB","FOB"],
              ["Estadistica","Estadística"],
              ["Derechos_Importacion","Derechos de Importación"],
              ["Tipo_Cambio","Tipo de Cambio"],
              ["Arancel","Arancel SIM IMPO"],
            ].map(([key,label])=>(
              <div key={key}>
                <label className="block text-sm mb-1">{label}</label>
                <input
                  type="text"
                  value={formData[key]}
                  onChange={(e)=>setField(key, e.target.value)}
                  placeholder="Ej: 2.142.234,31"
                  className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                    errors[key] ? "border-red-500" : "border-white/20"
                  }`}
                />
                {errors[key] && <p className="text-red-400 text-xs mt-1">{errors[key]}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* Acciones */}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={enviando || eliminando}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {enviando ? "Guardando..." : "Guardar Cambios"}
          </button>
          <button
            type="button"
            onClick={volverAtras}
            disabled={enviando || eliminando}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

/** Subcomponente: asociar un ZFE a un Grupo existente o
 * crear automáticamente el grupo a partir de un ZFI y asociar.
 */
function ZFEAttachToZFI({ ocId, zfeId }) {
  const { get, post } = useApi();
  const [groups, setGroups] = React.useState([]);
  const [groupId, setGroupId] = React.useState("");
  const [zfiList, setZfiList] = React.useState([]); // [{ZFI_ID, Despacho, Fecha}]
  const [zfiId, setZfiId] = React.useState("");     // selección para crear grupo
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  const loadData = React.useCallback(async () => {
    setMsg("");
    try {
      // grupos existentes
      const j1 = await get(`/zf/grupos?oc_id=${encodeURIComponent(ocId)}`);
      const items = Array.isArray(j1?.items) ? j1.items : [];
      setGroups(items);
      setGroupId(items[0]?.ZF_GroupID ? String(items[0].ZF_GroupID) : "");

      // ZFIs de la OC
      const j2 = await get(`/zf/zfis?oc_id=${encodeURIComponent(ocId)}`);
      const arr = Array.isArray(j2?.items) ? j2.items : [];
      setZfiList(arr);
      if (!items.length && arr.length) setZfiId(String(arr[0].ZFI_ID));
    } catch {
      setGroups([]); setZfiList([]);
    }
  }, [ocId]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const attachToGroup = async (gid) => {
    const jj = await post(`/zf/grupos/${gid}/items`, { ZFE_ID: zfeId });
    if (jj?.ok === false) throw new Error(jj?.error || "No se pudo asociar el ZFE.");
  };

  const createGroupForZFI = async (zfi) => {
    const j = await post(`/zf/grupos`, { ZFI_ID: Number(zfi), OC_ID: ocId });
    if (j?.ZF_GroupID || j?.id) return j.ZF_GroupID || j.id;

    const jx = await get(`/zf/grupos?oc_id=${encodeURIComponent(ocId)}`);
    const items = Array.isArray(jx?.items) ? jx.items : [];
    const found = items.find(g => Number(g?.ZFI?.ZFI_ID) === Number(zfi));
    if (found?.ZF_GroupID) return found.ZF_GroupID;

    throw new Error(j?.error || "No se pudo crear/obtener el Grupo ZF.");
  };

  const onAssociateClick = async () => {
    if (!groupId && !zfiId) return;
    setSaving(true); setMsg("");
    try {
      let gid = groupId;
      if (!gid && zfiId) {
        gid = await createGroupForZFI(zfiId);
      }
      await attachToGroup(gid);
      setMsg("✅ ZFE asociado correctamente.");
      await loadData();
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-[260px]">
          <label className="block text-sm mb-1">Grupo/ZFI existente</label>
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              value={groupId}
              onChange={(e)=>setGroupId(e.target.value)}
            >
              {groups.length === 0 ? (
                <option value="">(No hay grupos para esta OC)</option>
              ) : (
                groups.map(g => (
                  <option key={g.ZF_GroupID} value={g.ZF_GroupID}>
                    {g?.ZFI?.Despacho ? `ZFI ${g.ZFI.Despacho}` : `Grupo ${g.ZF_GroupID}`}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={loadData}
              className="px-2 py-1 text-xs rounded bg-white/10 border border-white/20"
              title="Refrescar"
            >
              Refrescar
            </button>
          </div>
        </div>

        <div className="min-w-[260px]">
          <label className="block text-sm mb-1">…o elegir un ZFI y crear el grupo</label>
          <select
            className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
            value={zfiId}
            onChange={(e)=>setZfiId(e.target.value)}
          >
            <option value="">(Elegir ZFI)</option>
            {zfiList.map(z => (
              <option key={z.ZFI_ID} value={z.ZFI_ID}>
                {z.Despacho ? `ZFI ${z.Despacho}` : `ZFI #${z.ZFI_ID}`}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">
            Si no existe grupo para ese ZFI, se creará automáticamente.
          </p>
        </div>

        <div className="self-end">
          <button
            type="button"
            onClick={onAssociateClick}
            disabled={saving || (!groupId && !zfiId)}
            className="px-3 py-2 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50"
          >
            {saving ? "Asociando…" : "Asociar"}
          </button>
        </div>
      </div>

      {msg && <div className="text-xs">{msg}</div>}
    </div>
  );
}
