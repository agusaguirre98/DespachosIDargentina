// src/Nacional/pages/InventarioServiciosPage.jsx

import React, { useEffect, useState } from "react";

const numberFmt = (n) =>
    Number(n || 0).toLocaleString("es-AR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

const pctFmt = (n) =>
    Number(n || 0).toLocaleString("es-AR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });

export default function InventarioServiciosPage() {
    const [data, setData] = useState({
        resumenGlobal: {
            totalPagado: 0,
            totalAsignado: 0,
            saldoDisponible: 0,
        },
        resumenPorTipo: [],
        resumenPorFactura: [],
        resumenPorOC: [],
    });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const cargarInventario = async () => {
        try {
            setLoading(true);
            setError("");
            const resp = await fetch("/api/servicios/inventario");
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
            const json = await resp.json();
            setData({
                resumenGlobal: json.resumenGlobal || {
                    totalPagado: 0,
                    totalAsignado: 0,
                    saldoDisponible: 0,
                },
                resumenPorTipo: json.resumenPorTipo || [],
                resumenPorFactura: json.resumenPorFactura || [],
                resumenPorOC: json.resumenPorOC || [],
            });
        } catch (e) {
            console.error("Error inventario servicios", e);
            setError("No se pudo obtener el inventario de servicios.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        cargarInventario();
    }, []);

    const { resumenGlobal, resumenPorTipo, resumenPorFactura, resumenPorOC } = data;

    const totalPagado = resumenGlobal.totalPagado || 0;
    const totalAsignado = resumenGlobal.totalAsignado || 0;
    const saldoDisponible = resumenGlobal.saldoDisponible || 0;
    const porcentajeConsumido =
        totalPagado > 0 ? (totalAsignado * 100) / totalPagado : 0;

    return (
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 px-6 lg:px-10 py-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-semibold">
                            Circuito Nacional · Gastos de servicio
                        </h1>
                        <p className="text-xs text-slate-400 mt-1">
                            Resumen de servicios pagados, asignados a órdenes de compra y
                            saldo disponible.
                        </p>
                    </div>
                    <button
                        onClick={cargarInventario}
                        disabled={loading}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium disabled:opacity-60"
                    >
                        {loading ? "Actualizando…" : "Actualizar"}
                    </button>
                </header>

                {error && (
                    <div className="rounded-lg border border-red-500/60 bg-red-900/40 px-4 py-3 text-xs text-red-100">
                        {error}
                    </div>
                )}

                {/* Tarjetas resumen */}
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 px-4 py-3">
                        <p className="text-[0.65rem] font-semibold tracking-wide text-slate-400 uppercase">
                            Servicios pagados
                        </p>
                        <p className="mt-2 text-2xl font-semibold">
                            {numberFmt(totalPagado)}
                        </p>
                        <p className="mt-1 text-[0.7rem] text-slate-400">
                            Unidades contabilizadas por facturas de servicio.
                        </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 px-4 py-3">
                        <p className="text-[0.65rem] font-semibold tracking-wide text-slate-400 uppercase">
                            Servicios asignados
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-400">
                            {numberFmt(totalAsignado)}
                        </p>
                        <p className="mt-1 text-[0.7rem] text-slate-400">
                            Consumidos y trazados contra órdenes de compra.
                        </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 px-4 py-3">
                        <p className="text-[0.65rem] font-semibold tracking-wide text-slate-400 uppercase">
                            Servicios disponibles
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-sky-400">
                            {numberFmt(saldoDisponible)}
                        </p>
                        <p className="mt-1 text-[0.7rem] text-slate-400">
                            Unidades aún no imputadas a OCs.
                        </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 px-4 py-3">
                        <p className="text-[0.65rem] font-semibold tracking-wide text-slate-400 uppercase">
                            Nivel de consumo
                        </p>
                        <p className="mt-2 text-2xl font-semibold">
                            {pctFmt(porcentajeConsumido)}%
                        </p>
                        <div className="mt-3 space-y-1.5">
                            <div className="flex justify-between text-[0.65rem] text-slate-400">
                                <span>Consumido</span>
                                <span>Disponible</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full"
                                    style={{ width: `${Math.min(porcentajeConsumido, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Panel central: por tipo + facturas con saldo */}
                <section className="grid gap-4 lg:grid-cols-2">
                    {/* Servicios por tipo */}
                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <p className="text-xs font-semibold text-slate-200">
                                    Servicios por tipo
                                </p>
                                <p className="text-[0.65rem] text-slate-500">
                                    Pagado, asignado y saldo por categoría.
                                </p>
                            </div>
                        </div>

                        <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-[0.7rem]">
                                <thead className="border-b border-white/5 text-slate-400">
                                    <tr>
                                        <th className="py-1.5 pr-2 text-left font-medium">Tipo</th>
                                        <th className="py-1.5 px-2 text-right font-medium">
                                            Pagado
                                        </th>
                                        <th className="py-1.5 px-2 text-right font-medium">
                                            Asignado
                                        </th>
                                        <th className="py-1.5 px-2 text-right font-medium">
                                            Disponible
                                        </th>
                                        <th className="py-1.5 pl-2 text-right font-medium">
                                            % consumo
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resumenPorTipo.length === 0 ? (
                                        <tr>
                                            <td
                                                colSpan={5}
                                                className="py-3 text-center text-[0.7rem] text-slate-500"
                                            >
                                                Todavía no hay servicios cargados.
                                            </td>
                                        </tr>
                                    ) : (
                                        resumenPorTipo.map((r) => {
                                            const pag = r.pagado || 0;
                                            const asig = r.asignado || 0;
                                            const disp = r.disponible || 0;
                                            const pct = pag > 0 ? (asig * 100) / pag : 0;
                                            return (
                                                <tr
                                                    key={r.tipo}
                                                    className="border-t border-white/5 hover:bg-slate-900/80"
                                                >
                                                    <td className="py-1.5 pr-2 text-slate-200">
                                                        {r.tipo}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right">
                                                        {numberFmt(pag)}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right text-emerald-300">
                                                        {numberFmt(asig)}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right text-sky-300">
                                                        {numberFmt(disp)}
                                                    </td>
                                                    <td className="py-1.5 pl-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-emerald-500"
                                                                    style={{
                                                                        width: `${Math.min(pct, 100)}%`,
                                                                    }}
                                                                />
                                                            </div>
                                                            <span className="w-10 text-right text-[0.65rem] text-slate-300">
                                                                {pctFmt(pct)}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Facturas con saldo disponible */}
                    <div className="rounded-2xl bg-slate-900/80 border border-white/5 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <p className="text-xs font-semibold text-slate-200">
                                    Facturas con saldo disponible
                                </p>
                                <p className="text-[0.65rem] text-slate-500">
                                    Lotes de servicio que aún tienen unidades por asignar.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3 mt-2">
                            {resumenPorFactura.length === 0 ? (
                                <p className="text-[0.7rem] text-slate-500">
                                    Todavía no hay facturas de servicio con saldo disponible.
                                </p>
                            ) : (
                                resumenPorFactura.map((f) => {
                                    const pag = f.pagado || 0;
                                    const asig = f.asignado || 0;
                                    const disp = pag - asig;
                                    const pct = pag > 0 ? (asig * 100) / pag : 0;
                                    return (
                                        <article
                                            key={f.servId}
                                            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-[0.72rem] font-semibold text-slate-100">
                                                        {f.numero}
                                                    </p>
                                                    <p className="text-[0.65rem] text-slate-400">
                                                        {f.proveedor} · {f.tipo} ·{" "}
                                                        {f.fecha ? String(f.fecha).slice(0, 10) : ""}
                                                    </p>
                                                </div>
                                                <span className="text-[0.65rem] text-slate-400">
                                                    ID #{f.servId}
                                                </span>
                                            </div>

                                            <div className="mt-2">
                                                <div className="flex justify-between text-[0.65rem] text-slate-400">
                                                    <span>Pagado</span>
                                                    <span>Asignado</span>
                                                    <span>Disponible</span>
                                                </div>
                                                <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                                    <div
                                                        className="h-full bg-emerald-500 rounded-full"
                                                        style={{
                                                            width: `${Math.min(pct, 100)}%`,
                                                        }}
                                                    />
                                                </div>
                                                <div className="mt-1 flex justify-between text-[0.65rem] text-slate-300">
                                                    <span>{numberFmt(pag)}</span>
                                                    <span>{numberFmt(asig)}</span>
                                                    <span>{numberFmt(disp)}</span>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </section>

                {/* Asignaciones recientes por OC */}
                <section className="rounded-2xl bg-slate-900/80 border border-white/5 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <p className="text-xs font-semibold text-slate-200">
                                Asignaciones recientes por OC
                            </p>
                            <p className="text-[0.65rem] text-slate-500">
                                Últimos movimientos de consumo de servicios.
                            </p>
                        </div>
                    </div>

                    <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-[0.7rem]">
                            <thead className="border-b border-white/5 text-slate-400">
                                <tr>
                                    <th className="py-1.5 px-2 text-left font-medium">OC</th>
                                    <th className="py-1.5 px-2 text-left font-medium">Tipo</th>
                                    <th className="py-1.5 px-2 text-right font-medium">
                                        Cant. asignada
                                    </th>
                                    <th className="py-1.5 px-2 text-right font-medium">
                                        Facturas origen
                                    </th>
                                    <th className="py-1.5 px-2 text-right font-medium">
                                        Última asignación
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {resumenPorOC.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="py-3 text-center text-[0.7rem] text-slate-500"
                                        >
                                            Todavía no se realizaron asignaciones de servicios a
                                            órdenes de compra.
                                        </td>
                                    </tr>
                                ) : (
                                    resumenPorOC.map((r, idx) => (
                                        <tr
                                            key={idx}
                                            className="border-t border-white/5 hover:bg-slate-900/80"
                                        >
                                            <td className="py-1.5 px-2">{r.ocId}</td>
                                            <td className="py-1.5 px-2">{r.tipo}</td>
                                            <td className="py-1.5 px-2 text-right">
                                                {numberFmt(r.totalAsignado)}
                                            </td>
                                            <td className="py-1.5 px-2 text-right">
                                                {r.facturasOrigen}
                                            </td>
                                            <td className="py-1.5 px-2 text-right">
                                                {r.ultimaFecha
                                                    ? String(r.ultimaFecha).slice(0, 10)
                                                    : "-"}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <p className="mt-2 text-[0.65rem] text-slate-500">
                        Más adelante podemos agregar filtros por rango de fecha, OC o tipo
                        de servicio; la estructura visual ya está lista.
                    </p>
                </section>
            </div>
        </div>
    );
}
