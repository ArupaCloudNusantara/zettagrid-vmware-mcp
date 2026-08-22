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
import { extractZoneCredentials } from './middleware/auth.js';
import { checkRateLimit } from './middleware/ratelimit.js';
import { logAudit } from './middleware/logging.js';
import { SERVER_VERSION } from './lib/package-info.js';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';

// Load environment variables
dotenv.config();

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
 * Stateless: new Server + transport per request (matches MCP streamable HTTP pattern).
 * Multi-tenant: each caller supplies their own VCD credentials via headers rather than the
 * server holding one shared identity for everyone. Shared by /mcp and /mcp/readonly — the
 * only difference between the two mounts is the readOnly flag passed to ZettagridMcpServer.
 */
async function handleMcpRequest(req: Request, res: Response, readOnly: boolean): Promise<void> {
  const extraction = extractZoneCredentials(req.headers);
  if ('error' in extraction) {
    res.status(extraction.error.status).json({ error: extraction.error.message });
    return;
  }

  const rateLimit = checkRateLimit(extraction.credentialHash);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds ?? 60));
    res.status(429).json({ error: `Rate limit exceeded (${rateLimit.limit}/min). Retry later.` });
    return;
  }

  try {
    const server = createServer();
    const zettagridServer = new ZettagridMcpServer(server, extraction.credentials, readOnly);
    await zettagridServer.initialize();

    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);
    res.on('close', () => transport.close());
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logAudit({
      credentialHashPrefix: extraction.credentialHash === 'env' ? 'env' : extraction.credentialHash.slice(0, 12),
      organization: extraction.credentials?.organizationName ?? 'env',
      zone: extraction.credentials?.zone ?? (process.env.ZETTAGRID_DEFAULT_ZONE ?? 'default'),
      tool: 'transport',
      outcome: 'error',
      durationMs: 0,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * HTTP transport — fork addition, for Docker deployment / remote access via Tailscale
 */
async function runHttp(): Promise<void> {
  console.error('Starting Zettagrid VMware MCP Server (HTTP)...');
  console.error(
    'WARNING: this transport is plaintext HTTP. If callers pass X-VCD-Token/-Org/-Zone ' +
    'headers, that credential travels in plaintext on every request — do not expose this ' +
    'port beyond a TLS-terminating reverse proxy or a trusted private network (Tailscale/VPN). ' +
    'See compose.yml — it must stay bound to loopback.'
  );

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

  app.post('/mcp', (req, res) => {
    void handleMcpRequest(req, res, false);
  });

  // A2.1: read-only mount — lists and permits only list_/get_/show_/test_-prefixed tools
  // (minus get_vm_console, which returns a live console bearer credential despite the name).
  app.post('/mcp/readonly', (req, res) => {
    void handleMcpRequest(req, res, true);
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
