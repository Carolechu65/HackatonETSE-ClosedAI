# Widgets AlarmaT

Android ofrece tres proveedores: **Tablón** (`AlarmaTWidget`, conserva el widget
instalado), **Alarmas** y **Tareas**. Los tres usan los colores compartidos de
`src/ui/tokens.ts`, una lista nativa desplazable y tamaño ajustable en ambos ejes.
`/widget-lab` permite revisar los tres diseños con datos ficticios.

La proyección v3 está limitada al usuario y piso elegidos: próxima alarma realmente
programada, propuestas pendientes y hasta veinte tareas, incluyendo como máximo
cinco hechas recientes. Se muestra el total pendiente si no caben todas. Las tareas
incluyen título, responsable, fecha, enlace y estado de aceptación. Cerrar sesión
limpia los tres proveedores y la caché privada. La fecha de lectura es absoluta;
mostrar un caché de nuevo no lo convierte en información recién sincronizada.

Cada tarjeta abre el detalle. La casilla de completar/reabrir guarda una acción
versionada en una cola privada mediante una actividad Android no exportada y abre
la app. La sesión autenticada envía esa acción al servidor; solo su respuesta
actualiza el widget. Una tarea modificada, una asignación pendiente/rechazada o una
sesión diferente no produce un cambio optimista. Sin conexión se conserva el intento
para la siguiente sincronización. La cola se limpia al cerrar sesión.

`WidgetLayout.tsx` se evalúa en el runtime aislado de expo-widgets: recibe únicamente
props JSON y no accede a red, credenciales, SQLite ni hooks. `LazyColumn` y los botones
nativos ya están soportados por expo-widgets 58.0.22. El plugin
`with-widget-links.cjs` añade navegación y acciones explícitas, valida destinos y
rechaza cambios inesperados en la dependencia.

Las propuestas nuevas de alarma sonora, notificación y tarea se consultan en
`GET /v1/assignments`. La app sincroniza los avisos al refrescar. Android dispone
además de un JobScheduler persistente de intervalo mínimo de quince minutos;
el sistema puede retrasarlo. Foreground y background comparten deduplicación,
cancelación de avisos resueltos y credenciales cifradas con Android Keystore.
Esto no es push instantáneo: la infraestructura Expo/FCM no está configurada.
Aceptar una tarea no acepta automáticamente una alarma vinculada.

Validación: proyección, autorización, enlaces, cola y conflictos se prueban en Node;
la política de acciones tiene pruebas Kotlin. La compilación y los artefactos están
bajo `/srv/mail/alarmat-build/`. El comportamiento del launcher, los permisos y los
retrasos del fabricante requieren comprobación física.
