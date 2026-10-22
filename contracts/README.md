# Contratos v1 · P1 + P3

Este directorio es el contrato compartido entre la app (TypeScript), la API HTTPS del VPS y el runtime Android. La referencia de producto y arquitectura está en [docs/TDD.md](../docs/TDD.md) y la guía de campos en [docs/CONTRACTS.md](../docs/CONTRACTS.md).

Estado actual: **v1 cerrada para P0** (propuesta puntual y semanal, aceptar/rechazar/otra hora/desactivar, acuse de programación y retirada). Gastos, huchas y agente se añaden con su propia versión.

## Contenido

```text
schemas/
  common.schema.json               # identificadores, tiempo, estados, códigos de error
  operation-envelope.schema.json   # sobre común de toda operación
  create-alarm-request.schema.json
  respond-to-alarm.schema.json
  report-schedule.schema.json
  withdraw-alarm-request.schema.json
  operation-receipt.schema.json    # respuesta común
  app-error.schema.json            # error tipado
  alarm-request.schema.json        # DTO compartido (persistido en SQLite servidor)
  recipient.schema.json            # decisión individual
  schedule.schema.json             # acuse por ocurrencia
fixtures/
  manifest.json                    # índice de casos: válidos, inválidos y semánticos
  operations/                      # sobres completos de ejemplo
  documents/                       # respuestas y documentos de ejemplo
  invalid/                         # rechazables por forma (JSON Schema)
  semantic/                        # forma válida, semántica inválida (validador TS)
```

## Verificación

```sh
npm run test:contracts   # JSON Schema + fixtures + cobertura del manifiesto
npm test                 # semántica del dominio (incluye estos mismos fixtures)
```

`scripts/contracts/check.mjs` detecta además fixtures huérfanos: todo archivo de `fixtures/` debe estar en el manifiesto. Los casos `semantic` son válidos para JSON Schema a propósito: los rechaza `src/domain/contracts/validate.ts` (zona IANA inexistente, instante que no corresponde a la hora civil, título en blanco, `consentScope` en una decisión que no es `ACCEPTED`).

## Reglas de cambio

- **Añadir un campo opcional** en el mismo cambio: esquema, tipo en `src/domain/contracts/types.ts`, validador en `src/domain/contracts/validate.ts`, fixture que lo use y nota en `docs/CONTRACTS.md`.
- **Renombrar, quitar o cambiar el significado** de un campo o de una versión: requiere `schemaVersion` nueva y consumidores actualizados. No se reciclan nombres.
- **Estados:** cada eje (propuesta, recepción, decisión, programación, sincronización) mantiene sus valores; no se añade un enum único.
- **Identidad:** `uid` sale de la sesión bearer opaca verificada en el servidor. `actorUid` en el cuerpo es un error, no una autoridad.
- **Tiempo:** instantes en milisegundos UTC enteros; zona IANA; hora civil conservada. No se envían cadenas ISO para el instante.
- **Dinero (más adelante):** enteros en céntimos y una moneda por grupo.
- **Privacidad:** los fixtures son sintéticos. No incluir tokens, correos reales ni datos de un piso real.

Los nombres de código van en inglés; la documentación, en español. Cualquier cambio de `contracts/` se revisa con P3 y, si toca ocurrencias o el acuse, con P4.

## Qué sigue pendiente (B02)

1. Implementar `POST /v1/operations/{operationName}` en `server/src/operations/` con transacciones SQLite, sesión, autorización e idempotencia (P3) antes de devolver éxito.
2. Usar estos esquemas compartidos en `server/src/contracts/` o generar su validación desde aquí; los validadores de `functions/src/contracts/` son legado, no una segunda autoridad.
3. Generar tipos/constantes para Kotlin o documentar el mapeo de estados del acuse con P4.
4. Añadir idiomas si la demo lo requiere: hoy los mensajes de error van en español de España.

## Cambio de backend y compatibilidad

La arquitectura objetivo usa SQLite en el VPS, `expo-sqlite` como proyección/outbox en el móvil y el store nativo para ejecutar alarmas. HTTP conserva los sobres y respuestas v1; un nombre de tabla no reemplaza un nombre de DTO. Algunos títulos/descripciones de JSON Schema aún contienen rutas históricas o la palabra callable: son metadatos heredados, no una dependencia funcional de Firebase. Esta actualización modifica documentación; no cambia JSON Schema, fixtures ni el código del backend.

P1/P3 cerrarán los fixtures de sesión, consultas paginadas y sincronización por cursor antes de conectar P2/P5. Se mantiene `additionalProperties: false`: IDs o metadatos nuevos de transporte pertenecen a un wrapper acordado, no a campos improvisados dentro de los DTO. Ver [transporte y estado real](../docs/CONTRACTS.md#9-transporte-https-y-almacenamiento-objetivo).
