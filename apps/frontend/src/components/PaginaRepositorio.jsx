import React, { useEffect, useMemo, useState } from 'react';

const ROOT_PATH = '';
const selectOptionStyle = { color: '#0f172a' };

const PaginaRepositorio = () => {
  const [items, setItems] = useState([]);
  const [rootFolders, setRootFolders] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [path, setPath] = useState(ROOT_PATH);
  const [searchText, setSearchText] = useState('');

  const segmentosPath = useMemo(
    () => (path || '').split('/').filter(Boolean),
    [path]
  );

  const carpetaBaseSeleccionada = segmentosPath[0] || ROOT_PATH;

  const normalizarRespuesta = (data) => {
    if (Array.isArray(data)) {
      return data;
    }

    if (data?.items && Array.isArray(data.items)) {
      return data.items.map((it) => ({
        nombre: it.name || it.nombre || '',
        tipo: it.isFolder ? 'Carpeta' : 'Archivo',
        url: it.webUrl || it.url || '',
        nextPath: it.nextPath || '',
        modificado: it.lastModifiedDateTime || '',
        modificado_por:
          it.lastModifiedBy?.user?.displayName ||
          it.modificado_por ||
          '',
      }));
    }

    const carpetas = Array.isArray(data?.carpetas) ? data.carpetas : [];
    const archivos = Array.isArray(data?.archivos) ? data.archivos : [];

    if (carpetas.length || archivos.length) {
      return [
        ...carpetas.map((c) => ({ ...c, tipo: 'Carpeta' })),
        ...archivos.map((a) => ({ ...a, tipo: 'Archivo' })),
      ];
    }

    return [];
  };

  const obtenerContenidoRepositorio = async (rutaActual) => {
    setCargando(true);
    setError(null);
    try {
      const ruta = (rutaActual ?? '').trim();
      const params = new URLSearchParams();
      params.set('path', ruta);
      params.set('top', '50');

      const response = await fetch(`/api/repositorio/?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || 'No se pudo obtener el contenido del repositorio.');
      }

      setItems(normalizarRespuesta(data));
    } catch (err) {
      setError(err.message || String(err));
      setItems([]);
    } finally {
      setCargando(false);
    }
  };

  const obtenerCarpetasRaiz = async () => {
    try {
      const params = new URLSearchParams();
      params.set('path', ROOT_PATH);
      params.set('top', '50');

      const response = await fetch(`/api/repositorio/?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || 'No se pudo obtener la raiz del repositorio.');
      }

      const carpetas = normalizarRespuesta(data)
        .filter((item) => item.tipo === 'Carpeta')
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

      setRootFolders(carpetas);
    } catch (err) {
      console.error('Error cargando carpetas raiz del repositorio:', err);
      setRootFolders([]);
    }
  };

  useEffect(() => {
    obtenerCarpetasRaiz();
  }, []);

  useEffect(() => {
    obtenerContenidoRepositorio(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const handleIrAtras = () => {
    const parts = [...segmentosPath];
    parts.pop();
    const nueva = parts.join('/');
    setPath(nueva || ROOT_PATH);
  };

  const handleNavegar = (item) => {
    const { tipo, url, nextPath, nombre } = item;
    if (tipo === 'Carpeta') {
      setSearchText('');
      setPath(nextPath || (path ? `${path}/${nombre}` : nombre));
    } else if (tipo === 'Archivo' && url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSeleccionCarpetaBase = (event) => {
    const nuevaBase = event.target.value;
    setSearchText('');
    setPath(nuevaBase || ROOT_PATH);
  };

  const handleBreadcrumbClick = (index) => {
    setSearchText('');
    if (index < 0) {
      setPath(ROOT_PATH);
      return;
    }

    setPath(segmentosPath.slice(0, index + 1).join('/'));
  };

  const itemsFiltrados = useMemo(() => {
    if (!searchText.trim()) return items;

    const q = searchText.toLowerCase();

    return items.filter((item) =>
      (item.nombre || '').toLowerCase().includes(q) ||
      (item.modificado_por || '').toLowerCase().includes(q)
    );
  }, [items, searchText]);

  const itemsOrdenados = useMemo(() => {
    return [...itemsFiltrados].sort((a, b) => {
      if (a.tipo !== b.tipo) {
        return a.tipo === 'Carpeta' ? -1 : 1;
      }
      return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
    });
  }, [itemsFiltrados]);

  if (cargando) return <div>Cargando contenido del repositorio...</div>;
  if (error) return <div style={{ color: '#ff6b6b' }}>Error: {error}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-3">Consultar Repositorio</h2>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="w-full md:max-w-sm">
            <label htmlFor="carpeta-base" className="block text-sm mb-1">
              Carpeta base
            </label>
            <select
              id="carpeta-base"
              value={carpetaBaseSeleccionada}
              onChange={handleSeleccionCarpetaBase}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100"
            >
              <option value="" style={selectOptionStyle}>
                Documentos
              </option>
              {rootFolders.map((folder) => (
                <option
                  key={folder.nombre}
                  value={folder.nextPath || folder.nombre}
                  style={selectOptionStyle}
                >
                  {folder.nombre}
                </option>
              ))}
            </select>
          </div>

          {segmentosPath.length > 0 && (
            <button
              type="button"
              onClick={handleIrAtras}
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 hover:bg-white/15 text-slate-100"
            >
              Volver
            </button>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-300">
        <span className="mr-2">Carpeta actual:</span>
        <button type="button" onClick={() => handleBreadcrumbClick(-1)} className="hover:underline">
          /Documentos
        </button>
        {segmentosPath.map((segmento, index) => (
          <span key={`${segmento}-${index}`}>
            {' / '}
            <button type="button" onClick={() => handleBreadcrumbClick(index)} className="hover:underline">
              {segmento}
            </button>
          </span>
        ))}
      </div>

      <div>
        <input
          type="text"
          placeholder="Buscar carpeta o archivo..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 outline-none text-slate-100 placeholder:text-slate-400"
        />
      </div>

      {itemsOrdenados.length > 0 ? (
        <div className="space-y-2">
          {itemsOrdenados.map((item, index) => {
            const esCarpeta = item.tipo === 'Carpeta';
            return (
              <button
                key={`${item.tipo}-${item.nombre}-${index}`}
                type="button"
                onClick={() => handleNavegar(item)}
                className="w-full text-left px-3 py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100 truncate">
                      {esCarpeta ? '[Carpeta]' : '[Archivo]'} {item.nombre}
                    </div>
                    {!esCarpeta && item.modificado_por ? (
                      <div className="text-xs text-slate-400 truncate">
                        Modificado por: {item.modificado_por}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-xs text-slate-400">
                    {esCarpeta ? 'Abrir' : 'Ver archivo'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-slate-300">Esta carpeta no contiene archivos ni subcarpetas.</p>
      )}
    </div>
  );
};

export default PaginaRepositorio;

