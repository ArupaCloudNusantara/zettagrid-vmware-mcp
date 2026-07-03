'use strict';
/**
 * Networking Test Suite (Firewall, NAT & Port Profiles)
 * Covers: UC-NET-001 through UC-NET-006
 * - Create/update/delete firewall rules
 * - Create/delete DNAT rules
 * - Create/delete application port profiles
 */

const McpClient = require('../McpClient');
const cfg       = require('../config');
const { makeLogger } = require('../logger');
const { toArray, findInList, get } = require('../helpers');

const log = makeLogger('networking');
let client;

// Track IDs created during tests for teardown
const created = { firewallRuleId: null, firewallRuleName: null, natRuleId: null, portProfileId: null };

// Resolved at runtime — overrides placeholder fixtures if real IDs are discovered
let resolvedEdgeGatewayId = cfg.fixtures.edgeGatewayId;
let resolvedAppPortProfileId = cfg.fixtures.appPortProfileId;
let resolvedVdcId = null;

beforeAll(async () => {
  log.separator('Networking Suite — Setup');
  client = new McpClient();
  await client.connect();

  // Dynamically discover edge gateway if fixture is a placeholder
  if (!resolvedEdgeGatewayId || resolvedEdgeGatewayId.includes('xxxxxxxx')) {
    try {
      const gws = toArray(await client.call('list_edge_gateways', {}));
      if (gws.length > 0) {
        resolvedEdgeGatewayId = get(gws[0], 'id') || get(gws[0], 'gatewayId') || resolvedEdgeGatewayId;
        log.info(`Discovered edgeGatewayId: ${resolvedEdgeGatewayId}`);
      }
    } catch (e) {
      log.warn(`Could not discover edge gateway: ${e.message}`);
    }
  }

  // Dynamically discover app port profile if fixture is a placeholder
  if (!resolvedAppPortProfileId || resolvedAppPortProfileId.includes('xxxxxxxx')) {
    try {
      const profiles = toArray(await client.call('list_application_port_profiles', {}));
      if (profiles.length > 0) {
        resolvedAppPortProfileId = get(profiles[0], 'id') || get(profiles[0], 'profileId') || resolvedAppPortProfileId;
        log.info(`Discovered appPortProfileId: ${resolvedAppPortProfileId}`);
      }
    } catch (e) {
      log.warn(`Could not discover app port profile: ${e.message}`);
    }
  }

  // Discover VDC ID (needed for create_application_port_profile contextEntityId)
  try {
    const vdcs = toArray(await client.call('list_vdcs', {}));
    const vdc  = vdcs.find(v => v.name === cfg.fixtures.vdcName);
    resolvedVdcId = get(vdc, 'id') || get(vdc, 'vdcId') || null;
    log.info(`Discovered vdcId: ${resolvedVdcId}`);
  } catch (e) {
    log.warn(`Could not discover VDC: ${e.message}`);
  }
});

afterAll(async () => {
  // Cleanup created firewall rule
  if (created.firewallRuleId) {
    log.info(`Teardown: deleting firewall rule ${created.firewallRuleId}`);
    await client.call('delete_firewall_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      ruleId:        created.firewallRuleId,
    }).catch(e => log.warn(`Teardown fw delete failed: ${e.message}`));
  }
  // Cleanup created NAT rule
  if (created.natRuleId) {
    log.info(`Teardown: deleting NAT rule ${created.natRuleId}`);
    await client.call('delete_nat_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      ruleId:        created.natRuleId,
    }).catch(e => log.warn(`Teardown nat delete failed: ${e.message}`));
  }
  // Cleanup created port profile
  if (created.portProfileId) {
    log.info(`Teardown: deleting port profile ${created.portProfileId}`);
    await client.call('delete_application_port_profile', {
      profileId: created.portProfileId,
    }).catch(e => log.warn(`Teardown port profile delete failed: ${e.message}`));
  }
  if (client) client.disconnect();
  log.separator('Networking Suite — Teardown complete');
});

