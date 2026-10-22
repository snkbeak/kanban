import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, loginErrorMessage, request } from '../src/lib/api.ts';

test('cookie requests handle 204 and send only the content precondition on PATCH', async () => {
  const original = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return init?.method === 'POST' ? new Response(null, { status: 204 }) : Response.json({ id: 'a' });
  };
  try {
    assert.equal(await api.logout(), undefined);
    await api.patch('a/b', { title: 'New' }, 7);
    assert.equal(calls[1].path, '/api/cards/a%2Fb');
    assert.equal(calls[1].init.credentials, 'same-origin');
    assert.equal(calls[1].init.cache, 'no-store');
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), { title: 'New', expected_version: 7 });
  } finally { globalThis.fetch = original; }
});
test('validation envelopes survive the client and uncertain writes are never retried', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
  try {
    await assert.rejects(api.comment('a', 'text'), error => error instanceof ApiError && error.uncertain);
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ error: { code: 'validation_error', message: 'Invalid request', fields: [{ path: ['body', 'tag'], message: 'Required' }] } }, { status: 422 });
    await assert.rejects(request('/cards'), error => error instanceof ApiError && error.fields[0].path[1] === 'tag' && !error.uncertain);
  } finally { globalThis.fetch = original; }
});
test('HTML from a missing proxy is a recoverable gateway failure', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Wrong route</html>', { status: 200 });
  try { await assert.rejects(api.board(), error => error instanceof ApiError && error.status === 502); }
  finally { globalThis.fetch = original; }
});

test('login throttling preserves Retry-After and never replays credentials', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: 'login_throttled', message: 'Too many login attempts', fields: [] } }, {
      status: 429, headers: { 'Retry-After': '42' },
    });
  };
  try {
    await assert.rejects(api.login('chris', 'test-password'), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429); assert.equal(error.retryAfterSeconds, 42);
      assert.match(loginErrorMessage(error), /Try again after .*in 42 seconds/);
      return true;
    });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('missing or malformed retry headers have a safe throttling message', async () => {
  const original = globalThis.fetch;
  try {
    for (const value of ['', 'nonsense', '-5', 'Infinity']) {
      globalThis.fetch = async () => new Response(null, { status: 429, headers: { 'Retry-After': value } });
      await assert.rejects(api.login('chris', 'test-password'), error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.retryAfterSeconds, null);
        assert.match(loginErrorMessage(error), /wait a few minutes/);
        return true;
      });
    }
    assert.match(loginErrorMessage(new ApiError(503, 'database_unavailable', 'Database unavailable')), /temporarily unavailable/);
  } finally { globalThis.fetch = original; }
});
