# P6 · Widget y tareas

`snapshot.ts` construye datos del widget; no existe todavía un widget instalado. Solo muestra como próxima alarma una ocurrencia aceptada, programada y futura. El reloj se recibe como argumento para reproducir escenarios.

Primeras entregas:

1. Acordar con P1 la versión/plugin de `expo-widgets` y producir development build Android.
2. Crear una plantilla mínima con próxima alarma, propuestas pendientes y deep link a la bandeja.
3. Consumir snapshot persistido y confirmado por P5/P4. No depender del proceso React abierto.
4. Probar actualización con la app cerrada; no considerar un callback JS evidencia de ejecución en background.
5. Completar `../features/tasks/model.ts` y sustituir `TaskPreview.tsx` por tarea real con asignación/vencimiento. Completar una tarea debe invalidar alarmas vinculadas mediante P3/P4/P5.

Desde la raíz: `npm run typecheck`. Probar que rechazada o pendiente nunca aparece como programada; registrar pruebas del widget en dispositivo. Gastos/huchas quedan fuera de este corte; ver [plan de equipo](../../docs/TEAM_PLAN.md).
