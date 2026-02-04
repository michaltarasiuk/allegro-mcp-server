import { cors } from 'hono/cors';

export const corsMiddleware = () =>
  cors({
    origin: (origin) => origin || 'http://localhost',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Mcp-Session-Id',
      'MCP-Protocol-Version',
      'Mcp-Protocol-Version',
      'X-Api-Key',
      'X-Auth-Token',
    ],
    exposeHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
  });
