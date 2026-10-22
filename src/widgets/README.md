# P6 · Widget y tareas

Estado: **incremento 2 integrado en código**; build Android y prueba física pendientes
(ver [`docs/demo.md`](../../docs/demo.md)).

## Piezas

| Archivo | Responsabilidad |
|---|---|
| `snapshot.ts` | Proyección pura v2: próxima ocurrencia confirmada y futura, contadores separados, frescura y alcance usuario/grupo. |
| `links.ts` | Contrato `alarmat://…`: construir, validar y convertir a ruta. Abrir un enlace nunca acepta ni programa. |
| `viewModel.ts` | Traduce el snapshot a props serializables (textos y enlaces) para el runtime aislado. |
| `AlarmaTWidget.tsx` | Plantilla Android con `@expo/ui/jetpack-compose`, directiva `'widget'`, sin hooks ni promesas. |
| `publisher.ts` | Única frontera con `expo-widgets`: `updateSnapshot`, limpieza al cerrar sesión, recarga. |
| `publish.ts` / `publish.native.ts` | Fachada segura: en web no importa `expo-widgets`; en Android publica de verdad. |
| `demoSnapshot.ts` | Cuatro estados de demostración para `/widget-lab` (datos simulados). |
| `WidgetPreview.tsx` | Simulación visual del widget en React Native para revisar estados sin launcher. |

## Uso desde la app (P5)

```ts
import { buildWidgetSnapshot, type WidgetAlarmInput } from '../widgets/snapshot.ts';
import { syncWidgetForSession } from '../widgets/publisher.ts';

const snapshot = buildWidgetSnapshot({ alarms, nowEpochMs: clock.nowEpochMs(), scope });
const result = syncWidgetForSession(snapshot, session, clock.nowEpochMs(), {
  timeZone: group.timeZone,
});
// result.published === false ⇒ no afirmar en la UI que el widget se actualizó.
```

`alarms` debe venir de la proyección reconciliada de P5 con los ejes del TDD
(`ProposalStatus`, `Decision`, `SchedulingStatus`). El adaptador `scaffoldAlarmInput`
existe solo para la bandeja de demostración y pierde matices (`SCHEDULING`/`FAILED`).

## Reglas que no se negocian

- `ACCEPTED` no es `SCHEDULED`: solo una ocurrencia `SCHEDULED`, futura y de una
  propuesta `ACTIVE` alimenta `nextAlarm`.
- Rechazada, retirada, caducada, desactivada, pendiente o `CANCEL_PENDING` no aparecen
  como alarma activa.
- El snapshot lleva `generatedAtEpochMs`; pasados 30 min el widget se marca como
  desactualizado pero no inventa un estado nuevo.
- Al cerrar sesión o cambiar de cuenta se publica el estado vacío
  (`syncWidgetForSession`), nunca el snapshot anterior.
- La plantilla solo pinta props. No consulta SQLite, el servidor ni el reloj.

## Apertura nativa Android

`plugins/with-widget-links.cjs` añade una acción Glance `actionStartActivity`
para los botones de `AlarmaTWidget` cuyo target sea una ruta interna exacta.
Se instala después de `expo-widgets` en `app.config.ts` y se aplica durante prebuild.
El parche está limitado a `expo-widgets@58.0.22`, es idempotente y detiene la
compilación si cambia la API. No necesita callbacks JS con el proceso vivo.

«Ver alarma» abre `alarmat://alarm/<id>`; «Ver propuestas» abre la bandeja.
Ninguno acepta ni programa. La pantalla debe verificar sesión, grupo y entidad.
El intent tiene componente y paquete explícitos para evitar abrir otra aplicación.
La marca «Lectura: fecha, hora» permanece verdadera cuando la app está cerrada;
no se infiere que una lectura antigua signifique falta de conexión.

Pruebas y protocolo físico: [`docs/qa/P6_WIDGET.md`](../../docs/qa/P6_WIDGET.md).

## Cómo probarlo

**En web (sin Android):** abre `/widget-lab`. Simula los cuatro estados con las funciones
reales y explica que publicar no está disponible. También está enlazado desde la pestaña
**Piso → «Abrir laboratorio del widget»**.

**En Android (widget real):**

1. `npx expo prebuild --platform android` y `npm run android` (development build nueva).
2. Mantén pulsado el escritorio → Widgets → **AlarmaT** (4×2).
3. Abre `/widget-lab` y pulsa «Publicar en el widget real». Cambia de estado y vuelve a
   publicar para ver próxima alarma, snapshot antiguo, vacío y sesión cerrada.
4. «Vaciar widget» equivale a un cierre de sesión; «Recargar» fuerza la relectura.

Si el widget no aparece en el launcher, falta la build nueva: una exportación JS no lo
instala. Registra el resultado en `docs/demo.md`.

## Desarrollo

```sh
npx expo prebuild --platform android   # registra el receptor del widget (P1)
npm run android                        # development build, no Expo Go
```

En el launcher: mantener pulsado → Widgets → AlarmaT. La instalación, el refresco con
la app cerrada y el comportamiento tras reiniciar deben registrarse en `docs/demo.md`;
una exportación JS **no** demuestra que el widget exista.
