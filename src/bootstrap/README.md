# Bootstrap de sincronización

`register.ts` se evalúa antes de Router y deja un modo demo explícito hasta recibir servicios configurados. No adivina URL, sesión ni formato del feed HTTP.

El integrador abre SQLite y restaura sesión antes de configurar:

```ts
import { initializeBootstrap } from './index';
import { createExpoBootstrapSources } from './expoSources';

initializeBootstrap({
  session, // SessionManager: view() y subscribe(listener)
  sync: repository, // reconcile(): Promise<unknown>
  sources: createExpoBootstrapSources({ enablePush: false }),
});
```

Una segunda inicialización mantiene la primera. `stopBootstrap()` elimina suscripciones y temporizadores; después admite otra configuración. El reconciliador debe comprobar su lease de sesión antes de aplicar resultados asíncronos: el bootstrap rechaza sus propios callbacks obsoletos, pero no puede deshacer trabajo interno del repositorio.

Sincroniza al abrir, reanudar y recuperar red. Ejecuta hasta diez consultas adicionales a intervalos de 30 segundos mientras permanece en primer plano; otro ciclo de reanudación o reconexión renueva el presupuesto. Una operación activa excluye otra consulta; las señales concurrentes se agrupan en una consulta posterior. Un error solo reintenta mediante ese polling acotado o una señal nueva. No programa temporizadores en background.

El adaptador Expo observa AppState y expo-network. El push es opcional; observa recepción y pulsación, sin pedir permisos, registrar tokens, presentar notificaciones ni programar alarmas. Los datos push que incluyan `eventId` (y opcionalmente `version`) son pistas para consultar estado autorizado; un conjunto acotado elimina repeticiones. No son un DTO autoritativo ni contienen instrucciones ejecutables. La deduplicación durable del feed corresponde al repositorio. P4 conserva presentación y programación; el adaptador remoto registra tokens si se configura ese servicio.

`tests/bootstrap/controller.test.ts` valida con fuentes y reloj falsos: inicialización repetida, ausencia de red, foreground/background, polling finito, concurrencia, deduplicación, cambio de cuenta, callbacks tardíos, teardown y errores sin rechazos no manejados. Las pruebas no validan recepción push real, conectividad Android, ejecución cerrada ni alarmas físicas. Hace falta development build y dispositivo; push Android además requiere credenciales de transporte. El recorrido con ambas apps abiertas no necesita push.
