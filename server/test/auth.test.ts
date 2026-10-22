import assert from 'node:assert/strict';
import test from 'node:test';
import { auth, registerUser, setupTest } from './helpers.ts';

test('registro, me, logout y login con sesión revocada', async () => {
  const ctx = await setupTest();
  try {
    const user = await registerUser(ctx.app, 'Ana');
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(user.token) });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.uid, user.uid);
    assert.equal(me.json().user.email, user.email);
    assert.equal(me.body.includes('password'), false);

    const logout = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: auth(user.token) });
    assert.equal(logout.statusCode, 200);

    const afterLogout = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(user.token) });
    assert.equal(afterLogout.statusCode, 401);
    assert.equal(afterLogout.json().code, 'UNAUTHENTICATED');

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: user.email, password: 'correct horse battery staple' },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.json().session.token);

    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: user.email, password: 'incorrecta incorrecta' },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().code, 'UNAUTHENTICATED');
  } finally {
    await ctx.close();
  }
});

test('correo duplicado y token ausente no revelan detalles internos', async () => {
  const ctx = await setupTest();
  try {
    const user = await registerUser(ctx.app);
    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: user.email.toUpperCase(), password: 'correct horse battery staple', displayName: 'Otra' },
    });
    assert.equal(duplicate.statusCode, 400);
    assert.equal(duplicate.json().code, 'INVALID_ARGUMENT');

    const missing = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me' });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().code, 'UNAUTHENTICATED');
  } finally {
    await ctx.close();
  }
});

test('invitaciones caducadas y de un solo uso', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Owner');
    const guest = await registerUser(ctx.app, 'Guest');
    const other = await registerUser(ctx.app, 'Other');
    const groupResponse = await ctx.app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: auth(owner.token),
      payload: { name: 'Piso', timeZone: 'Europe/Madrid' },
    });
    const groupId = groupResponse.json().groupId as string;

    const invitation = await ctx.app.inject({
      method: 'POST',
      url: `/v1/groups/${groupId}/invitations`,
      headers: auth(owner.token),
      payload: { expiresInMs: 10 * 60 * 1000 },
    });
    assert.equal(invitation.statusCode, 201);
    const token = invitation.json().token as string;

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/v1/invitations/${token}/accept`,
      headers: auth(guest.token),
    });
    assert.equal(first.statusCode, 200);

    const reused = await ctx.app.inject({
      method: 'POST',
      url: `/v1/invitations/${token}/accept`,
      headers: auth(other.token),
    });
    assert.equal(reused.statusCode, 400);

    const groups = await ctx.app.inject({ method: 'GET', url: '/v1/groups', headers: auth(guest.token) });
    assert.equal(groups.json().groups.length, 1);
    assert.equal(groups.json().groups[0].memberCount, 2);
  } finally {
    await ctx.close();
  }
});

test('límite de intentos de autenticación', async () => {
  const ctx = await setupTest({ config: { authRateLimit: { max: 2, windowMs: 60_000 } } });
  try {
    const payload = { email: 'limit@example.test', password: 'contraseña larga', displayName: 'Limit' };
    const one = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });
    const two = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });
    const three = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });
    assert.equal(one.statusCode, 401);
    assert.equal(two.statusCode, 401);
    assert.equal(three.statusCode, 429);
    assert.equal(three.json().code, 'RATE_LIMITED');
    assert.ok(three.headers['retry-after']);
  } finally {
    await ctx.close();
  }
});