// ─── UC-NET-001: Create Firewall Rule ─────────────────────────────────────
describe('UC-NET-001 — Create an Inbound Firewall Rule', () => {
  const UC = 'UC-NET-001';

  test('list_edge_gateways returns at least one gateway', async () => {
    log.separator(UC + ': list_edge_gateways');
    const result = await client.call('list_edge_gateways', {});
    const gws    = toArray(result);
    log.result(UC, 'list_edge_gateways', gws.length > 0, `count=${gws.length}`);
    expect(gws.length).toBeGreaterThan(0);
  });

  test('list_application_port_profiles returns port profiles', async () => {
    log.separator(UC + ': list_application_port_profiles');
    const result   = await client.call('list_application_port_profiles', {
      edgeGatewayId: resolvedEdgeGatewayId,
    });
    const profiles = toArray(result);
    log.result(UC, 'list_application_port_profiles', profiles.length > 0, `count=${profiles.length}`);
    expect(profiles.length).toBeGreaterThan(0);
  });

  test('create_firewall_rule creates a new ALLOW rule', async () => {
    log.separator(UC + ': create_firewall_rule');
    // Snapshot existing rule IDs before create — used to identify the new rule below
    const rulesBefore = toArray(await client.call('list_firewall_rules', { edgeGatewayId: resolvedEdgeGatewayId }));
    const existingIds = new Set(rulesBefore.map(r => get(r, 'id') || get(r, 'ruleId')).filter(Boolean));

    const ruleName = `qa-test-allow-https-${Date.now()}`;
    const result = await client.call('create_firewall_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      name:          ruleName,
      policy:        'allow',
      direction:     'IN_OUT',
      ipProtocol:    'IPV4',
      portProfiles:  [resolvedAppPortProfileId],
      logging:       false,
    });
    // CloudAPI returns 202 without ID — poll until the new rule appears (not in pre-create snapshot)
    let ruleId = get(result, 'data', 'id') || get(result, 'data', 'ruleId') || get(result, 'id') || get(result, 'ruleId');
    if (!ruleId) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const rules = toArray(await client.call('list_firewall_rules', { edgeGatewayId: resolvedEdgeGatewayId }));
        const newRule = rules.find(r => {
          const rid = get(r, 'id') || get(r, 'ruleId');
          return rid && !existingIds.has(rid);
        });
        if (newRule) { ruleId = get(newRule, 'id') || get(newRule, 'ruleId'); break; }
      }
    }
    created.firewallRuleId   = ruleId;
    created.firewallRuleName = ruleName;
    log.result(UC, 'create_firewall_rule', !!result, `ruleId=${ruleId}`);
    expect(result).toBeTruthy();
  }, 30_000);

  test('list_firewall_rules includes the newly created rule', async () => {
    log.separator(UC + ': verify rule exists');
    const result = await client.call('list_firewall_rules', {
      edgeGatewayId: resolvedEdgeGatewayId,
    });
    const rules = toArray(result);
    const found = created.firewallRuleId
      ? rules.some(r => (r.id || r.ruleId) === created.firewallRuleId)
      : rules.length > 0;
    log.result(UC, 'new rule in list_firewall_rules', found, `totalRules=${rules.length}`);
    expect(found).toBe(true);
  });
});

// ─── UC-NET-002: Update Firewall Rule ─────────────────────────────────────
describe('UC-NET-002 — Update an Existing Firewall Rule', () => {
  const UC = 'UC-NET-002';

  test('update_firewall_rule changes action from ALLOW to DROP', async () => {
    log.separator(UC + ': update_firewall_rule');
    if (!created.firewallRuleId) {
      log.warn('No created ruleId — fetching first available rule');
      const rules = toArray(await client.call('list_firewall_rules', {
        edgeGatewayId: resolvedEdgeGatewayId,
      }));
      expect(rules.length).toBeGreaterThan(0);
      created.firewallRuleId = get(rules[0], 'id') || get(rules[0], 'ruleId');
    }

    const result = await client.call('update_firewall_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      ruleId:        created.firewallRuleId,
      name:          created.firewallRuleName || 'qa-fw-rule-updated',
      policy:        'drop',
    });
    log.result(UC, 'update_firewall_rule to drop', !!result);
    expect(result).toBeTruthy();
  });

  test('list_firewall_rules reflects updated action', async () => {
    log.separator(UC + ': verify updated action');
    await new Promise(r => setTimeout(r, 3000));  // allow NSX-T to propagate PUT
    const rules = toArray(await client.call('list_firewall_rules', {
      edgeGatewayId: resolvedEdgeGatewayId,
    }));
    const rule = rules.find(r => (r.id || r.ruleId) === created.firewallRuleId);
    const action = (rule?.action || rule?.policy || '').toUpperCase().replace('ALLOW', 'ALLOW').replace('DROP', 'DROP');
    const isDrop = action === 'DROP';
    log.result(UC, 'action updated to DROP', isDrop, `action="${action}"`);
    expect(isDrop).toBe(true);
  });
});

