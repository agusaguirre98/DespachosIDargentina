import React, { useState, useEffect, useMemo } from 'react';

const PaginaRepositorio = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [path, setPath] = useState('Despachos');

  // 🔎 NUEVO: estado buscador
  const [searchText, setSearchText] = useState('');

  const normalizarRespuesta = (data) => {
    if (Array.isArray(data)) {
      return data;
    }

    if (data?.items && Array.isArray(data.items)) {
      return data.items.map((it) => ({
        nombre: it.name || it.nombre || '',
        tipo: it.isFolder ? 'Carpeta' : 'Archivo',
        url: it.webUrl || it.url || '',
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
      params.set('path', ruta === '' ? 'Despachos' : ruta);
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

  useEffect(() => {
    obtenerContenidoRepositorio(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const handleIrAtras = () => {
    const parts = (path || '').split('/').filter(Boolean);
    parts.pop();
    const nueva = parts.join('/');
    setPath(nueva || 'Despachos');
  };

  const handleNavegar = (nombre, tipo, url) => {
    if (tipo === 'Carpeta') {
      setPath(path ? `${path}/${nombre}` : nombre);
    } else if (tipo === 'Archivo' && url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // 🔎 NUEVO: filtrado cliente
  const itemsFiltrados = useMemo(() => {
    if (!searchText.trim()) return items;

    const q = searchText.toLowerCase();

    return items.filter((item) =>
      (item.nombre || '').toLowerCase().includes(q) ||
      (item.modificado_por || '').toLowerCase().includes(q)
    );
  }, [items, searchText]);

  if (cargando) return <div>Cargando contenido del repositorio...</div>;
  if (error) return <div style={{ color: '#ff6b6b' }}>Error: {error}</div>;

  return (
    <div>
      <h2>Consultar Repositorio</h2>

      {path && path !== 'Despachos' && (
        <button onClick={handleIrAtras} style={{ marginBottom: '10px' }}>
          Volver
        </button>
      )}

      <h3>Carpeta Actual: /{path}</h3>

      {/* 🔎 BUSCADOR */}
      <div style={{ margin: '15px 0' }}>
        <input
          type="text"
          placeholder="Buscar archivo..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #ccc',
          }}
        />
      </div>

      {itemsFiltrados.length > 0 ? (
        <ul>
          {itemsFiltrados.map((item, index) => (
            <li
              key={`${item.tipo}-${item.nombre}-${index}`}
              onClick={() => handleNavegar(item.nombre, item.tipo, item.url)}
              style={{
                cursor: item.tipo === 'Carpeta' ? 'pointer' : 'default',
                marginBottom: '6px',
              }}
            >
              {item.tipo === 'Carpeta' ? '📁' : '📄'} {item.nombre}
              {item.tipo === 'Archivo' && item.modificado_por ? (
                <span> — Modificado por: {item.modificado_por}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Esta carpeta no contiene archivos ni subcarpetas.</p>
      )}
    </div>
  );
};

export default PaginaRepositorio;