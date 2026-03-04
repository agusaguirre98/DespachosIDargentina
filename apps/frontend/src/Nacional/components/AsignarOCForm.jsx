// src/Nacional/components/AsignarOCForm.jsx

import React, { useEffect, useMemo, useState } from "react";
import {
    createAsignacionOC,
    fetchFacturasServicios,
    fetchTiposServicio,
} from "../api/serviciosApi";

// Reutilizamos el buscador de OC de Comercio Exterior
import OCSearchSelect from "../../components/OCSearchSelect";

export function AsignarOCForm() {
    const [tiposServicio, setTiposServicio] = useState([]);
    const [tipoServicio, setTipoServicio] = useState("");
    const [facturas, setFacturas] = useState([]);
    const [loadingFacturas, setLoadingFacturas] = useState(false);
    const [selectedServId, setSelectedServId] = useState("");

    // OC seleccionada (lo que devuelva OCSearchSelect)
    const [selectedOc, setSelectedOc] = useState(null);

    const [cantidad, setCantidad] = useState("");
    const [comentario, setComentario] = useState("");

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [okMsg, setOkMsg] = useState("");

    // 1) Cargar tipos de servicio desde el back
    useEffect(() => {
        const loadTipos = async () => {
            try {
                const data = await fetchTiposServicio();
                setTiposServicio(data || []);
                if (data?.length && !tipoServicio) {
                    setTipoServicio(data[0].codigo);
                }
            } catch (err) {
                console.error(err);
                setError(
                    err.message ||
                    "No se pudieron cargar los tipos de servicio desde el servidor."
                );
            }
        };
        loadTipos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2) Cargar facturas con saldo para el tipo seleccionado
    useEffect(() => {
        if (!tipoServicio) {
            setFacturas([]);
            setSelectedServId("");
            return;
        }

        const load = async () => {
            setLoadingFacturas(true);
            setError("");
            setOkMsg("");
            try {
                const data = await fetchFacturasServicios({
                    tipo: tipoServicio,
                    conSaldo: true,
                });
                setFacturas(data || []);
                if (data?.length) {
                    setSelectedServId(String(data[0].ServID ?? data[0].SERV_ID ?? ""));
                } else {
                    setSelectedServId("");
                }
            } catch (err) {
                console.error(err);
                setError(err.message || "Error al cargar facturas con saldo.");
                setFacturas([]);
                setSelectedServId("");
            } finally {
                setLoadingFacturas(false);
            }
        };
        load();
    }, [tipoServicio]);

    const selectedFactura = useMemo(
        () =>
            facturas.find(
                (f) => String(f.ServID ?? f.SERV_ID) === String(selectedServId)
            ),
        [facturas, selectedServId]
    );

    const disponible = useMemo(() => {
        if (!selectedFactura) return 0;
        return (
            (selectedFactura.CantidadTotal || 0) -
            (selectedFactura.CantidadAsignada || 0)
        );
    }, [selectedFactura]);

    // -------- Helper OC --------
    const getOcIdFromSelection = (sel) => {
        if (!sel) return "";

        // Si viene como array (por si el componente es multi)
        if (Array.isArray(sel)) {
            if (!sel.length) return "";
            return getOcIdFromSelection(sel[0]);
        }

        // String directo
        if (typeof sel === "string") {
            return sel;
        }

        // Objeto plano de OC
        if (sel.OC_ID || sel.REFERENCIA || sel.oc_id || sel.ocId) {
            return sel.OC_ID || sel.REFERENCIA || sel.oc_id || sel.ocId || "";
        }

        // Opción react-select { value, label, oc? }
        if (sel.value) {
            // Si viene anidado
            if (sel.oc) {
                return (
                    sel.oc.OC_ID ||
                    sel.oc.REFERENCIA ||
                    sel.value ||
                    ""
                );
            }
            // value solo ya es el id
            return sel.value || "";
        }

        return "";
    };

    const ocId = useMemo(() => getOcIdFromSelection(selectedOc), [selectedOc]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setOkMsg("");

        if (!selectedServId) {
            return setError("Seleccioná una factura de servicio.");
        }

        if (!ocId) {
            return setError("Seleccioná una Orden de Compra válida.");
        }

        const cant = parseFloat(cantidad);
        if (!cant || cant <= 0) {
            return setError("La cantidad a asignar debe ser mayor a 0.");
        }
        if (cant > disponible) {
            return setError(
                "La cantidad a asignar no puede superar el saldo disponible."
            );
        }

        const payload = {
            SERV_ID: Number(selectedServId),
            OC_ID: ocId.trim(),
            CantidadAsignada: cant,
            Comentario: comentario?.trim() || "",
        };

        try {
            setSaving(true);
            await createAsignacionOC(payload);
            setOkMsg("Asignación creada correctamente.");
            setCantidad("");
            setComentario("");
            // dejamos la OC seleccionada para seguir usando la misma
        } catch (err) {
            console.error(err);
            setError(err.message || "Error al crear la asignación a OC.");
        } finally {
            setSaving(false);
        }
    };

    const inputClasses =
        "w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60";

    return (
        <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow-sm lg:p-5 text-xs"
        >
            <h2 className="mb-1 text-sm font-semibold text-slate-100">
                Asignar servicios a OC
            </h2>

            {error && (
                <div className="rounded-lg border border-red-500/60 bg-red-900/40 px-3 py-2 text-[0.7rem] text-red-100">
                    {error}
                </div>
            )}
            {okMsg && (
                <div className="rounded-lg border border-emerald-500/60 bg-emerald-900/40 px-3 py-2 text-[0.7rem] text-emerald-100">
                    {okMsg}
                </div>
            )}

            {/* Tipo de servicio */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Tipo de gasto / servicio
                </label>
                <select
                    value={tipoServicio}
                    onChange={(e) => setTipoServicio(e.target.value)}
                    className={inputClasses}
                >
                    {tiposServicio.map((t) => (
                        <option key={t.codigo} value={t.codigo}>
                            {t.descripcion}
                        </option>
                    ))}
                </select>
            </div>

            {/* Factura */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Factura de servicio (con saldo)
                </label>
                <select
                    value={selectedServId}
                    onChange={(e) => setSelectedServId(e.target.value)}
                    disabled={loadingFacturas || !facturas.length}
                    className={inputClasses}
                >
                    {loadingFacturas && <option>Cargando…</option>}
                    {!loadingFacturas && !facturas.length && (
                        <option value="">No hay facturas con saldo para este tipo</option>
                    )}
                    {!loadingFacturas &&
                        facturas.map((f) => {
                            const disp =
                                (f.CantidadTotal || 0) - (f.CantidadAsignada || 0);
                            const label = `${f.NumeroFactura} · ${f.Proveedor} · Disp: ${disp}`;
                            const id = String(f.ServID ?? f.SERV_ID);
                            return (
                                <option key={id} value={id}>
                                    {label}
                                </option>
                            );
                        })}
                </select>
            </div>

            {/* Resumen factura seleccionada */}
            {selectedFactura && (
                <div className="grid gap-2 rounded-lg border border-slate-700/70 bg-slate-950/40 p-3 text-[0.7rem] sm:grid-cols-2">
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Nº Factura
                        </span>
                        <span className="font-medium text-slate-100">
                            {selectedFactura.NumeroFactura}
                        </span>
                    </div>
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Fecha
                        </span>
                        <span>{selectedFactura.Fecha}</span>
                    </div>
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Cantidad total
                        </span>
                        <span>{selectedFactura.CantidadTotal}</span>
                    </div>
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Asignada
                        </span>
                        <span>{selectedFactura.CantidadAsignada || 0}</span>
                    </div>
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Disponible
                        </span>
                        <span className="font-semibold text-emerald-300">
                            {disponible}
                        </span>
                    </div>
                    <div>
                        <span className="block text-[0.65rem] uppercase tracking-wide text-slate-500">
                            Costo unitario
                        </span>
                        <span>
                            {selectedFactura.CostoUnitario != null
                                ? Number(selectedFactura.CostoUnitario).toFixed(4)
                                : "—"}
                        </span>
                    </div>
                </div>
            )}

            {/* OC + cantidad */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                        OC a asignar
                    </label>

                    <OCSearchSelect
                        value={selectedOc}
                        onChange={setSelectedOc}
                        disabled={saving}
                        placeholder="Buscar OC por referencia, proveedor, etc."
                    />

                    {/* 🔥 OC seleccionada resaltada (solo si hay selección) */}
                    {ocId ? (
                        <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-900/20 px-3 py-2 text-[0.75rem] text-emerald-300">
                            <span className="font-semibold">OC seleccionada:</span>{" "}
                            {ocId}
                        </div>
                    ) : (
                        <span className="text-[0.65rem] text-slate-500">
                            Sin OC seleccionada
                        </span>
                    )}
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                        Cantidad a asignar
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={cantidad}
                        onChange={(e) => setCantidad(e.target.value)}
                        className={inputClasses}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Comentario (opcional)
                </label>
                <textarea
                    rows={2}
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    className={inputClasses + " resize-y"}
                />
            </div>

            <div className="pt-1">
                <button
                    type="submit"
                    disabled={saving || !selectedServId}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-[0.78rem] font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60"
                >
                    {saving ? "Guardando asignación…" : "Asignar a OC"}
                </button>
            </div>
        </form>
    );
}
