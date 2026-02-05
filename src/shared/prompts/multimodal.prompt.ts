import type { PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const MultimodalPromptArgsSchema = z.object({
  task: z
    .string()
    .describe('The analysis task to perform (e.g., "analyze this diagram")'),
  include_image: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include example image content'),
  include_audio: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include example audio content'),
  include_resource: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include embedded resource'),
});

export type MultimodalPromptArgs = z.infer<typeof MultimodalPromptArgsSchema>;

const EXAMPLE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const EXAMPLE_AUDIO_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQAAAAA=';

export const MULTIMODAL_PROMPT = {
  name: 'multimodal',
  description:
    'Generate analysis prompts with rich content (images, audio, embedded resources)',
  handler: async (args: unknown) => {
    logger.debug('multimodal_prompt', { message: 'Multimodal prompt called', args });
    const validation = MultimodalPromptArgsSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Invalid arguments: ${validation.error.message}`);
    }
    const { task, include_image, include_audio, include_resource } = validation.data;
    const messages: PromptMessage[] = [];
    messages.push({
      role: 'user',
      content: {
        type: 'text',
        text: `Task: ${task}\n\nPlease analyze the provided content below and provide detailed insights.`,
      },
    });
    if (include_image) {
      messages.push({
        role: 'user',
        content: {
          type: 'image',
          data: EXAMPLE_IMAGE_BASE64,
          mimeType: 'image/png',
          annotations: {
            audience: ['assistant'],
            priority: 0.9,
          },
        },
      });
    }
    if (include_audio) {
      messages.push({
        role: 'user',
        content: {
          type: 'audio',
          data: EXAMPLE_AUDIO_BASE64,
          mimeType: 'audio/wav',
          annotations: {
            audience: ['assistant'],
            priority: 0.8,
          },
        },
      });
    }
    if (include_resource) {
      messages.push({
        role: 'user',
        content: {
          type: 'resource',
          resource: {
            uri: 'docs://overview',
            mimeType: 'text/markdown',
            text: dedent`
              # Context Document

              This is an embedded resource that provides additional context for the analysis.

              ## Key Points
              - Resources can be embedded directly in prompts
              - This allows providing rich contextual information
              - The LLM can reference this content in its analysis

              Use this document as reference material when completing the task.
            `,
          },
        },
      });
    }
    if (include_image || include_audio || include_resource) {
      messages.push({
        role: 'assistant',
        content: {
          type: 'text',
          text: "I've received the content. Let me analyze it for you.",
        },
      });
    }
    messages.push({
      role: 'user',
      content: {
        type: 'text',
        text: 'Please provide a comprehensive analysis with specific observations and actionable recommendations.',
      },
    });
    logger.info('multimodal_prompt', {
      message: 'Multimodal prompt generated',
      task,
      content_types: {
        image: include_image,
        audio: include_audio,
        resource: include_resource,
      },
      message_count: messages.length,
    });
    return {
      description: `Multimodal analysis prompt for: ${task}`,
      messages,
    };
  },
};
