import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import OCSearchSelectMulti from "./OCSearchSelectMulti";
import useApi from "../hooks/useApi";
import ZFERetiroPanel from "./ZFERetiroPanel";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const normalizeDespacho = (s = "") =>
  s.replace(/\s+/g, "").trim().toUpperCase();

const TIPO_OPCIONES = [
  { value: "ZFI", label: "ZFI", hint: "Ingreso a Zona Franca" },
  { value: "ZFE", label: "ZFE", hint: "Nacionalización" },
  { value: "IC04", label: "IC04", hint: "Importación directa" },
  { value: "IC05", label: "IC05", hint: "Importación directa" },
];

export default function CreateDespacho({ volverAtras, onCreado, irAEditar }) {
  const { get, post, upload } = useApi();

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
  const [dupChecking, setDupChecking] = useState(false);
  const [dupInfo, setDupInfo] = useState(null);
  const [dupError, setDupError] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [mensaje, setMensaje] = useState("");
  const [draftRetiros, setDraftRetiros] = useState([]);

  const setField = (name, value) => {
    const v = name === "Despacho" ? normalizeDespacho(value) : value;
    setFormData((p) => ({ ...p, [name]: v }));
  };

  const ocIdList = useMemo(
    () =>
      Array.isArray(ocIds)
        ? ocIds
            .map((o) => (typeof o === "string" ? o : o?.OC_ID))
            .filter((id) => !!id)
        : [],
    [ocIds]
  );

  const primaryOcId = ocIdList[0] || formData.OC_ID || "";

  // ================= DUPLICADO =================
  useEffect(() => {
    const n = normalizeDespacho(formData.Despacho);
    setDupError("");
    setDupInfo(null);

    if (!n) return;

    const t = setTimeout(async () => {
      try {
        setDupChecking(true);

        const j = await get("/api/despachos/exists", {
          numero: n,
        });

        setDupInfo({
          exists: j.exists,
          id: j.id,
          numero: j.numero,
        });
      } catch {
        setDupError("Error de red al verificar duplicado.");
      } finally {
        setDupChecking(false);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [formData.Despacho, get]);

  // ================= VISOR PDF =================
  useEffect(() => {
    const calc = () => {
      if (!panelRef.current) return;
      const r = panelRef.current.getBoundingClientRect();
      setPanelWidth(Math.max(320, r.width - 16));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("resize", calc);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setArchivo(f);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(
      f && f.type === "application/pdf"
        ? URL.createObjectURL(f)
        : ""
    );
  };

  const procesarOCR = async () => {
    if (!archivo) {
      setMensaje("Seleccioná un PDF primero.");
      return;
    }

    try {
      setProcesando(true);
      setMensaje("Procesando OCR...");

      const fd = new FormData();
      fd.append("file", archivo);

      const j = await upload(
        "/api/ocr/despacho?max_pages=4&dpi=300",
        fd
      );

      const sug = j.suggested || {};

      setFormData((prev) => ({
        ...prev,
        Despacho: prev.Despacho || normalizeDespacho(sug.Despacho ?? ""),
        Fecha: prev.Fecha || (sug.Fecha ?? ""),
        FOB: prev.FOB || (sug.FOB ?? ""),
        Estadistica: prev.Estadistica || (sug.Estadistica ?? ""),
        Derechos_Importacion:
          prev.Derechos_Importacion || (sug.Derechos_Importacion ?? ""),
        Tipo_Cambio: prev.Tipo_Cambio || (sug.Tipo_Cambio ?? ""),
        Arancel: prev.Arancel || (sug.Arancel ?? ""),
      }));

      setMensaje("OCR completado. Revisá los datos.");
    } catch (e) {
      setMensaje(`Error OCR: ${e.message}`);
    } finally {
      setProcesando(false);
    }
  };

  // ================= SUBMIT =================
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("");

    if (!formData.Despacho?.trim())
      return setMensaje("El Nº de Despacho es obligatorio.");
    if (!formData.Fecha)
      return setMensaje("La Fecha es obligatoria.");
    if (!formData.TipoDespacho)
      return setMensaje("Seleccioná el Tipo de despacho.");
    if (!ocIdList.length)
      return setMensaje("Seleccioná al menos una Orden de Compra.");

    try {
      const payload = {
        ...formData,
        Despacho: normalizeDespacho(formData.Despacho),
        TipoDespacho: (formData.TipoDespacho || "").toUpperCase(),
        OC_ID: primaryOcId || "",
        oc_ids: ocIdList,
      };

      const fd = new FormData();

      Object.entries(payload).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach((item) => fd.append(`${k}[]`, item ?? ""));
        } else {
          fd.append(k, v ?? "");
        }
      });

      fd.append("tipoDocumento", "Despacho");
      if (archivo) fd.append("documento", archivo);

      const resp = await upload("/api/despachos", fd);

      if (!resp || resp.ok === false || !resp.id) {
        throw new Error(resp?.error || "No se pudo crear el despacho.");
      }

      const newId = resp.id;
      setMensaje("✅ Despacho creado con éxito.");

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
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl("");

      if (typeof onCreado === "function") onCreado(newId);
      else if (typeof irAEditar === "function") irAEditar(newId);
      else volverAtras?.();
    } catch (err) {
      setMensaje(`❌ ${err.message || "No se pudo conectar con el servidor."}`);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-8">
      {/* Tu JSX original queda exactamente igual */}
    </div>
  );
}