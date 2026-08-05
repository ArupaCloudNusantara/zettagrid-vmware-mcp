# Changelog

All notable changes to this project are documented here.

This project follows [Semantic Versioning](https://semver.org/).

---

## [1.4.0] — 2026-08-05

Guest customization reliability (Windows and cloud-init), a live user-reported password/XML
encoding defect, network handling for non-standard templates, and a full rework of the
application-port-profile auto-lookup/auto-create path.

### Fixed
- Guest customization for non-cloud-init templates (Windows, older Linux) was silently broken on
  every `create_vapp`/`add_vm_to_vapp` call using POOL/MANUAL IP mode: the post-deployment enable
  step built a malformed URL (double-encoded href) and 400'd every time; even after that, it raced
  the still-running instantiate/recompose task; `add_vm_to_vapp` targeted the *source template's*
  VM instead of the newly-created one; and it discarded the task its own PUT returned, so a caller
  powering on immediately after could collide with the still-in-flight backend reconfigure. All
  failures were invisible to callers (only logged, never surfaced). Also stopped firing this step
  unconditionally — it's now gated on the caller explicitly requesting a guest-customization
  override, since instantiation-time settings alone are already sufficient otherwise (confirmed
  across Windows Server 2016/2019/2022/2025 templates)
- `create_vapp` failed to instantiate templates whose own template VM ships with a disconnected NIC
  (`network="none"`, e.g. "Windows Server 2019 Standard Desktop") — the vApp-level network config
  now auto-populates from the caller's requested `networkConnections` instead of erroring
- Cloud-init templates (Ubuntu 24.04+) kept guest customization *enabled* when it should be
  disabled — a prior attempt to fix this by omitting `GuestCustomizationSection` entirely never
  actually worked, since vCD just falls back to the source template's own default. Now always
  explicitly sends `Enabled=false` for cloud-init templates
- Cloud-init network configuration (both the auto-generated netplan config for MANUAL IP mode, and
  a `network:` key inside a caller-supplied `userDataYaml`) was silently never applied — cloud-init
  only reads network config from a dedicated `network-config` OVF property, never from `user-data`.
  Both paths now deliver it correctly; live-verified via console login
- XML values (passwords, computer names, network/IP fields, storage profile fields, disk hrefs)
  were never escaped on write and never unescaped on read — a password or other value containing
  `&`, `<`, `>`, or `"` could produce malformed XML that broke the entire request, or round-trip
  back through `get_vm` corrupted. Root cause of a real user-reported issue setting an initial
  Ubuntu VM password
- `power_on_vapp`'s `forceCustomization` option sent the attribute at the vApp level, which vCD
  rejects ("Parameter forceCustomization is not supported for vApps") — it's VM-level only; now
  fans out to each VM in the vApp individually
- CloudAPI-backed calls (NAT rules, firewall rules, application port profiles) could throw a bare,
  context-free `fetch failed` with no retry, unlike other API calls — now retries with the same
  backoff and wraps failures with the endpoint/zone that failed
- Application port profile auto-lookup/auto-create had a cluster of related defects, found and
  fixed together: a `pageSize` of 128 the gateway silently rejected; unanchored substring matching
  that could match the wrong profile by port-number coincidence; hardcoded TCP regardless of the
  requested protocol; wrong ICMP payload shape; protocol-blind lookup collisions; name-only (not
  port-content) matching; a 25-item pagination cap that silently truncated larger orgs; duplicated
  VDC-resolution/creation logic between call sites; a silent "guess a VDC" fallback replaced with a
  clear error plus a required `vdcId`; and `create_application_port_profile` returning `{}` instead
  of the created object
- The suggested-IP helper (used in `CLARIFICATION_REQUIRED` responses) could suggest an IP already
  allocated to another VM or a DHCP lease — now checks actual network usage first
- DHCP IP mode requires *both* the DHCP service enabled *and* a pool configured, but validation only
  checked one — clarification responses now warn when either is missing, and Ubuntu 24.04+ no
  longer defaults to DHCP as a result

### Added
- Guest customization password validation: `adminPasswordEnabled: true` now requires either
  `adminPasswordAuto: true` or an explicit `adminPassword` — without one of these, vCD silently
  forces it back to `false` and no password gets configured at all. Rejected up front with a clear
  `CLARIFICATION_REQUIRED` instead of a silent no-op
- `forceCustomization` option on `power_on_vapp`/`power_on_vm` — re-runs guest OS customization on
  an already-deployed VM, for when guest properties were changed after the VM was already powered on
- Ubuntu 24.04+ templates now require explicit `networkConnections`/IP mode in `create_vapp` — the
  template's embedded network is often not valid in the target VDC, and relying on it silently
  produced broken deployments. Comes with a suggested-IP helper for the caller to choose from
- `add_vm_to_vapp` now mirrors `create_vapp`'s network auto-discovery and multi-network
  `CLARIFICATION_REQUIRED` behavior instead of failing or misconnecting when `networkConnections` is
  omitted on a vApp with more than one existing network
- `userDataYaml` field — pass unencoded cloud-init `#cloud-config` YAML directly; the server
  validates and base64-encodes it automatically, and extracts any top-level `network:` key into the
  separate `network-config` OVF property it actually needs to land in
- Validation guardrails: VM creation now requires at least one way to log in (password, SSH key, or
  `guestCustomization.adminPassword`); NAT/firewall rule requests must specify the port explicitly
  (via an application port profile or `externalPort`) rather than leaving it ambiguous
- `get_server_version` tool — package version, build commit, build timestamp, Node version, and
  platform, for confirming which build is actually running
- Documented `public-keys` (not `public_keys`) as the correct OVF property name for SSH key
  injection, and that it must NOT be base64-encoded (unlike `user-data`, which must be)

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

## [1.2.0] — 2026-07-08

133/133 integration tests passing against live VCD API.

*(Backfilled 2026-07-29 — this entry was skipped at release time. Reconstructed from the `v1.2.0` git tag message and verified against the actual commit diffs between `v1.1.0` and `v1.2.0`; corrects several inaccuracies in the original tag message, which listed tools that already existed in 1.1.0 — firewall rules, NAT rules, port profiles, and `update_vm_network` — as newly added.)*

### Fixed
- Firewall rule create/update: the rule-name field settled on `name` (not `displayName`, which VCD's EdgeFirewallRule CloudAPI model rejects) — without it, created rules had no name and couldn't be found by name-based lookups afterward
- `get_vm`: disk size read from the full VM entity XML lagged behind the `virtualHardwareSection/disks` sub-resource after a hot-resize, so verification checks could see stale values — now fetched in parallel, sub-resource takes precedence
- `get_vm`/`update_vm_disk`: disk-item selection assumed the boot disk was always first in the XML — now explicitly sorts on InstanceID 2000, with a largest-capacity fallback for templates with non-standard InstanceID assignments
- `delete_application_port_profile`: the DELETE path required the full URN, not a bare UUID — VCD returns HTTP 400 "Invalid urn string" otherwise
- `update_vm_disk`: hot disk extend on a powered-on VM could fail via the legacy API — added a CloudAPI fallback (`/cloudapi/1.0.0/vms/{id}/disks/{id}`), plus a multi-level power-off/undeploy fallback for VMs vCD won't let power off individually while their vApp is deployed
- `undeploy_vapp`/`power_off_vapp`: a vApp with one unresponsive VM could get permanently stuck — added a fallback that powers off each VM individually before retrying undeploy, and now accepts `MIXED` as a valid powered-off state
- `list_vms`: the vApp container filter passed a full URN instead of the bare UUID vCD's `/query` filter requires, silently returning zero results
- `update_vm_cpu`: a race condition could update the hot-add capability flag before the CPU resize task had actually completed; also fixed a malformed `VmCapabilities` XML element name/namespace, and stopped resetting `coresPerSocket` on hot-add (which could break the VM's socket topology and get the change rejected)

### Added
- CPU hot-add (`update_vm_cpu`: `cpuHotAdd` parameter), with a guard blocking hot-remove on powered-on VMs
- Memory hot-add (`update_vm_memory`: `memoryHotAdd` parameter), with a guard blocking hot-add across the 3 GB boundary on powered-on VMs — VMware KB 343190, Linux guests can freeze if this boundary is crossed while running
- Safety guards blocking CPU hot-remove, memory reduction, and disk shrink on powered-on VMs, each with a clear error instead of an opaque vCD rejection

### Test infrastructure
- Jest integration suite expanded to cover all 56 MCP tools (133 tests, 5 suites); enforced serial execution (`--runInBand`) since tests share live VCD fixtures and concurrent runs caused task-lock errors
- `globalSetup`/`globalTeardown` provision and clean up dedicated test vApps automatically; stale vApp detection before each run
- Structured `jest-results` log reporter
- Numerous fixture/assertion fixes for VCD-specific edge cases (symbolic vs UUID port-profile URNs, numeric vs string power-state codes, catalog template search ordering)

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
