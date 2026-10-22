# Gastos compartidos

La migración aditiva `005_shared_expenses.sql` guarda gastos reales en SQLite sin modificar datos anteriores. La moneda de todos los pisos es EUR. La API requiere sesión y pertenencia activa al piso en cada consulta y mutación, incluidos reintentos.

- `GET /v1/groups/:groupId/expenses` devuelve `{currency:"EUR",expenses:[...]}`.
- `POST /v1/groups/:groupId/expenses` recibe `{operationId,title,amountCents,participantUids}` y devuelve `{expense}`. Quien llama figura como pagador y debe estar entre los participantes activos. Importe entero de 1 a 100000000 céntimos; título de 1 a 120 caracteres; entre 1 y 500 participantes únicos.
- `POST /v1/groups/:groupId/expenses/:expenseId/settle` recibe `{operationId,expectedVersion}` y devuelve `{expense}`. Un participante puede marcar únicamente su propia cuota como liquidada; el pagador no puede liquidar cuotas ajenas. Se trata de un registro compartido, no de una transferencia bancaria ni de una confirmación del banco.

Cada gasto contiene `id`, `groupId`, `title`, `amountCents`, `paidByUid`, `participantUids`, `settledUids`, `shares:[{uid,amountCents}]`, `version` y `createdAtEpochMs`. El reparto ordena los UID y asigna un céntimo adicional a los primeros participantes hasta distribuir el resto; la suma siempre coincide con el importe. La cuota del pagador y las cuotas de cero céntimos ya constan como liquidadas al crear.

Las operaciones se guardan atómicamente con el gasto. El mismo `operationId` y entrada devuelve la respuesta original; reutilizarlo con otro cuerpo, grupo u operación devuelve 409. Una liquidación con versión obsoleta devuelve 409 y exige recargar. Las liquidaciones solo incrementan la versión cuando cambian el estado. El historial conserva las cuotas de antiguos miembros, pero estos pierden acceso cuando abandonan el piso. El cliente refresca este listado por HTTP; no forma parte del feed de alarmas P5 ni de su cola sin conexión.

Pruebas en `server/test/expenses.test.ts`: acceso por grupo, revocación, validación de importes y participantes, reparto exacto, reintentos, concurrencia, liquidación exclusivamente propia y migración de 004 a 005 conservando tareas y pisos.
