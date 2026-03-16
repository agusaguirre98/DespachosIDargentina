import { useEffect, useRef, useState, useMemo } from "react";
import useApi from "../hooks/useApi";

export default function OCSearchSelectMulti({
  value = [],
  onChange,
  placeholder = "Buscar OC...",
}) {
  const { get } = useApi();
  const containerRef = useRef(null);

  // 🔒 Normalización segura del value
  const selected = useMemo(() => {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") return { OC_ID: item };
        if (typeof item === "object" && item.OC_ID) return item;
        return null;
      })
      .filter(Boolean);
  }, [value]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // 🔎 Buscar OCs
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const q = query?.trim?.() || "";

      if (!q || q.length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);

      try {
        const data = await get("/oc/select", { search: q });

        if (cancelled) return;

        if (Array.isArray(data)) {
          setResults(data);
        } else if (Array.isArray(data?.items)) {
          setResults(data.items);
        } else {
          setResults([]);
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

  // 🔒 Cerrar dropdown al hacer click afuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (oc) => {
    if (!oc || !oc.OC_ID) return;

    if (selected.some((x) => x?.OC_ID === oc.OC_ID)) {
      setQuery("");
      setResults([]);
      setOpen(false);
      return;
    }

    const next = [...selected, oc];

    if (typeof onChange === "function") {
      onChange(next);
    }

    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const handleRemove = (ocId) => {
    const next = selected.filter((x) => x?.OC_ID !== ocId);

    if (typeof onChange === "function") {
      onChange(next);
    }
  };

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Chips */}
      <div className="flex flex-wrap gap-2 min-h-[28px]">
        {selected.length === 0 && (
          <span className="text-xs text-slate-500">
            Sin OC seleccionada
          </span>
        )}

        {selected.map((oc) => (
          <button
            key={oc.OC_ID}
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-700"
            onClick={() => handleRemove(oc.OC_ID)}
            title="Quitar OC"
          >
            <span>{oc.OC_ID}</span>
            <span className="text-slate-400">×</span>
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="relative">
        <input
          type="text"
          className="w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60 outline-none"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />

        {/* Dropdown */}
        {open && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 text-sm shadow-xl">
            {loading && (
              <div className="px-3 py-2 text-xs text-slate-400">
                Buscando...
              </div>
            )}

            {!loading && results.length > 0 &&
              results.map((oc) => {
                if (!oc?.OC_ID) return null;

                return (
                  <button
                    key={oc.OC_ID}
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-800 transition-colors"
                    onClick={() => handleSelect(oc)}
                  >
                    <span className="font-medium text-slate-100">
                      {oc.OC_ID}
                    </span>

                    <span className="text-xs text-slate-400">
                      {oc.CODPROVEEDOR || "-"} · {oc.RAZON_SOCIAL || "-"}
                    </span>

                    {oc.FechaOC && (
                      <span className="text-[10px] text-slate-500">
                        {oc.FechaOC}
                      </span>
                    )}
                  </button>
                );
              })
            }

            {!loading &&
              results.length === 0 &&
              query.trim().length >= 2 && (
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