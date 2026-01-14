#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";

import { loadTranscripts, downloadTranscripts } from "./loader.js";
import {
  initializeIndex,
  searchTranscripts,
  getEpisode,
  listEpisodes,
} from "./search.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const MODE = process.env.MCP_MODE || "stdio"; // "stdio" for local, "sse" for remote

// Create the MCP server
function createMCPServer() {
  const server = new Server(
    {
      name: "lenny-transcripts",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Define available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_transcripts",
        description:
          "Search across all of Lenny's Podcast transcripts for insights on a topic. " +
          "Returns relevant excerpts from episodes with guest names. " +
          "Use this to find what product leaders and experts have said about specific topics " +
          "like pricing, growth, product management, hiring, etc.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description:
                "The search query - use keywords related to the topic you want insights on",
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return (default: 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_episode",
        description:
          "Get the full transcript for a specific episode by guest name. " +
          "Use this when you want to dive deeper into a specific conversation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            guest: {
              type: "string",
              description:
                "The name of the guest (e.g., 'Shreyas Doshi', 'Julie Zhuo')",
            },
          },
          required: ["guest"],
        },
      },
      {
        name: "list_episodes",
        description:
          "List all available episodes/guests in Lenny's Podcast archive. " +
          "Use this to see what guests and topics are available to search.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_transcripts": {
          const query = (args as { query: string; limit?: number }).query;
          const limit = (args as { query: string; limit?: number }).limit || 10;

          const results = await searchTranscripts(query, limit);

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No results found for "${query}". Try different keywords.`,
                },
              ],
            };
          }

          const formattedResults = results
            .map((r, i) => `## ${i + 1}. ${r.guest}\n\n${r.snippet}\n`)
            .join("\n---\n\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${results.length} relevant episodes for "${query}":\n\n${formattedResults}`,
              },
            ],
          };
        }

        case "get_episode": {
          const guest = (args as { guest: string }).guest;
          const episode = getEpisode(guest);

          if (!episode) {
            const allGuests = listEpisodes();
            const suggestions = allGuests
              .filter((g) =>
                g.toLowerCase().includes(guest.toLowerCase().split(" ")[0])
              )
              .slice(0, 5);

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Episode with guest "${guest}" not found.${
                    suggestions.length > 0
                      ? ` Did you mean: ${suggestions.join(", ")}?`
                      : ""
                  }`,
                },
              ],
            };
          }

          // Return full transcript (may be long)
          return {
            content: [
              {
                type: "text" as const,
                text: `# Episode: ${episode.guest}\n\n${episode.content}`,
              },
            ],
          };
        }

        case "list_episodes": {
          const guests = listEpisodes();

          return {
            content: [
              {
                type: "text" as const,
                text: `# Available Episodes (${guests.length} total)\n\n${guests.join("\n")}`,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Run in stdio mode (local)
async function runStdio() {
  console.error("Starting Lenny's Podcast MCP Server (stdio mode)...");

  const episodes = await loadTranscripts();
  initializeIndex(episodes);

  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MCP Server running. Waiting for requests...");
}

// Run in SSE mode (remote/hosted)
async function runSSE() {
  console.error("Starting Lenny's Podcast MCP Server (SSE mode)...");

  // Download transcripts from Dropbox if not present locally
  await downloadTranscripts();

  const episodes = await loadTranscripts();
  initializeIndex(episodes);

  const app = express();
  app.use(express.json());

  // Track active transports by sessionId
  const transports: { [sessionId: string]: SSEServerTransport } = {};

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", episodes: episodes.length });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      episodes: episodes.length,
      endpoints: {
        sse: "/sse",
        messages: "/messages",
        health: "/health"
      }
    });
  });

  // OAuth endpoints - return JSON 404 to indicate no auth required
  // (prevents Claude Code from getting confused by HTML 404 errors)
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "No authorization required" });
  });

  app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "No authorization required" });
  });

  app.post("/register", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "No registration required" });
  });

  app.post("/oauth/register", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found", message: "No registration required" });
  });

  // SSE endpoint - clients connect here
  app.get("/sse", async (_req: Request, res: Response) => {
    console.error(`New SSE connection from ${_req.ip}`);

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;

    console.error(`Session created: ${sessionId}`);

    res.on("close", () => {
      console.error(`SSE connection closed: ${sessionId}`);
      delete transports[sessionId];
    });

    const server = createMCPServer();
    await server.connect(transport);
  });

  // Messages endpoint - clients POST messages here
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    console.error(`Message received for session: ${sessionId}`);

    const transport = transports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      console.error(`No transport found for session: ${sessionId}`);
      res.status(400).json({ error: "No transport found for sessionId" });
    }
  });

  app.listen(PORT, () => {
    console.error(`MCP Server listening on http://localhost:${PORT}`);
    console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
  });
}

// Main entry point
async function main() {
  if (MODE === "sse") {
    await runSSE();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
