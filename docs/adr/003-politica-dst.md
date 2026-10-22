# ADR-003 · Política de cambio horario y recurrencia semanal

**Fecha:** 2026-10-22 · **Owner:** P1 (revisión P4 y producto) · **Estado:** aceptado, revisable

## Contexto

El TDD exige una decisión explícita para las horas que no existen o se repiten por el cambio de horario, porque afecta a la alarma que suena en el móvil y a la serie semanal. Sin ella, dos dispositivos pueden calcular instantes distintos para la misma hora civil.

## Decisión

1. Se guarda el instante UTC en milisegundos **y** la hora civil propuesta con su zona IANA. El instante no se reinterpreta al viajar.
2. **Hora inexistente** (salto de primavera, p. ej. 02:30 en Europe/Madrid): se desplaza hacia delante la duración del salto. 02:30 se convierte en 03:30 del mismo día.
3. **Hora repetida** (salto de otoño): se usa la primera ocurrencia, el instante UTC menor.
4. **Recurrencia semanal:** la serie queda ligada a la zona del grupo. Se recalcula la hora civil en cada fecha, así que el salto de hora no cambia la hora local de la serie.
5. Una ocurrencia perdida se marca vencida y se calcula la siguiente. Nunca se hace sonar una alarma antigua al recuperar conexión.
6. Al confirmar una hora, la UI debe mostrar la próxima fecha/hora resuelta si cae en un salto horario.

Implementado y probado en `src/domain/time.ts` (`wallClockToEpochMs`, `nextWeeklyOccurrence`) con los casos 29/03/2026 y 25/10/2026 de Europe/Madrid (`tests/time.test.ts`).

## Consecuencias

- El runtime nativo (P4) debe usar la misma política al materializar ocurrencias; si Kotlin calcula distinto, la ocurrencia se cancela y se reprograma, no se duplica.
- `timeSpec.effectiveAtEpochMs` se valida contra la hora civil y la zona: un cliente que envíe un instante desalineado recibe `INVALID_ARGUMENT`.
- La política se puede revisar antes de cerrar el día 1; si cambia, hay que actualizar fixtures, validador, este ADR y el texto visible al usuario.
