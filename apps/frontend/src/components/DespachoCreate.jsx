import React, { useEffect, useMemo, useState } from "react";
import { pdfjs } from "react-pdf";
import OCSearchSelectMulti from "./OCSearchSelectMulti";
import useApi from "../hooks/useApi";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url
).toString();

const normalizeDespacho = (s = "") =>
  s.replace(/\s+/g, "").trim().toUpperCase();

const TIPO_OPCIONES = [
  { value: "ZFI", label: "ZFI - Ingreso a Zona Franca" },
  { value: "ZFE", label: "ZFE - Nacionalización" },
  { value: "IC04", label: "IC04 - Importación directa" },
  { value: "IC05", label: "IC05 - Importación directa" },
];

export default function CreateDespacho({ volverAtras, onCreado }) {
  const { get, upload } = useApi();

  const inputClasses =
    "w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/20 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60 outline-none";

  const selectClasses =
    "w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/20 text-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/60 outline-none";

  const optionClasses = "bg-slate-900 text-slate-100";

  const [formData, setFormData] = useState({
    Despacho: "",
    Fecha: "",
    FOB: "",
    Estadistica: "",
    Derechos_Importacion: "",
    Tipo_Cambio: "",
    Arancel: "",
    TipoDespacho: "",
    OC_ID: "",
  });

  const [ocIds, setOcIds] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [dupInfo, setDupInfo] = useState(null);

  const setField = (name, value) => {
    const v = name === "Despacho" ? normalizeDespacho(value) : value;
    setFormData((p) => ({ ...p, [name]: v }));
  };

  const ocIdList = useMemo(
    () =>
      Array.isArray(ocIds)
        ? ocIds
            .map((o) => (typeof o === "string" ? o : o?.OC_ID))
            .filter(Boolean)
        : [],
    [ocIds]
  );

  const primaryOcId = ocIdList[0] || "";

  useEffect(() => {
    const n = normalizeDespacho(formData.Despacho);
    if (!n) {
      setDupInfo(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const j = await get("/api/despachos/exists", { numero: n });
        setDupInfo(j);
      } catch {
        setDupInfo(null);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [formData.Despacho, get]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setArchivo(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    if (!formData.Despacho) return setMensaje("Ingresá el despacho.");
    if (!formData.Fecha) return setMensaje("Ingresá la fecha.");
    if (!formData.TipoDespacho)
      return setMensaje("Seleccioná el tipo de despacho.");
    if (!ocIdList.length)
      return setMensaje("Seleccioná al menos una OC.");

    try {
      const payload = {
        ...formData,
        Despacho: normalizeDespacho(formData.Despacho),
        TipoDespacho: formData.TipoDespacho.toUpperCase(),
        OC_ID: primaryOcId,
        oc_ids: ocIdList,
      };

      const fd = new FormData();

      Object.entries(payload).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach((item) => fd.append(`${k}[]`, item));
        } else {
          fd.append(k, v ?? "");
        }
      });

      if (archivo) fd.append("documento", archivo);
      fd.append("tipoDocumento", "Despacho");

      const resp = await upload("/api/despachos", fd);

      if (!resp?.id) throw new Error(resp?.error || "No se pudo crear");

      setMensaje("✅ Despacho creado correctamente");

      setFormData({
        Despacho: "",
        Fecha: "",
        FOB: "",
        Estadistica: "",
        Derechos_Importacion: "",
        Tipo_Cambio: "",
        Arancel: "",
        TipoDespacho: "",
        OC_ID: "",
      });

      setOcIds([]);
      setArchivo(null);

      if (onCreado) onCreado(resp.id);
    } catch (err) {
      setMensaje("❌ " + err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-slate-900 p-6 rounded-2xl border border-white/10 shadow-lg">
      <h2 className="text-xl font-semibold mb-6 text-slate-100">
        Nuevo Despacho
      </h2>

      <form onSubmit={handleSubmit} className="space-y-5">

        <div>
          <label className="block text-sm mb-1 text-slate-300">Despacho</label>
          <input
            value={formData.Despacho}
            onChange={(e) => setField("Despacho", e.target.value)}
            className={inputClasses}
          />
        </div>

        {dupInfo?.exists && (
          <div className="text-red-400 text-sm">
            ⚠ Este despacho ya existe (ID {dupInfo.id})
          </div>
        )}

        <div>
          <label className="block text-sm mb-1 text-slate-300">Fecha</label>
          <input
            type="date"
            value={formData.Fecha}
            onChange={(e) => setField("Fecha", e.target.value)}
            className={inputClasses}
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-300">
            Tipo despacho
          </label>

          <select
            value={formData.TipoDespacho}
            onChange={(e) => setField("TipoDespacho", e.target.value)}
            className={selectClasses}
          >
            <option value="" className={optionClasses}>
              Seleccionar
            </option>

            {TIPO_OPCIONES.map((t) => (
              <option
                key={t.value}
                value={t.value}
                className={optionClasses}
              >
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-300">
            Orden de Compra
          </label>
          <OCSearchSelectMulti value={ocIds} onChange={setOcIds} />
        </div>

        <div>
          <label className="block text-sm mb-1">PDF despacho</label>

          <input
            id="pdfDespacho"
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex items-center gap-3">
            <label
              htmlFor="pdfDespacho"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium cursor-pointer transition"
            >
              Seleccionar PDF
            </label>

            <span className="text-sm text-slate-300 truncate max-w-[250px]">
              {archivo ? archivo.name : "Ningún archivo seleccionado"}
            </span>
          </div>
</div>

        <div className="flex gap-3 pt-3">
          <button
            type="submit"
            className="px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Crear despacho
          </button>

          <button
            type="button"
            onClick={volverAtras}
            className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition-colors"
          >
            Cancelar
          </button>
        </div>

        {mensaje && (
          <div className="text-sm pt-3 text-emerald-300">
            {mensaje}
          </div>
        )}
      </form>
    </div>
  );
}