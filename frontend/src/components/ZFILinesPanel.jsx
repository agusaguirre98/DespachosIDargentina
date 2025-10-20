import React from "react";
import useApi from "../hooks/useApi";

/** Panel de artículos del ZFI (UNIDADES)
 *  - Muestra las líneas actuales del ZFI
 *  - Importa/reemplaza líneas desde la OC asignada
 */
export default function ZFILinesPanel({ zfiId, ocId }) {
  const { get, post } = useApi();
  const [lines, setLines] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  const loadLines = React.useCallback(async () => {
    setLoading(true); setMsg("");
    try {
      const j = await get(`/zf/zfi/${zfiId}/lines`);
      const arr = Array.isArray(j?.items) ? j.items : [];
      setLines(arr);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [get, zfiId]);

  React.useEffect(() => { if (zfiId) loadLines(); }, [zfiId, loadLines]);

  const handleImportFromOC = async () => {
    if (!ocId) { setMsg("Asigná una OC al ZFI antes de importar."); return; }
    if (lines.length > 0 && !window.confirm(
      "Este ZFI ya tiene líneas. Se REEMPLAZARÁN por lo que traiga la OC. ¿Continuar?"
    )) return;

    setImporting(true); setMsg("");
    try {
      const j = await post(`/zf/zfi/${zfiId}/import-from-oc`, {});
      if (j?.ok === false) throw new Error(j?.error || "No se pudo importar desde OC.");
      await loadLines();
      setMsg(`✅ Importación completada. Líneas: ${j?.inserted ?? lines.length}.`);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const totalUnidades = lines.reduce((acc, it) => acc + (Number(it.Cantidad) || 0), 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Zona Franca</div>
          <h3 className="text-lg font-semibold">Artículos del ZFI</h3>
          <p className="text-xs text-slate-400 mt-1">
            Fuente: OC {ocId ? <b>#{ocId}</b> : <i>(no asignada)</i>}. Todas las cantidades en <b>UNIDADES</b>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadLines}
            disabled={loading || importing}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20"
            title="Refrescar líneas"
          >
            {loading ? "Cargando…" : "Refrescar"}
          </button>
          <button
            type="button"
            onClick={handleImportFromOC}
            disabled={!ocId || importing || loading}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
            title="Reemplaza las líneas del ZFI por las de la OC"
          >
            {importing ? "Importando…" : "Importar desde OC"}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 text-sm">{msg}</div>}

      <div className="rounded-lg overflow-hidden border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/10">
            <tr>
              <th className="text-left px-3 py-2">SKU</th>
              <th className="text-left px-3 py-2">Talle</th>
              <th className="text-left px-3 py-2">Descripción</th>
              <th className="text-right px-3 py-2">Unidades</th>
              <th className="text-left px-3 py-2">Fuente</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-slate-400">
                  {ocId ? "No hay líneas aún. Importá desde la OC." : "Asigná una OC al ZFI para poder importar."}
                </td>
              </tr>
            ) : lines.map((it) => (
              <tr key={it.ZFI_LineID} className="border-t border-white/10">
                  <td className="px-3 py-2 font-mono">{it.SKU}</td>
                  <td className="px-3 py-2">{it.Talle || "-"}</td>
                  <td className="px-3 py-2">{it.Descripcion}</td>
                  <td className="px-3 py-2 text-right">{Number(it.Cantidad || 0)}</td>
                  <td className="px-3 py-2 text-slate-400">{it.Fuente || "OC"}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot className="border-t border-white/10 bg-white/5">
              <tr>
                <td className="px-3 py-2" colSpan={2}><b>Total artículos</b>: {lines.length}</td>
                <td className="px-3 py-2 text-right"><b>{totalUnidades}</b></td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
