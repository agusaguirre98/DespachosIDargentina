// src/Nacional/components/FacturaServicioList.jsx

import React from "react";

export function FacturaServicioList({ facturas, onSelect }) {
    if (!facturas?.length) {
        return (
            <div className="rounded-xl border border-dashed border-slate-600/70 bg-slate-950/40 p-3 text-xs text-slate-300">
                No hay facturas de servicio cargadas.
            </div>
        );
    }

    return (
        <div className="text-xs">
            <h2 className="mb-1 text-[0.8rem] font-semibold text-slate-100">
                Lista de facturas
            </h2>
            <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
                <div className="max-h-[360px] overflow-auto">
                    <table className="min-w-full text-[0.7rem]">
                        <thead className="bg-slate-800/80 text-slate-200">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                    Nº Factura
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                    Proveedor
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Cant. total
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Asignada
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Disponible
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Importe
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Costo unit.
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {facturas.map((f) => {
                                const disponible =
                                    (f.CantidadTotal || 0) - (f.CantidadAsignada || 0);
                                return (
                                    <tr
                                        key={f.SERV_ID ?? `${f.NumeroFactura}-${f.Fecha}`}
                                        className="cursor-pointer border-t border-slate-800/70 bg-slate-900/40 hover:bg-indigo-900/40"
                                        onClick={() => onSelect?.(f)}
                                    >
                                        <td className="px-2 py-1.5">{f.Fecha}</td>
                                        <td className="px-2 py-1.5">{f.NumeroFactura}</td>
                                        <td className="px-2 py-1.5">{f.TipoServicio}</td>
                                        <td className="px-2 py-1.5">{f.Proveedor}</td>
                                        <td className="px-2 py-1.5 text-right">
                                            {f.CantidadTotal}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            {f.CantidadAsignada || 0}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">{disponible}</td>
                                        <td className="px-2 py-1.5 text-right">
                                            {f.ImporteTotal?.toLocaleString?.("es-AR", {
                                                minimumFractionDigits: 2,
                                            }) ?? f.ImporteTotal}
                                        </td>
                                        <td className="px-2 py-1.5 text-right">
                                            {f.CostoUnitario !== undefined &&
                                                f.CostoUnitario !== null
                                                ? f.CostoUnitario.toFixed(4)
                                                : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="border-t border-slate-800/80 px-3 py-1.5 text-[0.65rem] text-slate-400">
                    Tip: hacé clic en una fila para ver el detalle y luego asignarla a
                    OCs.
                </p>
            </div>
        </div>
    );
}
