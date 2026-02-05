import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServerWithInternals } from "../mcp/server-internals.js";
import { logger } from "../utils/logger.js";
import { paginateArray } from "../utils/pagination.js";
import { CONFIG_RESOURCE } from "./config.resource.js";
import { DOCS_RESOURCE } from "./docs.resource.js";
import { LOGO_RESOURCE, LOGO_SVG_RESOURCE } from "./logo.resource.js";
import { STATUS_RESOURCE, startStatusUpdates } from "./status.resource.js";

const resources = [
  CONFIG_RESOURCE,
  DOCS_RESOURCE,
  LOGO_RESOURCE,
  LOGO_SVG_RESOURCE,
  STATUS_RESOURCE,
];

export function registerResources(server: McpServer) {
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        annotations: {
          audience: ["user", "assistant"],
          priority: 0.5,
          lastModified: new Date().toISOString(),
        },
      },
      resource.handler
    );
  }
  const exampleTemplate = new ResourceTemplate(
    "example://items/{collection}/{id}",
    {
      list: () => {
        const items = [
          { collection: "books", id: "1" },
          { collection: "books", id: "2" },
          { collection: "movies", id: "1" },
        ];
        const page = paginateArray(items, undefined, 100);
        return {
          resources: page.data.map(({ collection, id }) => ({
            uri: `example://items/${collection}/${id}`,
            name: `${collection}-${id}.json`,
            title: `${collection} ${id}`,
            mimeType: "application/json",
            annotations: {
              audience: ["assistant"],
              priority: 0.6,
              lastModified: new Date().toISOString(),
            },
          })),
          nextCursor: page.nextCursor,
        };
      },
      complete: {
        collection: (_value: string) => ["books", "movies", "music"],
        id: (_value: string) => ["1", "2", "3"],
      },
    }
  );
  server.registerResource(
    "example-items",
    exampleTemplate,
    {
      title: "Example Items",
      description: "Dynamic items accessible by collection and id",
      mimeType: "application/json",
    },
    (_uri: URL, variables: Record<string, string | string[]>) => {
      const raw = variables as Record<string, string | string[]>;
      const collection =
        typeof raw.collection === "string"
          ? raw.collection
          : (raw.collection?.[0] ?? "");
      const id = typeof raw.id === "string" ? raw.id : (raw.id?.[0] ?? "");
      return {
        contents: [
          {
            uri: `example://items/${collection}/${id}`,
            name: `${collection}-${id}.json`,
            title: `${collection} ${id}`,
            mimeType: "application/json",
            text: JSON.stringify({ collection, id, ok: true }),
            annotations: {
              audience: ["assistant"],
              priority: 0.6,
              lastModified: new Date().toISOString(),
            },
          },
        ],
      };
    }
  );
  startStatusUpdates(server);
  logger.info("resources", {
    message: `Registered ${resources.length} resources`,
    resourceUris: resources.map((r) => r.uri),
  });
}

export function emitResourceUpdated(server: McpServer, uri: string) {
  try {
    getServerWithInternals(server).sendResourceUpdated?.({ uri });
  } catch (error) {
    console.warn("Failed to send resource updated notification:", error);
  }
  logger.debug("resources", {
    message: "Resource updated notification sent",
    uri,
  });
}

export function emitResourcesListChanged(server: McpServer) {
  server.sendResourceListChanged();
  logger.debug("resources", {
    message: "Resources list changed notification sent",
  });
}
