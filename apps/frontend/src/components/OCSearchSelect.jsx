// src/components/OCSearchSelect.jsx
import { useEffect, useMemo, useRef, useState } from "react";

const fmt = (d) => {
  try { return new Date(d).toLocaleDateString("es-AR"); } catch { return d || ""; }
};

export default function OCSearchSelect({
  value,                 // string | null  -> OC_ID seleccionado
  onChange,              // (row|null) => void
  placeholder = "Buscar OC…",
  autoFetchOnFocus = true,
  minChars = 0,          // 0 => trae TOP 25 cuando está vacío
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const boxRef = useRef(null);
  const timerRef = useRef(null);

  const doFetch = async (query) => {
    setLoading(true);
    setErr("");
    try {
      const url = `/oc/select?search=${encodeURIComponent(query || "")}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // backend devuelve un array plano; soportamos también {items:[]}
      const items = Array.isArray(data) ? data : (data.items || []);
      setRows(items);
    } catch (e) {
      setErr(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // Buscar al escribir (debounce) y también cuando queda vacío (TOP 25)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if ((q || "").length >= minChars) doFetch(q);
      else doFetch(""); // vacío => trae TOP 25 (fallback del endpoint)
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  // Cerrar al click afuera
  useEffect(() => {
    const h = (ev) => {
      if (boxRef.current && !boxRef.current.contains(ev.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Row seleccionada por valor externo
  const selected = useMemo(
    () => rows.find((r) => String(r.OC_ID) === String(value)) || null,
    [rows, value]
  );

  const renderLine = (r) =>
    `${r.OC_ID ?? ""} – ${r.CODPROVEEDOR ?? ""} – ${r.RAZON_SOCIAL ?? ""} – ${fmt(r.FECHAOC)}`;

  return (
    <div ref={boxRef} className="relative w-full">
      <label className="block text-sm mb-1">Buscar OC (por Nº / Proveedor)</label>

      <input
        className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          setOpen(true);
          if (autoFetchOnFocus && rows.length === 0) doFetch(q);
        }}
      />

      <div className="mt-1 text-xs text-slate-300">
        {selected ? (
          <span className="inline-block px-2 py-1 rounded bg-emerald-700/40 border border-emerald-500/40">
            Seleccionada: {renderLine(selected)}
          </span>
        ) : (
          <span className="opacity-70">Sin OC seleccionada</span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-20 rounded-xl border border-white/15 bg-slate-900 max-h-72 overflow-auto shadow-lg">
          {loading && (
            <div className="p-3 text-sm text-slate-300">Buscando…</div>
          )}
          {!loading && err && (
            <div className="p-3 text-sm text-rose-300">Error: {err}</div>
          )}
          {!loading && !err && rows.length === 0 && (
            <div className="p-3 text-sm text-slate-300">Sin resultados</div>
          )}
          {!loading && !err && rows.length > 0 && (
            <ul className="divide-y divide-white/10">
              {rows.map((r) => (
                <li key={r.OC_ID}>
                  <button
                    type="button"
                    className={`w-full text-left p-2 hover:bg-white/10 ${
                      String(value) === String(r.OC_ID) ? "bg-white/10" : ""
                    }`}
                    onClick={() => {
                      onChange?.(r);
                      setOpen(false);
                    }}
                  >
                    <div className="font-medium">
                      OC {r.OC_ID} · {r.CODPROVEEDOR}
                    </div>
                    <div className="text-xs opacity-80">
                      {r.RAZON_SOCIAL} — {fmt(r.FECHAOC)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
