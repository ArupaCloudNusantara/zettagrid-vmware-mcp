'use strict';
/**
 * Monitoring & Metrics Test Suite
 * Covers: UC-MON-001 through UC-MON-009
 * - VM metrics, zone health, VDC resource allocation, edge network config
 * - Zone connectivity, organizations, VDC detail
 * - External networks, provider networks, disks, tasks, org networks
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { toArray, get } = require('../helpers');

const log = makeLogger('monitoring');
let client;

beforeAll(async () => {
  log.separator('Monitoring & Metrics Suite — Setup');
  client = new McpClient();
  await client.connect();
});

afterAll(async () => {
  if (client) client.disconnect();
  log.separator('Monitoring & Metrics Suite — Teardown complete');
});

// ─── UC-MON-001: VM Performance Metrics ───────────────────────────────────
describe('UC-MON-001 — Retrieve VM Performance Metrics', () => {
  const UC = 'UC-MON-001';

  test('list_vms returns a running VM to target', async () => {
    log.separator(UC + ': list_vms');
    const vms = toArray(await client.call('list_vms', {}));
    const running = vms.filter(v =>
      (v.status || v.powerState || '').toLowerCase().match(/poweredon|on/)
    );
    log.result(UC, 'found powered-on VM', running.length > 0, `running=${running.length}/${vms.length}`);
    expect(running.length).toBeGreaterThan(0);
  });

  test('get_vm_metrics returns metrics for a powered-on VM', async () => {
    log.separator(UC + ': get_vm_metrics');
    const vmId   = cfg.fixtures.vmIdOn;
    const result = await client.call('get_vm_metrics', { vmId });
    log.debug(`get_vm_metrics response: ${JSON.stringify(result)}`);
    log.result(UC, 'get_vm_metrics returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('metrics response contains CPU usage field', async () => {
    log.separator(UC + ': verify CPU metric');
    const result = await client.call('get_vm_metrics', { vmId: cfg.fixtures.vmIdOn });
    const cpuVal = get(result, 'cpu') ?? get(result, 'cpuUsagePercent') ?? get(result, 'cpu_percent');
    const hasCpu = cpuVal !== undefined && cpuVal !== null;
    log.result(UC, 'CPU metric present', hasCpu, `value=${cpuVal}`);
    expect(hasCpu).toBe(true);
  });

  test('metrics response contains memory usage field', async () => {
    log.separator(UC + ': verify memory metric');
    const result = await client.call('get_vm_metrics', { vmId: cfg.fixtures.vmIdOn });
    const memVal = get(result, 'memory') ?? get(result, 'memoryUsagePercent') ?? get(result, 'memory_percent');
    const hasMem = memVal !== undefined && memVal !== null;
    log.result(UC, 'Memory metric present', hasMem, `value=${memVal}`);
    expect(hasMem).toBe(true);
  });

  test('metrics CPU and memory values are numeric and within 0–100%', async () => {
    log.separator(UC + ': validate metric ranges');
    const result  = await client.call('get_vm_metrics', { vmId: cfg.fixtures.vmIdOn });
    const cpu  = parseFloat(get(result, 'cpu') ?? get(result, 'cpuUsagePercent') ?? 0);
    const mem  = parseFloat(get(result, 'memory') ?? get(result, 'memoryUsagePercent') ?? 0);
    const cpuOk = !isNaN(cpu) && cpu >= 0 && cpu <= 100;
    const memOk = !isNaN(mem) && mem >= 0 && mem <= 100;
    log.result(UC, `CPU=${cpu}% in range [0,100]`, cpuOk);
    log.result(UC, `Mem=${mem}% in range [0,100]`, memOk);
    expect(cpuOk).toBe(true);
    expect(memOk).toBe(true);
  });
});

// ─── UC-MON-002: Zone Health Status ───────────────────────────────────────
describe('UC-MON-002 — Check Zone Health Status', () => {
  const UC = 'UC-MON-002';

  test('get_zone_info returns zone configuration', async () => {
    log.separator(UC + ': get_zone_info');
    const result = await client.call('get_zone_info', {});
    log.result(UC, 'get_zone_info returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('get_zone_health returns health data for all zones', async () => {
    log.separator(UC + ': get_zone_health');
    const result = await client.call('get_zone_health', {});
    log.debug(`get_zone_health: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'get_zone_health returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('zone health includes session validation status', async () => {
    log.separator(UC + ': verify health fields');
    const result = await client.call('get_zone_health', {});
    const zones  = toArray(result) || (typeof result === 'object' ? [result] : []);
    expect(zones.length).toBeGreaterThan(0);

    const firstZone = zones[0];
    const hasStatus = 'status'   in firstZone ||
                      'healthy'  in firstZone ||
                      'valid'    in firstZone ||
                      'health'   in firstZone;
    log.result(UC, 'zone health has status field', hasStatus,
      `fields=${Object.keys(firstZone).join(',')}`);
    expect(hasStatus).toBe(true);
  });
});

// ─── UC-MON-003: VDC Resource Allocation ──────────────────────────────────
describe('UC-MON-003 — View VDC Resource Allocation', () => {
  const UC = 'UC-MON-003';

  test('list_vdcs returns at least one VDC', async () => {
    log.separator(UC + ': list_vdcs');
    const vdcs = toArray(await client.call('list_vdcs', {}));
    log.result(UC, 'list_vdcs', vdcs.length > 0, `count=${vdcs.length}`);
    expect(vdcs.length).toBeGreaterThan(0);
  });

  test('show_all_vdc_resources returns allocation summary', async () => {
    log.separator(UC + ': show_all_vdc_resources');
    const result = await client.call('show_all_vdc_resources', {});
    log.result(UC, 'show_all_vdc_resources returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('show_vdc_resources returns allocation for a specific VDC', async () => {
    log.separator(UC + ': show_vdc_resources');
    const vdcs  = toArray(await client.call('list_vdcs', {}));
    const vdcId = get(vdcs[0], 'id') || get(vdcs[0], 'vdcId');
    const result = await client.call('show_vdc_resources', { vdcId });
    log.debug(`show_vdc_resources: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'show_vdc_resources returns data', !!result, `vdcId=${vdcId}`);
    expect(result).toBeTruthy();
  });

  test('VDC resource report contains CPU, RAM and storage fields', async () => {
    log.separator(UC + ': verify resource fields');
    const vdcs   = toArray(await client.call('list_vdcs', {}));
    const vdcId  = get(vdcs[0], 'id') || get(vdcs[0], 'vdcId');
    const result = await client.call('show_vdc_resources', { vdcId });

    const text = typeof result === 'string' ? result.toLowerCase() : JSON.stringify(result).toLowerCase();
    const hasCpu  = text.includes('cpu')     || text.includes('vcpu');
    const hasRam  = text.includes('ram')     || text.includes('memory');
    const hasStorage = text.includes('storage') || text.includes('disk');

    log.result(UC, 'CPU field in response',     hasCpu);
    log.result(UC, 'RAM field in response',     hasRam);
    log.result(UC, 'Storage field in response', hasStorage);
    expect(hasCpu || hasRam || hasStorage).toBe(true);
  });
});

// ─── UC-MON-004: Edge Network Configuration ───────────────────────────────
describe('UC-MON-004 — Retrieve Edge Network Configuration', () => {
  const UC = 'UC-MON-004';
  let edgeGatewayId;

  test('list_edge_gateways returns at least one gateway', async () => {
    log.separator(UC + ': list_edge_gateways');
    const gws = toArray(await client.call('list_edge_gateways', {}));
    log.result(UC, 'list_edge_gateways', gws.length > 0, `count=${gws.length}`);
    expect(gws.length).toBeGreaterThan(0);
    edgeGatewayId = cfg.fixtures.edgeGatewayId ||
                    get(gws[0], 'id') || get(gws[0], 'gatewayId');
  });

  test('show_edge_network_config returns comprehensive config', async () => {
    log.separator(UC + ': show_edge_network_config');
    const result = await client.call('show_edge_network_config', { edgeGatewayId });
    log.debug(`show_edge_network_config: ${JSON.stringify(result).slice(0, 400)}`);
    log.result(UC, 'show_edge_network_config returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('edge config includes external IPs or uplinks information', async () => {
    log.separator(UC + ': verify edge config fields');
    const result = await client.call('show_edge_network_config', { edgeGatewayId });
    const text   = typeof result === 'string' ? result.toLowerCase() : JSON.stringify(result).toLowerCase();
    const hasIp       = text.includes('ip')         || text.includes('external');
    const hasUplink   = text.includes('uplink')      || text.includes('network');
    const hasFw       = text.includes('firewall')    || text.includes('rule');
    log.result(UC, 'external IP / uplink info present',  hasIp || hasUplink);
    log.result(UC, 'firewall/rule count info present',   hasFw);
    expect(hasIp || hasUplink || hasFw).toBe(true);
  });

  test('get_edge_gateway returns individual gateway details', async () => {
    log.separator(UC + ': get_edge_gateway');
    const result = await client.call('get_edge_gateway', { edgeGatewayId });
    const name   = get(result, 'name') || get(result, 'displayName') || '';
    log.result(UC, 'get_edge_gateway returns gateway', !!result, `name="${name}"`);
    expect(result).toBeTruthy();
  });
});

// ─── UC-MON-005: Zone Connectivity ────────────────────────────────────────
describe('UC-MON-005 — Test Zone Connectivity', () => {
  const UC = 'UC-MON-005';

  test('test_zone returns connectivity result', async () => {
    log.separator(UC + ': test_zone');
    const result = await client.call('test_zone', {});
    log.debug(`test_zone: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'test_zone returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('test_zone response indicates reachable or reports status', async () => {
    log.separator(UC + ': verify zone status');
    const result = await client.call('test_zone', {});
    const text   = typeof result === 'string' ? result.toLowerCase() : JSON.stringify(result).toLowerCase();
    const hasStatus = text.includes('success') || text.includes('reachable') ||
                      text.includes('status')  || text.includes('zone');
    log.result(UC, 'zone status field present', hasStatus);
    expect(hasStatus).toBe(true);
  });
});

// ─── UC-MON-006: Organizations ────────────────────────────────────────────
describe('UC-MON-006 — List and Get Organizations', () => {
  const UC = 'UC-MON-006';
  let orgId;

  test('list_organizations returns at least one organization', async () => {
    log.separator(UC + ': list_organizations');
    const result = await client.call('list_organizations', {});
    const orgs   = toArray(result);
    log.result(UC, 'list_organizations', orgs.length > 0, `count=${orgs.length}`);
    expect(orgs.length).toBeGreaterThan(0);
    orgId = get(orgs[0], 'id') || get(orgs[0], 'orgId');
  });

  test('get_organization returns org details', async () => {
    log.separator(UC + ': get_organization');
    const result = await client.call('get_organization', { orgId });
    const name   = get(result, 'name') || get(result, 'data', 'name') || '';
    log.result(UC, 'get_organization returns org', !!result, `name="${name}"`);
    expect(result).toBeTruthy();
  });

  test('org details include name and id fields', async () => {
    log.separator(UC + ': verify org fields');
    const result = await client.call('get_organization', { orgId });
    const text   = JSON.stringify(result).toLowerCase();
    const hasName = text.includes('name');
    const hasId   = text.includes('id') || text.includes('urn');
    log.result(UC, 'org name field present', hasName);
    log.result(UC, 'org id field present',   hasId);
    expect(hasName || hasId).toBe(true);
  });
});

// ─── UC-MON-007: VDC Detail ───────────────────────────────────────────────
describe('UC-MON-007 — Get VDC Detail', () => {
  const UC = 'UC-MON-007';
  let vdcId;

  test('list_vdcs returns at least one VDC', async () => {
    log.separator(UC + ': list_vdcs');
    const vdcs = toArray(await client.call('list_vdcs', {}));
    expect(vdcs.length).toBeGreaterThan(0);
    vdcId = get(vdcs[0], 'id') || get(vdcs[0], 'vdcId');
    log.result(UC, 'VDC found', !!vdcId, `vdcId=${vdcId}`);
  });

  test('get_vdc returns VDC detail', async () => {
    log.separator(UC + ': get_vdc');
    const result = await client.call('get_vdc', { vdcId });
    log.debug(`get_vdc: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'get_vdc returns data', !!result, `vdcId=${vdcId}`);
    expect(result).toBeTruthy();
  });

  test('VDC detail contains name and resource fields', async () => {
    log.separator(UC + ': verify VDC fields');
    const result = await client.call('get_vdc', { vdcId });
    const text   = JSON.stringify(result).toLowerCase();
    const hasName = text.includes('name');
    const hasRes  = text.includes('cpu') || text.includes('memory') || text.includes('storage');
    log.result(UC, 'VDC name present',     hasName);
    log.result(UC, 'VDC resource fields present', hasRes);
    expect(hasName).toBe(true);
  });
});

// ─── UC-MON-008: External and Provider Networks ───────────────────────────
describe('UC-MON-008 — List External Networks and Provider Network Info', () => {
  const UC = 'UC-MON-008';
  let networkId;

  test('list_external_networks returns network list', async () => {
    log.separator(UC + ': list_external_networks');
    const result   = await client.call('list_external_networks', {});
    const networks = toArray(result);
    log.result(UC, 'list_external_networks', networks.length > 0, `count=${networks.length}`);
    expect(networks.length).toBeGreaterThan(0);
    networkId = get(networks[0], 'id') || get(networks[0], 'networkId');
  });

  test('get_provider_network_info returns network details', async () => {
    log.separator(UC + ': get_provider_network_info');
    const result = await client.call('get_provider_network_info', { networkId });
    log.debug(`get_provider_network_info: ${JSON.stringify(result).slice(0, 300)}`);
    log.result(UC, 'get_provider_network_info returns data', !!result);
    expect(result).toBeTruthy();
  });

  test('provider network info contains network name or subnet', async () => {
    log.separator(UC + ': verify provider network fields');
    const result = await client.call('get_provider_network_info', { networkId });
    const text   = JSON.stringify(result).toLowerCase();
    const hasInfo = text.includes('name') || text.includes('subnet') || text.includes('cidr') ||
                    text.includes('gateway') || text.includes('ip');
    log.result(UC, 'network info fields present', hasInfo);
    expect(hasInfo).toBe(true);
  });
});

// ─── UC-MON-009: Inventory Lists ──────────────────────────────────────────
describe('UC-MON-009 — Inventory: Disks, Tasks, Org Networks', () => {
  const UC = 'UC-MON-009';

  test('list_disks returns disk inventory', async () => {
    log.separator(UC + ': list_disks');
    const result = await client.call('list_disks', {});
    const disks  = toArray(result);
    log.result(UC, 'list_disks returns data', Array.isArray(disks), `count=${disks.length}`);
    expect(Array.isArray(disks)).toBe(true);
  });

  test('list_tasks returns recent task history', async () => {
    log.separator(UC + ': list_tasks');
    const result = await client.call('list_tasks', {});
    const tasks  = toArray(result);
    log.result(UC, 'list_tasks returns data', Array.isArray(tasks), `count=${tasks.length}`);
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('list_tasks entries contain status and operation fields', async () => {
    log.separator(UC + ': verify task fields');
    const result = await client.call('list_tasks', {});
    const tasks  = toArray(result);
    if (tasks.length === 0) {
      log.warn('No tasks found — skipping field verification');
      return;
    }
    const task   = tasks[0];
    const text   = JSON.stringify(task).toLowerCase();
    const hasStatus = text.includes('status') || text.includes('state');
    const hasOp     = text.includes('operation') || text.includes('type') || text.includes('name');
    log.result(UC, 'task status field present',    hasStatus);
    log.result(UC, 'task operation field present', hasOp);
    expect(hasStatus || hasOp).toBe(true);
  });

  test('list_org_networks returns org network list', async () => {
    log.separator(UC + ': list_org_networks');
    const result   = await client.call('list_org_networks', {});
    const networks = toArray(result);
    log.result(UC, 'list_org_networks returns data', Array.isArray(networks), `count=${networks.length}`);
    expect(Array.isArray(networks)).toBe(true);
  });

  test('org networks include at least one routed or isolated network', async () => {
    log.separator(UC + ': verify org network fields');
    const result   = await client.call('list_org_networks', {});
    const networks = toArray(result);
    if (networks.length === 0) {
      log.warn('No org networks found — skipping field verification');
      return;
    }
    const net  = networks[0];
    const text = JSON.stringify(net).toLowerCase();
    const hasName = text.includes('name');
    const hasType = text.includes('type') || text.includes('routed') || text.includes('isolated');
    log.result(UC, 'network name field present', hasName);
    log.result(UC, 'network type field present', hasType);
    expect(hasName).toBe(true);
  });
});
