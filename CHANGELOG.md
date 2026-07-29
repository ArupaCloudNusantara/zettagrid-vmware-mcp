# Changelog

All notable changes to this project are documented here.

This project follows [Semantic Versioning](https://semver.org/).

---

## [1.3.0] — 2026-07-29

Field-reported defect fixes from a live multi-VM/multi-disk deployment scenario (deploying VMs into an existing vApp with static IPs and per-VM storage/network requirements). 149/149 integration tests passing (up from 133 in 1.2.0).

### Fixed
- `add_vm_to_vapp`: any call passing `networkConnections` failed with an invalid `NetworkAssignment` schema violation (`networkName` is not a valid attribute on that element) — the tool now emits the correct `innerNetwork`/`containerNetwork` pair, only when the names actually differ
- `add_vm_to_vapp`: omitting `networkConnections` to work around the above left the new VM on the template's own disconnected network reference, which doesn't exist in the target VDC — the tool now resolves against the vApp's actual configured networks and fails clearly (`NETWORK_NOT_CONFIGURED_ON_VAPP`) instead of emitting XML vCD will reject
- `add_vm_to_vapp`: a failed recompose could leave a partially-created "orphan" VM with no way to discover its id — the error response now returns the orphan's VM id when one exists, and the success message documents the same cleanup path for the async-task-failure case
- VDC/vApp friendly names (e.g. `"DC_1138718"`) passed to `show_vdc_resources`, `get_vdc`, `list_vapps`, or `list_vms` produced a generic HTTP 500/400 that read like a permissions failure instead of resolving to the underlying UUID
- `create_vapp`: per-field documentation for `cpuCount`/`memoryMB`/`diskSizeMB` read as if they were auto-applied during instantiation; reworded to make explicit that the caller must call `update_vm_cpu`/`update_vm_memory`/`update_vm_disk` themselves afterward

### Added
- `delete_vm` — remove a single VM from its vApp without touching the vApp's other VMs (discovers the parent vApp automatically)
- `delete_vapp`: guard requiring `force: true` when the vApp contains more than one VM — previously the only delete tool reachable to remove a single bad VM was the one that destroys the entire vApp
- `add_vm_disk` — add a brand-new, independent disk to a VM (e.g. a data/DB disk separate from the OS disk); distinct from `update_vm_disk`, which only resizes the existing boot disk
- `update_vm_network`: `addNic: true` to append a new NIC instead of only ever editing an existing one by index
- `adapterType` (`VMXNET3`/`E1000`/`E1000E`) on `create_vapp`, `add_vm_to_vapp`, and `update_vm_network`'s `addNic` path — settable when a NIC is created; vCD does not permit changing an already-existing NIC's adapter type (confirmed against the live API, not a limitation of this tool)
- `add_vm_to_vapp`: `storageProfileHref`/`storageProfileName` parameters, matching `create_vapp`
- `get_vm`: now returns storage profile, NIC adapter type, CPU/memory hot-add flags, and OVF/guest properties (e.g. verifying whether SSH key injection actually landed)
- Opt-in `waitForTask`/`timeoutMs` parameters on the highest-value mutating tools (power/lifecycle operations, resize, vApp/VM create/delete, snapshots) — polls the task to completion internally before responding instead of requiring a separate `get_task` round-trip; default behavior (bare task returned immediately) is unchanged for existing callers

---

## [1.1.0] — 2026-06-22

**Fork release — based on [Zettagrid/zettagrid-vmware-mcp](https://github.com/Zettagrid/zettagrid-vmware-mcp) v1.0.0**

### Added — Zones
- Jakarta zone (`jakarta`, code `jkt`) — endpoint `https://mycloud-jkt.zettagrid.id/api`
- Cibitung zone (`cibitung`, code `cbt`) — endpoint `https://mycloud-cbt.zettagrid.id/api`
- Dual-domain support in `zone-auth.ts` endpoint validation (`zettagrid.com` and `zettagrid.id`)
- Dual-format URL generation in `zone-manager.ts` (AU: `mycloud.{code}.zettagrid.com`, ID: `mycloud-{code}.zettagrid.id`)

### Added — Tools (30 new, **50 total**)
- `get_vm` — full VM detail: CPU, RAM, status, OS, network
- `shutdown_vm` — graceful guest OS shutdown (requires VMware Tools)
- `reboot_vm` — graceful guest OS reboot (requires VMware Tools)
- `suspend_vm` — suspend VM to disk
- `reset_vm` — hard reset a VM without guest OS involvement (XML API `POST /vApp/vm-{id}/power/action/reset`)
- `update_vm_cpu` — resize vCPU count on a powered-off VM (XML API `PUT /virtualHardwareSection/cpu`); root namespace must be `xmlns="http://www.vmware.com/vcloud/v1.5"`
- `update_vm_memory` — resize RAM on a powered-off VM (XML API `PUT /virtualHardwareSection/memory`); same namespace requirement
- `get_vm_metrics` — current CPU/memory metrics (CloudAPI `GET /vms/{id}/metrics/current`; expected unavailable on VCD instances without the metrics endpoint)
- `get_vapp` — full vApp detail
- `power_on_vapp` — power on vApp
- `power_off_vapp` — hard power off vApp
- `create_vapp` — deploy vApp from catalog template
- `delete_vapp` — delete a vApp; automatically undeployes first if the vApp is still deployed (handles suspended or mixed-state VMs)
- `undeploy_vapp` — undeploy a vApp from ESXi hosts without deleting data; forcibly powers off any running or suspended VMs (`POST /vApp/vapp-{id}/action/undeploy` with `UndeployPowerAction=powerOff`)
- `list_disks` — list named independent disks
- `list_tasks` — list recent async tasks
- `get_task` — poll a VCD async task by ID; returns status, operation, progress
- `list_org_networks` — list organization VDC networks
- `list_catalogs` — list catalogs
- `list_catalog_items` — list vApp templates in a catalog
- `list_snapshots` — list VM snapshots
- `create_snapshot` — create VM snapshot
- `revert_snapshot` — revert VM to current snapshot
- `remove_snapshots` — remove all VM snapshots
- `get_zone_health` — health and latency status across all configured zones
- `list_nat_rules` — list NAT rules for an NSX-T edge gateway (CloudAPI)
- `create_nat_rule` — create DNAT/SNAT rule; VCD 10.5 NSX-T uses `ruleType` (not `type`) and `dnatExternalPort` (not `externalPort`)
- `delete_nat_rule` — delete a NAT rule by ID
- `update_firewall_rule` — update an existing firewall rule; payload must include `id: ruleId` or VCD 10.5 silently ignores the update
- `delete_firewall_rule` — delete a firewall rule by ID

### Fixed — Stub implementations
- `list_organizations` — upstream returned empty array with `// TODO`; now uses `parseOrganizationRecords()`
- `list_vapps` — same issue; now uses `parseVAppRecords()`
- `list_external_networks` — same issue; now uses `parseQueryResults()`
- `parseVAppRecords` — VCD query API returns string status `"POWERED_ON"` for vApp records (not integer); `parseInt("POWERED_ON")` = NaN; fixed with `isNaN` fallback matching `parseVMRecords` pattern

### Changed
- `@modelcontextprotocol/sdk`: `^0.5.0` → `^1.12.0`; `Server` + `setRequestHandler` registration pattern preserved
- `src/index.ts`: supports both stdio (original) and HTTP transport, selected via `TRANSPORT` env var
- `src/types.ts`: `ZoneId` extended with `'jakarta' | 'cibitung'`
- `src/managers/zone-manager.ts`: zone registry updated for Indonesia zones
- `src/auth/zone-auth.ts`: domain validation accepts `zettagrid.id` in addition to `zettagrid.com`

### Added — Infrastructure
- `Dockerfile` — multi-stage Node 20 Alpine build
- `compose.yml` — Docker Compose deployment, binds to `127.0.0.1:3001` by default
- `GET /health` endpoint (HTTP transport only)
- `POST /mcp` endpoint using `StreamableHTTPServerTransport` (HTTP transport only)

### VCD API Notes (live-confirmed on VCD 10.5 / NSX-T)
- NSX-T realization delay: FW/NAT write operations on the same edge gateway require ~20s apart or VCD returns `BUSY_ENTITY`
- `update_firewall_rule` PUT body must include `id: ruleId`; VCD 10.5 accepts the request (HTTP 202) but applies nothing without it
- `create_nat_rule` field names: `ruleType` not `type`; `dnatExternalPort` not `externalPort`; no `internalPort` field in schema
- VM hardware XML: `PUT /virtualHardwareSection/cpu` and `/memory` require `xmlns="http://www.vmware.com/vcloud/v1.5"` as root namespace; VCD rejects the RASD namespace with "Cannot find the declaration of element 'Item'"
- `delete_vapp` on a deployed vApp returns HTTP 400 "Stop the vApp and try again"; `undeploy_vapp` must be called first

---

## [1.0.0] — 2025-06-19

**Upstream release by [Zettagrid](https://github.com/Zettagrid/zettagrid-vmware-mcp)**

Initial release. Multi-zone support for all Australian Zettagrid zones (Sydney, Melbourne, Perth, Brisbane, Adelaide, Darwin), OAuth authentication with automatic token refresh, 20 MCP tools covering organization, VDC, vApp, VM, edge gateway, and firewall management. TypeScript implementation with vCloud Director v1.5+ schema types. stdio transport only.
