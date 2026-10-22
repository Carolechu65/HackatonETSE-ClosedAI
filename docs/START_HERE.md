# Empezar a implementar alarmaT

Base pequeña para seis personas. Hay pantalla Expo con aceptar/rechazar en memoria, contratos, adaptadores pendientes, un módulo Kotlin mínimo y funciones Firebase que rechazan operaciones todavía no implementadas. Ningún botón activa alarmas reales.

## Arranque

La app utiliza Expo SDK 58 y requiere Node 22.13 o posterior de la rama 22 (`.nvmrc`). Las versiones salen de la plantilla oficial y del instalador Expo, y quedan fijadas en `package-lock.json`.

```sh
nvm use
npm ci
npm --prefix functions ci
npm run check
```

`npm run check` encadena TypeScript de la app y de los tests, la verificación de contratos, la suite de Node y la compilación del backend. Comandos sueltos:

```sh
npm run typecheck        # app + tests
npm run test:contracts   # esquemas JSON + fixtures (P1/P3)
npm test                 # dominio, tiempo, consentimiento y fakes
npm run export:android   # empaqueta el JavaScript; no compila Kotlin
```

Para crear la primera development build Android, prepara Android Studio/SDK, Java y un dispositivo o emulador:

```sh
npm run android
```

Para sesiones posteriores con esa build instalada:

```sh
npm start
```

`npm run export:android` comprueba el empaquetado JavaScript; no compila Kotlin ni valida permisos o sonido. **La compilación del APK y la instalación en un móvil físico siguen pendientes de P1/P4**; es el único criterio de A01 que no se puede verificar desde este entorno.

Verificado en este arranque: `npm ci` limpio con Node 22/26, TypeScript estricto, contratos y 34 tests de dominio, compilación del backend y exportación JavaScript Android. La auditoría npm de la app señala avisos altos transitivos en `braces` y `node-forge` y sus dependientes; no ofrece una corrección compatible con el stack actual. Queda revisar parches compatibles antes de distribuir; no aplicar el downgrade de Expo/React Native que propone `audit fix --force`. El backend actualizado no presenta avisos en su auditoría de instalación.

## Una entrada por persona

| Persona | Empieza aquí | Primera entrega |
|---|---|---|
| P1 · Base y contratos | `package.json`, `app.config.ts`, `src/domain/`, `contracts/`, `src/ui/` | Build reproducible, contratos v1, tipos/puertos, fixtures, Clock y composición. |
| P2 · Pantallas | `app/index.tsx`, `src/features/alarms/AlarmInboxScreen.tsx`, `src/features/auth/`, `groups/` | Formulario de propuesta y sesión real; sustituir datos de ejemplo. |
| P3 · Firebase y agente | `functions/src/index.ts`, `functions/src/operations/`, `functions/src/agents/`, `firebase/` | Crear/responder con transacciones y autorización; concretar borrador/clarificación del agente. |
| P4 · Alarmas Android | `src/platform/alarms/index.ts`, `modules/alarm-runtime/` | Programar, sonar y detener una alarma consentida sin JS vivo. |
| P5 · Datos y sincronización | `src/data/alarmRepository.ts`, `src/platform/sync/outbox.ts`, `src/bootstrap/index.ts` | SQLite + RNFirebase; conservar estados pendientes y conciliar versiones. |
| P6 · Widget, tareas e integración | `src/widgets/snapshot.ts`, `src/features/tasks/TaskPreview.tsx` | Widget Android mínimo con deep link y tarea vinculada; prueba entre dos móviles. |

Cada área incluye comentarios o README con el siguiente paso. El [TDD](TDD.md) define el contrato objetivo y [TEAM_PLAN](TEAM_PLAN.md) las horas/dependencias.

Para encargar la implementación a vuestro agente, copia el [prompt completo de tu persona](prompts/README.md). Cada uno incluye subencargos concretos, archivos permitidos, contratos, pruebas y criterios de entrega. El agente de IA pertenece a P3 y tiene un subprompt específico.

## Estado de A01 · base y contratos v1 (P1)

Ya está en la rama compartida y pasa `npm run check`:

- **Build reproducible:** `npm ci` arreglado con `overrides["react-dom"]`; `expo-font`, Fraunces y DM Mono fijados. Detalle en [ADR-001](adr/001-base-expo-y-lockfile.md).
- **Contratos v1:** 11 esquemas JSON, 33 fixtures y verificación con `npm run test:contracts`. Guía de consumo en [CONTRACTS](CONTRACTS.md) y reglas de cambio en [`contracts/README.md`](../contracts/README.md).
- **Dominio:** ejes de estado separados, consentimiento por versión, tiempo y recurrencia con política de cambio horario ([ADR-002](adr/002-ejes-de-estado.md), [ADR-003](adr/003-politica-dst.md)), validadores de entrada, identidad de ocurrencia, puertos, fakes y composición de dependencias.
- **UI común:** tokens y primitivos de Nevera Retro en `src/ui/` con el layout raíz y una ruta `+not-found`. P2 compone las pantallas. Rutas y deep links acordados en [ROUTES](ROUTES.md).
- **CI:** `.github/workflows/ci.yml` instala, comprueba y empaqueta en Node 22.

Pendiente de P1: instalar la development build en un móvil físico (con P4), revisar avisos de auditoría compatibles y mantener el lockfile cuando P4/P5 añadan dependencias nativas.

Para P2/P5, punto de partida del dominio:

```ts
import {
  parseRespondToAlarm, createFakeClock, createInMemoryAlarmRepository,
  createFakeAlarmRuntime, type AlarmSummary,
} from './src/domain/index.ts';
```

No importar adaptadores concretos desde las pantallas: usar `src/composition/index.ts`.


## Qué está deliberadamente pendiente

- **Firebase cliente:** todavía no se instalan ni configuran RNFirebase, credenciales cliente ni handlers FCM. P3/P5 los añaden juntos y reconstruyen la app.
- **Backend:** los callable tienen validación inicial y devuelven `unimplemented`; no guardan ni envían propuestas. Las Rules deniegan todo hasta implementar permisos y sus pruebas.
- **Alarma sonora:** el módulo nativo declara sus capacidades como no disponibles y rechaza programar/cancelar. La interfaz TypeScript funciona como punto de conexión.
- **Widgets:** hay una proyección pura; no se registra todavía un widget en el launcher. P6 instala/configura expo-widgets y valida el runtime aislado.
- **Agente:** existe su punto de entrada y contrato de borrador/clarificación; falta conectar un modelo, herramientas autorizadas y confirmación humana.
- **Automatizaciones:** el outbox es un contrato inicial; recurrencia, reintentos y cancelaciones por tareas están pendientes.

La demo en memoria pierde cambios al reiniciar. Aceptar produce «activación pendiente», nunca un éxito de programación ficticio. No marcar las features completas hasta integrar y comprobar el flujo real.

## Integración breve

Ramas cortas por entrega, revisión cruzada de contratos y push frecuente. Evitar cambios simultáneos de lockfile/configuración: P1 los integra. Antes de conectar Firebase, seguir la [guía del backend](../functions/README.md). No subir credenciales de servidor ni archivos de servicios privados.
