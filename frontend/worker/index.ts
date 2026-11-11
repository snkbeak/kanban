import { Container, getContainer } from '@cloudflare/containers';
import { apiError, containerEnvironment, proxyApi, type Configuration } from './proxy';

interface Env extends Configuration {
  ASSETS: Fetcher;
  KANBAN_API: DurableObjectNamespace<KanbanAPI>;
}

export class KanbanAPI extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = '2m';
  enableInternet = true; // PyMongo connects to Atlas over TLS; no MongoDB runs in this container.

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    this.envVars = containerEnvironment(env);
  }

  override onError(): void { throw new Error('API container unavailable'); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyApi(request, env, upstream => getContainer(env.KANBAN_API, 'shared-board').fetch(upstream));
    }
    if (url.origin !== env.PUBLIC_ORIGIN) return apiError(404, 'not_found', 'Not found');
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
