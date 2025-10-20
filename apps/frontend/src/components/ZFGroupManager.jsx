// src/components/ZFGroupManager.jsx
import { useState } from "react";
import ZFInventoryView from "./ZFInventoryView";
import ZFMovementsView from "./ZFMovementsView";
import ZFGroupAdmin from "./ZFGroupAdmin";

export default function ZFGroupManager() {
  const [tab, setTab] = useState("inventario"); // "inventario" | "movimientos" | "grupos"

  // Si realmente los necesitás, dejalos acá dentro:
  const [zfisOc, setZfisOc] = useState([]);      // ZFIs de la OC (sin agrupar)
  const [loadingZfis, setLoadingZfis] = useState(false);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* HEADER */}
      <header className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Zona Franca</h2>

        <div className="flex gap-2">
          {[
            { key: "inventario", label: "Inventario" },
            { key: "movimientos", label: "Movimientos" },
            { key: "grupos", label: "Administrar grupos" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-indigo-600 text-white"
                  : "bg-white/10 text-slate-300 hover:bg-white/20"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* CONTENIDO */}
      {tab === "inventario" && <ZFInventoryView />}
      {tab === "movimientos" && <ZFMovementsView />}
      {tab === "grupos" && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <ZFGroupAdmin />
        </div>
      )}
    </div>
  );
}
