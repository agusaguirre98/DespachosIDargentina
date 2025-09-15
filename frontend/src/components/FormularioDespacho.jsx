import React, { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// Worker PDF.js (compatible con Vite)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ✅ helper global: quita espacios, recorta y mayúsculas
const normalizeDespacho = (s = "") => s.replace(/\s+/g, "").trim().toUpperCase();

const FormularioDespacho = ({ volverAtras }) => {
  const [formData, setFormData] = useState({
    Despacho: "",
    Fecha: "",
    FOB: "",
    Estadistica: "",
    Derechos_Importacion: "",
    Tipo_Cambio: "",
    Arancel: "",
  });

  const [archivo, setArchivo] = useState(null);
  const [mensaje, setMensaje] = useState("");
  const [procesando, setProcesando] = useState(false);

  // ---- Duplicado de despacho
  const [dupChecking, setDupChecking] = useState(false);
  const [dupInfo, setDupInfo] = useState(null); // { exists, id, numero }
  const [dupError, setDupError] = useState("");

  useEffect(() => {
    const n = normalizeDespacho(formData.Despacho);
    setDupError("");
    setDupInfo(null);

    if (!n) return; // vacío: no chequeamos

    const t = setTimeout(async () => {
      try {
        setDupChecking(true);
        const resp = await fetch(`/api/despachos/exists?numero=${encodeURIComponent(n)}`);
        const data = await resp.json();
        if (!resp.ok || data.ok === false) {
          setDupError(data?.error || "Error verificando duplicado.");
          return;
        }
        setDupInfo({ exists: data.exists, id: data.id, numero: data.numero });
      } catch (e) {
        setDupError("Error de red al verificar duplicado.");
      } finally {
        setDupChecking(false);
      }
    }, 400); // debounce

    return () => clearTimeout(t);
  }, [formData.Despacho]);

  // ---- PDF preview
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");

  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    const calc = () => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      setPanelWidth(Math.max(320, rect.width - 16)); // padding 4 = 16px
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
    // limpiar Blob URL
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // normalizamos en vivo sólo el campo Despacho
    const v = name === "Despacho" ? normalizeDespacho(value) : value;
    setFormData((prev) => ({ ...prev, [name]: v }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setArchivo(file);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    if (file && file.type === "application/pdf") {
      setPdfPreviewUrl(URL.createObjectURL(file));
    } else {
      setPdfPreviewUrl("");
    }
  };

  const procesarOCR = async () => {
    if (!archivo) {
      setMensaje("Seleccioná un PDF primero.");
      return;
    }
    try {
      setProcesando(true);
      setMensaje("Procesando OCR...");

      const fd = new FormData();
      fd.append("file", archivo);

      const resp = await fetch("/api/ocr/despacho?max_pages=4&dpi=300", {
        method: "POST",
        body: fd,
      });
      const data = await resp.json();

      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || "Error en OCR");
      }

      const sug = data.suggested || {};
      setFormData((prev) => ({
        ...prev,
        Despacho: prev.Despacho || normalizeDespacho(sug.Despacho ?? ""),
        Fecha: prev.Fecha || (sug.Fecha ?? ""),
        FOB: prev.FOB || (sug.FOB ?? ""),
        Estadistica: prev.Estadistica || (sug.Estadistica ?? ""),
        Derechos_Importacion:
          prev.Derechos_Importacion || (sug.Derechos_Importacion ?? ""),
        Tipo_Cambio: prev.Tipo_Cambio || (sug.Tipo_Cambio ?? ""),
        Arancel: prev.Arancel || (sug.Arancel ?? ""),
      }));

      setMensaje("OCR completado. Revisá los datos.");
    } catch (e) {
      console.error(e);
      setMensaje("Error procesando el OCR.");
    } finally {
      setProcesando(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("Guardando despacho...");

    // seguridad: normalizamos antes de enviar
    const payload = {
      ...formData,
      Despacho: normalizeDespacho(formData.Despacho),
    };

    const dataToSend = new FormData();
    Object.entries(payload).forEach(([k, v]) => dataToSend.append(k, v ?? ""));
    dataToSend.append("tipoDocumento", "Despacho");
    if (archivo) dataToSend.append("documento", archivo);

    try {
      const response = await fetch("/api/despachos", {
        method: "POST",
        body: dataToSend,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Error guardando");

      setMensaje(`Despacho "${payload.Despacho}" creado con éxito.`);
      setFormData({
        Despacho: "",
        Fecha: "",
        FOB: "",
        Estadistica: "",
        Derechos_Importacion: "",
        Tipo_Cambio: "",
        Arancel: "",
      });
      setArchivo(null);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl("");
      volverAtras();
    } catch (err) {
      console.error(err);
      setMensaje(`Error: ${err.message}`);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-8">
      <button
        onClick={volverAtras}
        className="mb-4 rounded-md bg-white/10 px-4 py-2 border border-white/10 hover:bg-white/20"
      >
        Volver a la tabla
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* IZQUIERDA: formulario */}
        <div className="relative z-10 lg:col-span-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <input
                id="pdfInput"
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="sr-only"
              />
              <label
                htmlFor="pdfInput"
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 whitespace-nowrap"
              >
                Seleccionar archivo
              </label>

              <div className="text-sm text-slate-300 truncate max-w-[280px]">
                {archivo ? archivo.name : "Ningún archivo seleccionado"}
              </div>

              <button
                type="button"
                onClick={procesarOCR}
                disabled={!archivo || procesando}
                className="ml-auto px-4 py-2 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap"
              >
                {procesando ? "Procesando..." : "Procesar OCR"}
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-400">
              Campos completados con OCR. Revisá y confirmá.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  Nro. Despacho
                </label>
                <input
                  type="text"
                  name="Despacho"
                  value={formData.Despacho}
                  onChange={handleChange}
                  className={`w-full rounded-md bg-white/10 border px-3 py-2 outline-none focus:ring-2
                    ${
                      dupInfo?.exists
                        ? "border-red-500 focus:ring-red-400"
                        : "border-white/10 focus:ring-indigo-400"
                    }`}
                />
                {dupChecking && (
                  <p className="text-xs text-slate-400 mt-1">
                    Verificando duplicado…
                  </p>
                )}
                {dupError && (
                  <p className="text-xs text-amber-400 mt-1">{dupError}</p>
                )}
                {dupInfo?.exists && (
                  <p className="text-xs text-red-400 mt-1">
                    Ya existe un despacho con este número
                    {dupInfo.id ? (
                      <>
                        {" "}
                        (ID <b>{dupInfo.id}</b>)
                      </>
                    ) : null}
                    . Revisá antes de guardar.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">Fecha</label>
                <input
                  type="date"
                  name="Fecha"
                  value={formData.Fecha}
                  onChange={handleChange}
                  className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">FOB</label>
                <input
                  type="text"
                  name="FOB"
                  value={formData.FOB}
                  onChange={handleChange}
                  className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  Estadística
                </label>
                <input
                  type="text"
                  name="Estadistica"
                  value={formData.Estadistica}
                  onChange={handleChange}
                  className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Arancel
              </label>
              <input
                type="text"
                name="Arancel"
                value={formData.Arancel}
                onChange={handleChange}
                className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Derechos de Importación
              </label>
              <input
                type="text"
                name="Derechos_Importacion"
                value={formData.Derechos_Importacion}
                onChange={handleChange}
                className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Tipo de Cambio (Cotiz)
              </label>
              <input
                type="text"
                name="Tipo_Cambio"
                value={formData.Tipo_Cambio}
                onChange={handleChange}
                className="w-full rounded-md bg-white/10 border border-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <button
              type="submit"
              disabled={procesando || dupChecking || dupInfo?.exists}
              className={`px-4 py-2 rounded-md text-white font-medium
                ${
                  dupInfo?.exists
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
            >
              Guardar Despacho
            </button>
          </form>

          {mensaje && <p className="mt-3 text-sm text-slate-300">{mensaje}</p>}
        </div>

        {/* DERECHA: visor PDF ancho completo */}
        <div className="relative z-0 lg:col-span-8">
          <div className="sticky top-20 h-[calc(100vh-120px)]">
            <div
              ref={panelRef}
              className="h-full rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col"
            >
              <div className="text-sm text-slate-300 mb-2 shrink-0">
                Vista previa PDF — Página 3
              </div>

              <div className="flex-1 overflow-auto rounded-md bg-black/60">
                {pdfPreviewUrl ? (
                  <Document
                    file={pdfPreviewUrl}
                    onLoadError={(err) => {
                      console.error("PDF load error:", err);
                      setMensaje(`Error al cargar PDF: ${err.message}`);
                    }}
                    loading={<div className="text-slate-300 p-4">Cargando PDF…</div>}
                  >
                    <Page
                      pageNumber={3}
                      width={panelWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                ) : (
                  <div className="text-slate-400 p-4">
                    Seleccioná un PDF para ver la página 3 aquí.
                  </div>
                )}
              </div>

              {pdfPreviewUrl && (
                <div className="mt-2 text-right shrink-0">
                  <a
                    href={`${pdfPreviewUrl}#page=3&zoom=page-width`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-300 hover:text-indigo-200 underline"
                  >
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
};

export default FormularioDespacho;
