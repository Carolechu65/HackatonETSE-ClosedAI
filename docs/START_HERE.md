# Empezar a implementar alarmaT

Base pequeña para seis personas. La arquitectura objetivo usa API HTTPS propia y SQLite en el VPS, además de SQLite local en el móvil. El código actual conserva `functions/` y `firebase/` como scaffold legado; P3 debe migrarlo a `server/`. Esta revisión modifica especificaciones, no implementa ni despliega ese servidor. Ningún botón de demo activa alarmas reales.

## Arranque

La app utiliza Expo SDK 58 y requiere Node 22.13 o posterior de la rama 22 (`.nvmrc`). Las versiones salen de la plantilla oficial y del instalador Expo, y quedan fijadas en `package-lock.json`.

```sh
nvm use
npm ci
npm --prefix functions ci
npm run check
```

`npm run check` encadena TypeScript, contratos, tests y la compilación del scaffold antiguo de `functions/`. Se conserva este comando porque el código aún no se ha migrado: **no verifica el futuro servidor SQLite**. P1/P3 actualizarán scripts y CI al crear `server/`. Comandos actuales:

```sh
npm run typecheck        # app + tests
npm run test:contracts   # esquemas JSON + fixtures (P1/P3)
npm test                 # dominio, tiempo, consentimiento y fakes
npm run export:android   # empaqueta el JavaScript; no compila Kotlin
npm run web              # vista rápida en localhost (no sustituye la dev build)
```

Para crear la primera development build Android, prepara Android Studio/SDK, Java y un dispositivo o emulador:

```sh
npm run android
```

Para sesiones posteriores con esa build instalada:

```sh
npm start
```

`npm run export:android` comprueba el empaquetado JavaScript; no compila Kotlin ni valida permisos o sonido.

La development build **sí compila** en este entorno, sin depender de un móvil:

```sh
npx expo prebuild --platform android --no-install
cd android && ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleDebug
# BUILD SUCCESSFUL · android/app/build/outputs/apk/debug/app-debug.apk (254 MB, debug, todas las ABI)
```

Esa build incluye `expo-dev-client` y compila el módulo local: se genera `modules/alarm-runtime/android/build/outputs/aar/alarm-runtime-debug.aar`. El APK se instaló en el emulador Pixel 10 (API 37): la app arranca, carga las fuentes del estilo, muestra el tablón de Nevera Retro y el icono de la campana aparece en el lanzador de desarrollo. **Pendiente:** teléfono Android real, permisos, sonido, splash en arranque en frío y detención con la pantalla bloqueada (P1/P4). El tamaño de 254 MB es de debug con todas las ABI; no representa el de release.

Validación registrada en la entrega A01: `npm ci` limpio con Node 22/26, TypeScript estricto, 15 esquemas y 42 fixtures de contrato, **59 tests** de dominio, transporte y diseño, compilación del backend heredado en `functions/`, exportación JavaScript Android, APK de debug con Kotlin (`assembleDebug`, 15 min 55 s el primero, 7–8 min los incrementales) y arranque en emulador. La auditoría npm de la app señala avisos altos transitivos en `braces` y `node-forge` y sus dependientes; no ofrece una corrección compatible con el stack actual. Queda revisar parches compatibles antes de distribuir; no aplicar el downgrade de Expo/React Native que propone `audit fix --force`. La auditoría registrada del backend heredado no presenta avisos; esto no valida el futuro servidor SQLite.

## Una entrada por persona

| Persona | Empieza aquí | Primera entrega |
|---|---|---|
| P1 · Base y contratos | `package.json`, `app.config.ts`, `src/domain/`, `contracts/`, `src/ui/` | Build reproducible, contratos v1, tipos/puertos, fixtures, Clock y composición. |
| P2 · Pantallas | `app/index.tsx`, `src/features/alarms/AlarmInboxScreen.tsx`, `src/features/auth/`, `groups/` | Formulario de propuesta y sesión real; sustituir datos de ejemplo. |
| P3 · Backend SQLite/VPS y agente | [Prompt P3](prompts/03_SQLITE_VPS_AGENT.md); migrar `functions/` a `server/src/` y crear migraciones SQL | API propia, sesiones, autorización/transacciones; borrador y aclarificación del agente. |
| P4 · Alarmas Android | `src/platform/alarms/index.ts`, `modules/alarm-runtime/` | Programar, sonar y detener una alarma consentida sin JS vivo. |
| P5 · Datos y sincronización | `src/data/alarmRepository.ts`, `src/platform/sync/outbox.ts`, `src/bootstrap/index.ts` | SQLite local + API HTTP + SecureStore; conservar pendientes y conciliar versiones. |
| P6 · Widget, tareas e integración | `src/widgets/snapshot.ts`, `src/features/tasks/TaskPreview.tsx` | Widget Android mínimo con deep link y tarea vinculada; prueba entre dos móviles. |

