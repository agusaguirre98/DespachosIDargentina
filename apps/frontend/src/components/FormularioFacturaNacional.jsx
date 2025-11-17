import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import OCSearchSelectMulti from "./OCSearchSelectMulti";

// Worker de pdf.js desde node_modules (igual que en tu FormularioFactura.jsx)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Catálogo mínimo de tipos de gasto (mock). Reemplazalo por /api/tipos-gasto cuando esté el back.
const TIPOS_GASTO = [
  { id: "FLETE_INT", label: "Flete interno" },
  { id: "LOGISTICA", label: "Logística" },
  { id: "ESTAMP",    label: "Estampillado" },
];

// ======== Utils ========
const parseNumber = (s = "") => {
  if (s === null || s === undefined || s === "") return "";
  const t = String(s).trim();
  if (t.includes(".") && t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (!t.includes(".") && (t.match(/,/g)?.length === 1)) return Number(t.replace(",", "."));
  return Number(t.replace(/,/g, ""));
};

// ===================================================================
//                          FORMULARIO NACIONAL
// ===================================================================
export default function FormularioFacturaNacional({ onCancel, onSave }) {
  const [form, setForm] = useState({
    tipoGasto: "",
    fecha: "",
    moneda: "ARS",
    importe: "",
    proveedor: "",
    nroFactura: "",
    descripcion: "",
    ocIds: [],
    hasDoc: false,
  });

  // PDF + OCR
  const [archivo, setArchivo] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [procesandoOCR, setProcesandoOCR] = useState(false);

  // Preview responsive
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useEffect(() => {
    const update = () => setPanelWidth(panelRef.current?.clientWidth || 0);
    update();
    const ro = new ResizeObserver(update);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const setField = (name, value) => setForm((p) => ({ ...p, [name]: value }));

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setArchivo(file);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(file && file.type === "application/pdf" ? URL.createObjectURL(file) : "");
  };

  const mergeOCR = (sug = {}) => {
    setForm((prev) => ({
      ...prev,
      fecha:
        prev.fecha ||
        (typeof sug.Fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sug.Fecha) ? sug.Fecha : ""),
      proveedor: prev.proveedor || (sug.Razon_Social ?? ""),
      nroFactura: prev.nroFactura || (sug.nroFactura ?? ""),
      importe:
        prev.importe ||
        (typeof sug.Total === "number" ? String(sug.Total) : (sug.TotalNum != null ? String(sug.TotalNum) : "")),
      moneda: prev.moneda || (sug.Moneda || "ARS"),
      tipoGasto: prev.tipoGasto || (sug.TipoGasto ?? ""),
      descripcion: prev.descripcion || (sug.Detalle ?? ""),
    }));
  };

  const procesarOCR = async () => {
    if (!archivo) {
      setMensaje("Seleccioná un PDF primero.");
      return;
    }
    try {
      setProcesandoOCR(true);
      setMensaje("Procesando OCR de factura…");
      const fd = new FormData();
      fd.append("file", archivo);
      // Reusamos el mismo endpoint que ya usás en importaciones
      const resp = await fetch("/api/ocr/factura?max_pages=1", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) throw new Error(data?.error || "Error en OCR");
      mergeOCR(data.suggested || {});
      setMensaje("OCR completado. Revisá los datos.");
    } catch (e) {
      setMensaje(`Error: ${e.message}`);
    } finally {
      setProcesandoOCR(false);
    }
  };

  const totalPreview = useMemo(() => {
    const n = parseNumber(form.importe);
    return Number.isNaN(n) ? 0 : n;
  }, [form.importe]);

  const guardar = () => {
    if (!form.tipoGasto) return alert("El tipo de gasto es obligatorio");
    if (!form.fecha) return alert("La fecha es obligatoria");
    if (!form.proveedor) return alert("El proveedor es obligatorio");
    if (!form.nroFactura) return alert("El número de factura es obligatorio");
    if (!form.importe || parseNumber(form.importe) <= 0) return alert("El importe debe ser mayor a 0");
    if (!form.ocIds.length) return alert("Vinculá al menos una OC");

    onSave({
      tipoGasto: form.tipoGasto,
      fecha: form.fecha,
      moneda: form.moneda || "ARS",
      importe: parseNumber(form.importe),
      proveedor: form.proveedor,
      nroFactura: form.nroFactura,
      descripcion: form.descripcion,
      ocIds: (Array.isArray(form.ocIds) ? form.ocIds : [])
        .map((oc) => (typeof oc === "string" ? oc : oc?.OC_ID))
        .filter((id) => !!id),
      hasDoc: form.hasDoc,
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50">
      <div className="w-full max-w-6xl rounded-2xl bg-teal-100 border border-teal-300 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 shadow-xl">
        {/* IZQUIERDA: Formulario */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-teal-300 bg-teal-200/50 p-4">
            <div className="flex items-center gap-3">
              <input id="pdfFacturaNac" type="file" accept="application/pdf" onChange={handleFileChange} className="sr-only" />
              <label
                htmlFor="pdfFacturaNac"
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 whitespace-nowrap"
              >
                Seleccionar archivo
              </label>
              <div className="text-sm text-slate-900 truncate max-w-[260px]">
                {archivo ? archivo.name : "Ningún archivo seleccionado"}
              </div>
              <button
                type="button"
                onClick={procesarOCR}
                disabled={!archivo || procesandoOCR}
                className="ml-auto px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white"
              >
                {procesandoOCR ? "Procesando…" : "Procesar OCR"}
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Usá OCR para prellenar proveedor, N° y total.
            </p>
          </div>

          <div className="rounded-2xl border border-teal-300 bg-teal-200/50 p-4 space-y-4">
            {/* Tipo de Gasto */}
            <div>
              <label className="text-xs text-slate-700 mb-1 block">Tipo de Gasto *</label>
              <select
                className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none text-slate-900"
                value={form.tipoGasto}
                onChange={(e) => setField("tipoGasto", e.target.value)}
              >
                <option value="">Seleccione un Tipo de Gasto</option>
                {TIPOS_GASTO.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha / Moneda / Importe */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <label className="text-xs text-slate-700 mb-1 block">Fecha *</label>
                <input
                  type="date"
                  className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none"
                  value={form.fecha}
                  onChange={(e) => setField("fecha", e.target.value)}
                />
              </div>
              <div className="col-span-3">
                <label className="text-xs text-slate-700 mb-1 block">Moneda</label>
                <select
                  className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none text-slate-900"
                  value={form.moneda}
                  onChange={(e) => setField("moneda", e.target.value)}
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="col-span-3">
                <label className="text-xs text-slate-700 mb-1 block">Importe *</label>
                <input
                  type="text"
                  placeholder="Ej: 250000.00 o 2.142.234,31"
                  className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none"
                  value={form.importe}
                  onChange={(e) => setField("importe", e.target.value)}
                />
              </div>
            </div>

            {/* Proveedor / N° Factura */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-7">
                <label className="text-xs text-slate-700 mb-1 block">Proveedor *</label>
                <input
                  placeholder="Ej: LOGÍSTICA FEDERAL SA"
                  className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none"
                  value={form.proveedor}
                  onChange={(e) => setField("proveedor", e.target.value)}
                />
              </div>
              <div className="col-span-5">
                <label className="text-xs text-slate-700 mb-1 block">N° Factura *</label>
                <input
                  placeholder="Ej: F0001-12345678"
                  className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none"
                  value={form.nroFactura}
                  onChange={(e) => setField("nroFactura", e.target.value)}
                />
              </div>
            </div>

            {/* Descripción */}
            <div>
              <label className="text-xs text-slate-700 mb-1 block">Descripción</label>
              <input
                placeholder="Detalle de la factura…"
                className="w-full h-10 px-3 rounded-lg bg-teal-200/40 border border-teal-300 outline-none"
                value={form.descripcion}
                onChange={(e) => setField("descripcion", e.target.value)}
              />
            </div>

            {/* Vincular a varias OC (múltiple) */}
            <div>
              <label className="text-xs text-slate-700 mb-1 block">Vincular a varias OC (múltiple) *</label>
              <OCSearchSelectMulti
                value={form.ocIds}
                onChange={(ocIds) => setField("ocIds", ocIds)}
                placeholder="Buscar OC por número…"
              />
            </div>

            {/* Adjunto mock */}
            <div className="flex items-center gap-2">
              <input
                id="adjNac"
                type="checkbox"
                checked={form.hasDoc}
                onChange={(e) => setField("hasDoc", e.target.checked)}
              />
              <label htmlFor="adjNac" className="text-sm text-slate-800">Marcar como “Adjunto disponible”</label>
            </div>

            {/* Acciones */}
            <div className="flex gap-2 pt-2">
              <button className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500" onClick={guardar}>
                Guardar Factura
              </button>
              <button className="px-4 py-2 rounded-lg bg-teal-300 text-slate-900 hover:bg-teal-200" onClick={onCancel}>
                Cancelar
              </button>
            </div>

            {mensaje && (
              <div className="mt-2 text-sm p-2 rounded-lg bg-teal-200/60">{mensaje}</div>
            )}
          </div>
        </div>

        {/* DERECHA: Preview PDF */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-teal-300 bg-teal-200/50 p-4 h-full">
            <div className="text-sm text-slate-700 mb-2">Vista previa PDF — Página 1</div>
            <div ref={panelRef} className="h-[72vh] lg:h-[calc(100vh-180px)] overflow-auto">
              {pdfUrl ? (
                <Document
                  file={pdfUrl}
                  onLoadError={(e) => console.error("Error al cargar PDF:", e?.message || e)}
                  loading={<div className="text-slate-600">Cargando PDF…</div>}
                >
                  <Page
                    pageNumber={1}
                    width={panelWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                </Document>
              ) : (
                <div className="h-full grid place-items-center text-slate-600">
                  Seleccioná un PDF para ver la vista previa aquí.
                </div>
              )}
            </div>
            {pdfUrl && (
              <div className="mt-2 text-right">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-700 hover:text-indigo-500 underline"
                >
                  Abrir en pestaña nueva
                </a>
              </div>
            )}
          </div>

          {/* Resumen de captura rápida */}
          <div className="mt-4 rounded-2xl border border-teal-300 bg-teal-200/50 p-4 text-sm">
            <div className="font-semibold mb-2">Vista previa de datos</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-slate-800">
              <div><span className="text-slate-600">Tipo:</span> {form.tipoGasto || "—"}</div>
              <div><span className="text-slate-600">Fecha:</span> {form.fecha || "—"}</div>
              <div><span className="text-slate-600">Moneda:</span> {form.moneda}</div>
              <div><span className="text-slate-600">Importe:</span> {totalPreview.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div>
              <div><span className="text-slate-600">Proveedor:</span> {form.proveedor || "—"}</div>
              <div><span className="text-slate-600">N° Factura:</span> {form.nroFactura || "—"}</div>
              <div className="col-span-2 sm:col-span-3"><span className="text-slate-600">Descripción:</span> {form.descripcion || "—"}</div>
              <div className="col-span-2 sm:col-span-3">
                <span className="text-slate-600">OCs:</span>{" "}
                {form.ocIds.length
                  ? form.ocIds
                      .map((o) => (typeof o === "string" ? o : o?.OC_ID))
                      .filter((id) => !!id)
                      .map((id) => `OC-${id}`)
                      .join(", ")
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
