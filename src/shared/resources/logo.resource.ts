import dedent from "dedent";
import { logger } from "../utils/logger.js";

const LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const LOGO_RESOURCE = {
  uri: "logo://server",
  name: "Server Logo",
  description: "MCP server logo image (binary resource example)",
  mimeType: "image/png",
  handler: () => {
    logger.debug("logo_resource", { message: "Server logo requested" });
    return {
      contents: [
        {
          uri: "logo://server",
          mimeType: "image/png",
          blob: LOGO_PNG_BASE64,
        },
      ],
    };
  },
};

export const LOGO_SVG_RESOURCE = {
  uri: "logo://server/svg",
  name: "Server Logo (SVG)",
  description: "MCP server logo in SVG format (text resource example)",
  mimeType: "image/svg+xml",
  handler: () => {
    logger.debug("logo_svg_resource", { message: "Server SVG logo requested" });
    const svgContent = dedent`
      <?xml version="1.0" encoding="UTF-8"?>
      <svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="40" fill="#4A90E2" />
        <text x="50" y="55" font-family="Arial" font-size="30" fill="white" text-anchor="middle">MCP</text>
      </svg>
    `;
    return {
      contents: [
        {
          uri: "logo://server/svg",
          mimeType: "image/svg+xml",
          text: svgContent,
        },
      ],
    };
  },
};
