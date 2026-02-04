import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLowLevelServer } from '../mcp/server-internals.js';
import { logger } from './logger.js';

export interface BooleanFieldSchema {
  type: 'boolean';
  title?: string;
  description?: string;
  default?: boolean;
}

export interface StringFieldSchema {
  type: 'string';
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  default?: string;
}

export interface NumberFieldSchema {
  type: 'number' | 'integer';
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: number;
}

export interface TitledEnumFieldSchema {
  type: 'string';
  title?: string;
  description?: string;
  oneOf: Array<{
    const: string;
    title: string;
  }>;
  default?: string;
}

export interface UntitledEnumFieldSchema {
  type: 'string';
  title?: string;
  description?: string;
  enum: string[];
  default?: string;
}

export interface MultiSelectFieldSchema {
  type: 'array';
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  items:
    | {
        type: 'string';
        enum: string[];
      }
    | {
        anyOf: Array<{
          const: string;
          title: string;
        }>;
      };
  default?: string[];
}

export type FieldSchema =
  | BooleanFieldSchema
  | StringFieldSchema
  | NumberFieldSchema
  | TitledEnumFieldSchema
  | UntitledEnumFieldSchema
  | MultiSelectFieldSchema;

export interface ElicitationSchema {
  type: 'object';
  properties: Record<string, FieldSchema>;
  required?: string[];
}

export interface FormElicitationRequest {
  mode?: 'form';
  message: string;
  requestedSchema: ElicitationSchema;
}

export interface UrlElicitationRequest {
  mode: 'url';
  message: string;
  elicitationId: string;
  url: string;
}

export type ElicitationRequest = FormElicitationRequest | UrlElicitationRequest;

export interface ElicitResult {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, string | number | boolean | string[]>;
}

export const ElicitResultSchema = z.object({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional(),
});

export function validateElicitationSchema(schema: ElicitationSchema) {
  if (schema.type !== 'object') {
    throw new Error('Elicitation schema must have type: "object" at root');
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    throw new Error('Elicitation schema must have a "properties" object');
  }

  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    if ('properties' in fieldSchema) {
      throw new Error(
        `Nested objects not allowed in elicitation schema (field: "${fieldName}"). ` +
          'Only primitive types (string, number, integer, boolean) and enums are supported.',
      );
    }
    if (fieldSchema.type === 'array' && 'items' in fieldSchema) {
      const items = fieldSchema.items as Record<string, unknown>;
      if (items.type === 'object' || 'properties' in items) {
        throw new Error(
          `Array of objects not allowed in elicitation schema (field: "${fieldName}"). ` +
            'Only arrays with string enum items are supported for multi-select.',
        );
      }
    }
    const allowedTypes = ['boolean', 'string', 'number', 'integer', 'array'];
    if (!allowedTypes.includes(fieldSchema.type)) {
      throw new Error(
        `Invalid field type "${fieldSchema.type}" in elicitation schema (field: "${fieldName}"). ` +
          `Allowed types: ${allowedTypes.join(', ')}`,
      );
    }
  }
}

export function clientSupportsFormElicitation(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    return Boolean(clientCapabilities.elicitation);
  } catch {
    return false;
  }
}

export function clientSupportsUrlElicitation(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    return Boolean(clientCapabilities.elicitation?.url);
  } catch {
    return false;
  }
}

