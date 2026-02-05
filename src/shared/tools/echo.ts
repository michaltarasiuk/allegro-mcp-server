import { z } from "zod";
import { defineTool } from "./types.js";

export const echoInputSchema = z.object({
  message: z.string().min(1).describe("Message to echo back"),
  uppercase: z.boolean().optional().describe("Convert message to uppercase"),
});

export const echoTool = defineTool({
  name: "echo",
  title: "Echo",
  description: "Echo back a message, optionally transformed",
  inputSchema: echoInputSchema,
  outputSchema: {
    echoed: z.string().describe("The echoed message"),
    length: z.number().describe("Message length"),
  },
  annotations: {
    title: "Echo Message",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args) => {
    const message = args.message;
    const echoed = args.uppercase ? message.toUpperCase() : message;
    const result = {
      echoed,
      length: echoed.length,
    };
    return Promise.resolve({
      content: [{ type: "text", text: echoed }],
      structuredContent: result,
    });
  },
});
