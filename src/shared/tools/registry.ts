import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodObject, ZodRawShape, ZodTypeAny } from 'zod';
import { getCurrentAuthContext } from '../../core/context.js';
import type { RequestContext } from '../types/context.js';
import { asProviderInfo } from '../types/provider.js';
import { logger } from '../utils/logger.js';
import { echoTool } from './echo.js';
import { healthTool } from './health.js';
import type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';

function getSchemaShape(schema: ZodTypeAny) {
  if ('shape' in schema && typeof schema.shape === 'object') {
    return (schema as ZodObject<ZodRawShape>).shape;
  }

  if ('_def' in schema && schema._def && typeof schema._def === 'object') {
    const def = schema._def as {
      schema?: ZodTypeAny;
      innerType?: ZodTypeAny;
    };
    if (def.schema) {
      return getSchemaShape(def.schema);
    }
    if (def.innerType) {
      return getSchemaShape(def.innerType);
    }
  }
  return undefined;
}

interface ToolHandlerExtra {
  sessionId?: string;
  requestId?: string | number;
  signal?: AbortSignal;
  _meta?: {
    progressToken?: string | number;
  };
}

export type ContextResolver = (requestId: string | number) =>
  | {
      authStrategy?: ToolContext['authStrategy'];
      providerToken?: string;
      provider?: ToolContext['provider'];
      resolvedHeaders?: Record<string, string>;
    }
  | undefined;

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';

export { defineTool } from './types.js';

export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  outputSchema?: ZodRawShape;
  annotations?: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

function asRegisteredTool<T extends ZodRawShape>(tool: SharedToolDefinition<T>) {
  return tool as unknown as RegisteredTool;
}

export const sharedTools: RegisteredTool[] = [
  asRegisteredTool(healthTool),
  asRegisteredTool(echoTool),
];

export function getSharedTool(name: string) {
  return sharedTools.find((t) => t.name === name);
}

export function getSharedToolNames() {
  return sharedTools.map((t) => t.name);
}

export async function executeSharedTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
) {
  const tool = getSharedTool(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    if (context.signal?.aborted) {
      return {
        content: [{ type: 'text', text: 'Operation was cancelled' }],
        isError: true,
      };
    }
    const parseResult = tool.inputSchema.safeParse(args);
    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map(
          (e: { path: (string | number)[]; message: string }) =>
            `${e.path.join('.')}: ${e.message}`,
        )
        .join(', ');
      return {
        content: [{ type: 'text', text: `Invalid input: ${errors}` }],
        isError: true,
      };
    }
    const result = await tool.handler(
      parseResult.data as Record<string, unknown>,
      context,
    );
    if (tool.outputSchema && !result.isError) {
      if (!result.structuredContent) {
        return {
          content: [
            {
              type: 'text',
              text: 'Tool with outputSchema must return structuredContent (unless isError is true)',
            },
          ],
          isError: true,
        };
      }
    }
    return result;
  } catch (error) {
    if (context.signal?.aborted) {
      return {
        content: [{ type: 'text', text: 'Operation was cancelled' }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Tool error: ${(error as Error).message}` }],
      isError: true,
    };
  }
}

export function registerTools(server: McpServer, contextResolver?: ContextResolver) {
  for (const tool of sharedTools) {
    const inputSchemaShape = getSchemaShape(tool.inputSchema);
    if (!inputSchemaShape) {
      logger.error('tools', {
        message: 'Failed to extract schema shape',
        toolName: tool.name,
      });
      throw new Error(`Failed to extract schema shape for tool: ${tool.name}`);
    }
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: inputSchemaShape,
        ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
        ...(tool.annotations && { annotations: tool.annotations }),
      },
      async (args: Record<string, unknown>, extra: ToolHandlerExtra) => {
        let authContext:
          | ReturnType<NonNullable<ContextResolver>>
          | RequestContext
          | undefined =
          extra.requestId && contextResolver
            ? contextResolver(extra.requestId)
            : undefined;
        if (!authContext) {
          authContext = getCurrentAuthContext();
        }
        const context: ToolContext = {
          sessionId: extra.sessionId ?? crypto.randomUUID(),
          signal: extra.signal,
          meta: {
            progressToken: extra._meta?.progressToken,
            requestId: extra.requestId?.toString(),
          },
          authStrategy: authContext?.authStrategy,
          providerToken: authContext?.providerToken,
          provider: authContext?.provider
            ? asProviderInfo(authContext.provider)
            : undefined,
          resolvedHeaders: authContext?.resolvedHeaders,
        };
        const result = await executeSharedTool(tool.name, args, context);
        return result as CallToolResult;
      },
    );
  }
  logger.info('tools', { message: `Registered ${sharedTools.length} tools` });
}
