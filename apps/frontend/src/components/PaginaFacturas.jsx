import React, { useEffect, useMemo, useState } from "react";
import FormularioFactura from "../components/FormularioFactura";
import FormularioEditarFactura from "../components/FormularioEditarFactura";

const DEFAULT_LIMIT = 100;

const PaginaFacturas = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [modo, setModo] = useState("list"); // "list" | "create" | "edit"
  const [facturaEdit, setFacturaEdit] = useState(null);

  // Filtros/controles
  const [soloSinDespacho, setSoloSinDespacho] = useState(false);
  const [order, setOrder] = useState("fecha_desc"); // fecha_desc | fecha_asc | id_desc | id_asc | importe_desc | importe_asc
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [page, setPage] = useState(1);

  const fetchFacturas = async () => {
    try {
      setCargando(true);
      setError("");

      const params = new URLSearchParams();
      params.set("order", order);
      params.set("limit", String(limit));
      params.set("offset", String((page - 1) * limit));
      // Enviamos only_unlinked para que el SQL ya agrupe por vínculos
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

  // Cargar al entrar y ante cambios de filtros/paginación
  useEffect(() => {
    fetchFacturas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloSinDespacho, order, limit, page]);

  const volverListado = () => {
    setFacturaEdit(null);
    setModo("list");
    fetchFacturas();
  };

  // Filtro adicional en el cliente:
  // Cuando "soloSinDespacho" está activo, además de LinkedCount===0
  // ocultamos las que tienen texto en la columna de compatibilidad `Despacho`.
  const rows = useMemo(() => {
    if (!soloSinDespacho) return items;
    return items.filter(
      (f) => (f.LinkedCount ?? 0) === 0 && !(f.Despacho || "").trim()
    );
  }, [items, soloSinDespacho]);

  if (modo === "create") {
   return (
      <div className="max-w-7xl mx-auto">
        <FormularioFactura volverAtras={volverListado} />
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
        <h1 className="text-3xl font-bold">Facturas</h1>

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
            {/* aclaramos criterio: sin vínculo y sin texto */}
            Mostrar solo sin despacho
          </label>

          <select
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
            value={order}
            onChange={(e) => {
              setPage(1);
              setOrder(e.target.value);
            }}
            title="Ordenar"
          >
            <option value="fecha_desc">Fecha ↓</option>
            <option value="fecha_asc">Fecha ↑</option>
            <option value="id_desc">ID ↓</option>
            <option value="id_asc">ID ↑</option>
            <option value="importe_desc">Importe ↓</option>
            <option value="importe_asc">Importe ↑</option>
          </select>

          <select
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
            value={limit}
            onChange={(e) => {
              setPage(1);
              setLimit(Number(e.target.value) || DEFAULT_LIMIT);
            }}
            title="Filas por página"
          >
            {[50, 100, 200, 500].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <div className="inline-flex items-center gap-1">
            <button
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              title="Página anterior"
            >
              ◀
            </button>
            <span className="px-2">{page}</span>
            <button
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"
              onClick={() => setPage((p) => p + 1)}
              title="Página siguiente"
            >
              ▶
            </button>
          </div>

          <button
            onClick={fetchFacturas}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20"
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

      {error && <div className="mb-3 p-3 rounded-lg bg-red-900/30">{error}</div>}

      {cargando ? (
        <p>Cargando…</p>
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
                      : (f.Importe || "")}
                  </td>
                  <td className="p-3">
                    {f.HasDoc && f.DocUrl ? (
                      <a
                        href={f.DocUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={f.DocName || "Abrir adjunto"}
                        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 underline"
                      >
                        <span aria-hidden>📎</span>
                        <span className="text-xs">Abrir</span>
                      </a>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
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
                      onClick={() => { setFacturaEdit(f); setModo("edit"); }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="p-4 text-center text-slate-400" colSpan={10}>
                    {soloSinDespacho
                      ? "No hay facturas sin vínculos y sin texto de despacho."
                      : "No hay facturas para mostrar."}
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
