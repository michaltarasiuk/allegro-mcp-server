import { type CorsOptions, withCors } from './cors.js';

export function jsonResponse(
  data: unknown,
  options: {
    status?: number;
    headers?: Record<string, string>;
    cors?: boolean | CorsOptions;
  } = {},
) {
  const { status = 200, headers = {}, cors = true } = options;
  const response = new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
  if (cors) {
    return withCors(response, typeof cors === 'object' ? cors : undefined);
  }
  return response;
}

export function jsonRpcError(
  code: number,
  message: string,
  id: string | number | null = null,
  options: {
    status?: number;
    cors?: boolean | CorsOptions;
  } = {},
) {
  return jsonResponse(
    {
      jsonrpc: '2.0',
      error: { code, message },
      id,
    },
    { status: options.status ?? 200, cors: options.cors },
  );
}

export function jsonRpcSuccess(
  result: unknown,
  id: string | number | null,
  options: {
    headers?: Record<string, string>;
    cors?: boolean | CorsOptions;
  } = {},
) {
  return jsonResponse(
    {
      jsonrpc: '2.0',
      result,
      id,
    },
    { status: 200, headers: options.headers, cors: options.cors },
  );
}

export function textError(
  message: string,
  options: {
    status?: number;
    cors?: boolean | CorsOptions;
  } = {},
) {
  const { status = 400, cors = true } = options;
  const response = new Response(message, { status });
  if (cors) {
    return withCors(response, typeof cors === 'object' ? cors : undefined);
  }
  return response;
}

export function oauthError(
  error: string,
  description?: string,
  options: {
    status?: number;
    cors?: boolean | CorsOptions;
  } = {},
) {
  const body: Record<string, string> = { error };
  if (description) {
    body.error_description = description;
  }
  return jsonResponse(body, { status: options.status ?? 400, cors: options.cors });
}

export function redirectResponse(
  url: string,
  status: 301 | 302 | 303 | 307 | 308 = 302,
) {
  return Response.redirect(url, status);
}

export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerError: -32000,
} as const;
