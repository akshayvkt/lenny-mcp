#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { loadTranscripts, downloadTranscripts } from "./loader.js";
import {
  initializeIndex,
  searchTranscripts,
  getEpisode,
  listEpisodes,
} from "./search.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const MODE = process.env.MCP_MODE || "stdio"; // "stdio" for local, "sse" for remote

// Get the directory path for serving static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create the MCP server
function createMCPServer() {
  const server = new Server(
    {
      name: "lenny-transcripts",
      version: "1.0.0",
      icons: [{
        src: "https://lenny-mcp.onrender.com/icon.jpeg",
        mimeType: "image/jpeg",
        sizes: ["512x512"],
      }],
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

// Run in HTTP mode (remote/hosted) using Streamable HTTP transport
async function runHTTP() {
  console.error("Starting Lenny's Podcast MCP Server (HTTP mode)...");

  // Download transcripts from Dropbox if not present locally
  await downloadTranscripts();

  const episodes = await loadTranscripts();
  initializeIndex(episodes);

  const app = express();
  app.use(express.json());

  // Serve static files (icon, etc.)
  app.use(express.static(join(__dirname, "..", "public")));

  // Track transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", episodes: episodes.length });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      episodes: episodes.length,
      endpoints: {
        mcp: "/mcp",
        health: "/health"
      }
    });
  });

  // Main MCP endpoint - handles all MCP communication
  app.post("/mcp", async (req: Request, res: Response) => {
    console.error(`MCP request received`);

    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      // Create new transport for new sessions
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // Connect the MCP server to this transport
      const server = createMCPServer();
      await server.connect(transport);

      // Clean up on close
      transport.onclose = () => {
        if (transport?.sessionId) {
          transports.delete(transport.sessionId);
          console.error(`Session closed: ${transport.sessionId}`);
        }
      };
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);

    // Store transport by session ID AFTER handleRequest (session ID is assigned during initialize)
    if (transport.sessionId && !transports.has(transport.sessionId)) {
      transports.set(transport.sessionId, transport);
      console.error(`New session stored: ${transport.sessionId}`);
    }
  });

  // Handle GET requests to /mcp for SSE streams (backwards compatibility)
  app.get("/mcp", async (req: Request, res: Response) => {
    console.error(`SSE connection request received`);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).json({ error: "No session found. Send POST to /mcp first." });
      return;
    }

    await transport.handleRequest(req, res);
  });

  // Handle DELETE for session cleanup
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.close();
        transports.delete(sessionId);
      }
    }
    res.status(200).json({ ok: true });
  });

  app.listen(PORT, () => {
    console.error(`MCP Server listening on http://localhost:${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

// Main entry point
async function main() {
  if (MODE === "sse" || MODE === "http") {
    await runHTTP();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
