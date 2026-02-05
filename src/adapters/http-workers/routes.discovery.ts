interface IttyRouter {
  get(path: string, handler: (request: Request) => Promise<Response>): void;
  post(path: string, handler: (request: Request) => Promise<Response>): void;
}

import type { UnifiedConfig } from "../../shared/config/env.js";
import { jsonResponse } from "../../shared/http/response.js";
import {
  createDiscoveryHandlers,
  workerDiscoveryStrategy,
} from "../../shared/oauth/discovery-handlers.js";

export function attachDiscoveryRoutes(
  router: IttyRouter,
  config: UnifiedConfig
) {
  const { authorizationMetadata, protectedResourceMetadata } =
    createDiscoveryHandlers(config, workerDiscoveryStrategy);
  router.get("/.well-known/oauth-authorization-server", (request: Request) =>
    Promise.resolve(jsonResponse(authorizationMetadata(new URL(request.url))))
  );
  router.get("/.well-known/oauth-protected-resource", (request: Request) => {
    const here = new URL(request.url);
    const sid = here.searchParams.get("sid") ?? undefined;
    return Promise.resolve(jsonResponse(protectedResourceMetadata(here, sid)));
  });
}
