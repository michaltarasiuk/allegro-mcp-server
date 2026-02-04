import {
  createWorkerRouter,
  initializeWorkerStorage,
  shimProcessEnv,
  type WorkerEnv,
} from './adapters/http-workers/index.js';
import { parseConfig } from './shared/config/env.js';
import { withCors } from './shared/http/cors.js';

export default {
  async fetch(request: Request, env: WorkerEnv) {
    shimProcessEnv(env);
    const config = parseConfig(env as Record<string, unknown>);
    const storage = initializeWorkerStorage(env, config);
    if (!storage) {
      return withCors(
        new Response('Server misconfigured: Storage unavailable', { status: 503 }),
      );
    }
    const router = createWorkerRouter({
      tokenStore: storage.tokenStore,
      sessionStore: storage.sessionStore,
      config,
    });
    return router.fetch(request);
  },
};
