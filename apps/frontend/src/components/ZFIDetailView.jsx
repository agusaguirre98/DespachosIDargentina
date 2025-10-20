import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";

export default function ZFIDetailView({ zfiId }) {
  const { get } = useApi();
  const [hdr, setHdr] = useState(null);
  const [rows, setRows] = useState([]);
  const [zfes, setZfes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true); setMsg("");
    try {
      const d1 = await get(`/zf/zfi/${zfiId}/detalle`);
      if (!d1?.ok) throw new Error(d1?.error || "Error detalle ZFI.");
      setHdr(d1.header); setRows(d1.items || []);
      const d2 = await get(`/zf/zfi/${zfiId}/zfe`);
      setZfes(d2?.items || []);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{ load(); }, [zfiId]);

  if (loading) return <div className="text-slate-300">Cargando ZFI…</div>;
  if (!hdr)     return <div className="text-slate-300">No encontrado.</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">ZFI {hdr.DespachoZFI}</h3>
          <div className="text-sm text-slate-300">
            OC <b>{hdr.OC_ID || "-"}</b> · Fecha {hdr.Fecha || "-"}
          </div>
        </div>
        <div className="mt-2 text-sm text-slate-300">
          Ingresado: <b>{hdr.IngresadoTotal?.toLocaleString()}</b> ·
          Retirado: <b className="text-amber-300">{hdr.RetiradoTotal?.toLocaleString()}</b> ·
          Saldo: <b className={`${hdr.SaldoTotal <= 0 ? "text-red-400" : "text-green-400"}`}>{hdr.SaldoTotal?.toLocaleString()}</b>
        </div>
      </div>

      {msg && <div className="text-sm text-slate-300">{msg}</div>}

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h4 className="font-semibold mb-2">Artículos (por SKU/Talle)</h4>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-sm text-slate-200">
            <thead className="bg-white/10 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Talle</th>
                <th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-right">Ingresado</th>
                <th className="px-3 py-2 text-right">Unidades Retiradas</th>
                <th className="px-3 py-2 text-right">Unidades</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-4 text-slate-400">Sin ítems.</td></tr>
              ) : rows.map(r => (
                <tr key={`${r.SKU}|${r.Talle}`} className="hover:bg-white/10">
                  <td className="px-3 py-2">{r.SKU}</td>
                  <td className="px-3 py-2">{r.Talle || "-"}</td>
                  <td className="px-3 py-2">{r.Descripcion}</td>
                  <td className="px-3 py-2 text-right">{r.Ingresado?.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{r.Retirado?.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right ${r.Saldo <= 0 ? "text-red-400" : "text-green-400"}`}>
                    {r.Saldo?.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ZFEs que retiraron de este ZFI */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h4 className="font-semibold mb-2">ZFEs asociados</h4>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-sm text-slate-200">
            <thead className="bg-white/10 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">ZFE</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-right">Total retirado</th>
              </tr>
            </thead>
            <tbody>
              {zfes.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-4 text-slate-400">Aún no hay retiros.</td></tr>
              ) : zfes.map(z => (
                <tr key={z.ZFE_ID} className="hover:bg-white/10">
                  <td className="px-3 py-2">{z.DespachoZFE}</td>
                  <td className="px-3 py-2">{z.Fecha}</td>
                  <td className="px-3 py-2 text-right text-amber-300">{z.TotalRetirado?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
