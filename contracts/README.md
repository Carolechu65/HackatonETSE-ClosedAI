# P1 + P3 · contratos

Referencia normativa: [TDD](../docs/TDD.md). La UI inicial usa `src/domain/alarms.ts` como proyección pequeña, no como esquema completo del servidor.

Primera entrega conjunta: fijar los payloads de crear/responder/reportar, estados, errores y fixtures de versión vigente/obsoleta. Los validadores del backend viven inicialmente en `functions/src/contracts/`; convertirlos en esquemas compartidos antes de conectar consumidores.

No cambiar nombres de campos o significado de una versión sin actualizar backend, app y ejemplos en el mismo cambio.
