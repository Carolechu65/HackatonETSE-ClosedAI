import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readApiBaseUrl } from '../src/config/api.ts';

test('acepta una URL HTTPS y quita la barra final', () => {
  assert.equal(readApiBaseUrl('https://api.alarmat.example/'), 'https://api.alarmat.example');
  assert.equal(readApiBaseUrl(' https://api.alarmat.example/v1 '), 'https://api.alarmat.example/v1');
});

test('rechaza HTTP salvo localhost explícito en desarrollo', () => {
  assert.throws(() => readApiBaseUrl('http://api.alarmat.example'), /HTTPS/);
  assert.throws(() => readApiBaseUrl('http://localhost:8787'), /HTTPS/);
  assert.equal(
    readApiBaseUrl('http://localhost:8787', { allowLocalHttp: true }),
    'http://localhost:8787',
  );
  assert.equal(
    readApiBaseUrl('http://10.0.2.2:8787', { allowLocalHttp: true }),
    'http://10.0.2.2:8787',
  );
});

test('rechaza credenciales, query y fragmentos en la URL base', () => {
  assert.throws(() => readApiBaseUrl('https://ana:secreto@api.alarmat.example'), /usuario ni contraseña/);
  assert.throws(() => readApiBaseUrl('https://api.alarmat.example?token=abc'), /query ni fragmento/);
  assert.throws(() => readApiBaseUrl('https://api.alarmat.example#x'), /query ni fragmento/);
});

test('una configuración ausente o inválida falla en vez de inventar un host', () => {
  assert.throws(() => readApiBaseUrl(undefined), /EXPO_PUBLIC_API_URL/);
  assert.throws(() => readApiBaseUrl('   '), /EXPO_PUBLIC_API_URL/);
  assert.throws(() => readApiBaseUrl('api.alarmat.example'), /URL válida/);
});
