import React, { useEffect, useState } from "react";

const FormularioEditarDespacho = ({ id, volverAtras }) => {
  const [formData, setFormData] = useState({
    Despacho: "",
    Fecha: "",
    FOB: "",
    Estadistica: "",
    Derechos_Importacion: "",
    Tipo_Cambio: "",
  });
  const [errors, setErrors] = useState({});
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const setField = (name, value) => {
    setFormData((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  useEffect(() => {
    const obtenerDespacho = async () => {
      setCargando(true);
      try {
        const r = await fetch(`/api/despachos/${id}`);
        if (!r.ok) throw new Error(`Error al cargar: ${r.status}`);
        const datos = await r.json();
        // Normalizamos undefined a '' para inputs controlados
        setFormData({
          Despacho: datos.Despacho ?? "",
          Fecha: datos.Fecha ?? "",
          FOB: datos.FOB ?? "",
          Estadistica: datos.Estadistica ?? "",
          Derechos_Importacion: datos.Derechos_Importacion ?? "",
          Tipo_Cambio: datos.Tipo_Cambio ?? "",
        });
      } catch (err) {
        setMensaje(`❌ ${err.message}`);
      } finally {
        setCargando(false);
      }
    };
    obtenerDespacho();
  }, [id]);

  const validate = () => {
    const e = {};
    if (!formData.Despacho?.trim()) e.Despacho = "El número de despacho es obligatorio.";
    if (!formData.Fecha) e.Fecha = "La fecha es obligatoria.";
    ["FOB", "Estadistica", "Derechos_Importacion", "Tipo_Cambio"].forEach((f) => {
      const v = formData[f];
      if (v !== "" && v !== null && v !== undefined && isNaN(Number(v))) {
        e[f] = "Debe ser un número válido.";
      }
    });
    return e;
  };

  const numOrUndef = (v) =>
    v === "" || v === null || v === undefined ? undefined : parseFloat(v);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    const eVal = validate();
    if (Object.keys(eVal).length) {
      setErrors(eVal);
      return;
    }

    setEnviando(true);
    try {
      // Enviamos solo los campos; si viene undefined el backend conserva el valor
      const payload = {
        Despacho: formData.Despacho,
        Fecha: formData.Fecha,
        FOB: numOrUndef(formData.FOB),
        Estadistica: numOrUndef(formData.Estadistica),
        Derechos_Importacion: numOrUndef(formData.Derechos_Importacion),
        Tipo_Cambio: numOrUndef(formData.Tipo_Cambio),
      };

      const resp = await fetch(`/api/despachos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Error al actualizar.");

      setMensaje("✅ Despacho actualizado con éxito.");
      volverAtras();
    } catch (err) {
      setMensaje(`❌ ${err.message || "No se pudo conectar con el servidor."}`);
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) return <div>Cargando datos del despacho…</div>;

  return (
    <div className="max-w-2xl mx-auto bg-white/5 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Editar Despacho</h2>
        <button
          type="button"
          onClick={volverAtras}
          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600"
        >
          Volver a la tabla
        </button>
      </div>

      {mensaje && (
        <div className="mb-4 text-sm p-3 rounded-lg bg-black/30">{mensaje}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Despacho */}
        <div>
          <label htmlFor="Despacho" className="block text-sm mb-1">
            Nro. Despacho *
          </label>
          <input
            id="Despacho"
            name="Despacho"
            value={formData.Despacho}
            onChange={(e) => setField("Despacho", e.target.value)}
            className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
              errors.Despacho ? "border-red-500" : "border-white/20"
            }`}
            required
          />
          {errors.Despacho && (
            <p className="text-red-400 text-xs mt-1">{errors.Despacho}</p>
          )}
        </div>

        {/* Fecha */}
        <div>
          <label htmlFor="Fecha" className="block text-sm mb-1">
            Fecha *
          </label>
          <input
            type="date"
            id="Fecha"
            name="Fecha"
            value={formData.Fecha}
            onChange={(e) => setField("Fecha", e.target.value)}
            className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
              errors.Fecha ? "border-red-500" : "border-white/20"
            }`}
            required
          />
          {errors.Fecha && (
            <p className="text-red-400 text-xs mt-1">{errors.Fecha}</p>
          )}
        </div>

        {/* Números */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="FOB" className="block text-sm mb-1">
              FOB
            </label>
            <input
              type="number"
              step="any"
              id="FOB"
              name="FOB"
              value={formData.FOB}
              onChange={(e) => setField("FOB", e.target.value)}
              className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                errors.FOB ? "border-red-500" : "border-white/20"
              }`}
            />
            {errors.FOB && (
              <p className="text-red-400 text-xs mt-1">{errors.FOB}</p>
            )}
          </div>

          <div>
            <label htmlFor="Estadistica" className="block text-sm mb-1">
              Estadística
            </label>
            <input
              type="number"
              step="any"
              id="Estadistica"
              name="Estadistica"
              value={formData.Estadistica}
              onChange={(e) => setField("Estadistica", e.target.value)}
              className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                errors.Estadistica ? "border-red-500" : "border-white/20"
              }`}
            />
            {errors.Estadistica && (
              <p className="text-red-400 text-xs mt-1">{errors.Estadistica}</p>
            )}
          </div>

          <div>
            <label htmlFor="Derechos_Importacion" className="block text-sm mb-1">
              Derechos de Importación
            </label>
            <input
              type="number"
              step="any"
              id="Derechos_Importacion"
              name="Derechos_Importacion"
              value={formData.Derechos_Importacion}
              onChange={(e) => setField("Derechos_Importacion", e.target.value)}
              className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                errors.Derechos_Importacion ? "border-red-500" : "border-white/20"
              }`}
            />
            {errors.Derechos_Importacion && (
              <p className="text-red-400 text-xs mt-1">
                {errors.Derechos_Importacion}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="Tipo_Cambio" className="block text-sm mb-1">
              Tipo de Cambio
            </label>
            <input
              type="number"
              step="any"
              id="Tipo_Cambio"
              name="Tipo_Cambio"
              value={formData.Tipo_Cambio}
              onChange={(e) => setField("Tipo_Cambio", e.target.value)}
              className={`w-full px-3 py-2 rounded-lg bg-white/10 border outline-none ${
                errors.Tipo_Cambio ? "border-red-500" : "border-white/20"
              }`}
            />
            {errors.Tipo_Cambio && (
              <p className="text-red-400 text-xs mt-1">{errors.Tipo_Cambio}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={enviando}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {enviando ? "Guardando..." : "Guardar Cambios"}
          </button>
          <button
            type="button"
            onClick={volverAtras}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
};

export default FormularioEditarDespacho;
