import React, { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import BuscadorYTotalizador from "./BuscadorYTotalizador";

/**
 * Panel de retiros para ZFE.
 *
 * Props:
 * - zfeId: number | null
 * - ocId:  string|number
 * - modoCreacion?: boolean
 * - onDraftChange?: (items) => void
 */
export default function ZFERetiroPanel({ zfeId, ocId, modoCreacion = false, onDraftChange }) {
  const { get, post } = useApi();

  const [zfiId, setZfiId] = useState(null);
  const [saldo, setSaldo] = useState([]);     // [{SKU,Talle,Descripcion, Saldo}]
  const [retiros, setRetiros] = useState([]); // mismo shape + CantidadRetiro
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // --- Búsqueda ---
  const [q, setQ] = useState("");

  const normalizar = (s = "") =>
    s.toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

  const filtered = useMemo(() => {
    if (!q?.trim()) return retiros;
    const n = normalizar(q);
    return retiros.filter((r) => {
      const blob = `${r.SKU} ${r.Talle || ""} ${r.Descripcion || ""}`;
      return normalizar(blob).includes(n);
    });
  }, [retiros, q]);

  // === Resolver ZFI_ID a partir de OC (con fallback) ===
  const fetchZFIFromOC = async () => {
    const oc = encodeURIComponent(ocId ?? "");
    // 1) intentar por grupo (lo “oficial” del flujo)
    const j = await get(`/zf/grupos?oc_id=${oc}`);
    const gid = Array.isArray(j?.items) ? j.items[0] : null;
    const viaGrupo = gid?.ZFI?.ZFI_ID || null;
    if (viaGrupo) return viaGrupo;

    // 2) fallback: buscar ZFIs por esa OC (más reciente primero)
    const j2 = await get(`/zf/zfis?oc_id=${oc}`);
    const items = Array.isArray(j2?.items) ? j2.items : [];
    if (items.length) return items[0].ZFI_ID;

    throw new Error("No se encontró el ZFI vinculado a esta OC.");
  };

  const loadData = async () => {
    const ocOk = (ocId ?? "").toString().trim();
    if (!ocOk) return;

    setCargando(true);
    setMensaje("");
    try {
      // 1) ZFI a partir de OC
      const _zfiId = await fetchZFIFromOC();
      setZfiId(_zfiId);

      // 2) Ítems con saldo por SKU/Talle (CantidadActual)
      const r = await get(`/zf/inventario/${_zfiId}/items`);
      if (!r?.ok) throw new Error(r?.error || "Error obteniendo ítems del ZFI.");
      const items = Array.isArray(r.items) ? r.items : [];

      // 3) Si estamos editando un ZFE existente, cargar retiros previos
      let prevMap = {};
      if (zfeId) {
        const prev = await get(`/zf/zfe/${zfeId}/lines`);
        (prev?.items || []).forEach((it) => {
          prevMap[`${it.SKU}__${it.Talle || ""}`] = it.CantidadRetiro;
        });
      }

      // 4) Merge + mapeo: CantidadActual -> Saldo
      const merged = items.map((it) => ({
        SKU: it.SKU,
        Talle: it.Talle || "",
        Descripcion: it.Descripcion ?? "",
        Saldo: Number(it.CantidadActual || 0),
        CantidadRetiro: prevMap[`${it.SKU}__${it.Talle || ""}`] ?? "", // string para input
      }));

      setSaldo(merged);
      setRetiros(merged);

      // notificar draft al padre (modo creación)
      if (modoCreacion && typeof onDraftChange === "function") {
        const draft = merged
          .filter((x) => parseFloat(x.CantidadRetiro) > 0)
          .map((x) => toPayloadLine(_zfiId, x));
        onDraftChange(draft);
      }
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
      setSaldo([]);
      setRetiros([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocId, zfeId]);

  const toPayloadLine = (zfiIdLocal, r) => ({
    ZFI_ID: zfiIdLocal,
    SKU: r.SKU,
    Talle: r.Talle || "",
    Descripcion: r.Descripcion || "",
    CantidadRetiro: parseFloat(r.CantidadRetiro || 0),
  });

  // Totales globales (no solo filtrados)
  const totals = useMemo(() => {
    const totalSaldo = saldo.reduce((acc, r) => acc + (parseFloat(r.Saldo) || 0), 0);
    const totalRetiro = retiros.reduce((acc, r) => acc + (parseFloat(r.CantidadRetiro) || 0), 0);
    const filasSeleccionadas = retiros.filter((r) => parseFloat(r.CantidadRetiro) > 0).length;
    return { totalSaldo, totalRetiro, filasSeleccionadas };
  }, [saldo, retiros]);

  const handleChange = (idx, value) => {
    const v = value === "" ? "" : Number(value);
    const arr = [...retiros];
    // clamp 0..Saldo
    const disponible = parseFloat(arr[idx].Saldo || 0);
    let nv = Number.isFinite(v) ? Math.floor(Math.max(0, v)) : "";
    if (nv !== "" && Number.isFinite(disponible)) {
      nv = Math.min(nv, disponible);
    }
    arr[idx].CantidadRetiro = nv;
    setRetiros(arr);

    if (modoCreacion && typeof onDraftChange === "function" && zfiId) {
      const draft = arr
        .filter((x) => parseFloat(x.CantidadRetiro) > 0)
        .map((x) => toPayloadLine(zfiId, x));
      onDraftChange(draft);
    }
  };

  // Acciones rápidas
  const limpiarSeleccion = () => {
    if (!retiros.length) return;
    const next = retiros.map((r) => ({ ...r, CantidadRetiro: "" }));
    setRetiros(next);
    if (modoCreacion && onDraftChange && zfiId) onDraftChange([]);
  };

  const llenarConDisponiblesFiltrados = () => {
    if (!filtered.length) return;
    const map = new Map(filtered.map((r) => [`${r.SKU}__${r.Talle || ""}`, r]));
    const next = retiros.map((r) => {
      const key = `${r.SKU}__${r.Talle || ""}`;
      if (!map.has(key)) return r;
      const disponible = parseFloat(r.Saldo || 0) || 0;
      return { ...r, CantidadRetiro: Math.max(0, Math.floor(disponible)) };
    });
    setRetiros(next);

    if (modoCreacion && typeof onDraftChange === "function" && zfiId) {
      const draft = next
        .filter((x) => parseFloat(x.CantidadRetiro) > 0)
        .map((x) => toPayloadLine(zfiId, x));
      onDraftChange(draft);
    }
  };

  const handleSave = async () => {
    if (modoCreacion || !zfeId) {
      setMensaje("⚠️ Guardá el despacho primero para poder registrar los retiros.");
      return;
    }
    if (!zfiId) {
      setMensaje("❌ No se encontró el ZFI vinculado.");
      return;
    }

    // validar excedentes antes de enviar
    for (const r of retiros) {
      const disponible = parseFloat(r.Saldo || 0);
      const retirar = parseFloat(r.CantidadRetiro || 0);
      if (retirar > disponible) {
        setMensaje(`❌ No hay saldo suficiente para ${r.SKU} ${r.Talle || ""}.`);
        return;
      }
    }

    const items = retiros
      .filter((r) => parseFloat(r.CantidadRetiro) > 0)
      .map((r) => toPayloadLine(zfiId, r));

    if (!items.length) {
      setMensaje("No hay cantidades para guardar.");
      return;
    }

    setGuardando(true);
    setMensaje("");
    try {
      const resp = await post(`/zf/zfe/${zfeId}/lines`, { items });
      if (!resp?.ok) throw new Error(resp?.error || "Error al guardar retiros.");
      setMensaje(`✅ ${resp.inserted ?? items.length} líneas guardadas correctamente.`);
      await loadData();
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  const ocLabel = (ocId ?? "").toString().trim();

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-400">
          Fuente: OC #{ocLabel || "—"}. Unidades en <strong>UNIDADES</strong>.
        </span>
      </div>

      {/* Barra con búsqueda + totalizador + acciones */}
      <BuscadorYTotalizador
        q={q}
        onChangeQ={setQ}
        totalFilas={totals.filasSeleccionadas}
        totalUnidades={totals.totalRetiro}
        onRefrescar={loadData}
        cargando={cargando}
        onGuardar={handleSave}
        guardando={guardando}
        puedeGuardar={totals.totalRetiro > 0 && !!zfeId && !modoCreacion}
        onLlenarFiltrados={llenarConDisponiblesFiltrados}
        onLimpiar={limpiarSeleccion}
        totalItemsVisibles={filtered.length}
      />

      {mensaje && <p className="text-sm text-slate-300">{mensaje}</p>}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-sm text-slate-200">
          <thead className="bg-white/10 text-slate-300 text-xs uppercase">
            <tr>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Talle</th>
              <th className="px-2 py-2 text-left">Descripción</th>
              <th className="px-2 py-2 text-right">Disponible</th>
              <th className="px-2 py-2 text-right">Retirar</th>
              <th className="px-2 py-2 text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-3 text-slate-400">
                  {retiros.length
                    ? "No hay artículos que coincidan con la búsqueda."
                    : "No hay artículos disponibles para retirar."}
                </td>
              </tr>
            ) : (
              filtered.map((r, idx) => {
                // idx es del filtrado; buscamos el índice real en 'retiros'
                const realIdx = retiros.findIndex(
                  (x) => x.SKU === r.SKU && (x.Talle || "") === (r.Talle || "")
                );
                const disponible = parseFloat(r.Saldo || 0);
                const retirar = parseFloat(r.CantidadRetiro || 0);
                const saldoFinal =
                  (Number.isFinite(disponible) ? disponible : 0) -
                  (Number.isFinite(retirar) ? retirar : 0);
                const excedido = Number.isFinite(retirar) && retirar > disponible;

                return (
                  <tr
                    key={`${r.SKU}_${r.Talle || ""}_${idx}`}
                    className={excedido ? "bg-red-500/20" : "hover:bg-white/5"}
                  >
                    <td className="px-2 py-1">{r.SKU}</td>
                    <td className="px-2 py-1">{r.Talle || "-"}</td>
                    <td className="px-2 py-1">{r.Descripcion || ""}</td>
                    <td className="px-2 py-1 text-right">
                      {Number(disponible).toLocaleString()}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={r.CantidadRetiro}
                        onChange={(e) => handleChange(realIdx, e.target.value)}
                        className={`w-24 text-right rounded-md px-2 py-1 outline-none focus:ring-1 ${excedido
                          ? "bg-red-500/10 border border-red-400 text-red-200 focus:ring-red-400"
                          : "bg-white/10 border border-white/10 focus:ring-indigo-400"
                          }`}
                      />
                    </td>
                    <td className={`px-2 py-1 text-right ${excedido ? "text-red-400" : ""}`}>
                      {Number.isFinite(saldoFinal)
                        ? saldoFinal.toLocaleString()
                        : (r.Saldo || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {retiros.length > 0 && (
        <div className="text-sm text-slate-400 text-right mt-2">
          Total artículos: <strong>{retiros.length}</strong> — Total retirado (panel):{" "}
          <strong>{totals.totalRetiro.toLocaleString()}</strong> — Saldo teórico restante:{" "}
          <strong>{(totals.totalSaldo - totals.totalRetiro).toLocaleString()}</strong>
        </div>
      )}
    </div>
  );
}
