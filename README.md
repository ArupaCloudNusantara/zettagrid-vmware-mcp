# Zettagrid VMware MCP Server

> **Community fork** of [Zettagrid/zettagrid-vmware-mcp](https://github.com/Zettagrid/zettagrid-vmware-mcp) v1.0.0.  
> Fork version: **v1.1.0** — 50 tools, Indonesia zones (Jakarta, Cibitung), full firewall/NAT CRUD, VM resize/reset, vApp delete/undeploy, task polling, Docker transport. All original Australian zones and tools are fully preserved.

A Model Context Protocol (MCP) server for managing VMware Cloud Director (VCD 10.5) infrastructure through AI assistants such as Claude. Covers the full tenant lifecycle: read, create, modify, delete across vApps, VMs, firewall, NAT, snapshots, and tasks.

---

## Supported Zones

| Region | Zone | Token Variable | Endpoint |
|--------|------|----------------|----------|
| Australia | Sydney | `ZETTAGRID_API_TOKEN_SYDNEY` | `https://mycloud.syd.zettagrid.com/api` |
| Australia | Melbourne | `ZETTAGRID_API_TOKEN_MELBOURNE` | `https://mycloud.mel.zettagrid.com/api` |
| Australia | Perth | `ZETTAGRID_API_TOKEN_PERTH` | `https://mycloud.per.zettagrid.com/api` |
| Australia | Brisbane | `ZETTAGRID_API_TOKEN_BRISBANE` | `https://mycloud.bri.zettagrid.com/api` |
| Australia | Adelaide | `ZETTAGRID_API_TOKEN_ADELAIDE` | `https://mycloud.adl.zettagrid.com/api` |
| Australia | Darwin | `ZETTAGRID_API_TOKEN_DARWIN` | `https://mycloud.dar.zettagrid.com/api` |
| Indonesia | Jakarta | `ZETTAGRID_API_TOKEN_JAKARTA` | `https://mycloud-jkt.zettagrid.id/api` |
| Indonesia | Cibitung | `ZETTAGRID_API_TOKEN_CIBITUNG` | `https://mycloud-cbt.zettagrid.id/api` |

Configure only the zones you have access to. The server starts up cleanly with a single zone; unconfigured zones log a warning and are skipped.

---

## Installation

**Prerequisites:** Node.js 18+, npm, a valid Zettagrid API token.  
API tokens are issued per zone via the Zettagrid customer portal.

```bash
git clone https://github.com/YOUR-USERNAME/zettagrid-vmware-mcp.git
cd zettagrid-vmware-mcp
npm install
cp .env.example .env   # edit with your credentials
npm run build
npm start
```

---

## Configuration

### `.env` — minimal (single zone)

```bash
ZETTAGRID_ORGANIZATION=your-org-name
ZETTAGRID_DEFAULT_ZONE=jakarta

# Only configure the zones you have:
ZETTAGRID_API_TOKEN_JAKARTA=your-jakarta-token

TRANSPORT=stdio   # or "http" for Docker
```

### `.env` — multi-zone

```bash
ZETTAGRID_ORGANIZATION=your-org-name
ZETTAGRID_DEFAULT_ZONE=perth
ZETTAGRID_API_VERSION=39.1

ZETTAGRID_API_TOKEN_PERTH=your-perth-token
ZETTAGRID_API_TOKEN_SYDNEY=your-sydney-token
ZETTAGRID_API_TOKEN_JAKARTA=your-jakarta-token
ZETTAGRID_API_TOKEN_CIBITUNG=your-cibitung-token

TRANSPORT=stdio
PORT=3001
```

---

## MCP Client Configuration

### Claude Desktop (stdio transport)

`%APPDATA%\Claude\claude_desktop_config.json` (Windows)  
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "zettagrid": {
      "command": "node",
      "args": ["/absolute/path/to/zettagrid-vmware-mcp/build/index.js"],
      "env": {
        "ZETTAGRID_ORGANIZATION": "your-org-name",
        "ZETTAGRID_DEFAULT_ZONE": "jakarta",
        "ZETTAGRID_API_TOKEN_JAKARTA": "your-jakarta-token",
        "ZETTAGRID_API_VERSION": "39.1"
      }
    }
  }
}
```

### Claude Code (HTTP transport via Docker)

```json
{
  "mcpServers": {
    "zettagrid": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Docker Deployment (HTTP transport)

```bash
cp .env.example .env   # fill in credentials, set TRANSPORT=http
docker compose up -d --build
curl http://localhost:3001/health
```

`compose.yml` binds to `127.0.0.1:3001` by default — expose externally via Tailscale or an SSH tunnel.

---

## Tool Reference — 50 Tools

### Zone (3)

| Tool | Description |
|------|-------------|
| `test_zone` | Verify connectivity and auth to a zone |
| `get_zone_info` | List all configured zones with their codes and default |
| `get_zone_health` | Latency and auth health across all configured zones |

### Organization (2)

| Tool | Description |
|------|-------------|
| `list_organizations` | List orgs accessible to the token |
| `get_organization` | Org details, full name, and settings |

### VDC (4)

| Tool | Description |
|------|-------------|
| `list_vdcs` | List Virtual Data Centers |
| `get_vdc` | VDC details and storage profiles |
| `show_vdc_resources` | CPU, RAM, storage usage percentages |
| `show_all_vdc_resources` | Resources across all VDCs (server aggregate) |

### vApp (6)

| Tool | Description |
|------|-------------|
| `list_vapps` | List all vApps with status |
| `get_vapp` | vApp details, VMs inside, deployment status |
| `power_on_vapp` | Power on a vApp |
| `power_off_vapp` | Power off a vApp (hard) |
| `create_vapp` | Deploy a vApp from a catalog template |
| `delete_vapp` | Delete a vApp — automatically undeployes first if needed |
| `undeploy_vapp` | Undeploy a vApp from ESXi hosts without deleting data |

### VM (13)

| Tool | Description |
|------|-------------|
| `list_vms` | List VMs across all vApps |
| `get_vm` | VM details: CPU, RAM, status, OS, network |
| `get_vm_console` | WebMKS console ticket for browser access |
| `get_vm_metrics` | Real-time CPU/RAM usage (requires VCD metrics endpoint) |
| `power_on_vm` | Power on a VM |
| `power_off_vm` | Hard power off (no OS involvement) |
| `shutdown_vm` | Graceful guest OS shutdown (requires VMware Tools) |
| `reboot_vm` | Graceful guest OS reboot (requires VMware Tools) |
| `suspend_vm` | Suspend VM to disk |
| `reset_vm` | Hard reset — for unresponsive VMs, no VMware Tools required |
| `update_vm_cpu` | Change vCPU count — **VM must be powered off** |
| `update_vm_memory` | Change RAM (MB) — **VM must be powered off** |

### Snapshot (4)

| Tool | Description |
|------|-------------|
| `list_snapshots` | List VM snapshots |
| `create_snapshot` | Create a snapshot |
| `revert_snapshot` | Revert to current snapshot |
| `remove_snapshots` | Remove all snapshots for a VM |

### Disk & Task (3)

| Tool | Description |
|------|-------------|
| `list_disks` | List named independent disks |
| `list_tasks` | List recent async tasks with status |
| `get_task` | Poll a specific task by ID — enables AI async loops |

### Catalog (2)

| Tool | Description |
|------|-------------|
| `list_catalogs` | List catalogs in the organization |
| `list_catalog_items` | List vApp templates in a catalog (provides `templateHref` for `create_vapp`) |

### Network (3)

| Tool | Description |
|------|-------------|
| `list_org_networks` | List organization VDC networks |
| `list_external_networks` | List provider networks (provider token required; returns 4xx for tenant) |
| `get_provider_network_info` | Provider network details (provider token required) |

### Edge Gateway (3)

| Tool | Description |
|------|-------------|
| `list_edge_gateways` | List NSX-T edge gateways |
| `get_edge_gateway` | Edge gateway details and status |
| `show_edge_network_config` | Summarized config: external IPs, NAT count, FW count |

### Firewall (4)

| Tool | Description |
|------|-------------|
| `list_firewall_rules` | List all firewall rules including the default rule |
| `create_firewall_rule` | Create a new firewall rule |
| `update_firewall_rule` | Update an existing rule (name, policy, enabled, IPs) |
| `delete_firewall_rule` | Delete a firewall rule by ID |

### NAT (3)

| Tool | Description |
|------|-------------|
| `list_nat_rules` | List all DNAT/SNAT rules |
| `create_nat_rule` | Create a DNAT or SNAT rule |
| `delete_nat_rule` | Delete a NAT rule by ID |

---

## Transport Modes

| Mode | `TRANSPORT` | Use case |
|------|-------------|----------|
| `stdio` | `stdio` (default) | Claude Desktop, Cursor — subprocess, no network exposure |
| `http` | `http` | Docker, remote Claude Code, SSH tunnel access |

HTTP endpoints (when `TRANSPORT=http`):
- `GET /health` — server status and tool count
- `POST /mcp` — MCP JSON-RPC (StreamableHTTPServerTransport)

---

## Authentication

The server exchanges your Zettagrid API token for a short-lived OAuth access token automatically:

```
POST https://mycloud-{zone}.zettagrid.id/oauth/tenant/{org}/token
  ?grant_type=refresh_token&refresh_token={api_token}
```

Sessions are cached and refreshed transparently. No additional auth setup is needed beyond providing the API token.

---

## Troubleshooting

**Zone not configured warning on startup** — only the zones with a configured `ZETTAGRID_API_TOKEN_{ZONE}` variable will be active. Others log warnings and are skipped. This is expected behavior.

**VM resize fails** — `update_vm_cpu` and `update_vm_memory` require the VM to be in **powered-off** state (status 8). Use `get_vm` to check status before calling.

**NAT/FW operations return `BUSY_ENTITY`** — NSX-T edge gateways need ~20 seconds to realize changes. If you chain firewall and NAT writes in quick succession, the second call may fail with BUSY_ENTITY. Retry after 20–30 seconds.

**`get_vm_metrics` returns error** — the VCD metrics CloudAPI endpoint (`/cloudapi/1.0.0/vms/{id}/metrics/current`) may not be enabled on all Zettagrid VCD instances. Contact Zettagrid support to confirm.

**`list_external_networks` / `get_provider_network_info` return 4xx** — these are provider-scope endpoints. Tenant API tokens (the type issued via the customer portal) are expected to receive HTTP 4xx from these endpoints. This is correct VCD behavior, not a bug.

**Auth token test:**
```bash
curl -s -X POST \
  "https://mycloud-jkt.zettagrid.id/oauth/tenant/YourOrgName/token?grant_type=refresh_token&refresh_token=YourToken" \
  -H "Accept: application/json" | jq .access_token
```

---

## Testing

This server uses live integration tests against real VCD infrastructure. Tests are not included in the public release — write your own against your VDC using the tool reference above. All tools follow the same request/response pattern; see `.env.example` for the environment variables.

---

## Fork Changes from Upstream

### Indonesia zones (new)

| Zone | Code | Endpoint |
|------|------|----------|
| Jakarta | `jkt` | `https://mycloud-jkt.zettagrid.id/api` |
| Cibitung | `cbt` | `https://mycloud-cbt.zettagrid.id/api` (zone code assumed — confirm with Zettagrid Indonesia) |

### Stubs fixed

Three upstream tools had `// TODO` client implementations returning empty arrays. This fork wires them to existing XML parsers:

| Tool | Fix |
|------|-----|
| `list_organizations` | Uses `parseOrganizationRecords()` |
| `list_vapps` | Uses `parseVAppRecords()` |
| `list_external_networks` | Uses `parseQueryResults()` |

Additionally: `parseVAppRecords` had a `parseInt("POWERED_ON") = NaN` bug (VCD query API returns string status for vApps, not integer). Fixed with `isNaN` fallback, matching the existing `parseVMRecords` pattern.

### New tools (30 added, 50 total vs upstream 20)

**v1.1.0** (+30): `get_vm`, `shutdown_vm`, `reboot_vm`, `suspend_vm`, `reset_vm`, `get_vapp`, `power_on_vapp`, `power_off_vapp`, `create_vapp`, `delete_vapp`, `undeploy_vapp`, `update_vm_cpu`, `update_vm_memory`, `list_disks`, `list_tasks`, `get_task`, `list_org_networks`, `list_catalogs`, `list_catalog_items`, `list_snapshots`, `create_snapshot`, `revert_snapshot`, `remove_snapshots`, `get_zone_health`, `list_nat_rules`, `create_nat_rule`, `delete_nat_rule`, `update_firewall_rule`, `delete_firewall_rule`, `get_vm_metrics`

### SDK upgrade

Upgraded `@modelcontextprotocol/sdk` from `0.5.0` to `1.12.0`. The existing `Server` + `setRequestHandler` API is preserved; no tool registration code changed.

### HTTP transport

Added `StreamableHTTPServerTransport` alongside the original stdio transport. Controlled by `TRANSPORT` env var (`stdio` or `http`).

---

## VCD API Notes

Relevant to anyone extending this server against VCD 10.5 / NSX-T:

- **CloudAPI auth header**: `Accept: application/json;version=39.1` — NOT bare `application/json` (returns 406)
- **XML API auth header**: `Accept: application/*+xml;version=39.1`
- **Edge gateway URN format**: `urn:vcloud:gateway:{uuid}` — CloudAPI requires the full URN, not just the UUID
- **NSX-T realization delay**: After any FW or NAT write, wait ~20s before issuing another edge gateway API call or VCD returns `BUSY_ENTITY`
- **`update_firewall_rule` requires `id` in body**: VCD 10.5 silently ignores PUT updates that omit the `id` field (returns 202 accepted but applies nothing)
- **NAT rule field names** (VCD 10.5 NSX-T CloudAPI schema): use `ruleType` (not `type`), `dnatExternalPort` (not `externalPort`); there is no `internalPort` field
- **VM hardware XML namespace**: `PUT /virtualHardwareSection/cpu` and `/memory` require `xmlns="http://www.vmware.com/vcloud/v1.5"` as the root element namespace; VCD rejects the RASD namespace as root with "Cannot find declaration of element 'Item'"
- **vApp status**: VCD query API returns string `"POWERED_ON"` (not integer) for vApp records; integer status is used in the detail API. `parseVAppRecords` handles both.
- **VM settle time**: After a vApp instantiation task completes, wait ~5–8s before issuing power operations or they may fail silently

---

## License

MIT — see [LICENSE](LICENSE).

This project is not officially supported by Zettagrid and is provided without warranty.
