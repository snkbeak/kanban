import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerEnvironment, proxyApi, type Configuration } from '../worker/proxy.ts';

const config: Configuration = {
  DEPLOYMENT_ENV: 'production', PUBLIC_ORIGIN: 'https://board.example', MONGO_DB: 'kanban_test',
  MONGO_URL: 'mongodb://user:private-password@db.example',
  JWT_SECRET: 'test-only-jwt-secret-'.repeat(3), PROXY_SECRET: 'test-only-proxy-secret-'.repeat(3),
};
const request = (path: string, method = 'GET', extra: RequestInit = {}) => new Request(
  config.PUBLIC_ORIGIN + path, { method, ...extra },
);

test('production container configuration passes secrets only at runtime and fails closed', () => {
  const env = containerEnvironment(config);
  assert.equal(env.APP_ENV, 'production'); assert.equal(env.COOKIE_SECURE, 'true');
  assert.equal(env.TRUSTED_ORIGINS, '["https://board.example"]');
  assert.equal(env.MONGO_URL, config.MONGO_URL);
  for (const key of ['MONGO_URL', 'MONGO_DB', 'JWT_SECRET', 'PROXY_SECRET']) {
    assert.throws(() => containerEnvironment({ ...config, [key]: '' }), /incomplete/);
  }
  for (const origin of ['http://board.example', 'https://board.example/', 'https://user:pass@board.example']) {
    assert.throws(() => containerEnvironment({ ...config, PUBLIC_ORIGIN: origin }));
  }
  const local = containerEnvironment({ ...config, DEPLOYMENT_ENV: 'local', PUBLIC_ORIGIN: 'http://127.0.0.1:8787' });
  assert.equal(local.COOKIE_SECURE, 'false'); assert.equal(local.APP_ENV, 'development');
});

test('unsafe Origin rejection and alternate hosts never wake the container', async () => {
  const never = async () => { throw new Error('must not forward'); };
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const origin of [null, '', 'null', 'https://board.example.evil', 'https://board.example/', 'https://board.example, https://board.example']) {
      const headers = new Headers({ Referer: 'https://board.example/', 'X-Forwarded-Host': 'board.example' });
      if (origin !== null) headers.set('Origin', origin);
      const response = await proxyApi(request('/api/auth/login', method, { headers }), config, never);
      assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'csrf_rejected');
      assert.equal(response.headers.has('set-cookie'), false);
    }
  }
  const response = await proxyApi(new Request('https://preview.example/api/cards'), config, never);
  assert.equal(response.status, 404);
});

test('proxy preserves payload/query/cookies/origin and replaces untrusted routing and proxy headers', async () => {
  let calls = 0;
  const response = await proxyApi(request('/api/cards/a?expected_version=2', 'PATCH', {
    headers: { Origin: config.PUBLIC_ORIGIN, Cookie: 'access_token=test-only', 'Content-Type': 'application/json',
      'X-Kanban-Proxy-Secret': 'attacker', Host: 'evil.example', Forwarded: 'for=evil',
      'X-Forwarded-For': 'evil', 'CF-Connecting-IP': 'evil', 'X-API-Origin': 'https://evil.example' },
    body: '{"title":"draft","expected_version":2}',
  }), config, async upstream => {
    calls++;
    assert.equal(upstream.url, 'https://board.example/api/cards/a?expected_version=2');
    assert.equal(upstream.method, 'PATCH'); assert.equal(upstream.redirect, 'manual');
    assert.equal(upstream.headers.get('Origin'), config.PUBLIC_ORIGIN);
    assert.equal(upstream.headers.get('Cookie'), 'access_token=test-only');
    assert.equal(upstream.headers.get('X-Kanban-Proxy-Secret'), config.PROXY_SECRET);
    for (const header of ['Host', 'Forwarded', 'X-Forwarded-For', 'CF-Connecting-IP', 'X-API-Origin']) {
      assert.equal(upstream.headers.has(header), false);
    }
    assert.deepEqual(await upstream.json(), { title: 'draft', expected_version: 2 });
    return Response.json({ id: 'a' }, { headers: { 'Cache-Control': 'public, max-age=999', 'CDN-Cache-Control': 'public' } });
  });
  assert.equal(calls, 1); assert.deepEqual(await response.json(), { id: 'a' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('CDN-Cache-Control'), false);
});

test('login cookies, logout 204, error envelopes and Retry-After survive unchanged', async () => {
  for (const status of [200, 204, 401, 403, 409, 422, 429, 503]) {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Retry-After': '42' });
    headers.append('Set-Cookie', 'access_token=test; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append('Set-Cookie', 'second=test; Path=/; HttpOnly; Secure');
    const body = status === 204 ? null : JSON.stringify({ error: { code: 'test', message: 'test', fields: [] } });
    const response = await proxyApi(request('/api/auth/logout', 'POST', { headers: { Origin: config.PUBLIC_ORIGIN } }),
      config, async () => new Response(body, { status, headers }));
    assert.equal(response.status, status); assert.equal(response.headers.get('Retry-After'), '42');
    assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
    assert.equal(await response.text(), body ?? '');
  }
});

test('startup failures, redirects and broken upstream responses are generic and never replayed', async () => {
  for (const mode of ['throw', 'redirect', 'html']) {
    let calls = 0;
    const response = await proxyApi(request('/api/cards', 'POST', { headers: { Origin: config.PUBLIC_ORIGIN } }), config, async () => {
      calls++;
      if (mode === 'throw') throw new Error(config.MONGO_URL);
      return new Response('private diagnostics', { status: mode === 'redirect' ? 307 : 500,
        headers: { Location: 'https://evil.example', 'Content-Type': 'text/html' } });
    });
    assert.equal(calls, 1); assert.equal(response.status, 502);
    assert.equal(response.headers.has('Location'), false);
    assert.doesNotMatch(await response.text(), /private|password|evil/);
  }
});

test('deadlines include stalled response bodies and never retry a mutation', async () => {
  for (const stalledBody of [false, true]) {
    let calls = 0;
    const response = await proxyApi(request('/api/cards', 'POST', { headers: { Origin: config.PUBLIC_ORIGIN } }), config, async () => {
      calls++;
      return stalledBody ? new Response(new ReadableStream(), { headers: { 'Content-Type': 'application/json' } })
        : new Promise<Response>(() => {});
    }, 10);
    assert.equal(calls, 1); assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'gateway_timeout');
  }
});
