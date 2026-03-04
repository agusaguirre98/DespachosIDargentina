// src/Nacional/components/FacturaServicioDetalle.jsx

import React from "react";

export function FacturaServicioDetalle({ factura }) {
    if (!factura) {
        return (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-600/70 bg-slate-950/40 p-3 text-center text-[0.75rem] text-slate-400">
                Seleccioná una factura de la lista para ver el detalle.
            </div>
        );
    }

    const disponible =
        (factura.CantidadTotal || 0) - (factura.CantidadAsignada || 0);

    return (
        <div className="flex h-full flex-col rounded-xl border border-white/10 bg-slate-950/50 p-3 text-xs">
            <h2 className="mb-2 text-[0.8rem] font-semibold text-slate-100">
                Detalle factura
            </h2>

            <div className="grid gap-1.5 text-[0.7rem] sm:grid-cols-2">
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Nº Factura
                    </span>
                    <span className="font-medium text-slate-100">
                        {factura.NumeroFactura}
                    </span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Fecha
                    </span>
                    <span>{factura.Fecha}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Tipo servicio
                    </span>
                    <span>{factura.TipoServicio}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Proveedor
                    </span>
                    <span>{factura.Proveedor}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Cantidad total
                    </span>
                    <span>{factura.CantidadTotal}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Asignado
                    </span>
                    <span>{factura.CantidadAsignada || 0}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Disponible
                    </span>
                    <span className="font-medium text-emerald-300">{disponible}</span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Importe total
                    </span>
                    <span>
                        {factura.ImporteTotal?.toLocaleString?.("es-AR", {
                            minimumFractionDigits: 2,
                        }) ?? factura.ImporteTotal}
                    </span>
                </div>
                <div>
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Costo unitario
                    </span>
                    <span>
                        {factura.CostoUnitario != null
                            ? factura.CostoUnitario.toFixed(4)
                            : "—"}
                    </span>
                </div>
            </div>

            {factura.Descripcion && (
                <div className="mt-3 border-t border-slate-800/70 pt-2 text-[0.7rem] text-slate-200">
                    <span className="block text-[0.65rem] uppercase tracking-wide text-slate-400">
                        Descripción
                    </span>
                    <p className="mt-0.5 whitespace-pre-wrap">{factura.Descripcion}</p>
                </div>
            )}

            {/* 💡 Acá más adelante vamos a agregar:
          - Botón "Asignar a OC"
          - Modal con buscador de OC de Asignador + cantidad de avíos a asignar
      */}
        </div>
    );
}
