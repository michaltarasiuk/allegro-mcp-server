export interface CorsOptions {
  origin?: string;
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const DEFAULT_CORS: CorsOptions = {
  origin: "*",
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  headers: ["*"],
  credentials: false,
  maxAge: 86_400,
};

export function withCors(response: Response, options: CorsOptions = {}) {
  const opts = { ...DEFAULT_CORS, ...options };
  response.headers.set("Access-Control-Allow-Origin", opts.origin ?? "*");
  response.headers.set(
    "Access-Control-Allow-Methods",
    (opts.methods ?? []).join(", ")
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    (opts.headers ?? []).join(", ")
  );
  if (opts.credentials) {
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (opts.maxAge) {
    response.headers.set("Access-Control-Max-Age", String(opts.maxAge));
  }
  return response;
}

export function corsPreflightResponse(options: CorsOptions = {}) {
  return withCors(new Response(null, { status: 204 }), options);
}

export function buildCorsHeaders(options: CorsOptions = {}) {
  const opts = { ...DEFAULT_CORS, ...options };
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": opts.origin ?? "*",
    "Access-Control-Allow-Methods": (opts.methods ?? []).join(", "),
    "Access-Control-Allow-Headers": (opts.headers ?? []).join(", "),
  };
  if (opts.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  if (opts.maxAge) {
    headers["Access-Control-Max-Age"] = String(opts.maxAge);
  }
  return headers;
}
