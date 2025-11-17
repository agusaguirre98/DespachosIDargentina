import React, { useState, useEffect } from 'react';

const PaginaRepositorio = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  // Empezamos en la carpeta base del back
  const [path, setPath] = useState('Despachos');

  const normalizarRespuesta = (data) => {
    // Soporta distintas formas que puede devolver el back
    // 1) { ok, items: [{ name, isFolder, webUrl, ... }] }
    // 2) { carpetas: [...], archivos: [...] }
    // 3) Array simple (fallback)
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
      // 👉 Usá QUERY, no segmento, y tolerá undefined/null
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

  if (cargando) return <div>Cargando contenido del repositorio...</div>;
  if (error) return <div style={{ color: '#ff6b6b' }}>Error: {error}</div>;

  return (
    <div>
      <h2>Consultar Repositorio</h2>
      {path && path !== 'Despachos' && <button onClick={handleIrAtras}>Volver</button>}
      <h3>Carpeta Actual: /{path}</h3>

      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li
              key={`${item.tipo}-${item.nombre}-${index}`}
              onClick={() => handleNavegar(item.nombre, item.tipo, item.url)}
              style={{ cursor: item.tipo === 'Carpeta' ? 'pointer' : 'default' }}
            >
              {item.tipo === 'Carpeta' ? '📁' : '📄'} {item.nombre}
              {item.tipo === 'Archivo' && item.modificado_por
                ? <span> — Modificado por: {item.modificado_por}</span>
                : null}
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
