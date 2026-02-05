import type { ZodObject, ZodRawShape, z } from "zod";
import type { AuthStrategy } from "../types/auth.js";
import type { ProviderInfo } from "../types/provider.js";

export type { AuthStrategy } from "../types/auth.js";

export interface ToolContext {
  sessionId: string;
  signal?: AbortSignal;
  meta?: {
    progressToken?: string | number;
    requestId?: string;
  };
  authStrategy?: AuthStrategy;
  providerToken?: string;
  provider?: ProviderInfo;
  resolvedHeaders?: Record<string, string>;
  authHeaders?: Record<string, string>;
}

export type ToolContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    }
  | {
      type: "resource";
      uri: string;
      mimeType?: string;
      text?: string;
    };

export interface ToolResult {
  content: ToolContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface SharedToolDefinition<
  TShape extends ZodRawShape = ZodRawShape,
> {
  name: string;
  title?: string;
  description: string;
  inputSchema: ZodObject<TShape>;
  outputSchema?: ZodRawShape;
  handler: (
    args: z.infer<ZodObject<TShape>>,
    context: ToolContext
  ) => Promise<ToolResult>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export function defineTool<TShape extends ZodRawShape>(
  def: SharedToolDefinition<TShape>
) {
  return def;
}