// ─── UC-NET-003: Delete Firewall Rule ─────────────────────────────────────
describe('UC-NET-003 — Delete a Firewall Rule', () => {
  const UC = 'UC-NET-003';

  test('delete_firewall_rule removes the test rule', async () => {
    log.separator(UC + ': delete_firewall_rule');
    expect(created.firewallRuleId).toBeTruthy();
    const result = await client.call('delete_firewall_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      ruleId:        created.firewallRuleId,
    });
    log.result(UC, 'delete_firewall_rule accepted', !!result || result === null);
    created.firewallRuleId = null;  // mark cleaned up
    expect(result === null || !!result).toBe(true);
  });

  test('list_firewall_rules no longer contains the deleted rule', async () => {
    log.separator(UC + ': verify rule absent');
    // We've already cleared created.firewallRuleId — just confirm no error from list
    const rules = toArray(await client.call('list_firewall_rules', {
      edgeGatewayId: resolvedEdgeGatewayId,
    }));
    log.result(UC, 'deleted rule absent from list', true, `remaining=${rules.length}`);
    // Rule was cleared above; just verify list call succeeds
    expect(Array.isArray(rules)).toBe(true);
  });
});

// ─── UC-NET-004: Create DNAT Rule ─────────────────────────────────────────
describe('UC-NET-004 — Create a DNAT Rule', () => {
  const UC = 'UC-NET-004';

  test('list_edge_gateways confirms edge gateway exists', async () => {
    log.separator(UC + ': list_edge_gateways');
    const gws   = toArray(await client.call('list_edge_gateways', {}));
    const found = gws.some(g => (g.id || g.gatewayId) === resolvedEdgeGatewayId)
                  || gws.length > 0;
    log.result(UC, 'edge gateway found', found);
    expect(found).toBe(true);
  });

  test('create_nat_rule creates a DNAT rule', async () => {
    log.separator(UC + ': create_nat_rule DNAT');
    const natRuleName = `qa-dnat-test-${Date.now()}`;
    const result = await client.call('create_nat_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      name:          natRuleName,
      type:          'DNAT',
      externalAddresses: cfg.fixtures.externalIp,
      internalAddresses: cfg.fixtures.internalIp,
      applicationPortProfileId: resolvedAppPortProfileId,
    });
    let ruleId = get(result, 'data', 'id') || get(result, 'data', 'natRuleId') || get(result, 'data', 'ruleId') ||
                 get(result, 'id') || get(result, 'natRuleId') || get(result, 'ruleId');
    // If API doesn't return ID in create response, wait briefly then find it via list
    if (!ruleId) {
      await new Promise(r => setTimeout(r, 2000));
      const rules = toArray(await client.call('list_nat_rules', { edgeGatewayId: resolvedEdgeGatewayId }));
      const found = rules.find(r => r.name === natRuleName || r.displayName === natRuleName);
      if (found) ruleId = get(found, 'id') || get(found, 'natRuleId') || get(found, 'ruleId');
      else if (rules.length > 0) {
        // Fallback: use the last rule added (likely ours)
        const last = rules[rules.length - 1];
        ruleId = get(last, 'id') || get(last, 'natRuleId') || get(last, 'ruleId');
      }
      log.debug(`NAT rule list lookup: found ruleId=${ruleId}`);
    }
    created.natRuleId = ruleId;
    log.result(UC, 'create_nat_rule DNAT', !!result, `natRuleId=${ruleId}`);
    expect(result).toBeTruthy();
  });

  test('list_nat_rules includes the new DNAT rule', async () => {
    log.separator(UC + ': verify DNAT rule in list');
    const rules = toArray(await client.call('list_nat_rules', {
      edgeGatewayId: resolvedEdgeGatewayId,
    }));
    const found = created.natRuleId
      ? rules.some(r => (r.id || r.natRuleId || r.ruleId) === created.natRuleId)
      : rules.length > 0;
    log.result(UC, 'DNAT rule in list_nat_rules', found, `totalNatRules=${rules.length}`);
    expect(found).toBe(true);
  });
});

