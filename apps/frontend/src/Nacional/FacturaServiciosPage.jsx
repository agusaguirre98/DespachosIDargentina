// src/Nacional/FacturaServiciosPage.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    fetchFacturasServicios,
    fetchTiposServicio,
} from "./api/serviciosApi";
import { FacturaServicioForm } from "./components/FacturaServicioForm";
import { AsignarOCForm } from "./components/AsignarOCForm";
import { InventarioServiciosPanel } from "./components/InventarioServiciosPanel";

function FacturaServiciosPage() {
    const navigate = useNavigate();

    const [vista, setVista] = useState("tabla"); // 'tabla' | 'nueva' | 'asignar' | 'inventario'
    const [facturas, setFacturas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [tiposServicio, setTiposServicio] = useState([]);
    const [filtroTipo, setFiltroTipo] = useState("");
    const [soloConSaldo, setSoloConSaldo] = useState(false);

    // ========= Helpers de formato =========
    const formatNumber = (n) =>
        Number(n || 0).toLocaleString("es-AR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });

    // ========= Cargar tipos de servicio una vez =========
    useEffect(() => {
        const loadTipos = async () => {
            try {
                const data = await fetchTiposServicio();
                setTiposServicio(data || []);
            } catch (err) {
                console.error(err);
                setError(
                    err.message || "No se pudieron cargar los tipos de servicio."
                );
            }
        };
        loadTipos();
    }, []);

    // ========= Cargar facturas según filtros =========
    const cargarFacturas = async () => {
        try {
            setLoading(true);
            setError("");

            // Sólo mandamos conSaldo cuando el usuario marca el checkbox
            const data = await fetchFacturasServicios({
                tipo: filtroTipo || undefined,
                conSaldo: soloConSaldo ? true : undefined,
            });

            setFacturas(data || []);
        } catch (err) {
            console.error(err);
            setError(err.message || "Error al cargar facturas de servicio.");
            setFacturas([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (vista === "tabla") {
            cargarFacturas();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vista, filtroTipo, soloConSaldo]);

    const handleFacturaCreated = () => {
        setVista("tabla");
    };

    const totalPagado = useMemo(
        () => facturas.reduce((acc, f) => acc + (f.CantidadTotal || 0), 0),
        [facturas]
    );
    const totalAsignado = useMemo(
        () => facturas.reduce((acc, f) => acc + (f.CantidadAsignada || 0), 0),
        [facturas]
    );

    // ========= Render según vista =========
    const renderContenido = () => {
        if (vista === "nueva") {
            return (
                <section className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-sm lg:p-6">
                    <h2 className="mb-3 text-sm font-semibold text-slate-100">
                        Nueva factura de servicio
                    </h2>
                    <FacturaServicioForm onCreated={handleFacturaCreated} />
                </section>
            );
        }

        if (vista === "asignar") {
            return (
                <section className="mx-auto max-w-4xl">
                    <AsignarOCForm />
                </section>
            );
        }

        if (vista === "inventario") {
            // Por ahora, InventarioServiciosPanel usa sus propios mocks si no le pasamos props
            return <InventarioServiciosPanel />;
        }

        // ======== vista === 'tabla' ========
        return (
            <section className="space-y-4">
                {/* Filtros */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-xs">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                                Tipo de servicio
                            </label>
                            <select
                                value={filtroTipo}
                                onChange={(e) => setFiltroTipo(e.target.value)}
                                className="min-w-[180px] rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60"
                            >
                                <option value="">Todos</option>
                                {tiposServicio.map((t) => (
                                    <option key={t.codigo} value={t.codigo}>
                                        {t.descripcion}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <label className="flex items-center gap-2 text-[0.75rem] text-slate-300">
                            <input
                                type="checkbox"
                                checked={soloConSaldo}
                                onChange={(e) => setSoloConSaldo(e.target.checked)}
                                className="h-3 w-3 rounded border-slate-500 bg-slate-900"
                            />
                            Sólo facturas con saldo disponible
                        </label>

                        <div className="ml-auto flex flex-wrap gap-4 text-[0.75rem] text-slate-300">
                            <span>
                                Total pagado:{" "}
                                <span className="font-semibold text-slate-50">
                                    {formatNumber(totalPagado)}
                                </span>
                            </span>
                            <span>
                                Total asignado:{" "}
                                <span className="font-semibold text-emerald-300">
                                    {formatNumber(totalAsignado)}
                                </span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Tabla de facturas */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-xs">
                    {loading && (
                        <div className="py-6 text-center text-[0.8rem] text-slate-300">
                            Cargando facturas…
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg border border-red-500/60 bg-red-900/40 px-3 py-2 text-[0.75rem] text-red-100">
                            {error}
                        </div>
                    )}

                    {!loading && !error && !facturas.length && (
                        <div className="py-6 text-center text-[0.8rem] text-slate-400">
                            No se encontraron facturas con los filtros actuales.
                        </div>
                    )}

                    {!loading && !error && facturas.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-[0.75rem]">
                                <thead className="bg-slate-800/80 text-slate-200">
                                    <tr>
                                        <th className="px-2 py-2 text-left font-medium">ID</th>
                                        <th className="px-2 py-2 text-left font-medium">Tipo</th>
                                        <th className="px-2 py-2 text-left font-medium">
                                            Proveedor
                                        </th>
                                        <th className="px-2 py-2 text-left font-medium">
                                            Nº factura
                                        </th>
                                        <th className="px-2 py-2 text-left font-medium">Fecha</th>
                                        <th className="px-2 py-2 text-right font-medium">
                                            Cant. total
                                        </th>
                                        <th className="px-2 py-2 text-right font-medium">
                                            Asignada
                                        </th>
                                        <th className="px-2 py-2 text-right font-medium">
                                            Disponible
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {facturas.map((f) => {
                                        const id = f.ServID ?? f.SERV_ID;
                                        const disponible =
                                            (f.CantidadTotal || 0) - (f.CantidadAsignada || 0);

                                        return (
                                            <tr
                                                key={id}
                                                className="border-t border-slate-800/70 bg-slate-900/40"
                                            >
                                                <td className="px-2 py-1.5 text-slate-300">{id}</td>
                                                <td className="px-2 py-1.5 text-slate-100">
                                                    {f.TipoServicio}
                                                </td>
                                                <td className="px-2 py-1.5">{f.Proveedor}</td>
                                                <td className="px-2 py-1.5">{f.NumeroFactura}</td>
                                                <td className="px-2 py-1.5">
                                                    {String(f.Fecha).substring(0, 10)}
                                                </td>
                                                <td className="px-2 py-1.5 text-right">
                                                    {formatNumber(f.CantidadTotal)}
                                                </td>
                                                <td className="px-2 py-1.5 text-right text-emerald-300">
                                                    {formatNumber(f.CantidadAsignada)}
                                                </td>
                                                <td className="px-2 py-1.5 text-right text-indigo-300">
                                                    {formatNumber(disponible)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>
        );
    };

    return (
        <div className="min-h-screen w-screen bg-slate-950 text-slate-100">
            <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/80 backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <h1 className="text-2xl font-bold tracking-tight">
                        Circuito Nacional · Gastos de servicio
                    </h1>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-600"
                            onClick={() => navigate("/")}
                        >
                            ← Inicio
                        </button>
                        <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${vista === "tabla"
                                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                                    : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                                }`}
                            onClick={() => setVista("tabla")}
                        >
                            Ver facturas
                        </button>
                        <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${vista === "nueva"
                                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                                    : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                                }`}
                            onClick={() => setVista("nueva")}
                        >
                            Nueva factura
                        </button>
                        <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${vista === "asignar"
                                    ? "bg-fuchsia-600 text-white hover:bg-fuchsia-500"
                                    : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                                }`}
                            onClick={() => setVista("asignar")}
                        >
                            Asignar OC
                        </button>
                        <button
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${vista === "inventario"
                                    ? "bg-sky-600 text-white hover:bg-sky-500"
                                    : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                                }`}
                            onClick={() => setVista("inventario")}
                        >
                            Inventario
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-6 py-6 lg:py-8">
                {renderContenido()}
            </main>
        </div>
    );
}

export default FacturaServiciosPage;
export { FacturaServiciosPage };
