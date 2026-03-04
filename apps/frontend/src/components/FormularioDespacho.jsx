import React, { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import useApi from "../hooks/useApi";

// Worker PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const normalizeDespacho = (s = "") =>
  s.replace(/\s+/g, "").trim().toUpperCase();

const FormularioDespacho = ({ volverAtras }) => {
  const { get, upload } = useApi();

  const [formData, setFormData] = useState({
    Despacho: "",
    Fecha: "",
    FOB: "",
    Estadistica: "",
    Derechos_Importacion: "",
    Tipo_Cambio: "",
    Arancel: "",
  });

  const [archivo, setArchivo] = useState(null);
  const [mensaje, setMensaje] = useState("");
  const [procesando, setProcesando] = useState(false);

  const [dupChecking, setDupChecking] = useState(false);
  const [dupInfo, setDupInfo] = useState(null);
  const [dupError, setDupError] = useState("");

  // ================= DUPLICADO =================
  useEffect(() => {
    const n = normalizeDespacho(formData.Despacho);
    setDupError("");
    setDupInfo(null);

    if (!n) return;

    const t = setTimeout(async () => {
      try {
        setDupChecking(true);

        const data = await get("/api/despachos/exists", {
          numero: n,
        });

        setDupInfo({
          exists: data.exists,
          id: data.id,
          numero: data.numero,
        });
      } catch (e) {
        setDupError(e.message || "Error verificando duplicado.");
      } finally {
        setDupChecking(false);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [formData.Despacho, get]);

  // ================= PDF PREVIEW =================
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    const calc = () => {
      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      setPanelWidth(Math.max(320, rect.width - 16));
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

  const handleChange = (e) => {
    const { name, value } = e.target;
    const v = name === "Despacho" ? normalizeDespacho(value) : value;
    setFormData((prev) => ({ ...prev, [name]: v }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setArchivo(file);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);

    if (file && file.type === "application/pdf") {
      setPdfPreviewUrl(URL.createObjectURL(file));
    } else {
      setPdfPreviewUrl("");
    }
  };

  // ================= OCR =================
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

      const data = await upload(
        "/api/ocr/despacho?max_pages=4&dpi=300",
        fd
      );

      const sug = data.suggested || {};

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
      console.error(e);
      setMensaje(e.message || "Error procesando el OCR.");
    } finally {
      setProcesando(false);
    }
  };

  // ================= GUARDAR =================
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje("Guardando despacho...");

    const payload = {
      ...formData,
      Despacho: normalizeDespacho(formData.Despacho),
    };

    const dataToSend = new FormData();
    Object.entries(payload).forEach(([k, v]) =>
      dataToSend.append(k, v ?? "")
    );
    dataToSend.append("tipoDocumento", "Despacho");
    if (archivo) dataToSend.append("documento", archivo);

    try {
      await upload("/api/despachos", dataToSend);

      setMensaje(`Despacho "${payload.Despacho}" creado con éxito.`);

      setFormData({
        Despacho: "",
        Fecha: "",
        FOB: "",
        Estadistica: "",
        Derechos_Importacion: "",
        Tipo_Cambio: "",
        Arancel: "",
      });

      setArchivo(null);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl("");

      volverAtras();
    } catch (err) {
      console.error(err);
      setMensaje(`Error: ${err.message}`);
    }
  };

  // ================= RENDER (NO MODIFICADO) =================
  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-8">
      {/* ... TODO EL JSX ORIGINAL SIN CAMBIOS ... */}
    </div>
  );
};

export default FormularioDespacho;