# Lenny's Podcast MCP

Search 284 episodes of [Lenny's Podcast](https://www.lennysnewsletter.com/podcast) transcripts directly from Claude. Get instant access to product wisdom from guests like Shreyas Doshi, Julie Zhuo, Brian Chesky, and hundreds more.

## Quick Start

### Option 1: Claude Desktop / Claude.ai

1. Open Claude Desktop or go to [claude.ai](https://claude.ai)
2. Go to **Settings → Connectors → Add custom connector**
3. Enter the URL: `https://lenny-mcp.onrender.com/mcp`
4. Click **Add** and enable the connector
5. Start asking questions!

### Option 2: ChatGPT

1. Go to **Settings → Apps → Enable Developer Mode**
2. Click **Create App**
3. Add a name and paste the URL: `https://lenny-mcp.onrender.com/mcp`
4. Save and start using it!

### Option 3: Claude Code CLI

```bash
claude mcp add -t http -s user lenny-transcripts https://lenny-mcp.onrender.com/mcp
```

Then restart Claude Code.

---

## What You Can Ask

Once connected, try asking Claude things like:

- "What do product leaders say about pricing strategy?"
- "How should I think about user onboarding?"
- "What has Shreyas Doshi said about prioritization?"
- "Search Lenny's podcast for advice on building growth teams"
- "What do guests say about the transition from IC to manager?"

## Available Tools

| Tool | Description |
|------|-------------|
| `search_transcripts` | Search all 284 episodes by topic/keyword |
| `get_episode` | Get full transcript for a specific guest |
| `list_episodes` | List all available episodes |

## Self-Hosting

Want to run your own instance?

### Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/akshayvkt/lenny-mcp)

Set the environment variable `MCP_MODE=sse` in Render settings.

### Run Locally

```bash
# Clone the repo
git clone https://github.com/akshayvkt/lenny-mcp
cd lenny-mcp

# Install and build
npm install
npm run build

# Run in HTTP mode (for remote connections)
MCP_MODE=sse npm start

# Or run in stdio mode (for local Claude Code)
npm start
```

### Local Claude Code (with your own transcripts)

```bash
# Download transcripts from Lenny's Dropbox link
# Set the path to where you downloaded them
export LENNY_TRANSCRIPTS_PATH="/path/to/Lenny's Podcast Transcripts Archive [public]"

# Add to Claude Code as a local server
claude mcp add lenny-transcripts -- node /path/to/lenny-mcp/dist/index.js
```

## How It Works

The server downloads Lenny's publicly shared transcripts from Dropbox on startup, indexes them using FlexSearch for fast keyword search, and exposes three MCP tools that Claude can use to search and retrieve content.

## Credits

- Transcripts from [Lenny Rachitsky's public archive](https://twitter.com/lennysan)
- Built with [Model Context Protocol](https://modelcontextprotocol.io)

## License

MIT - See [LICENSE](LICENSE) for details.

The podcast transcripts are property of Lenny Rachitsky and are used with his public permission.
