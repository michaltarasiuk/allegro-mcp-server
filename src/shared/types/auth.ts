export type AuthStrategy = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';

export interface AuthHeaders {
  authorization?: string;
  'x-api-key'?: string;
  'x-auth-token'?: string;
  [key: string]: string | undefined;
}

export interface ResolvedAuth {
  strategy: AuthStrategy;
  headers: Record<string, string>;
  accessToken?: string;
}
