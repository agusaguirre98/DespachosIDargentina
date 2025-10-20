import { useEffect, useState } from "react";

export default function DebugOC() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [since, setSince] = useState("2000-01-01");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [lastUrl, setLastUrl] = useState("");

  const fetchOCs = async (query = q, sinceDate = since) => {
    setLoading(true);
    setErr(null);
    const url = `/oc/select?search=${encodeURIComponent(query || "")}&since=${encodeURIComponent(
      sinceDate || "2000-01-01"
    )}`;
    setLastUrl(url);
    try {
      const r = await fetch(url);
      const text = await r.text(); // para ver errores no JSON
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      if (!r.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      if (!Array.isArray(data)) throw new Error("Respuesta inesperada (no es un array)");
      setItems(data);
    } catch (e) {
      setItems([]);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOCs("", since); /* al montar trae últimas 25 */ }, []); // eslint-disable-line

  const reset = () => { setQ(""); fetchOCs("", since); };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Debug OC (últimas 25)</h2>
        <div className="text-xs text-slate-400">GET {lastUrl || "/oc/select"}</div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4 grid gap-3 md:grid-cols-3">
        <div className="flex flex-col">
          <label className="text-xs text-slate-300 mb-1">Buscar (OC / Código proveedor / Razón social)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej: 12345 o ACME"
            className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-300 mb-1">Desde (FECHA_ALTA)</label>
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
          />
        </div>
        <div className="flex items-end gap-2">
          <button onClick={() => fetchOCs(q, since)} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500">
            {loading ? "Cargando..." : "Buscar / Recargar"}
          </button>
          <button onClick={reset} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20">
            Limpiar
          </button>
        </div>
      </div>

      {err && <div className="mb-3 p-3 rounded-lg bg-rose-900/30 border border-rose-700/40 text-sm">❌ {err}</div>}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left text-slate-300">
              <th className="py-2 px-3 w-28">OC_ID</th>
              <th className="py-2 px-3 w-36">Cod. Proveedor</th>
              <th className="py-2 px-3">Razón social</th>
              <th className="py-2 px-3 w-36">Fecha OC</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr><td colSpan={4} className="py-3 px-3 text-center text-slate-400">Sin resultados</td></tr>
            ) : (
              items.map((r, i) => (
                <tr key={i} className="border-t border-white/10">
                  <td className="py-2 px-3">{r.OC_ID}</td>
                  <td className="py-2 px-3">{r.CODPROVEEDOR || "—"}</td>
                  <td className="py-2 px-3">{r.RAZON_SOCIAL || "—"}</td>
                  <td className="py-2 px-3">{r.FECHAOC || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-slate-400">
        {loading ? "Consultando Asignador..." : `Mostrando ${items.length} registro(s).`}
      </div>
    </div>
  );
}
