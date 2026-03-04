import { useState, useEffect, useMemo, Suspense, lazy, Fragment } from 'react';
import { useNavigate } from 'react-router-dom'; // ⬅️ agregado




// ⬇️ NUEVOS componentes (lazy):
const DespachoCreate = lazy(() => import('./components/DespachoCreate'));
const ZFGroupManager = lazy(() => import('./components/ZFGroupManager'));

// ⬇️ Los que ya tenías:
const FormularioEditarDespacho = lazy(() => import('./components/FormularioEditarDespacho'));
const PaginaFacturas = lazy(() => import('./components/PaginaFacturas'));
const PaginaRepositorio = lazy(() => import('./components/PaginaRepositorio'));
const PaginaDebugOC = lazy(() => import('./components/DebugOC'));

function money(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 });
}
const norm = (s) => (s ?? '').toString().trim().toUpperCase();
const dropdownOptionStyle = { color: '#0f172a' };

function App() {
  const navigate = useNavigate(); // ⬅️ agregado

  const [despachos, setDespachos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // ⬇️ Agrego nueva vista 'zf'
  // 'tabla_despachos' | 'nuevo' | 'editar' | 'facturas' | 'repositorio' | 'zf'
  const [vistaActual, setVistaActual] = useState('tabla_despachos');
  const [despachoIdAEditar, setDespachoIdAEditar] = useState(null);

  // 🔑 key para forzar remount de PaginaFacturas
  const [facturasKey, setFacturasKey] = useState(0);
  const goFacturas = () => {
    setVistaActual('facturas');
    setFacturasKey((k) => k + 1);
  };

  // Expandibles + cache por despacho
  const [expanded, setExpanded] = useState(new Set());
  const [cache, setCache] = useState({}); // { [nro]: { loading, facturas, resumen } }

  // --- Filtro por vínculos + conteo rápido por despacho ---
  const [linkFilter, setLinkFilter] = useState('ALL'); // 'ALL' | 'NO_LINKS' | 'WITH_LINKS'
  const [linksCount, setLinksCount] = useState({});         // { [despachoId]: number }
  const [cargandoVinculos, setCargandoVinculos] = useState(false);

  // --- Paginación ---
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ field: 'ID', direction: 'asc' });

  // --- Búsqueda/filtrado existentes ---
  const [searchField, setSearchField] = useState('TODOS'); // 'TODOS' | 'DESPACHO' | 'FECHA' | 'ID'
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const obtenerDespachos = async () => {
    setCargando(true);
    try {
      const respuesta = await fetch('/api/despachos');
      if (!respuesta.ok) throw new Error(`Error en la API: ${respuesta.status}`);
      const datos = await respuesta.json();
      setDespachos(datos);
    } catch (err) {
      console.error("Error al obtener despachos:", err);
      setError("No se pudieron cargar los datos. Intenta nuevamente.");
    } finally {
      setCargando(false);
    }
  };

  // Conteo rápido (usa /api/despachos/links-count)
  const fetchVinculos = async () => {
    try {
      setCargandoVinculos(true);
      const r = await fetch('/api/despachos/links-count');
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Error obteniendo conteos');
      const map = {};
      (j.items || []).forEach((row) => {
        const id = row.ID ?? row.DespachoId ?? row.Id;
        if (id != null) map[id] = row.LinkedCount ?? 0;
      });
      setLinksCount(map);
    } catch (e) {
      console.error(e);
    } finally {
      setCargandoVinculos(false);
    }
  };

  // Al volver a "Despachos", reseteo cache/expansiones y cargo + conteos
  useEffect(() => {
    if (vistaActual === 'tabla_despachos') {
      setCache({});
      setExpanded(new Set());
      obtenerDespachos();
      fetchVinculos();
    }
  }, [vistaActual]);

  const handleEditarClick = (id) => {
    setDespachoIdAEditar(id);
    setVistaActual('editar');
  };

  // Pide SIEMPRE (refresca) facturas + resumen del despacho
  const fetchDespachoData = async (nro, { force = false } = {}) => {
    if (!force) {
      const info = cache[nro];
      if (info && !info.loading && Array.isArray(info.facturas) && Array.isArray(info.resumen)) {
        return;
      }
    }
  
    setCache(p => ({ ...p, [nro]: { ...(p[nro] || {}), loading: true } }));
  
    try {
      const [rfRes, rrRes] = await Promise.all([
        fetch(`/api/despachos/${encodeURIComponent(nro)}/facturas`),
        fetch(`/api/despachos/${encodeURIComponent(nro)}/resumen-gasto`)
      ]);
  
      if (!rfRes.ok || !rrRes.ok) {
        throw new Error("Error obteniendo datos del despacho");
      }
  
      const rf = await rfRes.json();
      const rr = await rrRes.json();
  
      setCache(p => ({
        ...p,
        [nro]: {
          loading: false,
          facturas: rf?.items || [],
          resumen: rr?.items || []
        }
      }));
    } catch (e) {
      console.error(e);
      setCache(p => ({ ...p, [nro]: { loading: false, facturas: [], resumen: [] } }));
    }
  };

  // Abre/cierra y al abrir refresca
  const toggleExpand = (nro) => {
    const abrir = !expanded.has(nro);
    setExpanded(prev => {
      const next = new Set(prev);
      if (abrir) next.add(nro); else next.delete(nro);
      return next;
    });
    if (abrir) {
      const info = cache[nro];
      const hasFacturas = info && Array.isArray(info.facturas);
      const hasResumen = info && Array.isArray(info.resumen);
      if (!info || (!info.loading && (!hasFacturas || !hasResumen))) {
        fetchDespachoData(nro);
      }
    }
  };

  const toggleSort = (field) => {
    setSortConfig((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { field, direction: 'asc' };
    });
  };

  const getSortValue = (d, field) => {
    switch (field) {
      case 'ID': {
        const parsed = Number(d.ID);
        return Number.isFinite(parsed) ? parsed : null;
      }
      case 'OC':
        return (d.OC_ID ?? '').toString().toUpperCase();
      case 'Despacho':
        return norm(d.Despacho);
      case 'Tipo':
        return norm(d.TipoDespacho);
      case 'Fecha':
        return d.Fecha || '';
      case 'FOB': {
        const parsed = Number(d.FOB);
        return Number.isFinite(parsed) ? parsed : null;
      }
      case 'Adjunto':
        return d.HasDoc && d.DocUrl ? 1 : 0;
      case 'Vinculos':
        return linksCount[d.ID] ?? 0;
      default:
        return '';
    }
  };

  const getAriaSort = (field) => {
    if (sortConfig.field !== field) return 'none';
    return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortIndicator = (field) => {
    if (sortConfig.field !== field) return null;
    return (
      <span className="text-xs uppercase">
        {sortConfig.direction === 'asc' ? 'ASC' : 'DESC'}
      </span>
    );
  };

  // --- derivar lista filtrada base (texto/fechas) ---
  const baseFiltrada = useMemo(() => {
    const q = norm(searchText);
    const hasRange = dateFrom || dateTo;
    const inRange = (iso) => {
      if (!iso) return false;
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      return true;
    };

    return despachos.filter((d) => {
      const idStr = String(d.ID || '');
      const nro = norm(d.Despacho);
      const fecha = (d.Fecha || '');

      if (searchField === 'FECHA') {
        if (!hasRange) return true;
        return inRange(fecha);
      }

      if (searchField === 'DESPACHO') {
        if (!q) return true;
        return nro.includes(q);
      }

      if (searchField === 'ID') {
        if (!q) return true;
        return idStr.includes(searchText.trim());
      }

      if (!q && !hasRange) return true;
      const byText = q ? (nro.includes(q) || idStr.includes(searchText.trim()) || fecha.includes(searchText.trim())) : true;
      const byDate = hasRange ? inRange(fecha) : true;
      return byText && byDate;
    });
  }, [despachos, searchField, searchText, dateFrom, dateTo]);

  // --- aplicar filtro por vínculos usando linksCount ---
  const despachosFiltrados = useMemo(() => {
    if (linkFilter === 'NO_LINKS') {
      return baseFiltrada.filter(d => (linksCount[d.ID] ?? 0) === 0);
    }
    if (linkFilter === 'WITH_LINKS') {
      return baseFiltrada.filter(d => (linksCount[d.ID] ?? 0) > 0);
    }
    return baseFiltrada; // ALL
  }, [baseFiltrada, linkFilter, linksCount]);

  const sortedDespachos = useMemo(() => {
    const { field, direction } = sortConfig;
    const sorted = [...despachosFiltrados];

    sorted.sort((a, b) => {
      const av = getSortValue(a, field);
      const bv = getSortValue(b, field);

      const isEmpty = (value) => value === null || value === undefined || value === '';
      const aEmpty = isEmpty(av);
      const bEmpty = isEmpty(bv);
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return direction === 'asc' ? 1 : -1;
      if (bEmpty) return direction === 'asc' ? -1 : 1;

      const isNumber = typeof av === 'number' && typeof bv === 'number';
      if (isNumber) {
        return direction === 'asc' ? av - bv : bv - av;
      }

      const aStr = String(av ?? '');
      const bStr = String(bv ?? '');
      return direction === 'asc'
        ? aStr.localeCompare(bStr, 'es', { numeric: true, sensitivity: 'base' })
        : bStr.localeCompare(aStr, 'es', { numeric: true, sensitivity: 'base' });
    });

    return sorted;
  }, [despachosFiltrados, sortConfig, linksCount]);

  const totalDespachos = sortedDespachos.length;
  const totalPages = Math.max(1, Math.ceil(totalDespachos / rowsPerPage));
  const pageToDisplay = Math.min(currentPage, totalPages);
  const startIndex = totalDespachos === 0 ? 0 : (pageToDisplay - 1) * rowsPerPage;
  const endIndex = totalDespachos === 0 ? 0 : Math.min(startIndex + rowsPerPage, totalDespachos);
  const showingStart = totalDespachos === 0 ? 0 : startIndex + 1;
  const showingEnd = totalDespachos === 0 ? 0 : endIndex;
  const disablePrevPage = pageToDisplay <= 1;
  const disableNextPage = pageToDisplay >= totalPages || totalDespachos === 0;

  const paginatedDespachos = useMemo(
    () => sortedDespachos.slice(startIndex, endIndex),
    [sortedDespachos, startIndex, endIndex]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [despachos, searchField, searchText, dateFrom, dateTo, linkFilter, sortConfig]);

  useEffect(() => {
    setCurrentPage((prev) => {
      if (totalDespachos === 0) return 1;
      if (prev < 1) return 1;
      if (prev > totalPages) return totalPages;
      return prev;
    });
  }, [totalDespachos, totalPages]);

  const handleRowsPerPageChange = (event) => {
    const value = Number(event.target.value) || rowsPerPage;
    setRowsPerPage(value);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchField('TODOS');
    setSearchText('');
    setDateFrom('');
    setDateTo('');
  };

  // ⬇️ callback para volver de "Nuevo" y refrescar lista
  const handleCreated = () => {
    setVistaActual('tabla_despachos');
    obtenerDespachos();
  };

  const renderizarVista = () => {
    switch (vistaActual) {
      case 'nuevo':
        // ⬇️ Usamos el nuevo alta con selector de OC + tipo
        return (
          <DespachoCreate
            onCreado={handleCreated}
            volverAtras={() => setVistaActual('tabla_despachos')}
          />
        );
      case 'editar':
        return <FormularioEditarDespacho id={despachoIdAEditar} volverAtras={() => setVistaActual('tabla_despachos')} />;

      case 'facturas':
        return <PaginaFacturas key={facturasKey} />;
      case 'repositorio':
        return <PaginaRepositorio />;
      case 'zf':
        return <ZFGroupManager />;
      case 'tabla_despachos':
      default:
        return (
          <>
            <h2 className="text-xl font-semibold mb-3">Despachos Cargados</h2>

            <div className="mb-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  onClick={() => setVistaActual('nuevo')}
                >
                  Nuevo Despacho
                </button>


                {/* Filtro por vínculos + refrescar conteos */}
                <div className="flex items-center gap-2 ml-auto">
                  <select
                    value={linkFilter}
                    onChange={(e) => setLinkFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 outline-none text-slate-100 focus:bg-white focus:text-slate-900"
                    title="Filtrar por facturas vinculadas"
                  >
                    <option value="ALL" style={dropdownOptionStyle}>Todos</option>
                    <option value="NO_LINKS" style={dropdownOptionStyle}>Sin factura</option>
                    <option value="WITH_LINKS" style={dropdownOptionStyle}>Con factura</option>
                  </select>

                  <button
                    type="button"
                    onClick={fetchVinculos}
                    disabled={cargandoVinculos}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
                    title="Recalcular vínculos por despacho"
                  >
                    {cargandoVinculos ? "Actualizando vínculos…" : "Refrescar vínculos"}
                  </button>
                </div>
              </div>

              {/* Controles de búsqueda/filtrado (igual que antes) */}
              <div className="flex flex-wrap items-end gap-2 bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex flex-col">
                  <label className="text-xs text-slate-300 mb-1">Buscar por</label>
                  <select
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100 focus:bg-white focus:text-slate-900"
                    value={searchField}
                    onChange={(e) => setSearchField(e.target.value)}
                  >
                    <option value="TODOS" style={dropdownOptionStyle}>Todos</option>
                    <option value="DESPACHO" style={dropdownOptionStyle}>Despacho</option>
                    <option value="FECHA" style={dropdownOptionStyle}>Fecha</option>
                    <option value="ID" style={dropdownOptionStyle}>ID</option>
                  </select>
                </div>

                {searchField === 'FECHA' ? (
                  <>
                    <div className="flex flex-col">
                      <label className="text-xs text-slate-300 mb-1">Desde</label>
                      <input
                        type="date"
                        className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs text-slate-300 mb-1">Hasta</label>
                      <input
                        type="date"
                        className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 min-w-[240px] flex flex-col">
                    <label className="text-xs text-slate-300 mb-1">Texto</label>
                    <input
                      placeholder={searchField === 'ID' ? 'Ej: 123' :
                        searchField === 'DESPACHO' ? 'Ej: 25033ZFE...' :
                          'Despacho, fecha (YYYY-MM), o ID'}
                      className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                    />
                  </div>
                )}

                <button
                  type="button"
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20"
                  onClick={clearFilters}
                  title="Limpiar filtros"
                >
                  Limpiar
                </button>
              </div>
            </div>

            {cargando ? (
              <p>Cargando datos...</p>
            ) : error ? (
              <p className="text-red-400">Error: {error}</p>
            ) : despachosFiltrados.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-sm text-slate-200">
                  <div>
                    Mostrando {showingStart.toLocaleString('es-AR')}–{showingEnd.toLocaleString('es-AR')} de {totalDespachos.toLocaleString('es-AR')} despachos
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs uppercase tracking-wide text-slate-400">Filas por página</label>
                    <select
                      className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100 focus:bg-white focus:text-slate-900"
                      value={rowsPerPage}
                      onChange={handleRowsPerPageChange}
                    >
                      {[25, 50, 100, 200, 500].map((size) => (
                        <option key={size} value={size} style={dropdownOptionStyle}>{size}</option>
                      ))}
                    </select>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={disablePrevPage}
                        title="Página anterior"
                      >
                        ◀
                      </button>
                      <span className="px-2 font-semibold">
                        {pageToDisplay.toLocaleString('es-AR')} / {Math.max(totalPages, 1).toLocaleString('es-AR')}
                      </span>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={disableNextPage}
                        title="Página siguiente"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5">
                      <tr className="text-left text-slate-300">
                        <th className="py-2 px-3 w-10"></th> {/* expandir */}
                        <th className="py-2 px-3" aria-sort={getAriaSort('ID')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('ID')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por ID"
                          >
                            ID
                            {renderSortIndicator('ID')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('OC')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('OC')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por OC"
                          >
                            OC
                            {renderSortIndicator('OC')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('Despacho')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('Despacho')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por despacho"
                          >
                            Despacho
                            {renderSortIndicator('Despacho')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('Tipo')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('Tipo')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por tipo"
                          >
                            Tipo
                            {renderSortIndicator('Tipo')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('Fecha')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('Fecha')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por fecha"
                          >
                            Fecha
                            {renderSortIndicator('Fecha')}
                          </button>
                        </th>
                        <th className="py-2 px-3 text-right" aria-sort={getAriaSort('FOB')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('FOB')}
                            className="w-full flex items-center justify-end gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por FOB"
                          >
                            FOB
                            {renderSortIndicator('FOB')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('Adjunto')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('Adjunto')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por adjunto"
                          >
                            Adjunto
                            {renderSortIndicator('Adjunto')}
                          </button>
                        </th>
                        <th className="py-2 px-3" aria-sort={getAriaSort('Vinculos')}>
                          <button
                            type="button"
                            onClick={() => toggleSort('Vinculos')}
                            className="flex items-center gap-2 font-medium text-slate-200 hover:text-white focus:outline-none"
                            title="Ordenar por vínculos"
                          >
                            Vínculos
                            {renderSortIndicator('Vinculos')}
                          </button>
                        </th>
                        <th className="py-2 px-3">Acciones</th>
                      </tr>
                    </thead>

                    <tbody>
                      {paginatedDespachos.map((d) => {
                        const abierto = expanded.has(d.Despacho);
                        const info = cache[d.Despacho];
                        const count = linksCount[d.ID] ?? 0;
                        const tipo = (d.TipoDespacho || '').toUpperCase();
                        return (
                          <Fragment key={d.ID}>
                            <tr className="border-t border-white/10">
                              <td className="py-2 px-3">
                                <button
                                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                                  onClick={() => toggleExpand(d.Despacho)}
                                  title={abierto ? "Contraer" : "Expandir"}
                                >
                                  {abierto ? "▾" : "▸"}
                                </button>
                              </td>
                              <td className="py-2 px-3">{d.ID}</td>
                              <td className="py-2 px-3">{d.OC_ID || <span className="text-slate-400 text-xs">-</span>}</td>
                              <td className="py-2 px-3 font-medium">{d.Despacho}</td>
                              {/* Tipo */}
                              <td className="py-2 px-3">
                                {tipo ? (
                                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/20">
                                    <span className="w-1.5 h-1.5 mr-1 rounded-full bg-indigo-300" />
                                    {tipo}
                                  </span>
                                ) : <span className="text-slate-400 text-xs">-</span>}
                              </td>
                              <td className="py-2 px-3">{d.Fecha || ""}</td>
                              <td className="py-2 px-3 text-right">{money(d.FOB)}</td>
                              <td className="py-2 px-3">
                                {d.HasDoc && d.DocUrl ? (
                                  <span
                                    title={d.DocName || "Adjunto disponible"}
                                    className="inline-flex items-center gap-1 text-indigo-300"
                                  >
                                    <span className="text-xs">Adjunto disponible</span>
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-xs">—</span>
                                )}
                              </td>

                              {/* Badge con la cantidad de facturas */}
                              <td className="py-2 px-3">
                                {cargandoVinculos ? (
                                  <span className="text-slate-400 text-xs">…</span>
                                ) : count > 0 ? (
                                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-400/40">
                                    {count} factura{count === 1 ? "" : "s"}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-rose-600/30 border border-rose-400/40">
                                    Sin factura
                                  </span>
                                )}
                              </td>

                              <td className="py-2 px-3">
                                <button
                                  className="px-2 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                  onClick={() => handleEditarClick(d.ID)}
                                >
                                  Editar
                                </button>
                              </td>
                            </tr>

                            {abierto && (
                              <tr className="bg-black/20">
                                {/* ⬇️ colSpan actualizado: 10 columnas */}
                                <td colSpan={10} className="p-0">
                                  <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    {/* Facturas */}
                                    <div className="lg:col-span-8">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-semibold">Facturas asociadas</div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs"
                                            onClick={() => fetchDespachoData(d.Despacho, { force: true })}
                                          >
                                            Refrescar
                                          </button>
                                          <button
                                            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs"
                                            onClick={goFacturas}
                                          >
                                            Nueva factura
                                          </button>
                                        </div>
                                      </div>

                                      {(!info || info.loading) ? (
                                        <div className="text-slate-400 text-sm">Cargando…</div>
                                      ) : info.facturas.length ? (
                                        <div className="overflow-x-auto rounded border border-white/10">
                                          <table className="min-w-full text-xs">
                                            <thead className="bg-white/5">
                                              <tr>
                                                <th className="text-left p-2">Fecha</th>
                                                <th className="text-left p-2">Proveedor</th>
                                                <th className="text-left p-2">N° Factura</th>
                                                <th className="text-left p-2">Tipo Gasto</th>
                                                <th className="text-right p-2">Moneda</th>
                                                <th className="text-right p-2">Importe</th>
                                                <th className="text-left p-2">Adjunto</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {info.facturas.map((f) => (
                                                <tr key={f.ID} className="border-t border-white/10">
                                                  <td className="p-2">{f.Fecha || ""}</td>
                                                  <td className="p-2">{f.Proveedor || ""}</td>
                                                  <td className="p-2">{f.nroFactura || f.Invoice || ""}</td>
                                                  <td className="p-2">{f.TipoGastoNombre || f.TipoGastoId || ""}</td>
                                                  <td className="p-2 text-right">{f.Moneda || "ARS"}</td>
                                                  <td className="p-2 text-right">{money(f.Importe)}</td>
                                                  <td className="p-2">
                                                    {f.HasDoc && f.DocUrl ? (
                                                      <span className="text-indigo-300">Adjunto disponible</span>
                                                    ) : <span className="text-slate-400">—</span>}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      ) : (
                                        <div className="text-slate-400 text-sm">No hay facturas para este despacho.</div>
                                      )}
                                    </div>

                                    {/* Resumen por tipo */}
                                    <div className="lg:col-span-4">
                                      <div className="text-sm font-semibold mb-2">Resumen por tipo de gasto</div>
                                      {(!info || info.loading) ? (
                                        <div className="text-slate-400 text-sm">Cargando…</div>
                                      ) : info.resumen.length ? (
                                        <div className="rounded border border-white/10">
                                          <table className="w-full text-xs">
                                            <tbody>
                                              {info.resumen.map((r) => (
                                                <tr key={r.TipoGastoId} className="border-t border-white/10">
                                                  <td className="p-2">{r.TipoGastoNombre}</td>
                                                  <td className="p-2 text-right">{money(r.Total)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      ) : (
                                        <div className="text-slate-400 text-sm">Sin totales para mostrar.</div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}

                      {!paginatedDespachos.length && (
                        <tr>
                          <td className="py-3 px-3 text-center text-slate-400" colSpan={10}>
                            {linkFilter === 'NO_LINKS'
                              ? 'No hay despachos sin facturas asociadas.'
                              : linkFilter === 'WITH_LINKS'
                                ? 'No hay despachos con facturas asociadas.'
                                : 'No se encontraron despachos con los filtros aplicados.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>No se encontraron despachos cargados.</p>
            )}
          </>
        );
    }
  };

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/70 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Comercio Exterior</h1>
          <div className="flex gap-2">
            {/* ⬅️ Botón para volver al inicio */}
            <button
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-white font-medium hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
              onClick={() => navigate('/')}
              title="Volver al inicio"
            >
              ← Inicio
            </button>

            <button
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              onClick={() => setVistaActual('tabla_despachos')}
            >
              Ver Despachos
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              onClick={goFacturas}
            >
              Ver Facturas
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
              onClick={() => setVistaActual('repositorio')}
            >
              Consultar Repositorio
            </button>
            {/* ⬇️ Acceso directo a Zona Franca */}
            <button
              className="px-3 py-1.5 rounded-lg bg-fuchsia-700 text-white font-medium hover:bg-fuchsia-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
              onClick={() => setVistaActual('zf')}
            >
              Zona Franca
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-none mx-auto px-6 lg:px-8 py-6">
        <Suspense fallback={<div className="py-10 text-center text-slate-300">Cargando…</div>}>
          {renderizarVista()}
        </Suspense>
      </main>
    </div>
  );
}

export default App;
