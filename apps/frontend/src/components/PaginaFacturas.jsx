import React, { useEffect, useMemo, useState } from "react";
import FormularioFactura from "../components/FormularioFactura";
import FormularioEditarFactura from "../components/FormularioEditarFactura";
import ErrorBoundary from "./ErrorBoundary";

const DEFAULT_LIMIT = 100;

const PaginaFacturas = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [modo, setModo] = useState("list");
  const [facturaEdit, setFacturaEdit] = useState(null);

  const [soloSinDespacho, setSoloSinDespacho] = useState(false);
  const [order, setOrder] = useState("fecha_desc");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [page, setPage] = useState(1);

  const [searchText, setSearchText] = useState("");

  const selectClasses =
    "px-3 py-1.5 rounded-lg bg-slate-900 border border-white/20 text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60";

  const optionClasses = "bg-slate-900 text-slate-100";

  const inputClasses =
    "w-full px-4 py-2 rounded-lg bg-slate-900 border border-white/20 text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60";

  const fetchFacturas = async () => {
    try {
      setCargando(true);
      setError("");

      const params = new URLSearchParams();
      params.set("order", order);
      params.set("limit", String(limit));
      params.set("offset", String((page - 1) * limit));
      if (soloSinDespacho) params.set("only_unlinked", "1");

      const r = await fetch(`/api/facturas/with-links?${params.toString()}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error obteniendo facturas");

      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setError(e.message || "Error inesperado");
      setItems([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    fetchFacturas();
  }, [soloSinDespacho, order, limit, page]);

  const volverListado = () => {
    setFacturaEdit(null);
    setModo("list");
    fetchFacturas();
  };

  const baseRows = useMemo(() => {
    if (!soloSinDespacho) return items;
    return items.filter(
      (f) => (f.LinkedCount ?? 0) === 0 && !(f.Despacho || "").trim()
    );
  }, [items, soloSinDespacho]);

  const rows = useMemo(() => {
    if (!searchText.trim()) return baseRows;

    const q = searchText.toLowerCase();

    return baseRows.filter((f) =>
      (f.Proveedor || "").toLowerCase().includes(q) ||
      (f.nroFactura || f.Invoice || "").toLowerCase().includes(q) ||
      (f.Despacho || "").toLowerCase().includes(q) ||
      (f.Fecha || "").toLowerCase().includes(q) ||
      (f.TipoGastoNombre || "").toLowerCase().includes(q) ||
      String(f.Importe || "").toLowerCase().includes(q)
    );
  }, [baseRows, searchText]);

  if (modo === "create") {
    return (
      <div className="max-w-7xl mx-auto">
        <ErrorBoundary>
         <FormularioFactura volverAtras={volverListado} />
        </ErrorBoundary>
      </div>
    );
  }

  if (modo === "edit") {
    return (
      <div className="max-w-7xl mx-auto">
        <FormularioEditarFactura volverAtras={volverListado} factura={facturaEdit} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-slate-100">Facturas</h1>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-200 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={soloSinDespacho}
              onChange={(e) => {
                setPage(1);
                setSoloSinDespacho(e.target.checked);
              }}
            />
            Mostrar solo sin despacho
          </label>

          <select
            className={selectClasses}
            value={order}
            onChange={(e) => {
              setPage(1);
              setOrder(e.target.value);
            }}
          >
            <option value="fecha_desc" className={optionClasses}>Fecha ↓</option>
            <option value="fecha_asc" className={optionClasses}>Fecha ↑</option>
            <option value="id_desc" className={optionClasses}>ID ↓</option>
            <option value="id_asc" className={optionClasses}>ID ↑</option>
            <option value="importe_desc" className={optionClasses}>Importe ↓</option>
            <option value="importe_asc" className={optionClasses}>Importe ↑</option>
          </select>

          <button
            onClick={fetchFacturas}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100"
          >
            Refrescar
          </button>

          <button
            onClick={() => {
              setFacturaEdit(null);
              setModo("create");
            }}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500"
          >
            Nueva factura
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por proveedor, factura, despacho, fecha..."
          value={searchText}
          onChange={(e) => {
            setPage(1);
            setSearchText(e.target.value);
          }}
          className={inputClasses}
        />
      </div>

      {error && <div className="mb-3 p-3 rounded-lg bg-red-900/30">{error}</div>}

      {cargando ? (
        <p className="text-slate-300">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Proveedor</th>
                <th className="text-left p-3">N° Factura</th>
                <th className="text-left p-3">Tipo Gasto</th>
                <th className="text-right p-3">Moneda</th>
                <th className="text-right p-3">Importe</th>
                <th className="text-left p-3">Adjunto</th>
                <th className="text-left p-3">Despacho</th>
                <th className="text-left p-3">Vínculos</th>
                <th className="text-left p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.ID} className="border-t border-white/10">
                  <td className="p-3">{f.Fecha || ""}</td>
                  <td className="p-3">{f.Proveedor || ""}</td>
                  <td className="p-3">{f.nroFactura || f.Invoice || ""}</td>
                  <td className="p-3">{f.TipoGastoNombre || f.TipoGastoId || ""}</td>
                  <td className="p-3 text-right">{f.Moneda || "ARS"}</td>
                  <td className="p-3 text-right">
                    {typeof f.Importe === "number"
                      ? f.Importe.toLocaleString("es-AR", { minimumFractionDigits: 2 })
                      : f.Importe || ""}
                  </td>
                  <td className="p-3">{f.Despacho || ""}</td>
                  <td className="p-3">
                    {(f.LinkedCount ?? 0) > 0 ? (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-400/40">
                        {f.LinkedCount} vinculado{(f.LinkedCount ?? 0) === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-rose-600/30 border border-rose-400/40">
                        Sin vínculo
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      className="px-3 py-1 rounded bg-white/10 hover:bg-white/20"
                      onClick={() => {
                        setFacturaEdit(f);
                        setModo("edit");
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}

              {!rows.length && (
                <tr>
                  <td className="p-4 text-center text-slate-400" colSpan={10}>
                    No hay facturas para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PaginaFacturas;