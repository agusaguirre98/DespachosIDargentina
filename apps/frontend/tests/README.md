# Tests del frontend

Ubica en este directorio los tests de la SPA (Vitest, React Testing Library o Cypress). Puedes mantener subcarpetas por ámbito (`unit`, `integration`, `e2e`).

Buenas prácticas:
- Configura `npm test -- --watch` para desarrollo y `npm run test:ci` para pipelines.
- Mockea llamadas a `fetch`/`axios` reutilizando el hook `useApi`.
- Documenta en cada suite el estado mínimo necesario para montar los componentes.
