import React, { useEffect, useState, useRef, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// Worker recomendado (mismo patrÃƒÂ¯Ã‚Â¿Ã‚Â½n que en alta de facturas)
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

const buildFormData = (source = {}) => ({
  TipoGasto: source?.TipoGasto || "",
  Fecha: source?.Fecha || "",
  Invoice: source?.Invoice || "",
  nroFactura: source?.nroFactura || "",
  OrdenPO: source?.OrdenPO || "",
  Importe: source?.Importe ?? "",
  Moneda: source?.Moneda || "ARS",
  SIMI_SIRA: source?.SIMI_SIRA || "",
  Descripcion: source?.Descripcion || "",
  Despacho: source?.Despacho || "",
  BL: source?.BL || "",
  Mercaderia: source?.Mercaderia || "",
  Proveedor: source?.Proveedor || "",
  nroProveedor: source?.nroProveedor || "",
});

const FormularioEditarFactura = ({ volverAtras, factura }) => {
  const [facturaData, setFacturaData] = useState(factura || null);
  const [formData, setFormData] = useState(buildFormData(factura));

  const [archivo, setArchivo] = useState(null);
  const [tiposGastoList, setTiposGastoList] = useState([]);
  const [despachosList, setDespachosList] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [procesando, setProcesando] = useState(false);

  // ÃƒÂ¯Ã‚Â¿Ã‚Â½! Nuevo: estado para eliminar y para mostrar vÃƒÂ¯Ã‚Â¿Ã‚Â½nculos
  const [eliminando, setEliminando] = useState(false);
  const [checkingLinks, setCheckingLinks] = useState(false);
  const [linkedCount, setLinkedCount] = useState(0);

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
  
      if (!rTipos.ok || !rDesp.ok) {
        throw new Error("Error cargando listas");
      }
  
      const [tipos, desp] = await Promise.all([
        rTipos.json(),
        rDesp.json()
      ]);
  
      setTiposGastoList(Array.isArray(tipos) ? tipos : []);
      setDespachosList(Array.isArray(desp) ? desp : []);
    } catch (e) {
      setMensaje("No se pudieron cargar listas de apoyo.");
    }
  };
  useEffect(() => {
    fetchLists();
  }, []);


  useEffect(() => {
    setFacturaData(factura || null);
    setFormData(buildFormData(factura));
  }, [factura]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!factura?.ID) return;
      try {
        const r = await fetch(`/api/facturas/${factura.ID}`);
        const data = await r.json();
        if (!r.ok || !alive) return;
        setFacturaData(data);
        setFormData(buildFormData(data));
      } catch {
        // Si falla la carga completa, mantenemos los datos de la grilla para no bloquear la edici?n.
      }
    })();
    return () => {
      alive = false;
    };
  }, [factura?.ID]);

  // ÃƒÂ¯Ã‚Â¿Ã‚Â½! Nuevo: traer cantidad de despachos vinculados a esta factura (vÃƒÂ¯Ã‚Â¿Ã‚Â½a tabla puente)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!factura?.ID) {
        setLinkedCount(0);
        return;
      }
      setCheckingLinks(true);
      try {
        const r = await fetch(`/api/facturas/${factura.ID}/despachos`);
        const j = await r.json();
        if (!alive) return;
        if (j?.ok && Array.isArray(j.items)) setLinkedCount(j.items.length);
        else setLinkedCount(0);
      } catch {
        if (alive) setLinkedCount(0);
      } finally {
        if (alive) setCheckingLinks(false);
      }
    })();
    return () => { alive = false; };
  }, [factura?.ID]);

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
    // SÃƒÂ¯Ã‚Â¿Ã‚Â½lo completa campos vacÃƒÂ¯Ã‚Â¿Ã‚Â½os del form
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
      setMensaje("SeleccionÃƒÂ¯Ã‚Â¿Ã‚Â½ un PDF primero.");
      return;
    }
    try {
      setProcesando(true);
      setMensaje("Procesando OCR de facturaÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½");
      const fd = new FormData();
      fd.append("file", archivo);
      const resp = await fetch("/api/ocr/factura?max_pages=1", { method: "POST", body: fd });
      const data = await resp.json();
      if (!resp.ok || !data?.ok) throw new Error(data?.error || "Error en OCR");
      mergeOCR(data.suggested || {});
      setMensaje("OCR completado. RevisÃƒÂ¯Ã‚Â¿Ã‚Â½ los datos.");
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
        // normalizar importe a nÃƒÂ¯Ã‚Â¿Ã‚Â½mero string
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

      setMensaje("ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½& Factura guardada con ÃƒÂ¯Ã‚Â¿Ã‚Â½xito.");
      volverAtras();
    } catch (err) {
      setMensaje(`ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  // ÃƒÂ¯Ã‚Â¿Ã‚Â½! Nuevo: eliminar factura
  const handleDelete = async () => {
    if (!factura?.ID) return;

    const warn = linkedCount > 0
      ? `Esta factura estÃƒÂ¯Ã‚Â¿Ã‚Â½ vinculada a ${linkedCount} despacho(s).
Se eliminarÃƒÂ¯Ã‚Â¿Ã‚Â½ la factura y sus vÃƒÂ¯Ã‚Â¿Ã‚Â½nculos en la tabla puente (los despachos NO se borran).
ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½Seguro que querÃƒÂ¯Ã‚Â¿Ã‚Â½s continuar?`
      : "ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½Eliminar esta factura de forma permanente?";

    if (!window.confirm(warn)) return;

    setEliminando(true);
    setMensaje("");
    try {
      const resp = await fetch(`/api/facturas/${factura.ID}`, { method: "DELETE" });
      const isJson = resp.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await resp.json() : null;
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      volverAtras?.();
    } catch (e) {
      setMensaje(`ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ ${e.message || "No se pudo eliminar la factura."}`);
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Izquierda: Form */}
      <div className="lg:col-span-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={volverAtras}
            className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20"
            disabled={enviando || eliminando}
          >
            Volver
          </button>

          <div className="flex items-center gap-3">
            {/* pill de vÃƒÂ¯Ã‚Â¿Ã‚Â½nculos */}
            {factura?.ID && !checkingLinks && (
              linkedCount > 0 ? (
                <span className="inline-flex items-center px-2 py-1 rounded-full bg-amber-600/30 border border-amber-400/40 text-xs">
                  {linkedCount} despacho{linkedCount === 1 ? "" : "s"} vinculado{linkedCount === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-full bg-emerald-700/30 border border-emerald-400/40 text-xs">
                  Sin despachos vinculados
                </span>
              )
            )}
            <div className="text-sm opacity-80">
              {factura?.ID ? `Editando #${factura.ID}` : "Nueva factura"}
            </div>
          </div>
        </div>

        {/* Aviso dinÃƒÂ¯Ã‚Â¿Ã‚Â½mico para Flete Internacional */}
        {requiereNoGravado && (
          <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
            <div className="text-amber-200 text-sm font-medium">Modo Flete Internacional</div>
            <div className="text-amber-100/90 text-sm mt-1">
              RecordÃƒÂ¯Ã‚Â¿Ã‚Â½ ingresar en <b>Importe</b> el monto que figura como <b>ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½NO GRAVADOÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½</b> en la factura.
            </div>
            {proveedorEspecial && (
              <div className="text-amber-100/90 text-xs mt-2">
                Detectado proveedor especial ({formData.Proveedor}). En estas facturas el valor vÃƒÂ¯Ã‚Â¿Ã‚Â½lido suele ser el de <b>ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½NO GRAVADOÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½</b>.
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
              {archivo ? archivo.name : "Ningun archivo seleccionado"}
            </div>
            <button
              type="button"
              onClick={procesarOCR}
              disabled={!archivo || procesando || enviando || eliminando}
              className="ml-auto px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
            >
              {procesando ? "Procesando..." : "Procesar OCR"}
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Usa OCR para prellenar proveedor, Nro y total. {requiereNoGravado && <b>Tomaremos "NO GRAVADO" si aplica.</b>}
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
                <option value="" className="bg-slate-900 text-white">
                  Seleccione un Tipo de Gasto
                </option>

                {tiposGastoList.map((t) => (
                  <option
                    key={t.IdGasto}
                    value={t.TipoGasto}
                    className="bg-slate-900 text-white"
                  >
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
              <label className="text-sm">Nro Factura</label>
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
              <label className="text-sm">Invoice</label>
              <input
                value={formData.Invoice}
                onChange={(e) => setField("Invoice", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                placeholder="Ej: AD0250603"
              />
            </div>
            <div>
              <label className="text-sm">Moneda</label>
              <select
                value={formData.Moneda}
                onChange={(e) => setField("Moneda", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              >
                <option value="ARS" className="bg-slate-900 text-white">ARS</option>
                <option value="USD" className="bg-slate-900 text-white">USD</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">
                Importe {requiereNoGravado && <span className="opacity-80">(usar "NO GRAVADO")</span>}
              </label>
              <input
                value={formData.Importe}
                onChange={(e) => setField("Importe", e.target.value)}
                placeholder={requiereNoGravado ? "Ej: importe NO GRAVADO" : "Ej: 2.142.234,31 o 700.92"}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          {/* Mas campos */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">Despacho</label>
              <select
                value={formData.Despacho}
                onChange={(e) => setField("Despacho", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              >
                <option value="" className="bg-slate-900 text-white">
                  (Opcional)</option>
                {despachosList.map((d) => (
                  <option 
                  key={d.ID} 
                  value={d.Despacho}
                  className="bg-slate-900 text-white"
                  >
                    {d.Despacho}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm">Orden PO</label>
              <input
                value={formData.ordenPO /* mantener compat si usabas "ordenPO" en front */ || formData.OrdenPO}
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
              <label className="text-sm">Mercaderia</label>
              <input
                value={formData.Mercaderia}
                onChange={(e) => setField("Mercaderia", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-sm">Descripcion</label>
            <input
              value={formData.Descripcion}
              onChange={(e) => setField("Descripcion", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
            />
          </div>

          {/* Adjunto existente */}
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-sm text-slate-300">Documento adjunto</div>
            {facturaData?.HasDoc && facturaData?.DocUrl ? (
              <div className="mt-1 flex items-center gap-3">
                <a
                  href={facturaData.DocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 hover:text-indigo-200 underline"
                  title={facturaData.DocName || "Ver documento"}
                >
                  ÃƒÂ¯Ã‚Â¿Ã‚Â½xÃƒÂ¯Ã‚Â¿Ã‚Â½S} {facturaData.DocName || "Abrir adjunto"}
                </a>
                <span className="text-xs text-slate-400">(se abrirÃƒÂ¯Ã‚Â¿Ã‚Â½ en una pestaÃƒÂ¯Ã‚Â¿Ã‚Â½a nueva)</span>
              </div>
            ) : (
              <div className="mt-1 text-slate-400 text-sm">No hay documento adjunto.</div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={enviando || eliminando}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              {enviando ? "GuardandoÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½ÃƒÂ¯Ã‚Â¿Ã‚Â½" : "Guardar"}
            </button>

            <button
              type="button"
              onClick={volverAtras}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
              disabled={enviando || eliminando}
            >
              Cancelar
            </button>

            {/* BotÃƒÂ¯Ã‚Â¿Ã‚Â½n ELIMINAR (solo en ediciÃƒÂ¯Ã‚Â¿Ã‚Â½n) */}
            {factura?.ID && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={enviando || eliminando}
                className="ml-auto px-4 py-2 rounded-lg bg-rose-700 text-white hover:bg-rose-600 disabled:opacity-50"
                title={linkedCount > 0 ? "Eliminar (tambiÃƒÂ¯Ã‚Â¿Ã‚Â½n eliminarÃƒÂ¯Ã‚Â¿Ã‚Â½ los vÃƒÂ¯Ã‚Â¿Ã‚Â½nculos a despachos)" : "Eliminar factura"}
              >
                {eliminando ? "Eliminando..." : "Eliminar"}
              </button>
            )}
          </div>

          {mensaje && <p className="text-sm mt-2">{mensaje}</p>}
        </form>
      </div>

      {/* Derecha: Preview */}
      <div className="lg:col-span-6">
        <div className="sticky top-20 h-[calc(100vh-120px)]" ref={panelRef}>
          <div className="h-full rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col">
            <div className="text-sm mb-2">Vista previa PDF - Pagina 1</div>
            <div className="flex-1 overflow-auto rounded bg-black/60">
              {pdfPreviewUrl ? (
                <Document
                  file={pdfPreviewUrl}
                  onLoadError={(err) => console.error("PDF error:", err)}
                  loading={<div className="p-4">Cargando PDF...</div>}
                >
                  <Page pageNumber={1} width={panelWidth} renderTextLayer={false} renderAnnotationLayer={false} />
                </Document>
              ) : (
                <div className="p-4 text-slate-400">Selecciona un PDF para ver aqui.</div>
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
                  Abrir en pestana nueva
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

