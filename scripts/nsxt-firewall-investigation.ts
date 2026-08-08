/**
 * NSX-T Firewall API Investigation
 * Deep analysis of NSX-T edge gateway firewall structure and API endpoints
 */

import { readFileSync } from 'fs';
import { ZettagridClient } from '../client/zettagrid-client.js';

// Simple .env file loader
function loadEnvFile() {
  try {
    const envContent = readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } catch (error) {
    console.log('⚠️  No .env file found, using system environment variables');
  }
}

async function investigateNSXTFirewallAPI(): Promise<void> {
  console.log('🔥 NSX-T Firewall API Investigation - Perth Zone');
  console.log('=' .repeat(60));

  loadEnvFile();
  const client = new ZettagridClient();
  const zone = 'perth';

  try {
    // Authentication
    console.log('🔐 Authenticating...');
    const authTest = await client.testZone(zone);
    if (!authTest.success) {
      console.log(`❌ Authentication failed: ${authTest.error?.message}`);
      return;
    }
    console.log('✅ Authentication successful\n');

    // Get edge gateways
    console.log('1️⃣  Discovering Edge Gateways...');
    const edgeGatewaysResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { 
        type: 'edgeGateway', 
        pageSize: '10',
        format: 'records'
      }
    }, zone);

    if (edgeGatewaysResult.status === 200 && typeof edgeGatewaysResult.data === 'string') {
      const gateways = parseEdgeGatewayRecords(edgeGatewaysResult.data);
      console.log(`✅ Found ${gateways.length} edge gateways\n`);

      // Investigate the first gateway in detail
      if (gateways.length > 0) {
        const gateway = gateways[0];
        console.log(`2️⃣  Deep Analysis of Gateway: ${gateway.name} (${gateway.gatewayType})`);
        console.log(`   Gateway ID: ${gateway.id}`);
        
        // Test various service endpoints to understand structure
        await analyzeGatewayServices(client, zone, gateway.id);
        
        // Analyze the services structure
        await analyzeServiceStructure(client, zone, gateway.id);
        
        // Test NSX-T specific endpoints
        await testNSXTEndpoints(client, zone, gateway.id);
        
        // Test firewall service discovery
        await discoverFirewallServices(client, zone, gateway.id);
      }
    } else {
      console.log(`❌ Edge gateway discovery failed: ${edgeGatewaysResult.status}`);
    }

  } catch (error) {
    console.error('\n💥 Investigation failed:', error instanceof Error ? error.message : String(error));
  }
}

