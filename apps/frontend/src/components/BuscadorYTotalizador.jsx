import { useDeferredValue } from "react";

/**
 * Barra superior con:
 *  - input de búsqueda
 *  - totalizador (filas seleccionadas y unidades totales)
 *  - acciones (llenar, limpiar)
 *  - botones de refrescar/guardar
 *
 * Props:
 *  - q: string
 *  - onChangeQ: (val) => void
 *  - totalFilas: number         // filas con cantidad > 0
 *  - totalUnidades: number      // suma de cantidades > 0
 *  - onRefrescar: () => void
 *  - cargando: boolean
 *  - onGuardar: () => void
 *  - guardando: boolean
 *  - puedeGuardar: boolean
 *  - onLlenarFiltrados: () => void
 *  - onLimpiar: () => void
 *  - totalItemsVisibles: number // items que pasan el filtro
 */
export default function BuscadorYTotalizador({
    q,
    onChangeQ,
    totalFilas,
    totalUnidades,
    onRefrescar,
    cargando,
    onGuardar,
    guardando,
    puedeGuardar,
    onLlenarFiltrados,
    onLimpiar,
    totalItemsVisibles,
}) {
    // de-bounce visual para que el tipeo no "salte"
    const dq = useDeferredValue(q);

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
                <input
                    value={dq}
                    onChange={(e) => onChangeQ(e.target.value)}
                    placeholder="Buscar por SKU, talle o descripción…"
                    className="w-72 rounded-md bg-white/10 border border-white/20 text-sm px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-xs text-slate-400">{totalItemsVisibles} ítems</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm text-slate-300 mr-2">
                    Seleccionados: <b>{totalFilas}</b> · Total a retirar: <b>{totalUnidades}</b> u.
                </div>

                <button
                    onClick={onLimpiar}
                    className="text-xs underline underline-offset-4 text-slate-400 hover:text-slate-200"
                >
                    Limpiar selección
                </button>

                <button
                    onClick={onLlenarFiltrados}
                    className="text-xs underline underline-offset-4 text-slate-400 hover:text-slate-200"
                    title="Completa RETIRAR con el disponible de los ítems visibles"
                >
                    Llenar con disponibles (filtrados)
                </button>

                <button
                    onClick={onRefrescar}
                    disabled={cargando}
                    className="px-3 py-1 rounded-md bg-white/10 border border-white/20 text-sm disabled:opacity-50"
                >
                    {cargando ? "Actualizando…" : "Refrescar"}
                </button>

                <button
                    onClick={onGuardar}
                    disabled={guardando || !puedeGuardar}
                    className="px-3 py-1 rounded-md bg-fuchsia-700 hover:bg-fuchsia-600 text-sm disabled:opacity-50"
                    title={!puedeGuardar ? "No hay cantidades para guardar" : "Guardar retiros"}
                >
                    {guardando ? "Guardando…" : "Guardar retiros"}
                </button>
            </div>
        </div>
    );
}
