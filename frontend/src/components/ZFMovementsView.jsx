// src/components/ZFMovementsView.jsx
import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";

function fmtNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("es-AR", { minimumFractionDigits: 0 });
}

export default function ZFMovementsView() {
  const { get } = useApi();

  // tabla principal (resumen por ZFE)
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // expandibles y cache de ítems por ZFE
  const [open, setOpen] = useState(new Set());      // Set<ZFE_ID>
  const [cache, setCache] = useState({});           // { [ZFE_ID]: items[] }

  // filtros opcionales
  const [ocId, setOcId] = useState("");
  const [zfiId, setZfiId] = useState("");
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState("");     // YYYY-MM-DD

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (ocId) p.set("oc_id", ocId);
    if (zfiId) p.set("zfi_id", zfiId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [ocId, zfiId, from, to]);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await get(`/zf/movimientos${qs}`);
      setRows(data.items || []);
    } catch (e) {
      console.error(e);
      setErr(e.message || "Error cargando movimientos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // primera carga

  // abrir/cerrar y fetch perezoso del detalle
  const toggle = async (zfeId) => {
    const s = new Set(open);
    if (s.has(zfeId)) {
      s.delete(zfeId);
      setOpen(s);
      return;
    }
    s.add(zfeId);
    setOpen(s);

    if (!cache[zfeId]) {
      try {
        const data = await get(`/zf/movimientos/${zfeId}/items`);
        setCache((p) => ({ ...p, [zfeId]: data.items || [] }));
      } catch (e) {
        setCache((p) => ({ ...p, [zfeId]: [] }));
        alert(e.message || "No se pudo cargar el detalle");
      }
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Movimientos (ZFE)</h3>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Refrescar"}
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={ocId}
          onChange={(e) => setOcId(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
          placeholder="OC (opcional)"
        />
        <input
          value={zfiId}
          onChange={(e) => setZfiId(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
          placeholder="ZFI ID (opcional)"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
          title="Desde"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none"
          title="Hasta"
        />
        <button
          onClick={() => { setOpen(new Set()); setCache({}); load(); }}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
        >
          Aplicar filtros
        </button>
        {(ocId || zfiId || from || to) && (
          <button
            onClick={() => { setOcId(""); setZfiId(""); setFrom(""); setTo(""); setOpen(new Set()); setCache({}); load(); }}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"
          >
            Limpiar
          </button>
        )}
      </div>

      {err && <div className="text-red-400 mb-2">❌ {err}</div>}

      <div className="overflow-x-auto rounded border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-slate-300">
            <tr>
              <th className="p-2 w-10"></th>
              <th className="p-2 text-left">ZFE</th>
              <th className="p-2 text-left">ZFI origen</th>
              <th className="p-2 text-left">OC</th>
              <th className="p-2 text-right">Total retirado</th>
              <th className="p-2 text-left">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400 text-center" colSpan={6}>
                  No hay movimientos para los filtros aplicados.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <>
                <tr key={r.ZFE_ID} className="border-t border-white/10">
                  <td className="p-2">
                    <button
                      className="px-2 py-1 bg-white/10 rounded"
                      onClick={() => toggle(r.ZFE_ID)}
                      title="Ver detalle"
                    >
                      {open.has(r.ZFE_ID) ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="p-2 font-mono">{r.DespachoZFE}</td>
                  <td className="p-2">{r.ZFI_ID}</td>
                  <td className="p-2">{r.OC_ID}</td>
                  <td className="p-2 text-right text-amber-300 font-semibold">
                    {fmtNumber(r.TotalRetirado)}
                  </td>
                  <td className="p-2">
                    {r.Fecha
                      ? new Date(r.Fecha).toLocaleDateString("es-AR")
                      : "—"}
                  </td>
                </tr>

                {open.has(r.ZFE_ID) && (
                  <tr className="bg-black/20">
                    <td colSpan={6} className="p-0">
                      <div className="p-3">
                        {!cache[r.ZFE_ID] ? (
                          <div className="text-slate-400 text-sm">
                            Cargando detalle…
                          </div>
                        ) : cache[r.ZFE_ID].length === 0 ? (
                          <div className="text-slate-400 text-sm">
                            Este ZFE no tiene líneas.
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded border border-white/10">
                            <table className="min-w-full text-xs">
                              <thead className="bg-white/5">
                                <tr>
                                  <th className="p-2 text-left">SKU</th>
                                  <th className="p-2 text-left">Talle</th>
                                  <th className="p-2 text-left">Descripción</th>
                                  <th className="p-2 text-right">
                                    Unidades retiradas (UN)
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {cache[r.ZFE_ID].map((it, i) => (
                                  <tr key={i} className="border-t border-white/10">
                                    <td className="p-2">{it.SKU}</td>
                                    <td className="p-2">{it.Talle}</td>
                                    <td className="p-2">{it.Descripcion}</td>
                                    <td className="p-2 text-right">
                                      {fmtNumber(it.Cantidad)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-400 mt-2">
        Cada fila representa un despacho ZFE y la cantidad total retirada del ZFI asociado.
      </div>
    </section>
  );
}