Cada área incluye comentarios o README con el siguiente paso. El [TDD](TDD.md) define el contrato objetivo y [TEAM_PLAN](TEAM_PLAN.md) las horas/dependencias.

Para encargar la implementación a vuestro agente, copia el [prompt completo de tu persona](prompts/README.md). Cada uno incluye subencargos concretos, archivos permitidos, contratos, pruebas y criterios de entrega. El agente de IA pertenece a P3 y tiene un subprompt específico.

## Estado de A01 · base y contratos v1 (P1)

Ya está en la rama compartida y pasa `npm run check`:

- **Build reproducible:** `npm ci` arreglado con `overrides["react-dom"]`; `expo-font`, Fraunces y DM Mono fijados. Detalle en [ADR-001](adr/001-base-expo-y-lockfile.md).
- **Contratos v1:** 11 esquemas JSON, 33 fixtures y verificación con `npm run test:contracts`. Guía de consumo en [CONTRACTS](CONTRACTS.md) y reglas de cambio en [`contracts/README.md`](../contracts/README.md).
- **Dominio:** ejes de estado separados, consentimiento por versión, tiempo y recurrencia con política de cambio horario ([ADR-002](adr/002-ejes-de-estado.md), [ADR-003](adr/003-politica-dst.md)), validadores de entrada, identidad de ocurrencia, puertos, fakes y composición de dependencias.
- **UI común:** tokens y primitivos de Nevera Retro en `src/ui/` con el layout raíz y una ruta `+not-found`. P2 compone las pantallas. Rutas y deep links acordados en [ROUTES](ROUTES.md).
- **Build Android:** `expo prebuild` + `assembleDebug` generan un APK debug completo (`android/app/build/outputs/apk/debug/app-debug.apk`) con el módulo `alarm-runtime` compilado. El primer build tardó 15 min 55 s; los incrementales, 7–8 min.
- **Marca:** campanita con la T girada −42° formando el tick, adaptive icon en el círculo seguro y splash menta. Fuentes en `assets/brand/*.svg`, PNG con `npm run brand:render` y decisión en [ADR-005](adr/005-marca-e-icono.md). El despertador queda generado como alternativa.
- **Transporte HTTP:** mapeo estado↔código (`src/domain/http.ts`), normalización de errores sin JSON, fixtures de sesión, feed por cursor, lista y detalle, y configuración de `EXPO_PUBLIC_API_URL` con HTTPS obligatorio (`src/config/api.ts`). Detalle en [CONTRACTS §9](CONTRACTS.md#9-transporte-https-y-almacenamiento-objetivo).
- **CI:** `.github/workflows/ci.yml` instala, comprueba y empaqueta en Node 22.

Pendiente de P1: instalar la development build en un móvil **físico** (con P4), validar el arranque en frío y el splash en dispositivo, revisar avisos de auditoría compatibles y mantener el lockfile cuando P4/P5 añadan dependencias nativas.

Para P2/P5, punto de partida del dominio:

```ts
import {
  parseRespondToAlarm, createFakeClock, createInMemoryAlarmRepository,
  createFakeAlarmRuntime, type AlarmSummary,
} from './src/domain/index.ts';
```

No importar adaptadores concretos desde las pantallas: usar `src/composition/index.ts`.


## Qué está deliberadamente pendiente

- **Cliente remoto:** P5 implementará HTTP, sesión en SecureStore, sincronización por cursor y push Expo opcional. No instalar RNFirebase para el nuevo backend.
- **Backend:** las funciones antiguas siguen devolviendo `unimplemented`; las Rules antiguas deniegan todo. P3 debe reemplazarlas por API HTTP, sesiones propias, migraciones SQLite y autorización probada; después retirará el legado con P1. No hay servidor SQLite ejecutable todavía.
- **Alarma sonora:** el módulo nativo declara sus capacidades como no disponibles y rechaza programar/cancelar. La interfaz TypeScript funciona como punto de conexión.
- **Widgets:** hay una proyección pura; no se registra todavía un widget en el launcher. P6 instala/configura expo-widgets y valida el runtime aislado.
- **Agente:** existe su punto de entrada y contrato de borrador/clarificación; falta conectar un modelo, herramientas autorizadas y confirmación humana.
- **Automatizaciones:** el outbox es un contrato inicial; recurrencia, reintentos y cancelaciones por tareas están pendientes.

La demo en memoria pierde cambios al reiniciar. Aceptar produce «activación pendiente», nunca un éxito de programación ficticio. No marcar las features completas hasta integrar y comprobar el flujo real.

## Integración breve

Ramas cortas por entrega, revisión cruzada de contratos y push frecuente. Evitar cambios simultáneos de lockfile/configuración: P1 los integra. Antes de conectar el VPS, seguir la [guía SQLite/VPS](SQLITE_VPS_PRACTICES.md) y el [registro de migración](MIGRATION_SQLITE.md). No subir credenciales de servidor ni archivos de servicios privados.
