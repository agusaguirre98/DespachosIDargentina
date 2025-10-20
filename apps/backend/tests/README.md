# Pruebas del backend

Coloca aquí los tests automatizados del backend (pytest/unittest). Puedes estructurarlos por dominio replicando los paquetes de `src/api`.

Recomendaciones:
- Usa `pytest` como runner principal (`poetry run pytest` o `python -m pytest`).
- Simula dependencias externas (SQL Server, Graph API) con fixtures y `pytest-mock`.
- Define datos de prueba reutilizables en `conftest.py`.
