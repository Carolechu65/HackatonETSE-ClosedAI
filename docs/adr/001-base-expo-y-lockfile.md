# ADR-001 · Base Expo, versiones y `npm ci` reproducible

**Fecha:** 2026-10-22 · **Owner:** P1 · **Estado:** aceptado

## Contexto

El scaffold fijaba Expo SDK 58, React Native 0.88, React 19.3.0 y Node 22.13 (`package.json`, `.nvmrc`). Al ejecutar el comando documentado `npm ci` la instalación fallaba con `ERESOLVE`: el lockfile resolvía `react-dom@19.3.1` como peer de `expo-router`/Radix, pero la app fija `react@19.3.0` y `react-dom@19.3.1` exige `react ^19.3.1`. Sin instalación limpia no hay build ni CI para nadie.

Además, el estilo [Nevera Retro](../../nevera-retro.md) exige Fraunces y DM Mono, y no había forma de cargar fuentes.

## Decisión

1. Mantener las versiones del scaffold (Expo 58 / RN 0.88 / React 19.3.0 / Node 22). No se actualiza el SDK antes del hackathon.
2. Fijar `overrides: { "react-dom": "19.3.0" }`. `react-dom` no se usa en Android; el override solo alinea el peer que npm instala automáticamente. No se aplica `audit fix --force` ni `--legacy-peer-deps`, que ocultarían conflictos reales.
3. Añadir `expo-font` (`~58.0.9`) y `@expo-google-fonts/fraunces` / `@expo-google-fonts/dm-mono` para el sistema visual. Las fuentes se cargan en el layout raíz; si fallan, la app cae a `serif`/`monospace`.
4. Añadir `@types/node` (fijado a la misma versión que `functions/`) solo para los tests de Node.
5. Añadir `expo-system-ui` para que `userInterfaceStyle: "light"` se aplique de verdad (prebuild lo exigía) y evitar que Android pinte fondo oscuro.
6. Añadir `react-native-web` y `@expo/metro-runtime` solo para previsualizar la app en el navegador durante el hackathon (`npm run web`). No cambian el bundle Android, que sigue siendo el objetivo de la demo.
7. Comandos verificados: `npm ci`, `npm ci --prefix functions`, `npm run typecheck`, `npm test`, `npm run test:contracts`, `npm run check`, `npm run export:android` y `npx expo prebuild --platform android --no-install` (genera `android/` con el `applicationId` correcto; la carpeta está ignorada por Git).

## Consecuencias

- Añadir una dependencia nativa nueva (SQLite, RNFirebase, expo-widgets) obliga a reconstruir la development build; Fast Refresh no basta.
- `npm ci` se ejecutó con Node 26 en la máquina de desarrollo: funciona con avisos `EBADENGINE`. La versión soportada sigue siendo Node 22 (`.nvmrc`), que es la que usa CI.
- Si Expo publica una revisión que rompe el peer, la solución es alinear `react`/`react-dom`, no forzar la instalación.
- Las auditorías pendientes de `braces` y `node-forge` siguen abiertas: son transitivas y sin parche compatible con este stack; se revisan antes de distribuir.
- **No verificado todavía:** instalación en un móvil físico y compilación del APK (`npm run android`). Requiere Android Studio/SDK y un dispositivo; es la primera entrega pendiente de P1/P4.
