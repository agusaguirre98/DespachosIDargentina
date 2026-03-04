// src/Nacional/api/serviciosApi.js

const BASE_URL = "/api/servicios";

async function handleResponse(res, defaultError) {
    if (!res.ok) {
        let msg = defaultError;
        // Intentamos leer JSON { error: "..." }
        try {
            const data = await res.json();
            if (data && data.error) {
                msg = data.error;
            }
        } catch {
            // Si no es JSON, tratamos de leer texto plano
            try {
                const text = await res.text();
                if (text) msg = text;
            } catch {
                /* ignoramos */
            }
        }
        throw new Error(msg);
    }
    return res.json();
}

/**
 * GET /api/servicios/tipos
 * Devuelve los tipos de servicio activos (SERV_TiposServicio)
 */
export async function fetchTiposServicio() {
    const res = await fetch(`${BASE_URL}/tipos`, { method: "GET" });
    return handleResponse(res, "No se pudieron obtener los tipos de servicio.");
}

/**
 * GET /api/servicios/facturas
 * Parámetros opcionales:
 *   - tipo
 *   - proveedor
 *   - conSaldo (boolean) -> se envía como con_saldo=1/0
 */
export async function fetchFacturasServicios({ tipo, proveedor, conSaldo } = {}) {
    const params = new URLSearchParams();

    if (tipo) params.append("tipo", tipo);
    if (proveedor) params.append("proveedor", proveedor);
    if (conSaldo !== undefined) params.append("con_saldo", conSaldo ? "1" : "0");

    const qs = params.toString();
    const url = qs ? `${BASE_URL}/facturas?${qs}` : `${BASE_URL}/facturas`;

    const res = await fetch(url, { method: "GET" });
    return handleResponse(res, "No se pudieron obtener las facturas de servicio.");
}

/**
 * POST /api/servicios/facturas
 *
 * El backend espera multipart/form-data:
 *   - TipoServicio
 *   - Proveedor
 *   - NumeroFactura
 *   - Fecha
 *   - CantidadTotal
 *   - ImporteTotal
 *   - Descripcion (opcional)
 *   - pdf (File opcional)
 *
 * Podés llamar a esta función de dos maneras:
 *   1) createFacturaServicio(formData)   // ya armado con pdf, etc.
 *   2) createFacturaServicio({ ...campos }) // objeto plano, acá lo convertimos a FormData
 */
export async function createFacturaServicio(payload) {
    let body;

    if (payload instanceof FormData) {
        body = payload;
    } else {
        const fd = new FormData();
        Object.entries(payload || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                fd.append(key, value);
            }
        });
        body = fd;
    }

    const res = await fetch(`${BASE_URL}/facturas`, {
        method: "POST",
        body,
    });

    return handleResponse(res, "No se pudo crear la factura de servicio.");
}

/**
 * (Opcional) Si en algún momento implementás en el back:
 * GET /api/servicios/facturas/<id>
 */
export async function fetchFacturaServicioById(servId) {
    const res = await fetch(`${BASE_URL}/facturas/${encodeURIComponent(servId)}`, {
        method: "GET",
    });
    return handleResponse(
        res,
        "No se pudo obtener el detalle de la factura de servicio."
    );
}

/**
 * POST /api/servicios/asignaciones/oc
 * payload:
 *   {
 *     SERV_ID: number,
 *     OC_ID: string,
 *     CantidadAsignada: number,
 *     Comentario?: string
 *   }
 */
export async function createAsignacionOC(payload) {
    const res = await fetch(`${BASE_URL}/asignaciones/oc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    return handleResponse(res, "No se pudo crear la asignación a la OC.");
}

/**
 * GET /api/servicios/inventario
 * Devuelve:
 * {
 *   resumenGlobal,
 *   resumenPorTipo,
 *   resumenPorFactura,
 *   resumenPorOC
 * }
 */
export async function fetchInventarioServicios() {
    const res = await fetch(`${BASE_URL}/inventario`, { method: "GET" });
    return handleResponse(res, "No se pudo obtener el inventario de servicios.");
}