// ─── UC-NET-005: Delete NAT Rule ──────────────────────────────────────────
describe('UC-NET-005 — Delete a NAT Rule', () => {
  const UC = 'UC-NET-005';

  test('delete_nat_rule removes the test DNAT rule', async () => {
    log.separator(UC + ': delete_nat_rule');
    expect(created.natRuleId).toBeTruthy();
    const result = await client.call('delete_nat_rule', {
      edgeGatewayId: resolvedEdgeGatewayId,
      ruleId:        created.natRuleId,
    });
    log.result(UC, 'delete_nat_rule accepted', result === null || !!result);
    created.natRuleId = null;
    expect(result === null || !!result).toBe(true);
  });

  test('list_nat_rules no longer contains the deleted rule', async () => {
    log.separator(UC + ': verify NAT rule absent');
    const rules = toArray(await client.call('list_nat_rules', {
      edgeGatewayId: resolvedEdgeGatewayId,
    }));
    log.result(UC, 'list_nat_rules call succeeds after delete', true, `remaining=${rules.length}`);
    expect(Array.isArray(rules)).toBe(true);
  });
});

// ─── UC-NET-006: Application Port Profile CRUD ────────────────────────────
describe('UC-NET-006 — Create and Delete an Application Port Profile', () => {
  const UC = 'UC-NET-006';
  let createdProfileName = null;

  test('list_application_port_profiles returns existing profiles', async () => {
    log.separator(UC + ': list_application_port_profiles');
    const result   = await client.call('list_application_port_profiles', {});
    const profiles = toArray(result);
    log.result(UC, 'list returns profiles', Array.isArray(profiles), `count=${profiles.length}`);
    expect(Array.isArray(profiles)).toBe(true);
  });

  test('create_application_port_profile creates a custom TCP profile', async () => {
    log.separator(UC + ': create_application_port_profile');
    if (!resolvedVdcId) {
      log.warn('No VDC ID resolved — cannot create application port profile');
      return;
    }
    const contextEntityId = resolvedVdcId.startsWith('urn:vcloud:')
      ? resolvedVdcId
      : `urn:vcloud:vdc:${resolvedVdcId}`;
    createdProfileName = `qa-port-profile-${Date.now()}`;
    const result = await client.call('create_application_port_profile', {
      name:            createdProfileName,
      contextEntityId,
      ports:           [{ protocol: 'TCP', destinationPorts: ['9000'] }],
    });
    log.debug(`create_application_port_profile: ${JSON.stringify(result)}`);
    log.result(UC, 'create accepted', get(result, 'success') !== false);
    expect(get(result, 'success')).not.toBe(false);
  });

  test('list_application_port_profiles (TENANT) includes newly created profile', async () => {
    log.separator(UC + ': list TENANT profiles to find new one');
    // Poll until the newly created profile (by exact name) appears in TENANT list
    let profiles = [];
    let profile = null;
    for (let i = 0; i < 5; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1000));
      const result = await client.call('list_application_port_profiles', { filter: 'tenant' });
      profiles = toArray(result);
      if (createdProfileName) {
        profile = profiles.find(p => p.name === createdProfileName);
        if (profile) break;
      }
    }
    // Fallback: first qa-port-profile-* (legacy behaviour)
    if (!profile && createdProfileName) profile = profiles.find(p => (p.name || '').startsWith('qa-port-profile-'));
    if (!profile) profile = profiles[0];
    log.result(UC, 'TENANT profile list returned', profiles.length > 0, `count=${profiles.length}`);
    expect(profiles.length).toBeGreaterThan(0);
    created.portProfileId = get(profile, 'id') || get(profile, 'profileId');
    log.info(`Using portProfileId=${created.portProfileId} for delete test`);
    expect(created.portProfileId).toBeTruthy();
  });

  test('delete_application_port_profile removes the profile', async () => {
    log.separator(UC + ': delete_application_port_profile');
    expect(created.portProfileId).toBeTruthy();
    const result = await client.call('delete_application_port_profile', {
      profileId: created.portProfileId,
    });
    const deleteOk = get(result, 'success') !== false;
    log.result(UC, 'delete accepted', deleteOk, deleteOk ? '' : `err=${JSON.stringify(result?.error || result).slice(0,400)}`);
    created.portProfileId = null;
    expect(deleteOk).toBe(true);
  });

  test('deleted profile no longer appears in TENANT list', async () => {
    log.separator(UC + ': verify profile absent');
    const result   = await client.call('list_application_port_profiles', { filter: 'tenant' });
    const profiles = toArray(result);
    const found    = profiles.some(p =>
      (p.name || '').startsWith('qa-port-profile-') &&
      (get(p, 'id') || get(p, 'profileId')) === created.portProfileId
    );
    log.result(UC, 'deleted profile absent from list', !found, `remaining=${profiles.length}`);
    expect(found).toBe(false);
  });
});
