// Targets the real zettagrid-vmware-mcp HTTP transport:
//   GET  /health  — basic liveness
//   POST /mcp     — StreamableHTTPServerTransport (MCP JSON-RPC)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.argv[2]; // e.g. http://zettagrid-mcp-demo.zettagrid-mcp.svc.cluster.local:3001
if (!baseUrl) {
  console.error("Usage: node smoke-test.mjs <base-url, no trailing slash>");
  process.exit(1);
}

try {
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`/health returned ${health.status}`);
  console.log("OK: /health reachable.");

  const client = new Client({ name: "smoke-test", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);

  const { tools } = await client.listTools();
  if (!tools?.length) throw new Error("No tools registered on the MCP server.");
  console.log(`OK: ${tools.length} tool(s) registered.`);

  // get_zone_health is purpose-built for this: auth + latency across every
  // configured zone, no arguments, read-only. Falls back to any list/get
  // tool if the name ever changes upstream.
  const probe =
    tools.find((t) => t.name === "get_zone_health") ??
    tools.find((t) => /^(list_|get_|test_)/.test(t.name));

  if (probe) {
    const result = await client.callTool({ name: probe.name, arguments: {} });
    if (result.isError) throw new Error(`Tool "${probe.name}" returned an error.`);
    console.log(`OK: "${probe.name}" responded successfully.`);
  }

  await client.close();
  process.exit(0);
} catch (err) {
  console.error("Smoke test failed:", err.message);
  process.exit(1);
}
