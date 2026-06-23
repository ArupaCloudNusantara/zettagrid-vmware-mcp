/**
 * Zettagrid VMware MCP Server - Main Entry Point
 * Model Context Protocol server for comprehensive Zettagrid cloud management
 *
 * Fork addition: HTTP transport alongside the original stdio transport.
 * Controlled by TRANSPORT env var ("http" | "stdio", default: "stdio").
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ZettagridMcpServer } from './server/mcp-server.js';
import dotenv from 'dotenv';
import express from 'express';

// Load environment variables
dotenv.config();

const SERVER_VERSION = '1.1.0';

function createServer(): Server {
  return new Server(
    {
      name: 'zettagrid-vmware-mcp',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
}

/**
 * stdio transport — original upstream behaviour, for Claude Desktop / Cursor
 */
async function runStdio(): Promise<void> {
  console.error('Starting Zettagrid VMware MCP Server (stdio)...');

  const server = createServer();
  const zettagridServer = new ZettagridMcpServer(server);
  await zettagridServer.initialize();

  console.error('Zettagrid client initialized successfully');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP server connected and ready (stdio)');
}

/**
 * HTTP transport — fork addition, for Docker deployment / remote access via Tailscale
 */
async function runHttp(): Promise<void> {
  console.error('Starting Zettagrid VMware MCP Server (HTTP)...');

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: 'zettagrid-vmware-mcp',
      version: SERVER_VERSION,
      defaultZone: process.env.ZETTAGRID_DEFAULT_ZONE ?? 'perth',
    });
  });

  // Stateless: new Server + transport per request (matches MCP streamable HTTP pattern)
  app.post('/mcp', async (req, res) => {
    try {
      const server = createServer();
      const zettagridServer = new ZettagridMcpServer(server);
      await zettagridServer.initialize();

      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      await server.connect(transport);
      res.on('close', () => transport.close());
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  const port = parseInt(process.env.PORT ?? '3001', 10);
  app.listen(port, () => {
    console.error(`Zettagrid MCP HTTP server running on port ${port}`);
    console.error(`Default zone: ${process.env.ZETTAGRID_DEFAULT_ZONE ?? 'perth'}`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the server
const transportMode = process.env.TRANSPORT ?? 'stdio';
const run = transportMode === 'http' ? runHttp : runStdio;

run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
