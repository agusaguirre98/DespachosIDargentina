import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";

export default function OCSearchSelectMulti({
  value,
  onChange,
  placeholder = "Buscar OC...",
}) {
  const { get } = useApi();

  // normalizamos el value a una lista de objetos con OC_ID
  const selected = Array.isArray(value)
    ? value
      .map((item) => (typeof item === "string" ? { OC_ID: item } : item))
      .filter((item) => item && item.OC_ID)
    : [];

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // === Buscar OCs cuando se escribe ===
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const q = query.trim();
      if (!q || q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        // Backend: GET /oc/select?search=...
        const data = await get("/oc/select", {
          search: q,
          // si tu endpoint acepta since, podés agregarlo acá:
          // since: "2000-01-01",
        });

        if (!cancelled) {
          if (Array.isArray(data)) {
            setResults(data);
          } else if (Array.isArray(data?.items)) {
            // por si en algún momento lo cambiás a { items: [...] }
            setResults(data.items);
          } else {
            setResults([]);
          }
        }
      } catch (e) {
        console.error("Error buscando OCs:", e);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [query, get]);

  const handleSelect = (oc) => {
    if (!oc || !oc.OC_ID) return;

    // evitar duplicados
    if (selected.some((x) => x.OC_ID === oc.OC_ID)) {
      setQuery("");
      setResults([]);
      setOpen(false);
      return;
    }

    const next = [...selected, oc];
    onChange(next);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const handleRemove = (ocId) => {
    const next = selected.filter((x) => x.OC_ID !== ocId);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {/* chips seleccionados */}
      <div className="flex flex-wrap gap-2 min-h-[24px]">
        {selected.length === 0 && (
          <span className="text-xs text-slate-500">Sin OC seleccionada</span>
        )}
        {selected.map((oc) => (
          <button
            key={oc.OC_ID}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs"
            onClick={() => handleRemove(oc.OC_ID)}
            title="Quitar OC"
          >
            <span>{oc.OC_ID}</span>
            <span className="text-slate-400">×</span>
          </button>
        ))}
      </div>

      {/* input de búsqueda */}
      <div className="relative">
        <input
          type="text"
          className="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />

        {/* dropdown resultados */}
        {open && (loading || results.length > 0) && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 text-sm shadow-lg">
            {loading && (
              <div className="px-3 py-2 text-xs text-slate-400">
                Buscando...
              </div>
            )}
            {!loading &&
              results.map((oc) => (
                <button
                  key={oc.OC_ID}
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-800"
                  onClick={() => handleSelect(oc)}
                >
                  <span className="font-medium">{oc.OC_ID}</span>
                  <span className="text-xs text-slate-400">
                    {oc.CODPROVEEDOR} · {oc.RAZON_SOCIAL}
                  </span>
                  {oc.FechaOC && (
                    <span className="text-[10px] text-slate-500">
                      {oc.FechaOC}
                    </span>
                  )}
                </button>
              ))}
            {!loading && results.length === 0 && query.trim().length >= 2 && (
              <div className="px-3 py-2 text-xs text-slate-400">
                No se encontraron OCs para “{query}”.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
