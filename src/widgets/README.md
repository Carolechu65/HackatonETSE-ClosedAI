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
- La plantilla solo pinta props. No consulta SQLite, Firebase ni el reloj.

## Límite real de expo-widgets 58 en Android (verificado en el paquete instalado)

`WidgetInteractionAction.kt` convierte un botón en un broadcast que reevalúa props
(`evaluateWidgetButtonPress`); no lanza una Activity ni un deep link. La documentación
de `expo-widgets` además declara interactivos solo los widgets iOS 17+. Por eso:

- el primer corte **no** incluye botones en el widget; un botón que no navega sería un
  engaño de interfaz;
- `links.ts` y `props.alarmUrl` ya están listos para cuando P1/P4 añadan una acción
  nativa (`PendingIntent` a `alarmat://alarm/<id>`), o para la notificación de P4, que
  sí puede abrir la app.

Handoff con la petición concreta: [`docs/handoff/P6_HANDOFF.md`](../../docs/handoff/P6_HANDOFF.md).

## Desarrollo

```sh
npx expo prebuild --platform android   # registra el receptor del widget (P1)
npm run android                        # development build, no Expo Go
```

En el launcher: mantener pulsado → Widgets → AlarmaT. La instalación, el refresco con
la app cerrada y el comportamiento tras reiniciar deben registrarse en `docs/demo.md`;
una exportación JS **no** demuestra que el widget exista.
