import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "./App.jsx"; // Comercio Exterior (ya tenés esto)
import SelectorModulo from "./pages/SelectorModulo.jsx";
import GastosNacionales from "./pages/GastosNacionales.jsx";
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Pantalla inicial */}
        <Route path="/" element={<SelectorModulo />} />

        {/* Rutas hacia módulos */}
        <Route path="/comercio-exterior" element={<App />} />
        <Route path="/gastos-nacionales" element={<GastosNacionales />} />

        {/* Redirección por defecto */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
