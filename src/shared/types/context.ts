import type { CancellationToken } from "../utils/cancellation.js";
import type { AuthHeaders, AuthStrategy } from "./auth.js";
import type { ProviderTokens } from "./provider.js";

export type { AuthHeaders, AuthStrategy } from "./auth.js";

export interface RequestContext {
  sessionId?: string;
  cancellationToken: CancellationToken;
  requestId?: string | number;
  timestamp: number;
  authStrategy?: AuthStrategy;
  authHeaders?: AuthHeaders;
  resolvedHeaders?: Record<string, string>;
  rsToken?: string;
  providerToken?: string;
  provider?: ProviderTokens;
  serviceToken?: string;
}
