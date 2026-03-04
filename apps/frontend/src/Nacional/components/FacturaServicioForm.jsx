// src/Nacional/components/FacturaServicioForm.jsx

import React, { useEffect, useMemo, useState } from "react";
import { createFacturaServicio } from "../api/serviciosApi";

// Fallback local por si la API falla (así la UI no se rompe)
const FALLBACK_TIPOS_SERVICIO = [
    { id: "AVIOS", label: "Avíos" },
    { id: "ETIQUETAS", label: "Etiquetas" },
    { id: "PACKAGING", label: "Packaging" },
    { id: "SERV_LOGISTICA", label: "Servicio de logística" },
];

export function FacturaServicioForm({ onCreated }) {
    const [tiposServicio, setTiposServicio] = useState(FALLBACK_TIPOS_SERVICIO);

    const [form, setForm] = useState({
        TipoServicio: "AVIOS", // se ajusta cuando cargamos desde la API
        Proveedor: "",
        NumeroFactura: "",
        Fecha: "",
        CantidadTotal: "",
        ImporteTotal: "",
        Descripcion: "",
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [okMsg, setOkMsg] = useState("");

    // 🔹 Cargar tipos de servicio desde el backend
    useEffect(() => {
        const loadTipos = async () => {
            try {
                const res = await fetch("${BASE_URL}/api/servicios/tipos");
                if (!res.ok) throw new Error("No se pudieron cargar los tipos de servicio.");
                const data = await res.json();

                const mapped =
                    (data || []).map((t) => ({
                        id: t.codigo,
                        label: t.descripcion,
                    })) || [];

                if (mapped.length) {
                    setTiposServicio(mapped);
                    // Si el tipo actual no está en la lista, ponemos el primero
                    if (!mapped.some((t) => t.id === form.TipoServicio)) {
                        setForm((prev) => ({
                            ...prev,
                            TipoServicio: mapped[0].id,
                        }));
                    }
                }
            } catch (err) {
                console.error(err);
                // Dejamos el fallback y mostramos un warning suave en consola
            }
        };

        loadTipos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // sólo al montar

    const costoUnitarioPreview = useMemo(() => {
        const cant = parseFloat(form.CantidadTotal || 0);
        const imp = parseFloat(form.ImporteTotal || 0);
        if (!cant || !imp) return "";
        return (imp / cant).toFixed(4);
    }, [form.CantidadTotal, form.ImporteTotal]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
        setError("");
        setOkMsg("");
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setOkMsg("");

        if (!form.TipoServicio) return setError("Seleccioná el tipo de servicio.");
        if (!form.Proveedor?.trim())
            return setError("El proveedor es obligatorio.");
        if (!form.NumeroFactura?.trim())
            return setError("El número de factura es obligatorio.");
        if (!form.Fecha) return setError("La fecha es obligatoria.");

        const cant = parseFloat(form.CantidadTotal);
        const imp = parseFloat(form.ImporteTotal);
        if (!cant || cant <= 0)
            return setError("La cantidad total debe ser mayor a 0.");
        if (!imp || imp <= 0)
            return setError("El importe total debe ser mayor a 0.");

        const payload = {
            TipoServicio: form.TipoServicio,
            Proveedor: form.Proveedor.trim(),
            NumeroFactura: form.NumeroFactura.trim(),
            Fecha: form.Fecha,
            CantidadTotal: cant,
            ImporteTotal: imp,
            Descripcion: form.Descripcion?.trim() || "",
        };

        try {
            setLoading(true);
            const nueva = await createFacturaServicio(payload);
            setOkMsg("Factura creada correctamente.");
            setForm((prev) => ({
                ...prev,
                NumeroFactura: "",
                CantidadTotal: "",
                ImporteTotal: "",
                Descripcion: "",
            }));
            onCreated?.(nueva);
        } catch (err) {
            console.error(err);
            setError(err.message || "Error al crear la factura.");
        } finally {
            setLoading(false);
        }
    };

    const inputClasses =
        "w-full rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60";

    return (
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
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
                    Tipo de servicio
                </label>
                <select
                    name="TipoServicio"
                    value={form.TipoServicio}
                    onChange={handleChange}
                    className={inputClasses}
                >
                    {tiposServicio.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* resto del formulario igual que antes… */}
            {/* Proveedor */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Proveedor
                </label>
                <input
                    type="text"
                    name="Proveedor"
                    value={form.Proveedor}
                    onChange={handleChange}
                    placeholder="Nombre del proveedor"
                    className={inputClasses}
                />
            </div>

            {/* Número de factura */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Número de factura
                </label>
                <input
                    type="text"
                    name="NumeroFactura"
                    value={form.NumeroFactura}
                    onChange={handleChange}
                    placeholder="0001-00012345"
                    className={inputClasses}
                />
            </div>

            {/* Fecha */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Fecha
                </label>
                <input
                    type="date"
                    name="Fecha"
                    value={form.Fecha}
                    onChange={handleChange}
                    className={inputClasses}
                />
            </div>

            {/* Cantidad / Importe */}
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                        Cantidad total (unidades)
                    </label>
                    <input
                        type="number"
                        name="CantidadTotal"
                        value={form.CantidadTotal}
                        onChange={handleChange}
                        min="0"
                        step="1"
                        className={inputClasses}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                        Importe total
                    </label>
                    <input
                        type="number"
                        name="ImporteTotal"
                        value={form.ImporteTotal}
                        onChange={handleChange}
                        min="0"
                        step="0.01"
                        className={inputClasses}
                    />
                </div>
            </div>

            {/* Descripción */}
            <div className="flex flex-col gap-1">
                <label className="text-[0.7rem] uppercase tracking-wide text-slate-400">
                    Descripción (opcional)
                </label>
                <textarea
                    name="Descripcion"
                    value={form.Descripcion}
                    onChange={handleChange}
                    rows={2}
                    className={inputClasses + " resize-y"}
                />
            </div>

            {costoUnitarioPreview && (
                <p className="text-[0.7rem] text-slate-300">
                    Costo unitario estimado:{" "}
                    <span className="font-semibold text-indigo-300">
                        {costoUnitarioPreview}
                    </span>
                </p>
            )}

            <button
                type="submit"
                disabled={loading}
                className="mt-1 inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-[0.78rem] font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
            >
                {loading ? "Guardando…" : "Guardar factura"}
            </button>
        </form>
    );
}
