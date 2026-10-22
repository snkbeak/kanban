export interface Configuration {
  DEPLOYMENT_ENV: 'production' | 'local';
  PUBLIC_ORIGIN: string;
  MONGO_DB: string;
  MONGO_URL?: string;
  JWT_SECRET?: string;
  PROXY_SECRET?: string;
}

export function containerEnvironment(env: Configuration): Record<string, string> {
  const origin = new URL(env.PUBLIC_ORIGIN);
  const local = env.DEPLOYMENT_ENV === 'local';
  if ((!local && env.DEPLOYMENT_ENV !== 'production') || origin.origin !== env.PUBLIC_ORIGIN
    || (local ? !['http://localhost:8787', 'http://127.0.0.1:8787'].includes(origin.origin) : origin.protocol !== 'https:')
    || !env.MONGO_DB || !env.MONGO_URL || !/^mongodb(?:\+srv)?:\/\//.test(env.MONGO_URL)
    || !env.JWT_SECRET || env.JWT_SECRET.length < 32 || !env.PROXY_SECRET || env.PROXY_SECRET.length < 32) {
    throw new Error('Backend configuration is incomplete');
  }
  return {
    APP_ENV: local ? 'development' : 'production', COOKIE_SECURE: local ? 'false' : 'true',
    TRUSTED_ORIGINS: JSON.stringify([origin.origin]), MONGO_DB: env.MONGO_DB,
    MONGO_URL: env.MONGO_URL, JWT_SECRET: env.JWT_SECRET, PROXY_SECRET: env.PROXY_SECRET,
  };
}

export const apiError = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, fields: [] } }, { status, headers: { 'Cache-Control': 'no-store' } },
);

// Keep this independent of the runtime so proxy contracts can be tested without Cloudflare.
export async function proxyApi(request: Request, env: Configuration,
  backendFetch: (request: Request) => Promise<Response>, timeoutMs = 20000): Promise<Response> {
  if (new URL(request.url).origin !== env.PUBLIC_ORIGIN) return apiError(404, 'not_found', 'Not found');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
    return apiError(403, 'csrf_rejected', 'Request origin is not trusted');
  }
  try { containerEnvironment(env); }
  catch { return apiError(503, 'backend_unavailable', 'API is not configured'); }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, timeoutMs);
  });
  const forward = async () => {
    // Allowlist browser headers; never forward caller-controlled proxy/address/destination headers.
    const headers = new Headers();
    for (const name of ['Accept', 'Content-Type', 'Cookie', 'Origin', 'Referer']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('X-Kanban-Proxy-Secret', env.PROXY_SECRET!);
    const upstream = await backendFetch(new Request(request, {
      headers, redirect: 'manual', signal: controller.signal,
    }));
    // Container startup errors can be plain text with internal diagnostics. Never forward them.
    if ((upstream.status >= 300 && upstream.status < 400)
      || (upstream.status !== 204 && request.method !== 'HEAD'
        && !upstream.headers.get('Content-Type')?.includes('application/json'))) {
      await upstream.body?.cancel();
      return apiError(502, 'gateway_error', 'API returned an unexpected response');
    }
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.delete('CDN-Cache-Control');
    responseHeaders.delete('Cloudflare-CDN-Cache-Control');
    responseHeaders.delete('X-Kanban-Proxy-Secret');
    // Buffer through the deadline so a stalled response body is also bounded. Never retry a write.
    const body = upstream.status === 204 || request.method === 'HEAD' ? null : await upstream.arrayBuffer();
    return new Response(body, { status: upstream.status, headers: responseHeaders });
  };
  try { return await Promise.race([forward(), deadline]); }
  catch {
    return controller.signal.aborted
      ? apiError(504, 'gateway_timeout', 'API timed out; refresh before retrying a change')
      : apiError(502, 'gateway_error', 'API unavailable; refresh before retrying a change');
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