async function analyzeGatewayServices(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n🔍 Step 2a: Gateway Services Analysis...');
  
  try {
    const servicesResult = await client.makeRequest({
      method: 'GET',
      url: `/admin/edgeGateway/${gatewayId}/services`
    }, zone);

    if (servicesResult.status === 200 && typeof servicesResult.data === 'string') {
      console.log('✅ Services endpoint accessible');
      
      // Analyze the XML structure
      const xmlData = servicesResult.data;
      
      // Look for firewall-related elements
      const firewallElements = [
        'FirewallService',
        'firewallService', 
        'FirewallRule',
        'firewallRule',
        'EdgeGatewayServiceConfiguration',
        'NatService',
        'LoadBalancerService',
        'IpsecVpnService'
      ];
      
      console.log('   📋 Service structure analysis:');
      firewallElements.forEach(element => {
        if (xmlData.includes(element)) {
          console.log(`     ✅ Found: ${element}`);
        } else {
          console.log(`     ❌ Missing: ${element}`);
        }
      });
      
      // Extract service configuration
      if (xmlData.includes('EdgeGatewayServiceConfiguration')) {
        console.log('\n   🔧 EdgeGatewayServiceConfiguration found');
        
        // Look for firewall configuration
        const firewallStart = xmlData.indexOf('<FirewallService');
        const natStart = xmlData.indexOf('<NatService');
        
        if (firewallStart !== -1) {
          console.log('   🔥 FirewallService configuration found');
          const firewallEnd = xmlData.indexOf('</FirewallService>', firewallStart) + '</FirewallService>'.length;
          const firewallXML = xmlData.substring(firewallStart, firewallEnd);
          
          // Analyze firewall structure
          console.log('   📋 Firewall service structure:');
          console.log(`     - Enabled: ${firewallXML.includes('<IsEnabled>true</IsEnabled>') ? 'Yes' : 'No'}`);
          console.log(`     - Default Action: ${extractTagValue(firewallXML, 'DefaultAction')}`);
          console.log(`     - Log Default Action: ${extractTagValue(firewallXML, 'LogDefaultAction')}`);
          
          // Look for existing rules
          const rulePattern = /<FirewallRule[^>]*>/g;
          const ruleMatches = firewallXML.match(rulePattern);
          console.log(`     - Existing Rules: ${ruleMatches ? ruleMatches.length : 0}`);
          
          if (ruleMatches && ruleMatches.length > 0) {
            console.log('\n   🔍 Existing firewall rules found:');
            ruleMatches.slice(0, 3).forEach((rule, i) => {
              const ruleId = extractAttribute(rule, 'id');
              console.log(`     Rule ${i + 1}: ID=${ruleId}`);
            });
          }
        } else {
          console.log('   ⚠️  No FirewallService configuration found');
        }
        
        if (natStart !== -1) {
          console.log('   🌐 NAT Service configuration found');
        }
      }
      
      // Save the service configuration for analysis
      console.log('\n   💾 Saving service configuration for detailed analysis...');
      // We'll use this data to understand the structure
      
    } else {
      console.log(`❌ Services endpoint failed: ${servicesResult.status}`);
    }
  } catch (error) {
    console.log(`❌ Gateway services analysis failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

async function analyzeServiceStructure(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n🔍 Step 2b: Service Structure Analysis...');
  
  // Test different ways to access firewall configuration
  const endpoints = [
    `/admin/edgeGateway/${gatewayId}/services`,
    `/admin/edgeGateway/${gatewayId}`,
    `/admin/edgeGateway/${gatewayId}/firewall`,
    `/edgeGateway/${gatewayId}/services`,
    `/admin/edgeGateway/${gatewayId}/services/firewall`
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`   Testing: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint
      }, zone);
      
      if (result.status === 200) {
        console.log(`     ✅ Accessible - ${typeof result.data === 'string' ? `${result.data.length} chars` : 'JSON'}`);
        
        if (typeof result.data === 'string' && result.data.includes('FirewallService')) {
          console.log(`     🔥 Contains FirewallService configuration`);
        }
      } else {
        console.log(`     ❌ HTTP ${result.status}`);
      }
    } catch (error) {
      console.log(`     ❌ Error`);
    }
  }
}

async function testNSXTEndpoints(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n🔍 Step 2c: NSX-T Specific Endpoints...');
  
  // Test NSX-T specific API patterns
  const nsxtEndpoints = [
    `/1.0.0/edgeGateways/${gatewayId}`,
    `/1.0.0/edgeGateways/${gatewayId}/firewall`,
    `/1.0.0/edgeGateways/${gatewayId}/firewall/config`,
    `/1.0.0/edgeGateways/${gatewayId}/firewall/rules`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall`,
    `/network/edges/${gatewayId}/firewall`,
    `/network/edges/${gatewayId}/firewall/rules`
  ];
  
  for (const endpoint of nsxtEndpoints) {
    try {
      console.log(`   Testing NSX-T: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint
      }, zone);
      
      if (result.status === 200) {
        console.log(`     ✅ NSX-T endpoint accessible!`);
        if (typeof result.data === 'string' && result.data.includes('firewall')) {
          console.log(`     🔥 Contains firewall data`);
        }
      } else if (result.status === 404) {
        console.log(`     ❌ Not found`);
      } else {
        console.log(`     ⚠️  HTTP ${result.status}`);
      }
    } catch (error) {
      console.log(`     ❌ Error`);
    }
  }
}

