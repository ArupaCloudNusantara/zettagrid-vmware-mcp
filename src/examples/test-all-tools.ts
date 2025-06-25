#!/usr/bin/env tsx
/**
 * Comprehensive test of all MCP tools in Perth zone
 * Usage: npx tsx src/examples/test-all-tools.ts
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth'; // Testing in Perth zone
const DELAY_MS = 1000; // Delay between tests to avoid rate limiting

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAllTools() {
  console.log('🚀 Zettagrid MCP Tools Comprehensive Test');
  console.log('=========================================');
  console.log(`📍 Testing Zone: ${ZONE.toUpperCase()}`);
  console.log(`⏱️  Start Time: ${new Date().toISOString()}\n`);
  
  const client = new ZettagridClient();
  
  try {
    console.log('✅ Client created successfully\n');
    
    // Store IDs for cross-tool testing
    let orgId: string | undefined;
    let vdcId: string | undefined;
    let vappId: string | undefined;
    let vmId: string | undefined;
    let networkId: string | undefined;
    let edgeGatewayId: string | undefined;
    
    // Test 1: Zone Info
    console.log('1️⃣  Testing get_zone_info...');
    const zoneInfo = await client.getZoneInfo();
    if (zoneInfo.error) {
      console.error('❌ Failed:', zoneInfo.error.message);
    } else if (zoneInfo.data && zoneInfo.data.zones) {
      console.log('✅ Success! Available zones:', Object.keys(zoneInfo.data.zones).join(', '));
      console.log(`   Default zone: ${zoneInfo.data.defaultZone}`);
    } else {
      console.log('✅ Zone info retrieved but data structure unexpected');
    }
    await delay(DELAY_MS);
    
    // Test 2: List Organizations
    console.log('\n2️⃣  Testing list_organizations...');
    const orgs = await client.listOrganizations(ZONE);
    if (orgs.error) {
      console.error('❌ Failed:', orgs.error.message);
    } else if (orgs.data && Array.isArray(orgs.data)) {
      console.log(`✅ Success! Found ${orgs.data.length} organizations`);
      if (orgs.data.length > 0) {
        orgId = orgs.data[0].id;
        console.log(`   First org: ${orgs.data[0].name} (${orgId})`);
      }
    } else if (orgs.data && orgs.data.items) {
      console.log(`✅ Success! Found ${orgs.data.items.length} organizations`);
      if (orgs.data.items.length > 0) {
        orgId = orgs.data.items[0].id;
        console.log(`   First org: ${orgs.data.items[0].name} (${orgId})`);
      }
    } else {
      console.log('❌ No organizations found or unexpected structure');
    }
    await delay(DELAY_MS);
    
    // Test 3: Get Organization Details
    if (orgId) {
      console.log('\n3️⃣  Testing get_organization...');
      const org = await client.getOrganization(orgId, ZONE);
      if (org.error) {
        console.error('❌ Failed:', org.error.message);
      } else {
        console.log(`✅ Success! Org: ${org.data.name}`);
        console.log(`   Full name: ${org.data.fullName || 'N/A'}`);
        console.log(`   Enabled: ${org.data.isEnabled}`);
      }
      await delay(DELAY_MS);
    }
    
    // Test 4: List VDCs
    console.log('\n4️⃣  Testing list_vdcs...');
    const vdcs = await client.listVdcs(ZONE);
    if (vdcs.error) {
      console.error('❌ Failed:', vdcs.error.message);
    } else {
      console.log(`✅ Success! Found ${vdcs.data.items.length} VDCs`);
      if (vdcs.data.items.length > 0) {
        vdcId = vdcs.data.items[0].id;
        console.log(`   First VDC: ${vdcs.data.items[0].name} (${vdcId})`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 5: Get VDC Details
    if (vdcId) {
      console.log('\n5️⃣  Testing get_vdc...');
      const vdc = await client.getVdc(vdcId, ZONE);
      if (vdc.error) {
        console.error('❌ Failed:', vdc.error.message);
      } else {
        console.log(`✅ Success! VDC: ${vdc.data.name}`);
        console.log(`   Status: ${vdc.data.status}`);
        console.log(`   Enabled: ${vdc.data.isEnabled}`);
      }
      await delay(DELAY_MS);
    }
    
    // Test 6: List vApps
    console.log('\n6️⃣  Testing list_vapps...');
    const vapps = await client.listVApps(vdcId, ZONE);
    if (vapps.error) {
      console.error('❌ Failed:', vapps.error.message);
    } else {
      console.log(`✅ Success! Found ${vapps.data.items.length} vApps`);
      if (vapps.data.items.length > 0) {
        vappId = vapps.data.items[0].id;
        console.log(`   First vApp: ${vapps.data.items[0].name} (${vappId})`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 7: Get vApp Details
    if (vappId) {
      console.log('\n7️⃣  Testing get_vapp...');
      const vapp = await client.getVApp(vappId, ZONE);
      if (vapp.error) {
        console.error('❌ Failed:', vapp.error.message);
      } else {
        console.log(`✅ Success! vApp: ${vapp.data.name}`);
        console.log(`   Status: ${vapp.data.status}`);
        console.log(`   Deployed: ${vapp.data.deployed}`);
      }
      await delay(DELAY_MS);
    }
    
    // Test 8: List VMs
    console.log('\n8️⃣  Testing list_vms...');
    const vms = await client.listVMs(vappId, ZONE);
    if (vms.error) {
      console.error('❌ Failed:', vms.error.message);
    } else {
      console.log(`✅ Success! Found ${vms.data.items.length} VMs`);
      if (vms.data.items.length > 0) {
        vmId = vms.data.items[0].id;
        console.log(`   First VM: ${vms.data.items[0].name} (${vmId})`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 9: Get VM Details
    if (vmId) {
      console.log('\n9️⃣  Testing get_vm...');
      const vm = await client.getVM(vmId, ZONE);
      if (vm.error) {
        console.error('❌ Failed:', vm.error.message);
      } else {
        console.log(`✅ Success! VM: ${vm.data.name}`);
        console.log(`   Status: ${vm.data.status}`);
        console.log(`   Deployed: ${vm.data.deployed}`);
      }
      await delay(DELAY_MS);
      
      // Test 10: Get VM Console
      console.log('\n🔟 Testing get_vm_console...');
      const consoleResult = await client.getVMConsole(vmId, ZONE);
      if (consoleResult.error) {
        console.error('❌ Failed:', consoleResult.error.message);
        if (consoleResult.error.details) {
          console.log('   Details:', JSON.stringify(consoleResult.error.details, null, 2));
        }
      } else {
        console.log('✅ Success! Console ticket acquired');
        if (consoleResult.data && consoleResult.data.ticket) {
          console.log(`   Ticket: ${consoleResult.data.ticket.substring(0, 20)}...`);
        }
      }
      await delay(DELAY_MS);
    }
    
    // Test 11: List Organization Networks
    console.log('\n1️⃣1️⃣ Testing list_org_networks...');
    const networks = await client.listOrgNetworks(ZONE);
    if (networks.error) {
      console.error('❌ Failed:', networks.error.message);
    } else {
      console.log(`✅ Success! Found ${networks.data.items.length} networks`);
      if (networks.data.items.length > 0) {
        networkId = networks.data.items[0].id;
        console.log(`   First network: ${networks.data.items[0].name} (${networkId})`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 12: List Edge Gateways
    console.log('\n1️⃣2️⃣ Testing list_edge_gateways...');
    const edges = await client.listEdgeGateways(ZONE);
    if (edges.error) {
      console.error('❌ Failed:', edges.error.message);
    } else {
      console.log(`✅ Success! Found ${edges.data.items.length} edge gateways`);
      if (edges.data.items.length > 0) {
        edgeGatewayId = edges.data.items[0].id;
        console.log(`   First edge: ${edges.data.items[0].name} (${edgeGatewayId})`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 13: Get Edge Gateway
    if (edgeGatewayId) {
      console.log('\n1️⃣3️⃣ Testing get_edge_gateway...');
      const edge = await client.getEdgeGateway(edgeGatewayId, ZONE);
      if (edge.error) {
        console.error('❌ Failed:', edge.error.message);
      } else {
        console.log(`✅ Success! Edge Gateway: ${edge.data.name}`);
        console.log(`   Status: ${edge.data.status}`);
      }
      await delay(DELAY_MS);
      
      // Test 14: List Firewall Rules
      console.log('\n1️⃣4️⃣ Testing list_firewall_rules...');
      const rules = await client.listFirewallRules(edgeGatewayId, ZONE);
      if (rules.error) {
        console.error('❌ Failed:', rules.error.message);
      } else {
        console.log(`✅ Success! Found ${rules.data.items.length} firewall rules`);
        if (rules.data.items.length > 0) {
          console.log(`   First rule: ${rules.data.items[0].description || 'No description'}`);
        }
      }
      await delay(DELAY_MS);
      
      // Test 15: List NAT Rules
      console.log('\n1️⃣5️⃣ Testing list_nat_rules...');
      const natRules = await client.listNatRules(edgeGatewayId, ZONE);
      if (natRules.error) {
        console.error('❌ Failed:', natRules.error.message);
      } else {
        console.log(`✅ Success! Found ${natRules.data.items.length} NAT rules`);
        if (natRules.data.items.length > 0) {
          console.log(`   First rule type: ${natRules.data.items[0].ruleType}`);
        }
      }
      await delay(DELAY_MS);
    }
    
    // Test 16: List Storage Profiles
    console.log('\n1️⃣6️⃣ Testing list_storage_profiles...');
    const profiles = await client.listStorageProfiles(ZONE);
    if (profiles.error) {
      console.error('❌ Failed:', profiles.error.message);
    } else {
      console.log(`✅ Success! Found ${profiles.data.items.length} storage profiles`);
      if (profiles.data.items.length > 0) {
        console.log(`   First profile: ${profiles.data.items[0].name}`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 17: List Independent Disks
    console.log('\n1️⃣7️⃣ Testing list_disks...');
    const disks = await client.listDisks(ZONE);
    if (disks.error) {
      console.error('❌ Failed:', disks.error.message);
    } else {
      console.log(`✅ Success! Found ${disks.data.items.length} independent disks`);
      if (disks.data.items.length > 0) {
        console.log(`   First disk: ${disks.data.items[0].name}`);
      }
    }
    await delay(DELAY_MS);
    
    // Test 18: List Catalogs
    console.log('\n1️⃣8️⃣ Testing list_catalogs...');
    const catalogs = await client.listCatalogs(ZONE);
    if (catalogs.error) {
      console.error('❌ Failed:', catalogs.error.message);
    } else {
      console.log(`✅ Success! Found ${catalogs.data.items.length} catalogs`);
      if (catalogs.data.items.length > 0) {
        console.log(`   First catalog: ${catalogs.data.items[0].name}`);
      }
    }
    
    // Summary
    console.log('\n📊 Test Summary');
    console.log('===============');
    console.log(`✅ Test completed at: ${new Date().toISOString()}`);
    console.log(`📍 Zone tested: ${ZONE}`);
    console.log('\n💡 Note: Some operations may fail if resources don\'t exist or permissions are insufficient.');
    console.log('   This is expected behavior for read operations on empty environments.');
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

// Run the comprehensive test
console.log('Starting comprehensive MCP tools test...\n');
testAllTools().catch(console.error);