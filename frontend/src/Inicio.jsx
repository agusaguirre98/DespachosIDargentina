import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'


import App from './App.jsx' // ← tu módulo de Comercio Exterior existente
import SelectorModulo from './pages/SelectorModulo.jsx'
import GastosNacionales from './pages/GastosNacionales.jsx'


function Router() {
return (
<BrowserRouter>
<Routes>
{/* Página principal: selector */}
<Route path="/" element={<SelectorModulo />} />


{/* Rutas de cada módulo */}
<Route path="/comercio-exterior" element={<App />} />
<Route path="/gastos-nacionales" element={<GastosNacionales />} />


{/* Fallback */}
<Route path="*" element={<Navigate to="/" replace />} />
</Routes>
</BrowserRouter>
)
}


createRoot(document.getElementById('root')).render(<Router />)