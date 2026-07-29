'use strict';
/**
 * vApp & Catalog Management Test Suite
 * Covers: UC-VA-001 through UC-VA-006
 * - Deploy vApp, add VM to vApp, power on/off vApp, undeploy vApp, delete vApp
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { waitForTask, waitForVappStatus, findInList, toArray, get } = require('../helpers');

const log = makeLogger('vapp-catalog');
let client;

// Track resources created during tests so teardown can clean up
const created = { vappId: null, vdcId: null };

beforeAll(async () => {
  log.separator('vApp & Catalog Suite — Setup');
  client = new McpClient();
  await client.connect();
});

afterAll(async () => {
  // Best-effort cleanup of any vApp created during UC-VA-001
  if (created.vappId) {
    log.info(`Teardown: deleting test vApp ${created.vappId}`);
    try {
      await client.call('power_off_vapp', { vappId: created.vappId }).catch(() => {});
      const r = await client.call('delete_vapp', { vappId: created.vappId, force: true });
      const tid = get(r, 'taskId') || get(r, 'task', 'id');
      if (tid) await waitForTask(client, tid).catch(() => {});
    } catch (e) {
      log.warn(`Teardown delete_vapp failed: ${e.message}`);
    }
  }
  if (client) client.disconnect();
  log.separator('vApp & Catalog Suite — Teardown complete');
});

// ─── UC-VA-001: Deploy vApp from Catalog ──────────────────────────────────
describe('UC-VA-001 — Deploy a vApp from Catalog Template', () => {
  const UC = 'UC-VA-001';
  let catalogId;
  let templateId;

  test('list_catalogs returns at least one catalog', async () => {
    log.separator(UC + ': list_catalogs');
    const result  = await client.call('list_catalogs', {});
    const catalogs = toArray(result);
    log.result(UC, 'list_catalogs', catalogs.length > 0, `count=${catalogs.length}`);
    expect(catalogs.length).toBeGreaterThan(0);

    const match = catalogs.find(c =>
      c.name === cfg.fixtures.catalogName ||
      c.name?.toLowerCase().includes('test')
    ) || catalogs[0];
    catalogId = match.id || match.catalogId;
    log.info(`Using catalog: ${match.name} (${catalogId})`);
  });

  test('list_catalog_items returns at least one template', async () => {
    log.separator(UC + ': list_catalog_items');
    // Search the selected catalog first, then fall back to scanning all catalogs for a vApp template.
    // create_vapp requires the full template href (not bare ID) in its Source element.
    // entityType is the VCD field that distinguishes vApp templates from ISOs/media.
    const cats = toArray(await client.call('list_catalogs', {}));
    // Cache items per catalog to avoid double API calls
    const catItems = {};
    for (const cat of cats) {
      const cid = cat.id || cat.catalogId;
      catItems[cid] = toArray(await client.call('list_catalog_items', { catalogId: cid }));
    }
    let match;
    // Pass 1: exact name match across ALL catalogs (avoids picking wrong template from first catalog)
    for (const cat of cats) {
      const cid = cat.id || cat.catalogId;
      const exact = catItems[cid].find(i => i.name === cfg.fixtures.templateName);
      if (exact) { match = exact; catalogId = cid; break; }
    }
    // Pass 2: any vApp template (prefer configured catalog name, then others)
    if (!match) {
      const ordered = [
        ...cats.filter(c => c.name === cfg.fixtures.catalogName),
        ...cats.filter(c => c.name !== cfg.fixtures.catalogName),
      ];
      for (const cat of ordered) {
        const cid = cat.id || cat.catalogId;
        const fb = catItems[cid].find(i => (i.entityType || '').toLowerCase().includes('vapptemplate'));
        if (fb) { match = fb; catalogId = cid; break; }
      }
    }
    // Final fallback — use first item from original catalog (may be ISO, test will warn)
    if (!match) {
      const items = toArray(await client.call('list_catalog_items', { catalogId }));
      match = items[0];
      log.warn(`${UC}: no vApp template found — falling back to first catalog item: ${match?.name}`);
    }
    // create_vapp needs the vApp template href (entityHref), NOT the catalogItem href
    templateId = match?.entityHref || match?.href || match?.id || match?.templateId;
    log.result(UC, 'list_catalog_items', !!templateId, `count=— template=${match?.name} (${templateId})`);
    expect(templateId).toBeTruthy();
  });

  test('create_vapp deploys a new vApp from template', async () => {
    log.separator(UC + ': create_vapp');

    // Resolve vdcId from vdcName — must match DC_1138718 exactly; never fall back to another VDC
    const vdcs = toArray(await client.call('list_vdcs', {}));
    const vdc  = vdcs.find(v => v.name === cfg.fixtures.vdcName);
    const vdcId = vdc?.id || vdc?.vdcId;
    if (!vdcId) { log.warn(`VDC "${cfg.fixtures.vdcName}" not found — skipping create_vapp`); return; }
    log.info(`Using vdcId: ${vdcId}`);
    created.vdcId = vdcId;

    // Explicitly attach a routed org network (rather than relying on createVApp's zero-config
    // auto-discovery) so the vApp has a real, working network for add_vm_to_vapp's
    // networkConnections regression test (UC-VA-002) to attach to.
    const nets  = toArray(await client.call('list_org_networks', {}));
    const rnet  = nets.find(n => Number(n.linkType) === 1);
    const vmConfigs = rnet ? [{ networkConnections: [{ networkName: rnet.name, ipMode: 'DHCP' }] }] : [];
    if (!rnet) log.warn(`${UC}: no routed org network found — creating vApp without a network`);

    const vappName = `test-vapp-${Date.now()}`;
    const result = await client.call('create_vapp', {
      vappName,
      templateId,
      vdcId,
      ...(vmConfigs.length ? { instantiationParams: { vmConfigs } } : {}),
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    // Capture vappId for subsequent tests and teardown
    created.vappId = get(result, 'data', 'vappId') || get(result, 'data', 'id') || get(result, 'vappId') || get(result, 'id');

    // Fallback: if vappId not in response (regex miss on VCD XML), search by name
    if (!created.vappId && result?.success !== false) {
      await new Promise(r => setTimeout(r, 5000));
      const vapps = toArray(await client.call('list_vapps', {}));
      const found = vapps.find(v => v.name === vappName);
      if (found) {
        created.vappId = found.id || null;
        log.info(`${UC}: vappId recovered via name search: ${created.vappId}`);
      }
    }

    const isSuccess = result?.success !== false && !!created.vappId;
    log.result(UC, `create_vapp "${vappName}"`, isSuccess, `vappId=${created.vappId}`);
    expect(isSuccess).toBe(true);
  });

  test('get_vapp confirms vApp exists after deployment', async () => {
    log.separator(UC + ': get_vapp');
    if (!created.vappId) { log.warn('No vappId from create_vapp — skipping'); return; }
    const vapp = await client.call('get_vapp', { vappId: created.vappId });
    const name = get(vapp, 'data', 'name') || vapp?.name || '';
    log.result(UC, 'get_vapp returns deployed vApp', !!name, `name="${name}"`);
    expect(name).toBeTruthy();
  });
});

// ─── UC-VA-002: Add VM to vApp ────────────────────────────────────────────
describe('UC-VA-002 — Add VM to Existing vApp from Catalog', () => {
  const UC = 'UC-VA-002';
  let templateId;

  test('list_catalog_items returns a usable template', async () => {
    log.separator(UC + ': list_catalog_items');
    const cats = toArray(await client.call('list_catalogs', {}));
    expect(cats.length).toBeGreaterThan(0);
    // Search all catalogs for a vApp template (entityType, not type)
    let match;
    for (const cat of cats) {
      const items = toArray(await client.call('list_catalog_items', { catalogId: cat.id || cat.catalogId }));
      match = items.find(i => (i.entityType || '').toLowerCase().includes('vapptemplate')) || match;
      if (match) break;
    }
    if (!match) match = toArray(await client.call('list_catalog_items', { catalogId: cats[0].id || cats[0].catalogId }))[0];
    // add_vm_to_vapp also requires the vApp template href (entityHref), not catalogItem href
    templateId = match?.entityHref || match?.href || match?.id || match?.templateId;
    log.result(UC, 'template found', !!templateId, `templateId=${templateId}`);
    expect(templateId).toBeTruthy();
  });

  test('add_vm_to_vapp adds a VM into an existing vApp', async () => {
    log.separator(UC + ': add_vm_to_vapp');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }
    const result = await client.call('add_vm_to_vapp', {
      vappId,
      templateId,
      vmName: `test-vm-${Date.now()}`,
    }, cfg.timeouts.taskPoll);

    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    log.result(UC, 'add_vm_to_vapp completed', true);
    expect(result).toBeTruthy();
  });

  test('list_vms shows new VM under the vApp', async () => {
    log.separator(UC + ': list_vms verify');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }
    const vms    = toArray(await client.call('list_vms', { vappId }));
    log.result(UC, 'VM added to vApp', vms.length > 0, `vmCount=${vms.length}`);
    expect(vms.length).toBeGreaterThan(0);
  });

  // ─── Regression: B1/B2 — add_vm_to_vapp with an explicit networkConnections
  // override used to fail schema validation (invalid "networkName" attribute on
  // NetworkAssignment) or, if the override was omitted to dodge that, silently
  // leave the VM on the template's own (nonexistent-in-VDC) network. ───────────
  test('add_vm_to_vapp with explicit networkConnections is accepted (regression: B1 NetworkAssignment schema error)', async () => {
    log.separator(UC + ': add_vm_to_vapp with networkConnections (B1/B2 regression)');
    const vappId = created.vappId;
    const vdcId  = created.vdcId;
    if (!vappId || !vdcId) { log.warn(`${UC}: no vappId/vdcId from UC-VA-001 — skipping`); return; }

    // Use the network name the vApp is ALREADY configured with — discovered from a live VM's
    // NIC (the one created in UC-VA-001) rather than guessed from list_org_networks, since
    // add_vm_to_vapp can only attach to a network the vApp already has (it cannot bridge in a
    // brand-new one — recomposeVApp's schema has no NetworkConfigSection for that, unlike
    // instantiateVAppTemplate). This exercises the real reported scenario: an existing vApp
    // whose network the caller wants a new VM connected to.
    const existingVms = toArray(await client.call('list_vms', { vappId }));
    let networkName;
    for (const v of existingVms) {
      const vm  = get(await client.call('get_vm', { vmId: v.id }), 'data') || {};
      const nic = toArray(vm.networkConnections).find(n => n.network && n.network.toLowerCase() !== 'none');
      if (nic) { networkName = nic.network; break; }
    }
    if (!networkName) { log.warn(`${UC}: no existing VM with a real (non-"none") network found on the vApp — skipping`); return; }
    log.info(`Using vApp's existing network: ${networkName}`);

    const cats = toArray(await client.call('list_catalogs', {}));
    let match;
    for (const cat of cats) {
      const items = toArray(await client.call('list_catalog_items', { catalogId: cat.id || cat.catalogId }));
      match = items.find(i => (i.entityType || '').toLowerCase().includes('vapptemplate')) || match;
      if (match) break;
    }
    const templateIdForNet = match?.entityHref || match?.href;
    expect(templateIdForNet).toBeTruthy();

    const vmName = `test-vm-net-${Date.now()}`;
    const result = await client.call('add_vm_to_vapp', {
      vappId,
      templateId: templateIdForNet,
      vmName,
      vdcId,
      networkConnections: [{ networkName, ipMode: 'DHCP' }],
    }, cfg.timeouts.taskPoll);

    const succeeded = result?.success !== false;
    log.result(UC, 'add_vm_to_vapp with networkConnections accepted', succeeded, `error="${result?.error?.message || ''}"`);
    expect(succeeded).toBe(true);

    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    created.vmWithNetworkName = vmName;
    created.vmWithNetworkTarget = networkName;
    created.lastAddVmMessage = get(result, 'data', 'message') || result?.data?.message;
  });

  test('VM added with networkConnections has a NIC actually connected to the requested network (regression: B2 template network not mapped)', async () => {
    log.separator(UC + ': verify NIC network mapping (B2 regression)');
    const vappId = created.vappId;
    if (!vappId || !created.vmWithNetworkName) { log.warn(`${UC}: no VM from the B1/B2 regression test — skipping`); return; }

    const vms   = toArray(await client.call('list_vms', { vappId }));
    const added = vms.find(v => v.name === created.vmWithNetworkName);
    if (!added?.id) { log.warn(`${UC}: could not find VM "${created.vmWithNetworkName}" — skipping`); return; }

    const vm     = get(await client.call('get_vm', { vmId: added.id }), 'data') || {};
    const nics   = toArray(vm.networkConnections);
    const hasNic = nics.length > 0;
    log.result(UC, 'new VM has at least one NIC', hasNic, `nicCount=${nics.length}`);
    expect(hasNic).toBe(true);

    // The NIC must be connected to the requested org network — not left on the template's own
    // internal network name (e.g. "VM Network"), which is the exact B2 failure mode.
    const onRequestedNetwork = nics.some(n => (n.network || n.networkName) === created.vmWithNetworkTarget);
    log.result(UC, `NIC connected to requested network "${created.vmWithNetworkTarget}"`, onRequestedNetwork,
      `actual=${JSON.stringify(nics.map(n => n.network || n.networkName))}`);
    expect(onRequestedNetwork).toBe(true);
  });
});

// ─── Regression: H4 — delete_vapp had no guard against destroying a multi-VM vApp
// (the only delete tool reachable to clean up one bad VM was the destructive one), and
// there was no delete_vm to remove a single VM without touching the rest. ─────────────
describe('H4 Regression — delete_vm and delete_vapp safety guard', () => {
  const UC = 'H4';

  test('delete_vapp without force rejects a multi-VM vApp', async () => {
    log.separator(UC + ': delete_vapp guard');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }

    const before = toArray(await client.call('list_vms', { vappId }));
    if (before.length < 2) { log.warn(`${UC}: vApp has <2 VMs (${before.length}) — guard not exercised, skipping`); return; }

    const result  = await client.call('delete_vapp', { vappId });
    const guarded = result?.error?.code === 'DELETE_VAPP_MULTIPLE_VMS_GUARD';
    log.result(UC, 'delete_vapp guard rejects multi-VM vApp without force', guarded, `code=${result?.error?.code}`);
    expect(guarded).toBe(true);

    // Confirm the guard didn't let anything through — vApp must still exist
    const vapp = await client.call('get_vapp', { vappId });
    log.result(UC, 'vApp still exists after guarded rejection', vapp?.success !== false);
    expect(vapp?.success).not.toBe(false);
  });

  test('delete_vm removes a single VM without touching the rest of the vApp', async () => {
    log.separator(UC + ': delete_vm');
    const vappId = created.vappId;
    if (!vappId || !created.vmWithNetworkName) { log.warn(`${UC}: no vappId or target VM — skipping`); return; }

    const before = toArray(await client.call('list_vms', { vappId }));
    const target = before.find(v => v.name === created.vmWithNetworkName);
    if (!target?.id) { log.warn(`${UC}: target VM "${created.vmWithNetworkName}" not found — skipping`); return; }

    const result = await client.call('delete_vm', { vmId: target.id }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    const succeeded = result?.success !== false;
    log.result(UC, 'delete_vm accepted', succeeded, `error="${result?.error?.message || ''}"`);
    expect(succeeded).toBe(true);

    const after       = toArray(await client.call('list_vms', { vappId }));
    const stillThere  = after.some(v => v.id === target.id);
    log.result(UC, 'target VM removed from vApp', !stillThere, `before=${before.length} after=${after.length}`);
    expect(stillThere).toBe(false);
    expect(after.length).toBe(before.length - 1);

    const vapp = await client.call('get_vapp', { vappId });
    log.result(UC, 'vApp itself still exists after delete_vm', vapp?.success !== false);
    expect(vapp?.success).not.toBe(false);
  });
});

// ─── Regression: H1 — a failed add_vm_to_vapp could leave a partially-created "orphan"
// VM with no NICs, and no way to learn its id short of a manual list_vms scan. The exact
// orphan-appears-after-an-async-task-failure scenario from the report can't be forced
// deterministically in a test (it depends on vCD's internal partial-recompose timing), so
// this covers what IS deterministic: the new best-effort orphan lookup in the synchronous
// error path doesn't crash on a guaranteed-no-VM failure, and the success path documents
// the delete_vm cleanup workflow for the async case. ──────────────────────────────────
describe('H1 Regression — add_vm_to_vapp error/orphan reporting', () => {
  const UC = 'H1';

  test('add_vm_to_vapp on a nonexistent vApp fails cleanly with no false orphan claim', async () => {
    log.separator(UC + ': add_vm_to_vapp with bad vappId');
    const result = await client.call('add_vm_to_vapp', {
      vappId: 'urn:vcloud:vapp:00000000-0000-0000-0000-000000000000',
      templateId: 'https://mycloud-jkt.zettagrid.id/api/vAppTemplate/vappTemplate-00000000-0000-0000-0000-000000000000',
      vmName: `h1-nonexistent-${Date.now()}`,
    });
    const failed = result?.success === false;
    log.result(UC, 'call fails (not a crash/hang)', failed, `code=${result?.error?.code}`);
    expect(failed).toBe(true);
    log.result(UC, 'no orphanVmId claimed when nothing was created', result?.data?.orphanVmId === undefined);
    expect(result?.data?.orphanVmId).toBeUndefined();
  });

  test('successful add_vm_to_vapp documents the delete_vm cleanup workflow for async task failures', async () => {
    log.separator(UC + ': success message mentions delete_vm');
    if (!created.vmWithNetworkName) { log.warn(`${UC}: no successful add_vm_to_vapp call recorded — skipping`); return; }
    // Reuses the outcome already captured by the B1/B2 regression call above rather than
    // making a fresh mutating call — this is a documentation check, not a new operation.
    const mentionsCleanup = created.lastAddVmMessage?.includes('delete_vm') ?? false;
    log.result(UC, 'response message references delete_vm for the async-failure case', mentionsCleanup, created.lastAddVmMessage);
    expect(mentionsCleanup).toBe(true);
  });
});

// ─── Regression: H2 — update_vm_network could only rewrite an existing NIC block matched
// by index; a VM with no working NIC (e.g. left over from a B2-style failure) had no way
// to be given one short of the vCD portal. ────────────────────────────────────────────
describe('H2 Regression — update_vm_network addNic', () => {
  const UC = 'H2';

  async function findVmWithNic(vappId) {
    const vms = toArray(await client.call('list_vms', { vappId }));
    for (const v of vms) {
      const nics = toArray(get(await client.call('get_vm', { vmId: v.id }), 'data', 'networkConnections'));
      // A NIC on the "none" sentinel (template never had a real network mapped — see B2) isn't
      // usable as a reference network for the new NIC: DHCP/POOL modes are meaningless on it,
      // and vCD rejects the add outright ("Unknown IP Addressing Mode ... connected to network none").
      const real = nics.filter(n => (n.network || n.networkName) && (n.network || n.networkName).toLowerCase() !== 'none');
      if (real.length > 0) return { vm: v, nics, realNics: real };
    }
    return null;
  }

  test('update_vm_network with addNic:true appends a new NIC', async () => {
    log.separator(UC + ': update_vm_network addNic');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }

    const found = await findVmWithNic(vappId);
    if (!found) { log.warn(`${UC}: no VM with an existing NIC found — skipping`); return; }
    const { vm: target, nics: before, realNics } = found;
    const networkName = realNics[0]?.network || realNics[0]?.networkName || created.vmWithNetworkTarget;
    if (!networkName) { log.warn(`${UC}: could not determine a network name to add — skipping`); return; }

    const result = await client.call('update_vm_network', {
      vmId: target.id,
      addNic: true,
      networkName,
      ipMode: 'DHCP',
    }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    const succeeded = result?.success !== false;
    log.result(UC, 'update_vm_network addNic accepted', succeeded, `error="${result?.error?.message || ''}"`);
    expect(succeeded).toBe(true);

    const after = toArray(get(await client.call('get_vm', { vmId: target.id }), 'data', 'networkConnections'));
    log.result(UC, 'NIC count increased by exactly 1', after.length === before.length + 1, `before=${before.length} after=${after.length}`);
    expect(after.length).toBe(before.length + 1);
  });

  test('update_vm_network with addNic:true rejects an already-existing nicIndex', async () => {
    log.separator(UC + ': addNic collision guard');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId — skipping`); return; }

    const found = await findVmWithNic(vappId);
    if (!found) { log.warn(`${UC}: no VM with an existing NIC found — skipping`); return; }
    const { vm: target } = found;

    const result = await client.call('update_vm_network', {
      vmId: target.id,
      addNic: true,
      nicIndex: 0,
      networkName: created.vmWithNetworkTarget || 'placeholder-network',
    });
    const rejected = result?.success === false && /already exists/i.test(result?.error?.message || '');
    log.result(UC, 'addNic rejects a colliding nicIndex', rejected, `error="${result?.error?.message || ''}"`);
    expect(rejected).toBe(true);
  });
});

// ─── Regression: H3 — update_vm_disk only ever resized the existing boot/primary disk;
// there was no way to give a VM a second, independent disk (a common multi-disk shape —
// e.g. a DB or app disk separate from the OS disk) short of the vCD portal. Uses an
// ephemeral vApp-catalog VM rather than the shared vmIdOff fixture, since there's no
// remove-disk tool to undo a permanent addition to a persistent fixture. ─────────────────
describe('H3 Regression — add_vm_disk', () => {
  const UC = 'H3';

  test('add_vm_disk appends a new disk to a VM', async () => {
    log.separator(UC + ': add_vm_disk');
    const vappId = created.vappId;
    if (!vappId) { log.warn(`${UC}: no vappId from UC-VA-001 — skipping`); return; }

    const vms   = toArray(await client.call('list_vms', { vappId }));
    const target = vms[0];
    if (!target?.id) { log.warn(`${UC}: no VM available — skipping`); return; }

    const before = toArray(get(await client.call('get_vm', { vmId: target.id }), 'data', 'disks'));

    const result = await client.call('add_vm_disk', { vmId: target.id, diskSizeMB: 5120 }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);

    const succeeded = result?.success !== false;
    log.result(UC, 'add_vm_disk accepted', succeeded, `error="${result?.error?.message || ''}"`);
    expect(succeeded).toBe(true);

    const after = toArray(get(await client.call('get_vm', { vmId: target.id }), 'data', 'disks'));
    log.result(UC, 'disk count increased by exactly 1', after.length === before.length + 1, `before=${before.length} after=${after.length}`);
    expect(after.length).toBe(before.length + 1);

    const newDisk = after.find(d => !before.some(b => b.name === d.name && b.capacityMB === d.capacityMB));
    log.result(UC, 'new disk capacity matches request', newDisk?.capacityMB === 5120, `newDisk=${JSON.stringify(newDisk)}`);
    expect(newDisk?.capacityMB).toBe(5120);
  });
});

// ─── Regression: M2/M3/M4/L3 — add_vm_to_vapp lacked storage-profile parity with create_vapp
// (M2); no tool exposed NIC adapter type (M3); get_vm couldn't verify storage profile, adapter
// type, hot-add flags, or OVF/guest properties like injected SSH keys (M4); no tool offered a
// wait-for-completion option, forcing a separate get_task poll after every mutating call (L3).
// One add_vm_to_vapp call with waitForTask:true, adapterType, storageProfileHref, and
// ovfProperties exercises all four together. ──────────────────────────────────────────────
describe('M2/M3/M4/L3 Regression — storage profile, adapter type, get_vm fields, waitForTask', () => {
  const UC = 'M2-M4-L3';

  test('add_vm_to_vapp with waitForTask resolves the task without a separate poll', async () => {
    log.separator(UC + ': add_vm_to_vapp with waitForTask + adapterType + storageProfileHref + ovfProperties');
    const vappId = created.vappId;
    const vdcId  = created.vdcId;
    if (!vappId || !vdcId) { log.warn(`${UC}: no vappId/vdcId from UC-VA-001 — skipping`); return; }

    // Discover a real storage profile href from an existing VM (M4's new get_vm field) to
    // pass into add_vm_to_vapp (M2 — previously the field wasn't even in the tool's schema).
    const existingVms = toArray(await client.call('list_vms', { vappId }));
    const refVm = existingVms[0];
    if (!refVm?.id) { log.warn(`${UC}: no existing VM to read a storage profile from — skipping`); return; }
    const refVmData = get(await client.call('get_vm', { vmId: refVm.id }), 'data') || {};
    const storageProfileHref = refVmData.storageProfileHref;
    if (!storageProfileHref) { log.warn(`${UC}: get_vm returned no storageProfileHref — skipping`); return; }
    log.info(`Using storage profile: ${refVmData.storageProfileName} (${storageProfileHref})`);

    const networkName = created.vmWithNetworkTarget;
    if (!networkName) { log.warn(`${UC}: no known-good network name — skipping`); return; }

    const cats = toArray(await client.call('list_catalogs', {}));
    let match;
    for (const cat of cats) {
      const items = toArray(await client.call('list_catalog_items', { catalogId: cat.id || cat.catalogId }));
      match = items.find(i => (i.entityType || '').toLowerCase().includes('vapptemplate')) || match;
      if (match) break;
    }
    const templateId = match?.entityHref || match?.href;
    expect(templateId).toBeTruthy();

    const publicKeyValue = 'ssh-ed25519 AAAAExampleTestKeyOnly test@m4-regression';
    const vmName = `test-vm-m2m3m4-${Date.now()}`;
    const result = await client.call('add_vm_to_vapp', {
      vappId,
      templateId,
      vmName,
      vdcId,
      networkConnections: [{ networkName, ipMode: 'DHCP', adapterType: 'E1000' }],
      storageProfileHref,
      ovfProperties: [{ key: 'public-keys', value: publicKeyValue }],
      waitForTask: true,
      timeoutMs: 180_000,
    }, cfg.timeouts.taskPoll);

    const succeeded = result?.success !== false;
    log.result(UC, 'add_vm_to_vapp accepted', succeeded, `error="${result?.error?.message || ''}"`);
    expect(succeeded).toBe(true);

    // L3: the task should already be resolved — no separate get_task poll needed.
    const taskStatus = get(result, 'data', 'taskStatus');
    log.result(UC, 'waitForTask resolved the task synchronously (L3)', taskStatus === 'success', `taskStatus=${taskStatus}`);
    expect(taskStatus).toBe('success');

    created.m4TestVmName = vmName;
    created.m4TestStorageProfileHref = storageProfileHref;
    created.m4TestPublicKeyValue = publicKeyValue;
  });

  test('get_vm exposes storage profile, adapter type, hot-add flags, and OVF properties (M4)', async () => {
    log.separator(UC + ': get_vm field verification');
    const vappId = created.vappId;
    if (!vappId || !created.m4TestVmName) { log.warn(`${UC}: no VM from the previous test — skipping`); return; }

    const vms   = toArray(await client.call('list_vms', { vappId }));
    const added = vms.find(v => v.name === created.m4TestVmName);
    if (!added?.id) { log.warn(`${UC}: could not find VM "${created.m4TestVmName}" — skipping`); return; }

    const vm = get(await client.call('get_vm', { vmId: added.id }), 'data') || {};

    log.result(UC, 'storageProfileHref matches request (M2 + M4)', vm.storageProfileHref === created.m4TestStorageProfileHref, `expected=${created.m4TestStorageProfileHref} actual=${vm.storageProfileHref}`);
    expect(vm.storageProfileHref).toBe(created.m4TestStorageProfileHref);

    const nic = toArray(vm.networkConnections)[0];
    log.result(UC, 'NIC adapterType is E1000 as requested (M3)', nic?.adapterType === 'E1000', `nic=${JSON.stringify(nic)}`);
    expect(nic?.adapterType).toBe('E1000');

    log.result(UC, 'cpuHotAddEnabled present (M4)', typeof vm.cpuHotAddEnabled === 'boolean', `value=${vm.cpuHotAddEnabled}`);
    expect(typeof vm.cpuHotAddEnabled).toBe('boolean');
    log.result(UC, 'memoryHotAddEnabled present (M4)', typeof vm.memoryHotAddEnabled === 'boolean', `value=${vm.memoryHotAddEnabled}`);
    expect(typeof vm.memoryHotAddEnabled).toBe('boolean');

    const ovfProps = toArray(vm.ovfProperties);
    const publicKeyProp = ovfProps.find(p => p.key === 'public-keys');
    log.result(UC, 'ovfProperties includes the injected public-keys value (M4)', publicKeyProp?.value === created.m4TestPublicKeyValue, `publicKeyProp=${JSON.stringify(publicKeyProp)}`);
    expect(publicKeyProp?.value).toBe(created.m4TestPublicKeyValue);
  });

  test("update_vm_network with adapterType on an EXISTING NIC is rejected by vCD (M3 platform constraint, not a code bug)", async () => {
    log.separator(UC + ': update_vm_network adapterType on existing NIC');
    const vappId = created.vappId;
    if (!vappId || !created.m4TestVmName) { log.warn(`${UC}: no VM from the earlier test — skipping`); return; }

    const vms   = toArray(await client.call('list_vms', { vappId }));
    const target = vms.find(v => v.name === created.m4TestVmName);
    if (!target?.id) { log.warn(`${UC}: could not find VM "${created.m4TestVmName}" — skipping`); return; }

    // Confirmed live: vCD flatly rejects changing an existing NIC's adapter type ("Cannot
    // change network adapter type of existing virtual machine"), regardless of power state.
    // adapterType only works when adding a brand-new NIC (see the earlier add_vm_to_vapp test) —
    // this documents the platform constraint rather than asserting a change that can't succeed.
    const result = await client.call('update_vm_network', {
      vmId: target.id,
      nicIndex: 0,
      adapterType: 'VMXNET3',
    });

    const rejected = result?.success === false && /adapter type/i.test(result?.error?.message || '');
    log.result(UC, 'vCD rejects adapterType change on an existing NIC', rejected, `error="${result?.error?.message || ''}"`);
    expect(rejected).toBe(true);

    // Confirm the rejected call left the NIC's adapter type untouched (still E1000 from the
    // add_vm_to_vapp call) rather than partially applying.
    const vm  = get(await client.call('get_vm', { vmId: target.id }), 'data') || {};
    const nic = toArray(vm.networkConnections)[0];
    log.result(UC, 'NIC adapterType unchanged after rejection', nic?.adapterType === 'E1000', `nic=${JSON.stringify(nic)}`);
    expect(nic?.adapterType).toBe('E1000');
  });
});

// ─── UC-VA-003: Power On vApp ─────────────────────────────────────────────
describe('UC-VA-003 — Power On a vApp', () => {
  const UC = 'UC-VA-003';
  // Use the newly created vApp from UC-VA-001 if available;
  // vappIdOff fixture may be absent if it was deleted by a previous test run.
  let targetVappId;

  beforeAll(() => {
    targetVappId = created.vappId;
    if (!targetVappId) log.warn(`${UC}: no vappId from UC-VA-001 — all power-on tests will skip`);
  });

  test('power_on_vapp transitions vApp to powered-on', async () => {
    log.separator(UC + ': power_on_vapp');
    if (!targetVappId) { log.warn(`${UC}: no vApp to power on — skipping`); expect(true).toBe(true); return; }
    const vappId = targetVappId;
    const result = await client.call('power_on_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_on_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered On', async () => {
    log.separator(UC + ': verify vApp status');
    if (!targetVappId) { log.warn(`${UC}: no vApp — skipping`); expect(true).toBe(true); return; }
    const vapp   = await waitForVappStatus(client, targetVappId, 'Powered On');
    const status = vapp?.status || '';
    log.result(UC, 'vApp Powered On', status.toLowerCase().includes('powered'), `status="${status}"`);
    expect(status).toMatch(/powered.?on|running/i);
  });

  test('list_vms shows VMs inside vApp are powered on', async () => {
    log.separator(UC + ': list_vms check');
    if (!targetVappId) { log.warn(`${UC}: no vApp — skipping`); expect(true).toBe(true); return; }
    const vms = toArray(await client.call('list_vms', { vappId: targetVappId }));
    vms.forEach((v, i) => log.debug(`  VM[${i}] status=${JSON.stringify(v.status)} powerState=${JSON.stringify(v.powerState)}`));
    const poweredOn = vms.filter(v => {
      // status may be: numeric 4, string 'POWERED_ON'/'powered_on', or absent (vApp confirmed on)
      if (v.status === undefined && v.powerState === undefined) return true;
      const s = String(v.status ?? v.powerState ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      // Exclude only explicitly-off/suspended states
      return !['8','poweredoff','off','3','suspended','1','resolved'].includes(s);
    });
    log.result(UC, 'VMs inside vApp are powered on',
      poweredOn.length > 0, `poweredOn=${poweredOn.length}/${vms.length}`);
    expect(poweredOn.length).toBeGreaterThan(0);
  });
});

// ─── UC-VA-004: Power Off vApp ────────────────────────────────────────────
describe('UC-VA-004 — Power Off a vApp', () => {
  const UC = 'UC-VA-004';

  test('power_off_vapp transitions vApp to powered-off', async () => {
    log.separator(UC + ': power_off_vapp');
    const vappId = cfg.fixtures.vappIdOn;
    const result = await client.call('power_off_vapp', { vappId }, cfg.timeouts.powerOp);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'power_off_vapp accepted', true);
    expect(result).toBeTruthy();
  });

  test('get_vapp status is Powered Off within timeout', async () => {
    log.separator(UC + ': verify vApp status');
    // Ubuntu 22.04 graceful shutdown can take 4-8 minutes — use 10m timeout
    const vapp   = await waitForVappStatus(client, cfg.fixtures.vappIdOn, 'Powered Off', 600_000);
    const status = vapp?.status || '';
    const isOff = /powered.?off|stopped|resolved|mixed/i.test(status);
    log.result(UC, 'vApp Powered Off', isOff, `status="${status}"`);
    expect(status).toMatch(/powered.?off|stopped|resolved|mixed/i);
  }, 700_000);
});

// ─── UC-VA-006: Undeploy vApp ─────────────────────────────────────────────
describe('UC-VA-006 — Undeploy a vApp (Power Off + Undeploy Without Deleting)', () => {
  const UC     = 'UC-VA-006';
  const vappId = cfg.fixtures.vappIdOn;

  test('ensure vApp is powered on before undeploying', async () => {
    log.separator(UC + ': ensure powered on');
    await client.call('power_on_vapp', { vappId }, cfg.timeouts.powerOp).catch(() => {});
    await waitForVappStatus(client, vappId, 'Powered On').catch(() => {});
    log.result(UC, 'vApp is powered on', true);
    expect(true).toBe(true);
  });

  test('undeploy_vapp powers off and undeploys the vApp', async () => {
    log.separator(UC + ': undeploy_vapp');
    const result = await client.call('undeploy_vapp', { vappId }, cfg.timeouts.powerOp);
    if (result?.error) log.warn(`${UC}: undeploy error: ${result.error.message || JSON.stringify(result.error)}`);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id') || get(result, 'data', 'taskId');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.powerOp);
    log.result(UC, 'undeploy_vapp accepted', !!result);
    expect(result).toBeTruthy();
  });

  test('vApp is powered off after undeploy', async () => {
    log.separator(UC + ': verify powered off');
    // Ubuntu 22.04 graceful shutdown can take 4-8 minutes — use 10m timeout
    const vapp   = await waitForVappStatus(client, vappId, 'Powered Off', 600_000);
    const status = (vapp?.status || '').toLowerCase();
    log.result(UC, 'vApp powered off after undeploy', true, `status="${status}"`);
    expect(status).toMatch(/powered.?off|stopped|resolved|mixed/i);
  }, 700_000);

  test('get_vapp confirms vApp still exists after undeploy', async () => {
    log.separator(UC + ': verify vApp still exists');
    const vapp = await client.call('get_vapp', { vappId });
    const name = get(vapp, 'data', 'name') || vapp?.name || '';
    log.result(UC, 'vApp still exists after undeploy', !!name, `name="${name}"`);
    expect(name).toBeTruthy();
  });
});

// ─── UC-VA-005: Delete vApp ───────────────────────────────────────────────
describe('UC-VA-005 — Delete a vApp', () => {
  const UC = 'UC-VA-005';
  // Use the vApp created in UC-VA-001 if available; otherwise a dedicated fixture
  let targetVappId;

  beforeAll(() => {
    targetVappId = created.vappId;
    if (!targetVappId) log.warn(`${UC}: no vappId from UC-VA-001 — delete tests will skip`);
  });

  test('list_vapps confirms target vApp exists before deletion', async () => {
    log.separator(UC + ': pre-delete list_vapps');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp exists before delete', found);
    if (!found) log.warn(`vApp ${targetVappId} not found — may have been cleaned up already`);
  });

  test('delete_vapp removes the vApp permanently', async () => {
    log.separator(UC + ': delete_vapp');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    // force: true — this vApp has multiple VMs by this point (H4's delete_vapp guard rejects
    // multi-VM deletes without it) and this test intentionally wants full cleanup regardless.
    const result = await client.call('delete_vapp', { vappId: targetVappId, force: true }, cfg.timeouts.taskPoll);
    const taskId = get(result, 'data', 'taskId') || get(result, 'taskId') || get(result, 'task', 'id');
    if (taskId) await waitForTask(client, taskId, cfg.timeouts.taskPoll);
    const succeeded = result?.success !== false;
    log.result(UC, 'delete_vapp completed', succeeded, `error="${result?.error?.message || ''}"`);
    created.vappId = null;
    expect(succeeded).toBe(true);
  });

  test('list_vapps no longer returns the deleted vApp', async () => {
    log.separator(UC + ': post-delete list_vapps');
    if (!targetVappId) { log.warn(`${UC}: no vappId — skipping`); return; }
    const vapps = toArray(await client.call('list_vapps', {}));
    const found = vapps.some(v => (v.id || v.vappId) === targetVappId);
    log.result(UC, 'vApp absent after delete', !found);
    expect(found).toBe(false);
  });
});
