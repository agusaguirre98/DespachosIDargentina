// src/Nacional/components/InventarioServiciosPanel.jsx

import React, { useEffect, useMemo, useState } from "react";
import { fetchInventarioServicios } from "../api/serviciosApi";

export function InventarioServiciosPanel({
    // Por si algún día querés inyectar datos desde afuera,
    // estos props tienen prioridad sobre lo que viene del back.
    resumenGlobal: resumenGlobalProp,
    resumenPorTipo: resumenPorTipoProp,
    resumenPorFactura: resumenPorFacturaProp,
    resumenPorOC: resumenPorOCProp,
}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // 🔹 Cargar inventario desde el backend al montar el componente
    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                setError("");
                const res = await fetchInventarioServicios();
                setData(res || {});
            } catch (err) {
                console.error(err);
                setError(err.message || "Error al obtener el inventario de servicios.");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, []);

    // 🔹 Elegimos fuente de datos: primero props (si vienen), luego back
    const resumenGlobal = resumenGlobalProp ?? data?.resumenGlobal ?? {
        totalPagado: 0,
        totalAsignado: 0,
        saldoDisponible: 0,
    };

    const resumenPorTipo =
        resumenPorTipoProp ??
        data?.resumenPorTipo ??
        [];

    const resumenPorFactura =
        resumenPorFacturaProp ??
        data?.resumenPorFactura ??
        [];

    const resumenPorOC =
        resumenPorOCProp ??
        data?.resumenPorOC ??
        [];

    const stats = {
        totalPagado: resumenGlobal?.totalPagado ?? 0,
        totalAsignado: resumenGlobal?.totalAsignado ?? 0,
        saldoDisponible: resumenGlobal?.saldoDisponible ?? 0,
    };

    const tipos = Array.isArray(resumenPorTipo) ? resumenPorTipo : [];
    const facturas = Array.isArray(resumenPorFactura) ? resumenPorFactura : [];
    const asignacionesOC = Array.isArray(resumenPorOC) ? resumenPorOC : [];

    const ratioConsumido = useMemo(() => {
        if (!stats.totalPagado) return 0;
        return Math.min(
            100,
            Math.round((stats.totalAsignado / stats.totalPagado) * 100)
        );
    }, [stats.totalPagado, stats.totalAsignado]);

    const ratioDisponible = useMemo(() => 100 - ratioConsumido, [ratioConsumido]);

    const format = (n) =>
        Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0 });

    // 🔹 Estados de carga / error
    if (loading) {
        return (
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-xs text-slate-300">
                Cargando inventario de servicios…
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-red-500/60 bg-red-900/30 p-4 text-xs text-red-100">
                {error}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* 🔹 Resumen global */}
            <section>
                <h2 className="mb-3 text-sm font-semibold text-slate-100">
                    Resumen de servicios pagados vs. consumidos
                </h2>

                <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                        <div className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                            Servicios pagados
                        </div>
                        <div className="mt-1 text-2xl font-bold text-slate-50">
                            {format(stats.totalPagado)}
                        </div>
                        <div className="mt-1 text-[0.7rem] text-slate-400">
                            Unidades contabilizadas por facturas de servicio.
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                        <div className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                            Servicios asignados
                        </div>
                        <div className="mt-1 text-2xl font-bold text-emerald-300">
                            {format(stats.totalAsignado)}
                        </div>
                        <div className="mt-1 text-[0.7rem] text-slate-400">
                            Consumidos y trazados contra órdenes de compra.
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                        <div className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                            Servicios disponibles
                        </div>
                        <div className="mt-1 text-2xl font-bold text-indigo-300">
                            {format(stats.saldoDisponible)}
                        </div>
                        <div className="mt-1 text-[0.7rem] text-slate-400">
                            Unidades aún no imputadas a OCs.
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                        <div className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                            Nivel de consumo
                        </div>
                        <div className="mt-1 flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-slate-50">
                                {ratioConsumido}%
                            </span>
                            <span className="text-[0.7rem] text-slate-400">
                                del total pagado
                            </span>
                        </div>
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                                className="h-2 bg-emerald-500"
                                style={{ width: `${ratioConsumido}%` }}
                            />
                        </div>
                        <div className="mt-1 flex justify-between text-[0.65rem] text-slate-400">
                            <span>Consumido</span>
                            <span>{ratioDisponible}% disponible</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* 🔹 Desglose por tipo + facturas con saldo */}
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                {/* Por tipo de servicio */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[0.8rem] font-semibold text-slate-100">
                            Servicios por tipo
                        </h3>
                        <span className="text-[0.7rem] text-slate-400">
                            Pagado, asignado y saldo por categoría.
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-[0.7rem]">
                            <thead className="bg-slate-800/70 text-slate-200">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Pagado</th>
                                    <th className="px-2 py-1.5 text-right font-medium">
                                        Asignado
                                    </th>
                                    <th className="px-2 py-1.5 text-right font-medium">
                                        Disponible
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        % consumo
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {tipos.map((t) => {
                                    const disponibleCalc =
                                        t.disponible ??
                                        (t.pagado != null && t.asignado != null
                                            ? (t.pagado || 0) - (t.asignado || 0)
                                            : 0);

                                    const pct =
                                        t.pagado > 0
                                            ? Math.round((t.asignado / t.pagado) * 100)
                                            : 0;
                                    return (
                                        <tr
                                            key={t.tipo}
                                            className="border-t border-slate-800/70 bg-slate-900/40"
                                        >
                                            <td className="px-2 py-1.5 font-medium text-slate-100">
                                                {t.tipo}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">
                                                {format(t.pagado)}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-emerald-300">
                                                {format(t.asignado)}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-indigo-300">
                                                {format(disponibleCalc)}
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                                                        <div
                                                            className="h-1.5 bg-emerald-500"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[0.68rem] text-slate-300">
                                                        {pct}%
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}

                                {!tipos.length && (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="px-3 py-3 text-center text-[0.7rem] text-slate-400"
                                        >
                                            Todavía no hay servicios cargados.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Top facturas con saldo */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[0.8rem] font-semibold text-slate-100">
                            Facturas con saldo disponible
                        </h3>
                        <span className="text-[0.7rem] text-slate-400">
                            Lotes de servicio que aún tienen unidades por asignar.
                        </span>
                    </div>

                    <div className="space-y-2">
                        {facturas.map((f) => {
                            const disp =
                                f.disponible ??
                                (f.pagado != null && f.asignado != null
                                    ? (f.pagado || 0) - (f.asignado || 0)
                                    : 0);
                            const pct =
                                f.pagado > 0
                                    ? Math.round((f.asignado / f.pagado) * 100)
                                    : 0;

                            return (
                                <div
                                    key={f.servId}
                                    className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-[0.7rem]"
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-semibold text-slate-100">
                                                {f.numero}
                                            </div>
                                            <div className="text-[0.65rem] text-slate-400">
                                                {f.proveedor} · {f.tipo} · {f.fecha}
                                            </div>
                                        </div>
                                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[0.65rem] text-slate-200">
                                            ID #{f.servId}
                                        </span>
                                    </div>

                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                                            <div
                                                className="h-1.5 bg-emerald-500"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <span className="text-[0.65rem] text-slate-300">
                                            {pct}% consumido
                                        </span>
                                    </div>

                                    <div className="mt-2 grid grid-cols-3 gap-2 text-[0.65rem] text-slate-300">
                                        <div>
                                            <div className="text-slate-400">Pagado</div>
                                            <div className="font-medium">
                                                {format(f.pagado)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-slate-400">Asignado</div>
                                            <div className="font-medium text-emerald-300">
                                                {format(f.asignado)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-slate-400">Disponible</div>
                                            <div className="font-medium text-indigo-300">
                                                {format(disp)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {!facturas.length && (
                            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2 text-[0.7rem] text-slate-400">
                                No se encontraron facturas con saldo disponible.
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 🔹 Asignaciones recientes por OC */}
            <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[0.8rem] font-semibold text-slate-100">
                        Asignaciones recientes por OC
                    </h3>
                    <span className="text-[0.7rem] text-slate-400">
                        Últimos movimientos de consumo de servicios.
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-[0.7rem]">
                        <thead className="bg-slate-800/70 text-slate-200">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">OC</th>
                                <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Cant. asignada
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                    Facturas origen
                                </th>
                                <th className="px-2 py-1.5 text-left font-medium">
                                    Última asignación
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {asignacionesOC.map((r) => (
                                <tr
                                    key={`${r.ocId}-${r.tipo}`}
                                    className="border-t border-slate-800/70 bg-slate-900/40"
                                >
                                    <td className="px-2 py-1.5 font-medium text-slate-100">
                                        {r.ocId}
                                    </td>
                                    <td className="px-2 py-1.5">{r.tipo}</td>
                                    <td className="px-2 py-1.5 text-right text-emerald-300">
                                        {format(r.totalAsignado)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                        {r.facturasOrigen}
                                    </td>
                                    <td className="px-2 py-1.5">{r.ultimaFecha}</td>
                                </tr>
                            ))}

                            {!asignacionesOC.length && (
                                <tr>
                                    <td
                                        colSpan={5}
                                        className="px-3 py-3 text-center text-[0.7rem] text-slate-400"
                                    >
                                        No se encontraron asignaciones recientes.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="mt-2 text-[0.65rem] text-slate-400">
                    Más adelante podemos agregar filtros por rango de fecha, OC o tipo de
                    servicio; la estructura visual ya está lista.
                </p>
            </section>
        </div>
    );
}

export default InventarioServiciosPanel;
