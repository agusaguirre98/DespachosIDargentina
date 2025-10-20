import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";

export default function ZFEDetailView({ zfeId }) {
  const { get } = useApi();
  const [hdr, setHdr] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true); setMsg("");
    try {
      const d = await get(`/zf/zfe/${zfeId}/lines`);
      if (!d?.ok) throw new Error(d?.error || "Error detalle ZFE.");
      setHdr(d.header); setRows(d.items || []);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{ load(); }, [zfeId]);

  if (loading) return <div className="text-slate-300">Cargando ZFE…</div>;
  if (!hdr)     return <div className="text-slate-300">No encontrado.</div>;

  const total = rows.reduce((acc, r) => acc + (Number(r.CantidadRetiro) || 0), 0);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">ZFE {hdr.DespachoZFE}</h3>
        <div className="text-sm text-slate-300">
          OC <b>{hdr.OC_ID || "-"}</b> · Fecha {hdr.Fecha || "-"} · ZFI Origen <b>{hdr.DespachoZFI || "-"}</b>
        </div>
      </div>

      {msg && <div className="text-sm text-slate-300">{msg}</div>}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-sm text-slate-200">
          <thead className="bg-white/10 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">Talle</th>
              <th className="px-3 py-2 text-left">Descripción</th>
              <th className="px-3 py-2 text-right">Cantidad retirada</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-4 text-slate-400">Sin líneas.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={`${r.SKU}|${r.Talle}|${i}`} className="hover:bg-white/10">
                <td className="px-3 py-2">{r.SKU}</td>
                <td className="px-3 py-2">{r.Talle || "-"}</td>
                <td className="px-3 py-2">{r.Descripcion}</td>
                <td className="px-3 py-2 text-right text-amber-300">{Number(r.CantidadRetiro)?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-white/5">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right font-medium">Total</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-300">
                  {total.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
