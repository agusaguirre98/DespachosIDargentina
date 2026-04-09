import React, { useEffect, useMemo, useState } from "react";
import FormularioFactura from "../components/FormularioFactura";
import FormularioEditarFactura from "../components/FormularioEditarFactura";
import ErrorBoundary from "./ErrorBoundary";

const DEFAULT_LIMIT = 50;

const PaginaFacturas = ({ despachoInicial = null }) => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [modo, setModo] = useState(despachoInicial ? "create" : "list");
  const [facturaEdit, setFacturaEdit] = useState(null);

  const [soloSinDespacho, setSoloSinDespacho] = useState(false);
  const [order, setOrder] = useState("fecha_desc");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [searchText, setSearchText] = useState("");
  const [updatingRegistrado, setUpdatingRegistrado] = useState({});

  const optionClasses = "bg-slate-900 text-slate-100";

  const sortableColumns = {
    Fecha: { asc: "fecha_asc", desc: "fecha_desc" },
    Proveedor: { asc: "proveedor_asc", desc: "proveedor_desc" },
    Factura: { asc: "factura_asc", desc: "factura_desc" },
    TipoGasto: { asc: "tipo_gasto_asc", desc: "tipo_gasto_desc" },
    Moneda: { asc: "moneda_asc", desc: "moneda_desc" },
    Importe: { asc: "importe_asc", desc: "importe_desc" },
    Adjunto: { asc: "adjunto_asc", desc: "adjunto_desc" },
    Despacho: { asc: "despacho_asc", desc: "despacho_desc" },
    Registrado: { asc: "registrado_asc", desc: "registrado_desc" },
    Vinculos: { asc: "vinculos_asc", desc: "vinculos_desc" },
  };

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
      if (searchText.trim()) params.set("q", searchText.trim());

      const r = await fetch(`/api/facturas/with-links?${params.toString()}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error obteniendo facturas");

      setItems(Array.isArray(j.items) ? j.items : []);
      setTotalItems(Number(j?.total) || 0);
    } catch (e) {
      setError(e.message || "Error inesperado");
      setItems([]);
      setTotalItems(0);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    fetchFacturas();
  }, [soloSinDespacho, order, limit, page, searchText]);

  const volverListado = () => {
    setFacturaEdit(null);
    setModo("list");
    fetchFacturas();
  };

  const rows = useMemo(() => items, [items]);

  const toggleRegistrado = async (facturaId, checked) => {
    try {
      setError("");
      setUpdatingRegistrado((prev) => ({ ...prev, [facturaId]: true }));

      const response = await fetch(`/api/facturas/${facturaId}/registrado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrado: checked ? 1 : 0 }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "No se pudo actualizar el estado registrado");
      }

      setItems((prev) =>
        prev.map((item) =>
          item.ID === facturaId ? { ...item, Registrado: checked } : item
        )
      );
    } catch (e) {
      setError(e.message || "Error actualizando registrado");
    } finally {
      setUpdatingRegistrado((prev) => {
        const next = { ...prev };
        delete next[facturaId];
        return next;
      });
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const pageToDisplay = Math.min(page, totalPages);
  const showingStart = totalItems === 0 ? 0 : (pageToDisplay - 1) * limit + 1;
  const showingEnd = totalItems === 0 ? 0 : Math.min(pageToDisplay * limit, totalItems);
  const disablePrevPage = pageToDisplay <= 1;
  const disableNextPage = pageToDisplay >= totalPages || totalItems === 0;

  const handleRowsPerPageChange = (event) => {
    const value = Number(event.target.value) || DEFAULT_LIMIT;
    setLimit(value);
    setPage(1);
  };

  const getSortDirection = (column) => {
    const config = sortableColumns[column];
    if (!config) return null;
    if (order === config.asc) return "asc";
    if (order === config.desc) return "desc";
    return null;
  };

  const toggleSort = (column) => {
    const config = sortableColumns[column];
    if (!config) return;
    const currentDirection = getSortDirection(column);
    const nextOrder = currentDirection === "asc" ? config.desc : config.asc;
    setPage(1);
    setOrder(nextOrder);
  };

  const renderSortIndicator = (column) => {
    const direction = getSortDirection(column);
    if (direction === "asc") return <span aria-hidden="true">^</span>;
    if (direction === "desc") return <span aria-hidden="true">v</span>;
    return <span aria-hidden="true" className="text-slate-500">-</span>;
  };

  const getAriaSort = (column) => {
    const direction = getSortDirection(column);
    if (direction === "asc") return "ascending";
    if (direction === "desc") return "descending";
    return "none";
  };

  if (modo === "create") {
    return (
      <div className="max-w-7xl mx-auto">
        <ErrorBoundary>
          <FormularioFactura volverAtras={volverListado} despachoInicial={despachoInicial} />
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

      {!cargando && !error && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-sm text-slate-200">
          <div>
            Mostrando {showingStart.toLocaleString("es-AR")}-{showingEnd.toLocaleString("es-AR")} de {totalItems.toLocaleString("es-AR")} facturas
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs uppercase tracking-wide text-slate-400">Filas por pagina</label>
            <select
              className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100 focus:bg-white focus:text-slate-900"
              value={limit}
              onChange={handleRowsPerPageChange}
            >
              {[25, 50, 100, 200, 500].map((size) => (
                <option key={size} value={size} className={optionClasses}>{size}</option>
              ))}
            </select>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={disablePrevPage}
                title="Pagina anterior"
              >
                {"<"}
              </button>
              <span className="px-2 font-semibold">
                {pageToDisplay.toLocaleString("es-AR")} / {Math.max(totalPages, 1).toLocaleString("es-AR")}
              </span>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={disableNextPage}
                title="Pagina siguiente"
              >
                {">"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cargando ? (
        <p className="text-slate-300">Cargando...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left p-3" aria-sort={getAriaSort("Fecha")}>
                  <button type="button" onClick={() => toggleSort("Fecha")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por fecha">
                    Fecha
                    {renderSortIndicator("Fecha")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("Proveedor")}>
                  <button type="button" onClick={() => toggleSort("Proveedor")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por proveedor">
                    Proveedor
                    {renderSortIndicator("Proveedor")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("Factura")}>
                  <button type="button" onClick={() => toggleSort("Factura")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por numero de factura">
                    Nro Factura
                    {renderSortIndicator("Factura")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("TipoGasto")}>
                  <button type="button" onClick={() => toggleSort("TipoGasto")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por tipo de gasto">
                    Tipo Gasto
                    {renderSortIndicator("TipoGasto")}
                  </button>
                </th>
                <th className="text-right p-3" aria-sort={getAriaSort("Moneda")}>
                  <button type="button" onClick={() => toggleSort("Moneda")} className="ml-auto flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por moneda">
                    Moneda
                    {renderSortIndicator("Moneda")}
                  </button>
                </th>
                <th className="text-right p-3" aria-sort={getAriaSort("Importe")}>
                  <button type="button" onClick={() => toggleSort("Importe")} className="ml-auto flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por importe">
                    Importe
                    {renderSortIndicator("Importe")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("Adjunto")}>
                  <button type="button" onClick={() => toggleSort("Adjunto")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por adjunto">
                    Adjunto
                    {renderSortIndicator("Adjunto")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("Despacho")}>
                  <button type="button" onClick={() => toggleSort("Despacho")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por despacho">
                    Despacho
                    {renderSortIndicator("Despacho")}
                  </button>
                </th>
                <th className="text-center p-3" aria-sort={getAriaSort("Registrado")}>
                  <button type="button" onClick={() => toggleSort("Registrado")} className="mx-auto flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por registrado">
                    Registrado
                    {renderSortIndicator("Registrado")}
                  </button>
                </th>
                <th className="text-left p-3" aria-sort={getAriaSort("Vinculos")}>
                  <button type="button" onClick={() => toggleSort("Vinculos")} className="flex items-center gap-2 font-medium text-slate-100 hover:text-white focus:outline-none" title="Ordenar por vinculos">
                    Vinculos
                    {renderSortIndicator("Vinculos")}
                  </button>
                </th>
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
                  <td className="p-3">
                    {(f.LinkedCount ?? 0) > 0 ? (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-400/40">
                        {f.LinkedCount} vinculado{(f.LinkedCount ?? 0) === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-rose-600/30 border border-rose-400/40">
                        Sin vinculo
                      </span>
                    )}
                  </td>
                  <td className="p-3">{f.Despacho || ""}</td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                      checked={Boolean(f.Registrado)}
                      disabled={Boolean(updatingRegistrado[f.ID])}
                      onChange={(e) => toggleRegistrado(f.ID, e.target.checked)}
                      aria-label={`Marcar factura ${f.ID} como registrada`}
                    />
                  </td>
                  <td className="p-3">
                    {f.HasDoc && f.DocUrl ? (
                      <a
                        href={f.DocUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={f.DocName || "Adjunto disponible"}
                        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                      >
                        <span className="text-xs">Adjunto disponible</span>
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">-</span>
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
                  <td className="p-4 text-center text-slate-400" colSpan={11}>
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
