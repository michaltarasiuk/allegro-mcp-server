import dedent from 'dedent';

export interface ToolMetadata {
  name: string;
  title: string;
  description: string;
}

export const toolsMetadata = {
  example_api: {
    name: 'example_api',
    title: 'Example API Tool',
    description: dedent`
      Call an example external API endpoint and return the response.

      This tool demonstrates best practices for:
      - Making HTTP requests to external APIs
      - Handling responses and errors gracefully
      - Validating input parameters with Zod schemas
      - Formatting output for LLM consumption

      The tool can be customized for any REST API by modifying:
      1. The API endpoint URL
      2. Input schema validation rules
      3. Response parsing and formatting logic
      4. Error handling for specific API error codes
    `,
  },
} as const satisfies Record<string, ToolMetadata>;

export function getToolMetadata(toolName: keyof typeof toolsMetadata) {
  return toolsMetadata[toolName];
}

export function getToolNames() {
  return Object.keys(toolsMetadata);
}

export const serverMetadata = {
  title: 'Allegro MCP Server',
  instructions:
    'Use the available tools to inspect resources, run API calls, and keep responses concise.',
} as const;
