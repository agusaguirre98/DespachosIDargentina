import React, { useState, useEffect } from 'react';

const PaginaRepositorio = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [path, setPath] = useState(''); // raíz

  const obtenerContenidoRepositorio = async (ruta) => {
    setCargando(true);
    setError(null);
    try {
      const response = await fetch(`/api/repositorio/${encodeURIComponent(ruta)}`);
      if (!response.ok) throw new Error("No se pudo obtener el contenido del repositorio.");
      const data = await response.json();
      setItems(data);
    } catch (error) {
      setError(error.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { obtenerContenidoRepositorio(path); }, [path]);

  const handleIrAtras = () => {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    setPath(parts.join('/'));
  };

  const handleNavegar = (nombre, tipo, url) => {
    if (tipo === 'Carpeta') {
      setPath(path ? `${path}/${nombre}` : nombre);
    } else if (tipo === 'Archivo' && url) {
      window.open(url, '_blank');
    }
  };

  if (cargando) return <div>Cargando contenido del repositorio...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h2>Consultar Repositorio</h2>
      {path && <button onClick={handleIrAtras}>Volver</button>}
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
              {item.tipo === 'Archivo' && <span> - Modificado por: {item.modificado_por}</span>}
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
