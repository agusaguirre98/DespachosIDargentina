import React, { useEffect, useRef, useState, useMemo, Fragment } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Listbox, Combobox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon, XMarkIcon } from "@heroicons/react/24/outline";

// Worker de pdf.js desde node_modules
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PROVEEDORES_NO_GRAVADO = [
  "GESTION FORWARD SRL",
  "TRANSPORTES SAGRILO LTDA S.E.",
  "UNLIMITED WORLD S.A.",
];

const USE_SERVER_SEARCH = true; // poné false si no querés buscar en /api/despachos/search

const isFleteInternacional = (v) =>
  (v || "").toString().trim().toLowerCase() === "flete internacional";

const normalize = (s) => (s || "").toString().trim().toUpperCase();

// admite "2.142.234,31" o "700.92"
const parseNumber = (s = "") => {
  if (s === null || s === undefined || s === "") return "";
  const t = String(s).trim();
  if (t.includes(".") && t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (!t.includes(".") && (t.match(/,/g)?.length === 1)) return Number(t.replace(",", "."));
  return Number(t.replace(/,/g, ""));
};

// debounce simple
const debounce = (fn, ms = 300) => {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
};

const FormularioFactura = ({ volverAtras }) => {
  const [formData, setFormData] = useState({
    TipoGasto: "",
    Fecha: "",
    Invoice: "",
    nroFactura: "",
    OrdenPO: "",
    Importe: "",
    Moneda: "ARS",
    SIMI_SIRA: "",
    Descripcion: "",
    Despacho: "", // principal (texto para compatibilidad back)
    BL: "",
    Mercaderia: "",
    Proveedor: "",
    nroProveedor: "",
  });

  // selección múltiple (IDs como string)
  const [selectedDespachos, setSelectedDespachos] = useState([]); // ["12", "34", ...]
  const [serverSuggestions, setServerSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // estados base
  const [archivo, setArchivo] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [tiposGastoList, setTiposGastoList] = useState([]);
  const [despachosList, setDespachosList] = useState([]);
  const [errors, setErrors] = useState({});
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cargandoListas, setCargandoListas] = useState(true);
  const [procesandoOCR, setProcesandoOCR] = useState(false);

  // preview responsive
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

  const setField = (name, value) => {
    setFormData((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  useEffect(() => {
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
      } catch {
        setMensaje("No se pudieron cargar listas de apoyo (Tipos y Despachos).");
      } finally {
        setCargandoListas(false);
      }
    };
  
    fetchLists();
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setArchivo(file);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(file && file.type === "application/pdf" ? URL.createObjectURL(file) : "");
  };

  // ========= Combobox múltiple de despachos (con búsqueda server-side opcional) =========
  const [query, setQuery] = useState("");

  const debouncedFetch = useMemo(
    () =>
      debounce(async (q) => {
        if (!USE_SERVER_SEARCH || !q) {
          setServerSuggestions([]);
          return;
        }
        try {
          setLoadingSuggestions(true);
          const r = await fetch(`/api/despachos/search?q=${encodeURIComponent(q)}`);
          const j = await r.json();
          const items = Array.isArray(j?.items) ? j.items : [];
          // Filtramos los ya seleccionados
          const filtered = items.filter((it) => !selectedDespachos.includes(String(it.ID)));
          setServerSuggestions(filtered.slice(0, 50));
        } catch {
          setServerSuggestions([]);
        } finally {
          setLoadingSuggestions(false);
        }
      }, 250),
    [selectedDespachos]
  );

  useEffect(() => {
    debouncedFetch(query.trim());
  }, [query, debouncedFetch]);

  // Filtro local fallback + merge con server
  const localFiltered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const out = [];
    for (const d of despachosList) {
      const code = (d?.Despacho || "").toUpperCase();
      if (code.includes(q) && !selectedDespachos.includes(String(d.ID))) {
        out.push(d);
      }
      if (out.length >= 50) break;
    }
    return out;
  }, [query, despachosList, selectedDespachos]);

  const suggestions = useMemo(() => {
    const byId = new Set((serverSuggestions || []).map((x) => String(x.ID)));
    const merged = [...serverSuggestions];
    for (const d of localFiltered) {
      const idStr = String(d.ID);
      if (!byId.has(idStr)) merged.push(d);
      if (merged.length >= 50) break;
    }
    return merged;
  }, [serverSuggestions, localFiltered]);

  // Map helpers
  const byId = useMemo(() => {
    const m = new Map();
    for (const d of despachosList) m.set(String(d.ID), d);
    for (const d of serverSuggestions) m.set(String(d.ID), d);
    return m;
  }, [despachosList, serverSuggestions]);

  // Valores seleccionados como objetos (para el Combobox multiple)
  const selectedAsObjects = selectedDespachos
    .map((idStr) => byId.get(String(idStr)))
    .filter(Boolean);

  const onChangeMulti = (items) => {
    // items son objetos {ID, Despacho}
    const ids = items.map((it) => String(it.ID));
    setSelectedDespachos(ids);

    // si no hay principal y elegiste alguno, seteo el 1° como principal para compatibilidad
    if (!formData.Despacho && items.length > 0) {
      setField("Despacho", items[0].Despacho || "");
    }
  };

  const removeChip = (idStr) => {
    setSelectedDespachos((prev) => prev.filter((x) => x !== idStr));
  };

  // ========= Validaciones y OCR =========
  const requiereNoGravado = useMemo(
    () => isFleteInternacional(formData.TipoGasto),
    [formData.TipoGasto]
  );
  const proveedorEspecial = useMemo(() => {
    const prov = normalize(formData.Proveedor);
    return PROVEEDORES_NO_GRAVADO.some((p) => normalize(p) === prov);
  }, [formData.Proveedor]);

  const validate = () => {
    const e = {};
    if (!formData.TipoGasto) e.TipoGasto = "Seleccioná un tipo de gasto.";
    if (!formData.Fecha) e.Fecha = "La fecha es obligatoria.";
    if (formData.Importe !== "") {
      const n = parseNumber(formData.Importe);
      if (Number.isNaN(n)) e.Importe = "El importe no tiene un formato válido.";
    }
    return e;
  };

  const mergeOCR = (sug = {}) => {
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
      setProcesandoOCR(true);
      setMensaje("Procesando OCR de factura…");
      const fd = new FormData();
      fd.append("file", archivo);
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

  // ========= Submit =========
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");
    const eVal = validate();
    if (Object.keys(eVal).length) {
      setErrors(eVal);
      return;
    }

    setEnviando(true);
    try {
      const dataToSend = new FormData();
      const n = formData.Importe === "" ? "" : parseNumber(formData.Importe);
      const payload = { ...formData, Importe: n === "" ? "" : String(n) };

      Object.entries(payload).forEach(([k, v]) => {
        if (v !== "" && v !== null && v !== undefined) dataToSend.append(k, v);
      });

      // Enviar múltiples "Despachos" (IDs) para la tabla puente
      if (selectedDespachos.length > 0) {
        selectedDespachos.forEach((val) => dataToSend.append("Despachos", String(val)));

        // si no hay principal, usar el código del primero seleccionado
        if (!formData.Despacho) {
          const first = byId.get(String(selectedDespachos[0]));
          if (first?.Despacho) dataToSend.append("Despacho", first.Despacho);
        }
      }

      dataToSend.append("tipoDocumento", "Gasto");
      if (archivo) dataToSend.append("documento", archivo);

      const resp = await fetch("/api/facturas", { method: "POST", body: dataToSend });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Error al guardar la factura.");

      setMensaje("✅ Factura guardada con éxito.");
      setArchivo(null);
      setPdfUrl("");
      volverAtras();
    } catch (err) {
      setMensaje(`❌ ${err.message || "No se pudo conectar con el servidor."}`);
    } finally {
      setEnviando(false);
    }
  };

  // ========= Principal Listbox helpers =========
  const principalSelectedObj = useMemo(() => {
    if (!formData.Despacho) return null;
    // Busco por texto; si no lo encuentro, muestro el texto igualmente
    const found = despachosList.find((d) => (d?.Despacho || "").toUpperCase() === formData.Despacho.toUpperCase());
    return found || { ID: "_custom", Despacho: formData.Despacho };
  }, [formData.Despacho, despachosList]);

  const setPrincipal = (obj) => {
    setField("Despacho", obj?.Despacho || "");
  };

  return (
    <div className="max-w-[1600px] mx-auto px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-50">Nueva Factura</h2>
        <button
          type="button"
          onClick={volverAtras}
          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100"
        >
          Volver a Facturas
        </button>
      </div>

      {mensaje && (
        <div className="mb-4 text-sm p-3 rounded-lg bg-black/30 text-slate-100">{mensaje}</div>
      )}

      {/* Aviso dinámico para Flete Internacional */}
      {requiereNoGravado && (
        <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4">
          <div className="text-amber-200 text-sm font-medium">Modo Flete Internacional</div>
          <div className="text-amber-100/90 text-sm mt-1">
            Recordá ingresar en <b>Importe</b> el monto que figura como <b>“NO GRAVADO”</b>.
          </div>
          {proveedorEspecial && (
            <div className="text-amber-100/90 text-xs mt-2">
              Detectado proveedor especial ({formData.Proveedor}). En estas facturas el valor
              válido suele ser el de <b>“NO GRAVADO”</b>.
            </div>
          )}
        </div>
      )}

      {/* Layout: formulario (izq) + preview (der) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* IZQUIERDA: Formulario */}
        <div className="relative z-10 lg:col-span-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            {/* Selector de archivo + OCR */}
            <div className="flex items-center gap-3">
              <input
                id="pdfFactura"
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="sr-only"
              />
              <label
                htmlFor="pdfFactura"
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 whitespace-nowrap"
              >
                Seleccionar archivo
              </label>
              <div className="text-sm text-slate-100 truncate max-w-[260px]">
                {archivo ? archivo.name : "Ningún archivo seleccionado"}
              </div>
              <button
                type="button"
                onClick={procesarOCR}
                disabled={!archivo || procesandoOCR}
                className="ml-auto px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-slate-50"
              >
                {procesandoOCR ? "Procesando…" : "Procesar OCR"}
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Usá OCR para prellenar proveedor, N° y total{" "}
              {requiereNoGravado && <b>— tomaremos “NO GRAVADO” si aplica.</b>}
            </p>
          </div>

          {cargandoListas ? (
            <p className="mt-6 text-slate-100">Cargando datos...</p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-slate-100">
              {/* Tipo de Gasto */}
              <div>
                <label htmlFor="TipoGasto" className="block text-sm mb-1">
                  Tipo de Gasto *
                </label>
                <select
                  id="TipoGasto"
                  name="TipoGasto"
                  value={formData.TipoGasto}
                  onChange={(e) => setField("TipoGasto", e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none text-slate-100 ${
                    errors.TipoGasto ? "border-red-500" : "border-white/20"
                  }`}
                  required
                >
                  <option value="" className="text-slate-700">Seleccione un Tipo de Gasto</option>
                  {tiposGastoList.map((t) => (
                    <option key={t.IdGasto} value={t.TipoGasto} className="text-slate-900">
                      {t.TipoGasto}
                    </option>
                  ))}
                </select>
                {errors.TipoGasto && (
                  <p className="text-red-400 text-xs mt-1">{errors.TipoGasto}</p>
                )}
              </div>

              {/* Fecha / Moneda / Importe */}
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="Fecha" className="block text-sm mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    id="Fecha"
                    name="Fecha"
                    value={formData.Fecha}
                    onChange={(e) => setField("Fecha", e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none text-slate-100 ${
                      errors.Fecha ? "border-red-500" : "border-white/20"
                    }`}
                    required
                  />
                  {errors.Fecha && (
                    <p className="text-red-400 text-xs mt-1">{errors.Fecha}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="Moneda" className="block text-sm mb-1">
                    Moneda
                  </label>
                  <select
                    id="Moneda"
                    name="Moneda"
                    value={formData.Moneda}
                    onChange={(e) => setField("Moneda", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                  >
                    <option value="ARS" className="text-slate-900">ARS</option>
                    <option value="USD" className="text-slate-900">USD</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="Importe" className="block text-sm mb-1">
                    Importe {requiereNoGravado && <span className="opacity-80">(usar “NO GRAVADO”)</span>}
                  </label>
                  <input
                    id="Importe"
                    name="Importe"
                    value={formData.Importe}
                    onChange={(e) => setField("Importe", e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none text-slate-100 ${
                      errors.Importe ? "border-red-500" : "border-white/20"
                    }`}
                    placeholder={requiereNoGravado ? "Ej: 3.738.821,52" : "Ej: 250000.00 o 2.142.234,31"}
                  />
                  {errors.Importe && <p className="text-red-400 text-xs mt-1">{errors.Importe}</p>}
                </div>
              </div>

              {/* Datos texto */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="Proveedor" className="block text-sm mb-1">Proveedor</label>
                  <input
                    id="Proveedor"
                    name="Proveedor"
                    value={formData.Proveedor}
                    onChange={(e) => setField("Proveedor", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                    placeholder="Ej: GESTION FORWARD SRL"
                  />
                </div>
                <div>
                  <label htmlFor="nroFactura" className="block text-sm mb-1">N° Factura</label>
                  <input
                    id="nroFactura"
                    name="nroFactura"
                    value={formData.nroFactura}
                    onChange={(e) => setField("nroFactura", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                    placeholder="Ej: F0001-12345678"
                  />
                </div>
                <div>
                  <label htmlFor="OrdenPO" className="block text-sm mb-1">Orden PO</label>
                  <input
                    id="OrdenPO"
                    name="OrdenPO"
                    value={formData.OrdenPO}
                    onChange={(e) => setField("OrdenPO", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="SIMI_SIRA" className="block text-sm mb-1">SIMI / SIRA</label>
                  <input
                    id="SIMI_SIRA"
                    name="SIMI_SIRA"
                    value={formData.SIMI_SIRA}
                    onChange={(e) => setField("SIMI_SIRA", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="Descripcion" className="block text-sm mb-1">Descripción</label>
                  <input
                    id="Descripcion"
                    name="Descripcion"
                    value={formData.Descripcion}
                    onChange={(e) => setField("Descripcion", e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
                    placeholder="Detalle de la factura..."
                  />
                </div>
              </div>

              {/* Despacho principal (Listbox oscuro) */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">Despacho (principal)</label>
                  <Listbox value={principalSelectedObj} onChange={setPrincipal}>
                    <div className="relative">
                      <Listbox.Button className="relative w-full cursor-default rounded-lg bg-white/10 py-2 pl-3 pr-10 text-left text-slate-100 border border-white/20 focus:outline-none">
                        <span className="block truncate">{principalSelectedObj?.Despacho || "(Opcional)"}</span>
                        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                          <ChevronUpDownIcon className="h-5 w-5 text-slate-300" />
                        </span>
                      </Listbox.Button>
                      <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                      >
                        <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-slate-900/95 text-slate-100 shadow-lg ring-1 ring-black/10 focus:outline-none">
                          <Listbox.Option
                            value={{ ID: "", Despacho: "" }}
                            className={({ active }) =>
                              `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? "bg-white/10" : ""}`
                            }
                          >
                            {({ selected }) => (
                              <>
                                <span className="block truncate text-slate-400">(Opcional)</span>
                                {selected ? (
                                  <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                    <CheckIcon className="h-5 w-5" />
                                  </span>
                                ) : null}
                              </>
                            )}
                          </Listbox.Option>
                          {despachosList.map((d) => (
                            <Listbox.Option
                              key={d.ID}
                              value={d}
                              className={({ active }) =>
                                `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? "bg-white/10" : ""}`
                              }
                            >
                              {({ selected }) => (
                                <>
                                  <span className="block truncate">{d.Despacho}</span>
                                  {selected ? (
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                      <CheckIcon className="h-5 w-5" />
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </Listbox.Option>
                          ))}
                        </Listbox.Options>
                      </Transition>
                    </div>
                  </Listbox>
                </div>

                {/* Combobox múltiple oscuro */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm">
                      Vincular a varios despachos (múltiple)
                      {selectedDespachos.length > 0 && (
                        <span className="ml-2 text-xs text-slate-400">({selectedDespachos.length} seleccionados)</span>
                      )}
                    </label>
                    {selectedDespachos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedDespachos([])}
                        className="text-xs text-slate-300 hover:text-slate-100 underline"
                      >
                        Limpiar selección
                      </button>
                    )}
                  </div>

                  <Combobox value={selectedAsObjects} onChange={onChangeMulti} multiple>
                    <div className="relative">
                      <div className="relative w-full cursor-text rounded-lg bg-white/10 border border-white/20 px-2 py-1.5 text-slate-100 focus-within:ring-1 focus-within:ring-indigo-400">
                        <div className="flex flex-wrap gap-1">
                          {selectedAsObjects.map((item) => (
                            <span
                              key={String(item.ID)}
                              className="inline-flex items-center gap-1 rounded-full bg-indigo-600/30 border border-indigo-400/40 px-2 py-0.5 text-xs"
                            >
                              {item.Despacho}
                              <button
                                type="button"
                                onClick={() => removeChip(String(item.ID))}
                                className="hover:text-white"
                                title="Quitar"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </span>
                          ))}
                          <Combobox.Input
                            className="flex-1 min-w-[160px] bg-transparent outline-none placeholder:text-slate-400 text-sm px-1"
                            placeholder="Escribí para buscar (ej: 25001IC...)"
                            displayValue={() => ""}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && suggestions.length > 0) {
                                e.preventDefault();
                                onChangeMulti([...selectedAsObjects, suggestions[0]]);
                                setQuery("");
                              }
                            }}
                            onPaste={(e) => {
                              const t = e.clipboardData.getData("text");
                              if (!t) return;
                              e.preventDefault();
                              const tokens = String(t).toUpperCase().split(/[\s,;]+/).filter(Boolean);
                              if (!tokens.length) return;
                              const mapByCode = new Map(
                                [
                                  ...despachosList.map((d) => [String(d.Despacho || "").toUpperCase(), d]),
                                  ...serverSuggestions.map((d) => [String(d.Despacho || "").toUpperCase(), d]),
                                ]
                              );
                              const toAdd = [];
                              tokens.forEach((code) => {
                                const d = mapByCode.get(code);
                                if (d && !selectedDespachos.includes(String(d.ID))) toAdd.push(d);
                              });
                              if (toAdd.length) onChangeMulti([...selectedAsObjects, ...toAdd]);
                              setQuery("");
                            }}
                          />
                          <Combobox.Button className="absolute inset-y-0 right-2 my-auto">
                            <ChevronUpDownIcon className="h-5 w-5 text-slate-300" />
                          </Combobox.Button>
                        </div>
                      </div>

                      <Transition
                        as={Fragment}
                        leave="transition ease-in duration-100"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                      >
                        {((query && suggestions.length > 0) || loadingSuggestions) && (
                          <Combobox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-slate-900/95 text-slate-100 shadow-lg ring-1 ring-black/10 focus:outline-none">
                            {loadingSuggestions && (
                              <div className="px-3 py-2 text-xs text-slate-300">Buscando…</div>
                            )}
                            {suggestions.map((d) => (
                              <Combobox.Option
                                key={d.ID}
                                value={d}
                                className={({ active }) =>
                                  `cursor-default select-none py-2 pl-3 pr-2 ${active ? "bg-white/10" : ""}`
                                }
                              >
                                {({ selected, active }) => (
                                  <div className="flex items-center gap-2">
                                    <span className="flex-1 truncate">{d.Despacho}</span>
                                    {selected && <CheckIcon className="h-5 w-5" />}
                                  </div>
                                )}
                              </Combobox.Option>
                            ))}
                          </Combobox.Options>
                        )}
                      </Transition>
                    </div>
                  </Combobox>

                  <p className="text-xs text-slate-400 mt-2">
                    Se crearán vínculos en la tabla puente. Si no elegís un despacho principal y
                    seleccionás varios, se usará el primero como principal para compatibilidad.
                  </p>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={enviando}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-50"
                >
                  {enviando ? "Guardando..." : "Guardar Factura"}
                </button>
                <button
                  type="button"
                  onClick={volverAtras}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>

        {/* DERECHA: Preview PDF */}
        <div className="relative z-0 lg:col-span-7">
          <div className="sticky top-20 h-[calc(100vh-120px)]">
            <div ref={panelRef} className="h-full rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
              <div className="text-sm text-slate-300 mb-2">Vista previa PDF — Página 1</div>
              <div className="flex-1 overflow-auto">
                {pdfUrl ? (
                  <Document
                    file={pdfUrl}
                    onLoadError={(e) => console.error("Error al cargar PDF:", e?.message || e)}
                    loading={<div className="text-slate-400">Cargando PDF…</div>}
                  >
                    <Page pageNumber={1} width={panelWidth} renderAnnotationLayer={false} renderTextLayer={false} />
                  </Document>
                ) : (
                  <div className="h-full grid place-items-center text-slate-400">
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

export default FormularioFactura;
