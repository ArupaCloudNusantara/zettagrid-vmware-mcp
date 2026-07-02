'use strict';

const cfg = require('./config');
const { makeLogger } = require('./logger');

const log = makeLogger('helpers');

/**
 * Poll get_task until status is 'success' or 'error', or timeout expires.
 * Returns the final task object.
 */
async function waitForTask(client, taskId, timeoutMs = cfg.timeouts.taskPoll) {
  if (!taskId) throw new Error('waitForTask called with empty taskId');
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const raw = await client.call('get_task', { taskId });
    if (Date.now() >= deadline) break;   // guard: don't log after deadline
    last = raw?.data ?? raw;
    // VCD task status field is 'taskStatus' in parseTaskResponse output
    const status = (last?.taskStatus || last?.status || last?.operationKey || '').toLowerCase();
    log.debug(`Task ${taskId} status: ${status}`);
    if (status === 'success' || status === 'completed') return last;
    if (status === 'error'   || status === 'aborted')   throw new Error(`Task ${taskId} failed: ${last?.message || last?.description || status}`);
    await sleep(cfg.timeouts.taskInterval);
  }
  throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`);
}

// Entity-level status codes (same mapping for VMs and vApps):
// 1=RESOLVED (undeployed), 3=SUSPENDED, 4=POWERED_ON, 8=POWERED_OFF, 10=MIXED
const ENTITY_STATUS_MAP = { 1: 'RESOLVED', 3: 'SUSPENDED', 4: 'POWERED_ON', 8: 'POWERED_OFF', 10: 'MIXED' };

function normalizeStateStr(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Poll get_vm until powerState matches expected, or timeout expires.
 * Returns the unwrapped VM data object (not the raw MCP response wrapper).
 */
async function waitForVmPower(client, vmId, expectedState, timeoutMs = cfg.timeouts.powerOp) {
  const deadline = Date.now() + timeoutMs;
  let vm;
  const wantNorm = normalizeStateStr(expectedState);  // 'poweredon', 'poweredoff', 'suspended'
  while (Date.now() < deadline) {
    const raw = await client.call('get_vm', { vmId });
    if (Date.now() >= deadline) break;   // guard: don't log after deadline
    vm = raw?.data ?? raw;
    // Normalize numeric status integer to a human-readable string
    if (typeof vm.status === 'number') vm.status = ENTITY_STATUS_MAP[vm.status] || vm.statusDescription || String(vm.status);
    const stateNorm = normalizeStateStr(vm.statusDescription || vm.status);
    log.debug(`VM ${vmId} power state: ${vm.statusDescription || vm.status}`);
    if (stateNorm === wantNorm) return vm;
    await sleep(cfg.timeouts.taskInterval);
  }
  throw new Error(`VM ${vmId} did not reach state "${expectedState}" within ${timeoutMs}ms`);
}

/**
 * Poll get_vapp until status matches expected.
 * Returns the unwrapped vApp data object (not the raw MCP response wrapper).
 */
async function waitForVappStatus(client, vappId, expectedStatus, timeoutMs = cfg.timeouts.powerOp) {
  const deadline = Date.now() + timeoutMs;
  let vapp;
  const wantNorm = normalizeStateStr(expectedStatus);  // 'poweredon', 'poweredoff', etc.
  while (Date.now() < deadline) {
    const raw = await client.call('get_vapp', { vappId });
    vapp = raw?.data ?? raw;
    // Normalize numeric status integer to a human-readable string
    if (typeof vapp.status === 'number') vapp.status = ENTITY_STATUS_MAP[vapp.status] || String(vapp.status);
    const stateNorm = normalizeStateStr(vapp.status);
    log.debug(`vApp ${vappId} status: ${vapp.status}`);
    if (stateNorm === wantNorm) return vapp;
    // RESOLVED (undeploy result, status=1) and MIXED (status=10, some VMs still stopping) also
    // satisfy a "Powered Off" check — the power-off intent was fulfilled even if one VM is stuck.
    if (wantNorm === 'poweredoff' && (stateNorm === 'resolved' || stateNorm === 'mixed')) return vapp;
    await sleep(cfg.timeouts.taskInterval);
  }
  throw new Error(`vApp ${vappId} did not reach status "${expectedStatus}" within ${timeoutMs}ms (last seen: "${vapp?.status ?? 'unknown'}")`);
}

/**
 * Find an item in a list result by a field match.
 * Handles { values: [...] }, { items: [...] }, or plain array.
 */
function findInList(result, predicate) {
  const arr = Array.isArray(result)         ? result
            : Array.isArray(result?.values) ? result.values
            : Array.isArray(result?.items)  ? result.items
            : [];
  return arr.find(predicate) || null;
}

/**
 * Extract all items from a list result regardless of wrapper shape.
 */
function toArray(result) {
  if (Array.isArray(result))               return result;
  if (Array.isArray(result?.values))       return result.values;
  if (Array.isArray(result?.items))        return result.items;
  if (Array.isArray(result?.data?.items))     return result.data.items;
  if (Array.isArray(result?.data?.values))    return result.data.values;
  if (Array.isArray(result?.data?.snapshots)) return result.data.snapshots;
  if (Array.isArray(result?.data))            return result.data;
  return [];
}

/**
 * Simple sleep.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Safely get a nested property without throwing.
 */
function get(obj, ...keys) {
  return keys.reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

module.exports = { waitForTask, waitForVmPower, waitForVappStatus, findInList, toArray, sleep, get };
