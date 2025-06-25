#!/usr/bin/env tsx
/**
 * Test firewall tools in Perth zone
 * Usage: npx tsx src/examples/test-firewall-tools.ts
 */

import { ZettagridClient } from '../client/zettagrid-client.js';
import { config } from 'dotenv';

// Load environment variables
config();

const ZONE = 'perth'; // Testing in Perth zone
const DELAY_MS = 1500; // Delay between tests to avoid rate limiting

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testFirewallTools() {
  console.log('🔥 Zettagrid Firewall Tools Test');
  console.log('=================================');
  console.log(`📍 Testing Zone: ${ZONE.toUpperCase()}`);
  console.log(`⏱️  Start Time: ${new Date().toISOString()}\n`);
  
  const client = new ZettagridClient();
  const testResults: { tool: string; status: string; details?: string }[] = [];
  
  try {
    console.log('✅ Client created successfully\n');
    
    // Store IDs for cross-tool testing
    let edgeGatewayId: string | undefined;
    
    // Test 1: List Edge Gateways
    console.log('1️⃣  Testing list_edge_gateways...');
    try {
      const edgeGateways = await client.listEdgeGateways(ZONE);
      if (edgeGateways.error) {
        testResults.push({ tool: 'list_edge_gateways', status: '❌ Failed', details: edgeGateways.error.message });
        console.error('❌ Failed:', edgeGateways.error.message);
        if (edgeGateways.error.details) {
          console.log('   Details:', JSON.stringify(edgeGateways.error.details, null, 2));
        }
      } else if (edgeGateways.data && edgeGateways.data.items) {
        testResults.push({ tool: 'list_edge_gateways', status: '✅ Success', details: `Found ${edgeGateways.data.items.length} edge gateways` });
        console.log(`✅ Success! Found ${edgeGateways.data.items.length} edge gateways`);
        if (edgeGateways.data.items.length > 0) {
          edgeGatewayId = edgeGateways.data.items[0].id;
          console.log(`   First edge gateway: ${edgeGateways.data.items[0].name} (${edgeGatewayId})`);
        } else {
          console.log('   ⚠️  No edge gateways found - firewall tests will be limited');
        }
      } else {
        testResults.push({ tool: 'list_edge_gateways', status: '⚠️  Warning', details: 'Unexpected response format' });
        console.log('⚠️  Warning: Unexpected response format');
        console.log('   Response:', JSON.stringify(edgeGateways, null, 2).substring(0, 500));
      }
    } catch (e) {
      testResults.push({ tool: 'list_edge_gateways', status: '❌ Error', details: String(e) });
      console.error('❌ Error:', e);
    }
    await delay(DELAY_MS);
    
    // Test 2: Get Edge Gateway Details (if we have an ID)
    if (edgeGatewayId) {
      console.log('\n2️⃣  Testing get_edge_gateway...');
      try {
        const edgeGateway = await client.getEdgeGateway(edgeGatewayId, ZONE);
        if (edgeGateway.error) {
          testResults.push({ tool: 'get_edge_gateway', status: '❌ Failed', details: edgeGateway.error.message });
          console.error('❌ Failed:', edgeGateway.error.message);
          if (edgeGateway.error.details) {
            console.log('   Details:', JSON.stringify(edgeGateway.error.details, null, 2));
          }
        } else if (edgeGateway.data) {
          testResults.push({ tool: 'get_edge_gateway', status: '✅ Success', details: edgeGateway.data.name });
          console.log(`✅ Success! Edge Gateway: ${edgeGateway.data.name}`);
          console.log(`   Status: ${edgeGateway.data.status}`);
          if (edgeGateway.data.configuration) {
            console.log(`   Configuration available: ${!!edgeGateway.data.configuration}`);
            console.log(`   Firewall service: ${!!edgeGateway.data.configuration.edgeGatewayServiceConfiguration?.firewallService}`);
          }
        }
      } catch (e) {
        testResults.push({ tool: 'get_edge_gateway', status: '❌ Error', details: String(e) });
        console.error('❌ Error:', e);
      }
      await delay(DELAY_MS);
      
      // Test 3: List Firewall Rules
      console.log('\n3️⃣  Testing list_firewall_rules...');
      try {
        const firewallRules = await client.listFirewallRules(edgeGatewayId, ZONE);
        if (firewallRules.error) {
          testResults.push({ tool: 'list_firewall_rules', status: '❌ Failed', details: firewallRules.error.message });
          console.error('❌ Failed:', firewallRules.error.message);
          if (firewallRules.error.details) {
            console.log('   Details:', JSON.stringify(firewallRules.error.details, null, 2));
          }
        } else if (firewallRules.data && firewallRules.data.items) {
          testResults.push({ tool: 'list_firewall_rules', status: '✅ Success', details: `Found ${firewallRules.data.items.length} firewall rules` });
          console.log(`✅ Success! Found ${firewallRules.data.items.length} firewall rules`);
          
          // Display existing rules
          if (firewallRules.data.items.length > 0) {
            console.log('\n   📋 Existing Firewall Rules:');
            firewallRules.data.items.forEach((rule, index) => {
              console.log(`   ${index + 1}. ${rule.description || 'No description'}`);
              console.log(`      Policy: ${rule.policy || 'N/A'} | Enabled: ${rule.isEnabled || 'N/A'}`);
              console.log(`      Source: ${rule.sourceIp || 'Any'}:${rule.sourcePortRange || 'Any'}`);
              console.log(`      Destination: ${rule.destinationIp || 'Any'}:${rule.destinationPortRange || 'Any'}`);
              if (rule.protocols) {
                const protocols = [];
                if (rule.protocols.tcp) protocols.push('TCP');
                if (rule.protocols.udp) protocols.push('UDP');
                if (rule.protocols.icmp) protocols.push('ICMP');
                console.log(`      Protocols: ${protocols.join(', ') || 'None'}`);
              }
              console.log('');
            });
          }
        }
      } catch (e) {
        testResults.push({ tool: 'list_firewall_rules', status: '❌ Error', details: String(e) });
        console.error('❌ Error:', e);
      }
      await delay(DELAY_MS);
      
      // Test 4: Create Firewall Rule (READ-ONLY test - we'll skip this for safety)
      console.log('\n4️⃣  Testing create_firewall_rule...');
      console.log('⚠️  SKIPPING create_firewall_rule test for safety reasons');
      console.log('   Creating firewall rules could affect network security');
      console.log('   To test manually, use:');
      console.log(`   await client.createFirewallRule('${edgeGatewayId}', {`);
      console.log(`     description: 'Test rule created by MCP',`);
      console.log(`     policy: 'allow',`);
      console.log(`     sourceIp: '192.168.1.0/24',`);
      console.log(`     destinationIp: 'Any',`);
      console.log(`     destinationPortRange: '80',`);
      console.log(`     protocols: { tcp: true }`);
      console.log(`   }, '${ZONE}');`);
      
      testResults.push({ tool: 'create_firewall_rule', status: '⏭️  Skipped', details: 'Avoided for security reasons' });
      
    } else {
      console.log('\n⚠️  Skipping edge gateway dependent tests - no edge gateways found');
      testResults.push({ tool: 'get_edge_gateway', status: '⏭️  Skipped', details: 'No edge gateway ID available' });
      testResults.push({ tool: 'list_firewall_rules', status: '⏭️  Skipped', details: 'No edge gateway ID available' });
      testResults.push({ tool: 'create_firewall_rule', status: '⏭️  Skipped', details: 'No edge gateway ID available' });
    }
    
    // Summary
    console.log('\n📊 Firewall Tools Test Summary');
    console.log('==============================');
    console.log(`✅ Test completed at: ${new Date().toISOString()}`);
    console.log(`📍 Zone tested: ${ZONE}\n`);
    
    console.log('Results by tool:');
    console.log('----------------');
    testResults.forEach(result => {
      console.log(`${result.status} ${result.tool}${result.details ? ` - ${result.details}` : ''}`);
    });
    
    const successCount = testResults.filter(r => r.status.includes('Success')).length;
    const failCount = testResults.filter(r => r.status.includes('Failed') || r.status.includes('Error')).length;
    const skipCount = testResults.filter(r => r.status.includes('Skipped')).length;
    const warnCount = testResults.filter(r => r.status.includes('Warning')).length;
    
    console.log(`\n📈 Statistics:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⚠️  Warnings: ${warnCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    console.log(`   📊 Total: ${testResults.length}`);
    
    // Recommendations
    console.log(`\n💡 Recommendations:`);
    if (failCount > 0) {
      console.log('   • Check API permissions for edge gateway access');
      console.log('   • Verify edge gateway IDs and zone configuration');
    }
    if (successCount > 0) {
      console.log('   • Firewall tools are working correctly');
      console.log('   • Consider implementing edge gateway query parsing for better results');
    }
    console.log('   • Use caution when creating firewall rules in production');
    console.log('   • Test firewall rule creation in a development environment first');
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
  }
}

// Run the firewall test
console.log('Starting firewall tools test...\n');
testFirewallTools().catch(console.error);