export async function elicitForm(server: McpServer, request: FormElicitationRequest) {
  if (!clientSupportsFormElicitation(server)) {
    logger.warning('elicitation', {
      message: 'Client does not support form elicitation',
    });
    throw new Error('Client does not support form elicitation');
  }

  validateElicitationSchema(request.requestedSchema);
  logger.debug('elicitation', {
    message: 'Requesting form elicitation',
    fieldCount: Object.keys(request.requestedSchema.properties).length,
  });
  try {
    const lowLevel = getLowLevelServer(server);
    if (!lowLevel.request) {
      throw new Error('Server does not support client requests');
    }
    const response = (await lowLevel.request({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: request.message,
        requestedSchema: request.requestedSchema,
      },
    })) as ElicitResult;
    logger.info('elicitation', {
      message: 'Form elicitation completed',
      action: response.action,
    });
    return response;
  } catch (error) {
    logger.error('elicitation', {
      message: 'Form elicitation failed',
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function elicitUrl(
  server: McpServer,
  request: Omit<UrlElicitationRequest, 'mode'>,
) {
  if (!clientSupportsUrlElicitation(server)) {
    logger.warning('elicitation', {
      message: 'Client does not support URL elicitation',
    });
    throw new Error('Client does not support URL elicitation');
  }
  logger.debug('elicitation', {
    message: 'Requesting URL elicitation',
    elicitationId: request.elicitationId,
    url: request.url,
  });
  try {
    const lowLevel = getLowLevelServer(server);
    if (!lowLevel.request) {
      throw new Error('Server does not support client requests');
    }
    const response = (await lowLevel.request({
      method: 'elicitation/create',
      params: {
        mode: 'url',
        message: request.message,
        elicitationId: request.elicitationId,
        url: request.url,
      },
    })) as ElicitResult;
    logger.info('elicitation', {
      message: 'URL elicitation completed',
      action: response.action,
      elicitationId: request.elicitationId,
    });
    return response;
  } catch (error) {
    logger.error('elicitation', {
      message: 'URL elicitation failed',
      error: (error as Error).message,
      elicitationId: request.elicitationId,
    });
    throw error;
  }
}

export async function notifyElicitationComplete(
  server: McpServer,
  elicitationId: string,
) {
  if (!clientSupportsUrlElicitation(server)) {
    throw new Error('Client does not support URL elicitation notifications');
  }
  logger.debug('elicitation', {
    message: 'Sending elicitation complete notification',
    elicitationId,
  });
  try {
    const lowLevel = getLowLevelServer(server);
    const sent = lowLevel.notification?.({
      method: 'notifications/elicitation/complete',
      params: { elicitationId },
    });
    if (sent) await sent;
    logger.info('elicitation', {
      message: 'Elicitation complete notification sent',
      elicitationId,
    });
  } catch (error) {
    logger.error('elicitation', {
      message: 'Failed to send elicitation complete notification',
      error: (error as Error).message,
      elicitationId,
    });
    throw error;
  }
}

export async function confirm(
  server: McpServer,
  message: string,
  options?: {
    confirmLabel?: string;
    declineLabel?: string;
  },
) {
  const result = await elicitForm(server, {
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: options?.confirmLabel ?? 'Confirm',
          default: false,
        },
      },
    },
  });
  return result.action === 'accept' && result.content?.confirmed === true;
}

export async function promptText(
  server: McpServer,
  message: string,
  options?: {
    title?: string;
    description?: string;
    defaultValue?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
  },
) {
  const result = await elicitForm(server, {
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          title: options?.title ?? 'Value',
          description: options?.description,
          default: options?.defaultValue,
          minLength: options?.minLength,
          maxLength: options?.maxLength,
        },
      },
      ...(options?.required && { required: ['value'] }),
    },
  });
  if (result.action === 'accept') {
    return result.content?.value as string | undefined;
  }
  return undefined;
}

export async function promptSelect(
  server: McpServer,
  message: string,
  options: Array<{
    value: string;
    label: string;
  }>,
  config?: {
    title?: string;
    defaultValue?: string;
    required?: boolean;
  },
) {
  const result = await elicitForm(server, {
    message,
    requestedSchema: {
      type: 'object',
      properties: {
        selection: {
          type: 'string',
          title: config?.title ?? 'Selection',
          oneOf: options.map((opt) => ({ const: opt.value, title: opt.label })),
          default: config?.defaultValue,
        },
      },
      ...(config?.required && { required: ['selection'] }),
    },
  });
  if (result.action === 'accept') {
    return result.content?.selection as string | undefined;
  }
  return undefined;
}
