import React, { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";

/**
 * Panel de retiros para ZFE.
 *
 * Props:
 * - zfeId: number | null       -> si es null (modo creación), no intenta leer/guardar líneas en backend
 * - ocId:  string|number       -> OC vinculada (se usa para encontrar el ZFI del grupo)
 * - modoCreacion?: boolean     -> true si estás en CreateDespacho
 * - onDraftChange?: (items) => void  -> callback opcional con los ítems > 0 (para que el padre los guarde luego)
 */
export default function ZFERetiroPanel({ zfeId, ocId, modoCreacion = false, onDraftChange }) {
  const { get, post } = useApi();

  const [zfiId, setZfiId] = useState(null);
  const [saldo, setSaldo] = useState([]);   // [{SKU, Talle, Descripcion?, CantidadTotal?, CantidadRetirada?, Saldo}]
  const [retiros, setRetiros] = useState([]); // estado editable con CantidadRetiro (string/number)
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Busca ZFI_ID a partir de la OC (grupos)
  const fetchZFIFromOC = async () => {
    const j = await get(`/zf/grupos?oc_id=${encodeURIComponent(ocId)}`);
    const gid = Array.isArray(j?.items) ? j.items[0] : null;
    const _zfiId = gid?.ZFI?.ZFI_ID || null;
    if (!_zfiId) throw new Error("No se encontró el ZFI vinculado a esta OC.");
    return _zfiId;
  };

  const loadData = async () => {
    if (!ocId) return;
    setCargando(true);
    setMensaje("");
    try {
      // 1) ZFI a partir de OC
      const _zfiId = await fetchZFIFromOC();
      setZfiId(_zfiId);

      // 2) Saldos del ZFI
      const r = await get(`/zf/zfi/${_zfiId}/saldo`);
      if (!r?.ok) throw new Error(r?.error || "Error obteniendo saldos.");
      const items = Array.isArray(r.items) ? r.items : [];

      // 3) Si estamos editando un ZFE existente, cargar retiros previos
      let prevMap = {};
      if (zfeId) {
        const prev = await get(`/zf/zfe/${zfeId}/lines`);
        (prev?.items || []).forEach(it => {
          prevMap[`${it.SKU}__${it.Talle || ""}`] = it.CantidadRetiro;
        });
      }

      const merged = items.map(it => ({
        ...it,
        Descripcion: it.Descripcion ?? "",          // por si el saldo no la trae
        CantidadRetiro: prevMap[`${it.SKU}__${it.Talle || ""}`] ?? "", // string para input
      }));

      setSaldo(merged);
      setRetiros(merged);
      // notificar draft al padre (modo creación)
      if (modoCreacion && typeof onDraftChange === "function") {
        const draft = merged
          .filter(x => parseFloat(x.CantidadRetiro) > 0)
          .map(x => toPayloadLine(_zfiId, x));
        onDraftChange(draft);
      }
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
      setSaldo([]); setRetiros([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocId, zfeId]); // cambia sólo si cambian estos

  const toPayloadLine = (zfiIdLocal, r) => ({
    ZFI_ID: zfiIdLocal,
    SKU: r.SKU,
    Talle: r.Talle || "",
    Descripcion: r.Descripcion || "",
    CantidadRetiro: parseFloat(r.CantidadRetiro || 0),
  });

  const totals = useMemo(() => {
    const totalSaldo = saldo.reduce((acc, r) => acc + (parseFloat(r.Saldo) || 0), 0);
    const totalRetiro = retiros.reduce((acc, r) => acc + (parseFloat(r.CantidadRetiro) || 0), 0);
    return { totalSaldo, totalRetiro };
  }, [saldo, retiros]);

  const handleChange = (idx, value) => {
    const v = value === "" ? "" : Number(value);
    const arr = [...retiros];
    arr[idx].CantidadRetiro = Number.isFinite(v) ? v : "";
    setRetiros(arr);

    if (modoCreacion && typeof onDraftChange === "function" && zfiId) {
      const draft = arr
        .filter(x => parseFloat(x.CantidadRetiro) > 0)
        .map(x => toPayloadLine(zfiId, x));
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
      .filter(r => parseFloat(r.CantidadRetiro) > 0)
      .map(r => toPayloadLine(zfiId, r));

    if (!items.length) {
      setMensaje("No hay cantidades para guardar.");
      return;
    }

    setGuardando(true);
    setMensaje("");
    try {
      const resp = await post(`/zf/zfe/${zfeId}/lines`, { items });
      if (!resp?.ok) throw new Error(resp?.error || "Error al guardar retiros.");
      setMensaje(`✅ ${resp.inserted} líneas guardadas correctamente.`);
      await loadData();
    } catch (e) {
      setMensaje(`❌ ${e.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-slate-400">
          Fuente: OC #{ocId}. Unidades en <strong>UNIDADES</strong>.
        </span>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            disabled={cargando}
            className="px-3 py-1 rounded-md bg-white/10 border border-white/20 text-sm disabled:opacity-50"
          >
            {cargando ? "Actualizando…" : "Refrescar"}
          </button>
          <button
            onClick={handleSave}
            disabled={guardando || modoCreacion || !zfeId}
            className="px-3 py-1 rounded-md bg-fuchsia-700 hover:bg-fuchsia-600 text-sm disabled:opacity-50"
            title={modoCreacion || !zfeId ? "Guardá el despacho para registrar retiros" : "Guardar retiros"}
          >
            {guardando ? "Guardando…" : "Guardar retiros"}
          </button>
        </div>
      </div>

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
            {retiros.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-3 text-slate-400">
                  No hay artículos disponibles para retirar.
                </td>
              </tr>
            ) : (
              retiros.map((r, idx) => {
                const disponible = parseFloat(r.Saldo || 0);
                const retirar = parseFloat(r.CantidadRetiro || 0);
                const saldoFinal = (Number.isFinite(disponible) ? disponible : 0) - (Number.isFinite(retirar) ? retirar : 0);
                const excedido = Number.isFinite(retirar) && retirar > disponible;

                return (
                  <tr
                    key={`${r.SKU}_${r.Talle || ""}_${idx}`}
                    className={excedido ? "bg-red-500/20" : "hover:bg-white/5"}
                  >
                    <td className="px-2 py-1">{r.SKU}</td>
                    <td className="px-2 py-1">{r.Talle || "-"}</td>
                    <td className="px-2 py-1">{r.Descripcion || ""}</td>
                    <td className="px-2 py-1 text-right">{Number(disponible).toLocaleString()}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={r.CantidadRetiro}
                        onChange={(e) => handleChange(idx, e.target.value)}
                        className="w-24 text-right rounded-md bg-white/10 border border-white/10 px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </td>
                    <td className={`px-2 py-1 text-right ${excedido ? "text-red-400" : ""}`}>
                      {Number.isFinite(saldoFinal) ? saldoFinal.toLocaleString() : (r.Saldo || 0).toLocaleString()}
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
