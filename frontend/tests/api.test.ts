import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, request } from '../src/lib/api.ts';

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
