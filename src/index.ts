/**
 * Zettagrid VMware MCP Server - Main Entry Point
 * Model Context Protocol server for comprehensive Zettagrid cloud management
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ZettagridMcpServer } from './server/mcp-server.js';

/**
 * Main function to start the MCP server
 */
async function main(): Promise<void> {
  // Create MCP server instance
  const server = new Server(
    {
      name: 'zettagrid-vmware-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Initialize Zettagrid MCP server
  const zettagridServer = new ZettagridMcpServer(server);
  await zettagridServer.initialize();

  // Create transport and start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
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
main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});