import React, { useEffect, useState, useRef, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// Worker recomendado (mismo patrón que en alta de facturas)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PROVEEDORES_NO_GRAVADO = [
  "GESTION FORWARD SRL",
  "TRANSPORTES SAGRILO LTDA S.E.",
  "UNLIMITED WORLD S.A.",
];

const normalize = (s) => (s || "").toString().trim().toUpperCase();
const isFleteInternacional = (v) =>
  (v || "").toString().trim().toLowerCase() === "flete internacional";

const parseNumber = (s = "") => {
  if (s === null || s === undefined || s === "") return "";
  const t = String(s).trim();
  if (t.includes(".") && t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (!t.includes(".") && (t.match(/,/g)?.length === 1)) return Number(t.replace(",", "."));
  return Number(t.replace(/,/g, ""));
};

const FormularioEditarFactura = ({ volverAtras, factura }) => {
  const [formData, setFormData] = useState({
    TipoGasto: factura?.TipoGasto || "",
    Fecha: factura?.Fecha || "",
    Invoice: factura?.Invoice || "",
    nroFactura: factura?.nroFactura || "",
    OrdenPO: factura?.OrdenPO || "",
    Importe: factura?.Importe ?? "",
    Moneda: factura?.Moneda || "ARS",
    SIMI_SIRA: factura?.SIMI_SIRA || "",
    Descripcion: factura?.Descripcion || "",
    Despacho: factura?.Despacho || "",
    BL: factura?.BL || "",
    Mercaderia: factura?.Mercaderia || "",
    Proveedor: factura?.Proveedor || "",
    nroProveedor: factura?.nroProveedor || "",
  });

  const [archivo, setArchivo] = useState(null);
  const [tiposGastoList, setTiposGastoList] = useState([]);
  const [despachosList, setDespachosList] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [procesando, setProcesando] = useState(false);

  // preview PDF
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(480);

  useEffect(() => {
    const calc = () => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      setPanelWidth(Math.max(320, rect.width - 16));
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

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const setField = (name, value) => setFormData((p) => ({ ...p, [name]: value }));

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setArchivo(f);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    if (f && f.type === "application/pdf") setPdfPreviewUrl(URL.createObjectURL(f));
    else setPdfPreviewUrl("");
  };

  const fetchLists = async () => {
    try {
      const [rTipos, rDesp] = await Promise.all([
        fetch("/api/tipos-gasto"),
        fetch("/api/despachos/list"),
      ]);
      const [tipos, desp] = await Promise.all([rTipos.json(), rDesp.json()]);
      setTiposGastoList(Array.isArray(tipos) ? tipos : []);
      setDespachosList(Array.isArray(desp) ? desp : []);
    } catch (e) {
      setMensaje("No se pudieron cargar listas de apoyo.");
    }
  };
  useEffect(() => {
    fetchLists();
  }, []);

  // Banner y hints: Flete internacional => usar "NO GRAVADO"
  const requiereNoGravado = useMemo(
    () => isFleteInternacional(formData.TipoGasto),
    [formData.TipoGasto]
  );
  const proveedorEspecial = useMemo(() => {
    const prov = normalize(formData.Proveedor);
    return PROVEEDORES_NO_GRAVADO.some((p) => normalize(p) === prov);
  }, [formData.Proveedor]);

  const mergeOCR = (sug = {}) => {
    // Sólo completa campos vacíos del form
    setFormData((prev) => ({
      ...prev,
      Fecha:
        prev.Fecha ||
        (typeof sug.Fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sug.Fecha) ? sug.Fecha : ""),
      Proveedor: prev.Proveedor || (sug.Razon_Social ?? ""),
      nroFactura: prev.nroFactura || (sug.nroFactura ?? ""),
      Importe: prev.Importe || (typeof sug.Total === "number" ? sug.Total : sug.TotalNum),
      Moneda: prev.Moneda || (sug.Moneda || "ARS"),
      TipoGasto: prev.TipoGasto || (sug.TipoGasto ?? ""),
      Descripcion: prev.Descripcion || (sug.Detalle ?? ""),
    }));
  };

  const procesarOCR = async () => {
    if (!archivo) {
      setMensaje("Seleccioná un PDF primero.");
      return;
    }
    try {
      setProcesando(true);
      setMensaje("Procesando OCR de factura…");
      const fd = new FormData();
      fd.append("file", archivo);
      const resp = await fetch("/api/ocr/factura?max_pages=1", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) throw new Error(data?.error || "Error en OCR");
      mergeOCR(data.suggested || {});
      setMensaje("OCR completado. Revisá los datos.");
    } catch (e) {
      console.error(e);
      setMensaje(`Error: ${e.message}`);
    } finally {
      setProcesando(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    try {
      setEnviando(true);

      const isEdit = Boolean(factura?.ID);
      let url = "/api/facturas";
      let method = "POST";
      let body;
      let headers;

      if (isEdit) {
        // PUT: enviar JSON plano (el backend no acepta archivo en PUT)
        url = `/api/facturas/${factura.ID}`;
        method = "PUT";
        const payload = { ...formData };
        // normalizar importe a número string
        const n = typeof payload.Importe === "number" ? payload.Importe : parseNumber(payload.Importe);
        payload.Importe = n !== null && !Number.isNaN(n) ? String(n) : "";
        body = JSON.stringify(payload);
        headers = { "Content-Type": "application/json" };
      } else {
        // POST: usar FormData y adjuntar archivo si existe
        const fd = new FormData();
        Object.entries(formData).forEach(([k, v]) => {
          if (k === "Importe") {
            const n = typeof v === "number" ? v : parseNumber(v);
            fd.append(k, n !== null && !Number.isNaN(n) ? String(n) : "");
          } else {
            if (v !== undefined && v !== null) fd.append(k, v);
          }
        });
        fd.append("tipoDocumento", "Gasto");
        if (archivo) fd.append("documento", archivo);
        body = fd;
        headers = undefined; // fetch pone boundary
      }

      const r = await fetch(url, { method, body, headers });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Error guardando factura");

      setMensaje("✅ Factura guardada con éxito.");
      volverAtras();
    } catch (err) {
      setMensaje(`❌ ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Izquierda: Form */}
      <div className="lg:col-span-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={volverAtras} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">
            Volver
          </button>
          <div className="text-sm opacity-80">
            {factura?.ID ? `Editando #${factura.ID}` : "Nueva factura"}
          </div>
        </div>

        {/* Aviso dinámico para Flete Internacional */}
        {requiereNoGravado && (
          <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
            <div className="text-amber-200 text-sm font-medium">Modo Flete Internacional</div>
            <div className="text-amber-100/90 text-sm mt-1">
              Recordá ingresar en <b>Importe</b> el monto que figura como <b>“NO GRAVADO”</b> en la factura.
            </div>
            {proveedorEspecial && (
              <div className="text-amber-100/90 text-xs mt-2">
                Detectado proveedor especial ({formData.Proveedor}). En estas facturas el valor válido suele ser el de <b>“NO GRAVADO”</b>.
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-white/10 p-4 bg-white/5">
          <div className="flex items-center gap-3">
            <input id="pdfInput" type="file" accept="application/pdf" onChange={handleFileChange} className="sr-only" />
            <label htmlFor="pdfInput" className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500">
              Seleccionar archivo
            </label>
            <div className="text-sm text-slate-300 truncate max-w-[280px]">
              {archivo ? archivo.name : "Ningún archivo seleccionado"}
            </div>
            <button
              type="button"
              onClick={procesarOCR}
              disabled={!archivo || procesando}
              className="ml-auto px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
            >
              {procesando ? "Procesando…" : "Procesar OCR"}
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Usá OCR para prellenar proveedor, N° y total. {requiereNoGravado && <b>Tomaremos “NO GRAVADO” si aplica.</b>}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Fila 1 */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">Tipo de Gasto *</label>
              <select
                value={formData.TipoGasto}
                onChange={(e) => setField("TipoGasto", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                required
              >
                <option value="">Seleccione un Tipo de Gasto</option>
                {tiposGastoList.map((t) => (
                  <option key={t.IdGasto} value={t.TipoGasto}>
                    {t.TipoGasto}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm">Fecha *</label>
              <input
                type="date"
                value={formData.Fecha}
                onChange={(e) => setField("Fecha", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                required
              />
            </div>
          </div>

          {/* Fila 2 */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">Proveedor</label>
              <input
                value={formData.Proveedor}
                onChange={(e) => setField("Proveedor", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                placeholder="Ej: GESTION FORWARD SRL"
              />
            </div>
            <div>
              <label className="text-sm">N° Factura</label>
              <input
                value={formData.nroFactura}
                onChange={(e) => setField("nroFactura", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          {/* Fila 3: Moneda + Importe */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm">Moneda</label>
              <select
                value={formData.Moneda}
                onChange={(e) => setField("Moneda", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">
                Importe {requiereNoGravado && <span className="opacity-80">(usar “NO GRAVADO”)</span>}
              </label>
              <input
                value={formData.Importe}
                onChange={(e) => setField("Importe", e.target.value)}
                placeholder={requiereNoGravado ? "Ej: importe NO GRAVADO" : "Ej: 2.142.234,31 o 700.92"}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          {/* Más campos */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">Despacho</label>
              <select
                value={formData.Despacho}
                onChange={(e) => setField("Despacho", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              >
                <option value="">(Opcional)</option>
                {despachosList.map((d) => (
                  <option key={d.ID} value={d.Despacho}>
                    {d.Despacho}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm">Orden PO</label>
              <input
                value={formData.OrdenPO}
                onChange={(e) => setField("OrdenPO", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">BL</label>
              <input
                value={formData.BL}
                onChange={(e) => setField("BL", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
            <div>
              <label className="text-sm">Mercadería</label>
              <input
                value={formData.Mercaderia}
                onChange={(e) => setField("Mercaderia", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-sm">Descripción</label>
            <input
              value={formData.Descripcion}
              onChange={(e) => setField("Descripcion", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
            />
          </div>

          {/* Adjunto existente */}
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm text-slate-300">Documento adjunto</div>
            {factura?.HasDoc && factura?.DocUrl ? (
              <div className="mt-1 flex items-center gap-3">
                <a
                  href={factura.DocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 hover:text-indigo-200 underline"
                  title={factura.DocName || "Ver documento"}
                >
                  📎 {factura.DocName || "Abrir adjunto"}
                </a>
                <span className="text-xs text-slate-400">(se abrirá en una pestaña nueva)</span>
              </div>
            ) : (
              <div className="mt-1 text-slate-400 text-sm">No hay documento adjunto.</div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={enviando}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              {enviando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={volverAtras} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600">
              Cancelar
            </button>
          </div>

          {mensaje && <p className="text-sm mt-2">{mensaje}</p>}
        </form>
      </div>

      {/* Derecha: Preview */}
      <div className="lg:col-span-6">
        <div className="sticky top-20 h-[calc(100vh-120px)]" ref={panelRef}>
          <div className="h-full rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col">
            <div className="text-sm mb-2">Vista previa PDF — Página 1</div>
            <div className="flex-1 overflow-auto rounded bg-black/60">
              {pdfPreviewUrl ? (
                <Document
                  file={pdfPreviewUrl}
                  onLoadError={(err) => console.error("PDF error:", err)}
                  loading={<div className="p-4">Cargando PDF…</div>}
                >
                  <Page pageNumber={1} width={panelWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
              ) : (
                <div className="p-4 text-slate-400">Seleccioná un PDF para ver aquí.</div>
              )}
            </div>
            {pdfPreviewUrl && (
              <div className="mt-2 text-right">
                <a
                  href={`${pdfPreviewUrl}#page=1&zoom=page-width`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                >
                  Abrir en pestaña nueva
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FormularioEditarFactura;
