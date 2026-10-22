import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPERATION_PARSERS,
  parseAlarmRequestDetail,
  parseAlarmRequestDocument,
  parseAlarmRequestPage,
  parseAuthResponse,
  parseAppError,
  parseCreateAlarmRequest,
  parseMeResponse,
  parseOperationReceipt,
  parseRecipientDocument,
  parseReportSchedule,
  parseRespondToAlarm,
  parseScheduleDocument,
  parseSyncPage,
  parseWithdrawAlarmRequest,
  type AppErrorPayload,
  type OperationName,
} from '../src/domain/index.ts';
import { expectDomainError, readContractsFile, readManifest } from './helpers.ts';

const manifest = readManifest();

test('todos los fixtures válidos pasan los validadores de TypeScript', () => {
  for (const entry of manifest.operations) {
    const fixture = readContractsFile<unknown>(entry.file);
    const parser = OPERATION_PARSERS[entry.operation as OperationName];
    assert.ok(parser, `${entry.id}: operación desconocida ${entry.operation}`);
    assert.doesNotThrow(() => parser(fixture), `${entry.id} debería ser válido`);
  }
});

const documentParsers: Record<string, (data: unknown) => unknown> = {
  'schemas/operation-receipt.schema.json': parseOperationReceipt,
  'schemas/app-error.schema.json': parseAppError,
  'schemas/alarm-request.schema.json': parseAlarmRequestDocument,
  'schemas/recipient.schema.json': parseRecipientDocument,
  'schemas/schedule.schema.json': parseScheduleDocument,
  'schemas/session.schema.json#/$defs/authResponse': parseAuthResponse,
  'schemas/session.schema.json#/$defs/meResponse': parseMeResponse,
  'schemas/sync-page.schema.json': parseSyncPage,
  'schemas/alarm-request-page.schema.json': parseAlarmRequestPage,
  'schemas/alarm-request-detail.schema.json': parseAlarmRequestDetail,
};

test('los documentos compartidos pasan sus validadores', () => {
  for (const entry of manifest.documents) {
    const parser = documentParsers[entry.schema as string];
    assert.ok(parser, `${entry.id}: sin validador para ${entry.schema}`);
    assert.doesNotThrow(() => parser(readContractsFile<unknown>(entry.file)), `${entry.id} debería ser válido`);
  }
});

test('los fixtures inválidos se rechazan con INVALID_ARGUMENT', () => {
  for (const entry of manifest.invalid) {
    const fixture = readContractsFile<unknown>(entry.file);
    if (entry.schema) {
      const parser = documentParsers[entry.schema];
      assert.ok(parser, `${entry.id}: sin validador para ${entry.schema}`);
      expectDomainError(() => parser(fixture), 'INVALID_ARGUMENT');
      continue;
    }
    const parse = entry.payloadSchema
      ? () => OPERATION_PARSERS[entry.operation as OperationName](fixture)
      : () => parseCreateAlarmRequest(fixture);
    expectDomainError(parse, 'INVALID_ARGUMENT');
  }
});

test('los casos semánticos se rechazan aunque su forma sea válida', () => {
  for (const entry of manifest.semantic) {
    const fixture = readContractsFile<unknown>(entry.file);
    const parser = OPERATION_PARSERS[entry.operation as OperationName];
    const error = expectDomainError(() => parser(fixture), entry.expect as string);
    assert.ok(error.message.length > 0, `${entry.id}: el error debe explicar el motivo`);
  }
});

test('crear exige un aviso futuro cuando el llamador conoce el reloj', () => {
  const fixture = readContractsFile<unknown>('fixtures/operations/create-alarm-request.minimal.json');
  assert.doesNotThrow(() => parseCreateAlarmRequest(fixture, { nowEpochMs: 1792701000000 }));
  expectDomainError(
    () => parseCreateAlarmRequest(fixture, { nowEpochMs: 1792782000000 }),
    'INVALID_ARGUMENT',
  );
});

test('responder exige versions y no admite identidad declarada por el cliente', () => {
  const accept = readContractsFile<Record<string, unknown>>('fixtures/operations/respond-to-alarm.accept.json');
  const withoutRevisions = { ...accept, expectedRequestVersion: undefined, expectedDecisionRevision: undefined };
  expectDomainError(() => parseRespondToAlarm(withoutRevisions), 'INVALID_ARGUMENT');

  expectDomainError(
    () => parseRespondToAlarm({ ...accept, actorUid: 'ana' }),
    'INVALID_ARGUMENT',
  );
});

test('reportar programación valida modalidad y mecanismo', () => {
  const report = readContractsFile<Record<string, unknown>>('fixtures/operations/report-schedule.scheduled.json');
  assert.doesNotThrow(() => parseReportSchedule(report));

  const payload = report.payload as Record<string, unknown>;
  expectDomainError(
    () => parseReportSchedule({ ...report, payload: { ...payload, mode: 'NOTIFICATION' } }),
    'INVALID_ARGUMENT',
  );
  expectDomainError(
    () => parseReportSchedule({ ...report, payload: { ...payload, deviceEpoch: 0 } }),
    'INVALID_ARGUMENT',
  );
});

test('retirar una propuesta exige motivo y versión esperada', () => {
  const withdraw = readContractsFile<Record<string, unknown>>('fixtures/operations/withdraw-alarm-request.json');
  assert.doesNotThrow(() => parseWithdrawAlarmRequest(withdraw));
  expectDomainError(
    () => parseWithdrawAlarmRequest({ ...withdraw, expectedRequestVersion: undefined }),
    'INVALID_ARGUMENT',
  );
});

test('el recibo y el error del contrato se parsean con sus variantes', () => {
  const replayed = readContractsFile<unknown>('fixtures/documents/operation-receipt.replayed.json');
  assert.equal(parseOperationReceipt(replayed).status, 'REPLAYED');

  const error = readContractsFile<unknown>('fixtures/documents/app-error.version-conflict.json');
  const parsed: AppErrorPayload = parseAppError(error);
  assert.equal(parsed.code, 'VERSION_CONFLICT');
  assert.equal(parsed.retryable, false);

  expectDomainError(() => parseAppError({ code: 'NOPE', message: 'x' }), 'INVALID_ARGUMENT');
});
