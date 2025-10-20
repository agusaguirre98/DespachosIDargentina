import React, { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import FormularioFacturaNacional from "../components/FormularioFacturaNacional.jsx";

const LS_KEY = "gn_facturas_nacionales_v1";

// Util format
const money = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 });

export default function GastosNacionales() {
  const navigate = useNavigate();

  // Guardamos facturas nacionales planas y derivamos la grilla por OC
  const [facturas, setFacturas] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [openNueva, setOpenNueva] = useState(false);
  const [expandedOC, setExpandedOC] = useState(null); // para ver facturas de una OC

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(facturas));
  }, [facturas]);

  // Derivar filas por OC (lo mínimo para cumplir columnas pedidas)
  // - ID = OC_ID
  // - Proveedor/Tipo/Fecha: tomamos el más reciente para mostrar en la lista
  const rows = useMemo(() => {
    const byOC = new Map(); // ocId -> { ocId, vinculos, lastFactura }
    for (const f of facturas) {
      for (const oc of f.ocIds) {
        const curr = byOC.get(oc) || { ocId: oc, vinculos: 0, lastFactura: null, hasAdjunto: false };
        const fecha = f.fecha || "";
        const last = curr.lastFactura;
        const newer = !last || (fecha && fecha > (last.fecha || ""));
        const next = {
          ...curr,
          vinculos: curr.vinculos + 1,
          hasAdjunto: curr.hasAdjunto || !!f.hasDoc,
          lastFactura: newer ? f : last,
        };
        byOC.set(oc, next);
      }
    }
    return Array.from(byOC.values())
      .sort((a, b) => String(a.ocId).localeCompare(String(b.ocId), "es", { numeric: true }));
  }, [facturas]);

  // Alta: el form devuelve un objeto factura con ocIds (múltiple)
  const handleGuardarFactura = (payload) => {
    setFacturas((prev) => [
      {
        id: crypto.randomUUID(),
        ...payload,
      },
      ...prev,
    ]);
    setOpenNueva(false);
  };

  // Borrar TODAS las facturas de una OC (acción rápida para pruebas)
  const deleteOCGroup = (ocId) => {
    if (!confirm(`¿Eliminar todas las facturas vinculadas a la OC ${ocId}?`)) return;
    setFacturas((prev) => prev.filter((f) => !f.ocIds.includes(ocId)));
    if (expandedOC === ocId) setExpandedOC(null);
  };

  return (
    <div className="min-h-screen w-screen bg-teal-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-teal-200 bg-teal-200/70 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Gastos Nacionales</h1>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-white font-medium hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
              onClick={() => navigate("/")}
              title="Volver al inicio"
            >
              ← Inicio
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              onClick={() => setOpenNueva(true)}
              title="Crear nueva factura"
            >
              Nueva Factura
            </button>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-[1600px] mx-auto px-6 lg:px-8 py-6">
        <div className="rounded-xl border border-teal-200 bg-teal-100/60 overflow-hidden shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-teal-200/50">
              <tr className="text-left text-slate-700">
                <th className="py-2 px-3 w-10"></th>
                <th className="py-2 px-3">ID</th>
                <th className="py-2 px-3">OC</th>
                <th className="py-2 px-3">Proveedor</th>
                <th className="py-2 px-3">Tipo</th>
                <th className="py-2 px-3">Fecha</th>
                <th className="py-2 px-3">Adjunto</th>
                <th className="py-2 px-3">Vínculos</th>
                <th className="py-2 px-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 px-3 text-center text-slate-600">
                    Aun no hay facturas. Carga una con "Nueva Factura".
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const last = r.lastFactura || {};
                const isOpen = expandedOC === r.ocId;
                return (
                  <Fragment key={r.ocId}>
                    <tr className="border-t border-teal-200">
                      <td className="py-2 px-3">
                        <button
                          className="px-2 py-1 rounded bg-teal-200/40 text-slate-700 hover:bg-teal-200/60"
                          onClick={() => setExpandedOC(isOpen ? null : r.ocId)}
                          title={isOpen ? "Contraer" : "Ver facturas de la OC"}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="py-2 px-3">{r.ocId}</td>
                      <td className="py-2 px-3 font-medium">OC-{r.ocId}</td>
                      <td className="py-2 px-3">{last.proveedor || <span className="text-slate-600 text-xs">—</span>}</td>
                      <td className="py-2 px-3">
                        {last.tipoGasto
                          ? <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-indigo-200/80 border border-indigo-300 text-indigo-900">{last.tipoGasto}</span>
                          : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="py-2 px-3">{last.fecha || <span className="text-slate-600 text-xs">—</span>}</td>
                      <td className="py-2 px-3">
                        {r.hasAdjunto ? (
                          <span className="text-indigo-700 text-xs">Adjunto disponible</span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-400/40">
                          {r.vinculos} factura{r.vinculos === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <button
                          className="px-2 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500"
                          onClick={() => setExpandedOC(isOpen ? null : r.ocId)}
                        >
                          Ver facturas
                        </button>
                        <button
                          className="ml-2 px-2 py-1.5 rounded-lg bg-rose-700 text-white font-medium hover:bg-rose-600"
                          onClick={() => deleteOCGroup(r.ocId)}
                          title="Eliminar todas las facturas de esta OC (solo mock/local)"
                        >
                          Eliminar OC
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-teal-100/60">
                        <td colSpan={9} className="p-0">
                          <div className="p-4">
                            <div className="text-sm font-semibold mb-2">Facturas de OC-{r.ocId}</div>
                            <div className="overflow-x-auto rounded border border-teal-200">
                              <table className="min-w-full text-xs">
                                <thead className="bg-teal-200/40">
                                  <tr>
                                    <th className="text-left p-2">Fecha</th>
                                    <th className="text-left p-2">Proveedor</th>
                                    <th className="text-left p-2">N° Factura</th>
                                    <th className="text-left p-2">Tipo Gasto</th>
                                    <th className="text-left p-2">Moneda</th>
                                    <th className="text-right p-2">Importe</th>
                                    <th className="text-left p-2">Adjunto</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {facturas
                                    .filter((f) => f.ocIds.includes(r.ocId))
                                    .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""))
                                    .map((f) => (
                                      <tr key={f.id} className="border-t border-teal-200">
                                        <td className="p-2">{f.fecha || ""}</td>
                                        <td className="p-2">{f.proveedor || ""}</td>
                                        <td className="p-2">{f.nroFactura || ""}</td>
                                        <td className="p-2">{f.tipoGasto || ""}</td>
                                        <td className="p-2">{f.moneda || "ARS"}</td>
                                        <td className="p-2 text-right">{money(f.importe)}</td>
                                        <td className="p-2">
                                          {f.hasDoc ? (
                                            <span className="text-indigo-700">Adjunto disponible</span>
                                          ) : (
                                            <span className="text-slate-500">—</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal/Nueva */}
      {openNueva && (
        <FormularioFacturaNacional
          onCancel={() => setOpenNueva(false)}
          onSave={handleGuardarFactura}
        />
      )}
    </div>
  );
}



