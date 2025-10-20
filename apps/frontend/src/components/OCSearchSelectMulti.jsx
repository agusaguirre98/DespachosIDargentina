import React, { useState } from "react";
import OCSearchSelect from "./OCSearchSelect";

/**
 * Normaliza el objeto que devuelve OCSearchSelect a { id: number, label: string }
 * Funciona con distintas formas: {ID, id, OcId}, {OC, oc, Numero, label, text}...
 */
function normalizeOC(item) {
  if (!item) return null;
  const idRaw = item.ID ?? item.id ?? item.OcId ?? item.ocId ?? item.value ?? item.key ?? null;
  const id = Number(idRaw);
  const code =
    item.OC ?? item.oc ?? item.Numero ?? item.numero ?? item.label ?? item.text ?? (Number.isFinite(id) ? `OC-${id}` : "");
  if (!Number.isFinite(id)) return null;
  return { id, label: String(code || `OC-${id}`) };
}

/**
 * Props:
 *  - value: number[]  (IDs de OC seleccionadas)
 *  - onChange: (ids: number[]) => void
 *  - placeholder?: string
 *  - className?: string
 *
 * Reutiliza OCSearchSelect para elegir una OC a la vez y arma chips.
 */
export default function OCSearchSelectMulti({ value = [], onChange, placeholder = "Buscar OC…", className = "" }) {
  const [lastSelected, setLastSelected] = useState(null); // solo para controlar OCSearchSelect si hace falta
  const [inputPasteGuard, setInputPasteGuard] = useState(""); // input invisible para pegar listas

  const addId = (id) => {
    if (!Number.isFinite(id)) return;
    if (value.includes(id)) return;
    onChange([...value, id]);
  };

  const onSelect = (item) => {
    const norm = normalizeOC(item);
    if (!norm) return;
    addId(norm.id);
    setLastSelected(null); // limpiar el selector si es controlado
  };

  const removeId = (id) => onChange(value.filter((x) => x !== id));

  const onPaste = (e) => {
    const t = e.clipboardData.getData("text");
    if (!t) return;
    const toks = t.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const nums = toks.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (!nums.length) return;
    e.preventDefault();
    const set = new Set(value);
    nums.forEach((n) => set.add(n));
    onChange(Array.from(set));
    setInputPasteGuard(""); // limpiar
  };

  return (
    <div className={className}>
      {/* Selector de una OC (tu componente) */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {/* 
            Ajustá la API de OCSearchSelect si fuera necesario:
            - Si tu componente usa `onSelect` en vez de `onChange`, cambiá la prop.
            - Si exige `value`, podés pasar `lastSelected`.
          */}
          <OCSearchSelect
            value={lastSelected}
            onChange={onSelect}
            placeholder={placeholder}
          />
        </div>

        {/* Campo invisible para paste masivo (opcional) */}
        <input
          className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-200"
          placeholder="Pegar OCs (ej: 55001, 55002)"
          value={inputPasteGuard}
          onChange={(e) => setInputPasteGuard(e.target.value)}
          onPaste={onPaste}
        />
      </div>

      {/* Chips */}
      <div className="mt-2 flex flex-wrap gap-2">
        {value.length === 0 && <span className="text-slate-400 text-xs">Aún no seleccionaste OCs</span>}
        {value.map((oc) => (
          <span
            key={oc}
            className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-white/10 border border-white/20"
          >
            OC-{oc}
            <button
              className="rounded bg-white/10 hover:bg-white/20 px-1"
              onClick={() => removeId(oc)}
              title="Quitar"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
