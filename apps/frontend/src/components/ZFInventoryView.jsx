import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";

export default function ZFInventoryView() {
  const { get } = useApi();
  const [rows, setRows] = useState([]);         // inventario ZFI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(new Set());  // zfi_id abiertos
  const [cache, setCache] = useState({});       // { [zfi_id]: items[] }

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        const data = await get("/zf/inventario");
        setRows(data.items || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [get]);

  const toggle = async (zfiId) => {
    const s = new Set(open);
    if (s.has(zfiId)) { s.delete(zfiId); setOpen(s); return; }
    s.add(zfiId); setOpen(s);
    if (!cache[zfiId]) {
      const data = await get(`/zf/inventario/${zfiId}/items`);
      setCache((p) => ({ ...p, [zfiId]: data.items || [] }));
    }
  };

  if (loading) return <div>Cargando inventario…</div>;
  if (error)   return <div className="text-red-400">❌ {error}</div>;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-semibold mb-2">Inventario en Zona Franca</h3>
      <div className="overflow-x-auto rounded border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-slate-300">
            <tr>
              <th className="p-2 w-10"></th>
              <th className="p-2 text-left">ZFI</th>
              <th className="p-2 text-left">OC</th>
              <th className="p-2 text-right">Ingresado</th>
              <th className="p-2 text-right">Retirado</th>
              <th className="p-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr key={r.ZFI_ID} className="border-t border-white/10">
                  <td className="p-2">
                    <button className="px-2 py-1 bg-white/10 rounded"
                            onClick={() => toggle(r.ZFI_ID)} title="Ver items">
                      {open.has(r.ZFI_ID) ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="p-2 font-mono">{r.ZFI_Despacho}</td>
                  <td className="p-2">{r.OC_ID}</td>
                  <td className="p-2 text-right">{r.Ingresado}</td>
                  <td className="p-2 text-right">{r.Retirado}</td>
                  <td className="p-2 text-right">{r.Saldo}</td>
                </tr>

                {open.has(r.ZFI_ID) && (
                  <tr className="bg-black/20">
                    <td colSpan={6} className="p-0">
                      <div className="p-3">
                        {!cache[r.ZFI_ID] ? (
                          <div className="text-slate-400 text-sm">Cargando items…</div>
                        ) : cache[r.ZFI_ID].length === 0 ? (
                          <div className="text-slate-400 text-sm">Sin items.</div>
                        ) : (
                          <div className="overflow-x-auto rounded border border-white/10">
                            <table className="min-w-full text-xs">
                              <thead className="bg-white/5">
                                <tr>
                                  <th className="p-2 text-left">SKU</th>
                                  <th className="p-2 text-left">Talle</th>
                                  <th className="p-2 text-left">Descripción</th>
                                  <th className="p-2 text-right">Unidades</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cache[r.ZFI_ID].map((it, i) => (
                                  <tr key={i} className="border-t border-white/10">
                                    <td className="p-2">{it.SKU}</td>
                                    <td className="p-2">{it.Talle}</td>
                                    <td className="p-2">{it.Descripcion}</td>
                                    <td className="p-2 text-right">{it.CantidadActual}</td>
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
        Totales mostrados por despacho (ZFI). Los saldos incluyen todos los retiros asociados.
      </div>
    </section>
  );
}
