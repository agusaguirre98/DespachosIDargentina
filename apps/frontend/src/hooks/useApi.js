// src/hooks/useApi.js
import { useCallback, useMemo } from "react";

export default function useApi() {
  const API_BASE = useMemo(() => {
    return "";
  }, []);

  const buildUrl = useCallback((path) => {
    if (!path) return API_BASE;
    if (/^https?:\/\//i.test(path)) return path;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${API_BASE}${p}`;
  }, [API_BASE]);

  const apiFetch = useCallback(
    async (path, options = {}) => {
      const url = buildUrl(path);

      let res;
      try {
        res = await fetch(url, options);
      } catch (e) {
        throw new Error(`No se pudo conectar con el servidor (${url}). ${e?.message || ""}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (res.status === 204) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return {};
      }

      if (!ct.includes("application/json")) {
        const text = await res.text();
        const snippet = text.slice(0, 300);
        const hint = snippet.includes("<!doctype") || snippet.includes("<html")
          ? " (parece HTML: probablemente la SPA en vez del endpoint de API)"
          : "";
        throw new Error(`Respuesta no-JSON desde ${url} [${res.status} ${res.statusText}]${hint}\n${snippet}`);
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`No se pudo parsear JSON desde ${url} [${res.status}]`);
      }

      if (!res.ok) {
        const msg = data?.error || data?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data;
    },
    [buildUrl]
  );

  const get = useCallback(
    (path, params) => {
      let finalPath = path;
      if (params && typeof params === "object") {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          if (Array.isArray(value)) {
            value.forEach((item) => {
              if (item === undefined || item === null) return;
              searchParams.append(key, String(item));
            });
          } else {
            searchParams.append(key, String(value));
          }
        });
        const qs = searchParams.toString();
        if (qs) {
          finalPath = `${path}${path.includes("?") ? "&" : "?"}${qs}`;
        }
      }
      return apiFetch(finalPath);
    },
    [apiFetch]
  );

  const post = useCallback(
    (path, body) =>
      apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    [apiFetch]
  );

  const put = useCallback(
    (path, body) =>
      apiFetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    [apiFetch]
  );

  const del = useCallback((path) => apiFetch(path, { method: "DELETE" }), [apiFetch]);

  const upload = useCallback(
    (path, formData) =>
      apiFetch(path, {
        method: "POST",
        body: formData,
      }),
    [apiFetch]
  );

  // 🟣 NUEVO: OCR de despachos
  const ocrDespacho = useCallback(
    async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await upload("/api/despachos/ocr", formData);

      // Log útil para debug
      console.log("OCR RAW:", res.raw);
      console.log("OCR SUGGESTED:", res.suggested);
      console.log("OCR DEBUG:", res.debug);

      return res;
    },
    [upload]
  );

  return {
    API_BASE,
    buildUrl,
    apiFetch,
    get,
    post,
    put,
    del,
    upload,
    ocrDespacho, // 👈 nuevo método
  };
}