async function discoverFirewallServices(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n🔍 Step 2d: Firewall Service Discovery...');
  
  try {
    // Get the main services configuration
    const servicesResult = await client.makeRequest({
      method: 'GET',
      url: `/admin/edgeGateway/${gatewayId}/services`
    }, zone);

    if (servicesResult.status === 200 && typeof servicesResult.data === 'string') {
      const xmlData = servicesResult.data;
      
      // Find the current firewall service configuration
      const firewallStart = xmlData.indexOf('<FirewallService');
      if (firewallStart !== -1) {
        const firewallEnd = xmlData.indexOf('</FirewallService>', firewallStart) + '</FirewallService>'.length;
        const firewallXML = xmlData.substring(firewallStart, firewallEnd);
        
        console.log('   🔥 Current Firewall Service Configuration:');
        console.log(`     - Service Enabled: ${extractTagValue(firewallXML, 'IsEnabled')}`);
        console.log(`     - Default Action: ${extractTagValue(firewallXML, 'DefaultAction')}`);
        console.log(`     - Version: ${extractTagValue(firewallXML, 'Version')}`);
        
        // Look for the firewall rules structure
        const rulesStart = xmlData.indexOf('<FirewallRules');
        if (rulesStart !== -1) {
          console.log('     ✅ FirewallRules section found');
          
          // Extract a sample rule structure if any exist
          const sampleRuleMatch = xmlData.match(/<FirewallRule[^>]*>.*?<\/FirewallRule>/s);
          if (sampleRuleMatch) {
            console.log('\n   📋 Sample Rule Structure:');
            const sampleRule = sampleRuleMatch[0];
            console.log(`     - Rule ID: ${extractAttribute(sampleRule, 'id')}`);
            console.log(`     - Enabled: ${extractTagValue(sampleRule, 'IsEnabled')}`);
            console.log(`     - Description: ${extractTagValue(sampleRule, 'Description')}`);
            console.log(`     - Policy: ${extractTagValue(sampleRule, 'Policy')}`);
            console.log(`     - Protocols: ${extractTagValue(sampleRule, 'Protocols')}`);
          } else {
            console.log('     ℹ️  No existing rules found - clean firewall configuration');
          }
        } else {
          console.log('     ⚠️  No FirewallRules section found');
        }
        
        // Determine the correct format for rule modification
        console.log('\n   🎯 Determining Rule Management Strategy:');
        
        if (xmlData.includes('<FirewallService') && xmlData.includes('<FirewallRules')) {
          console.log('     ✅ Standard vCloud Director firewall service structure detected');
          console.log('     📝 Strategy: PUT entire FirewallService configuration with modified rules');
        } else {
          console.log('     ⚠️  Non-standard firewall structure - may need NSX-T specific API');
        }
      } else {
        console.log('   ❌ No FirewallService configuration found in services');
      }
    }
  } catch (error) {
    console.log(`   ❌ Firewall service discovery failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// Helper functions
function parseEdgeGatewayRecords(xmlData: string): any[] {
  const records: any[] = [];
  const recordPattern = /<(\w+:)?EdgeGatewayRecord[^>]*>/gi;
  const matches = xmlData.match(recordPattern);
  
  if (matches) {
    matches.forEach(match => {
      const name = extractAttribute(match, 'name');
      const href = extractAttribute(match, 'href');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const gatewayType = extractAttribute(match, 'gatewayType');
      
      if (name && href && id) {
        records.push({ name, id, href, gatewayType });
      }
    });
  }
  
  return records;
}

function extractAttribute(xmlElement: string, attributeName: string): string {
  const pattern = new RegExp(`${attributeName}=[\"']([^\"']*?)[\"']`, 'i');
  const match = xmlElement.match(pattern);
  return match?.[1] || '';
}

function extractTagValue(xmlData: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i');
  const match = xmlData.match(pattern);
  return match?.[1] || '';
}

function extractIdFromHref(href: string): string {
  if (!href) return '';
  const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (match?.[1]) return match[1];
  const parts = href.split('/');
  return parts[parts.length - 1] || '';
}

// Run investigation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  investigateNSXTFirewallAPI().catch(error => {
    console.error('NSX-T Firewall API investigation failed:', error);
    process.exit(1);
  });
}

export { investigateNSXTFirewallAPI };