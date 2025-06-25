/**
 * Gateway Configuration Analyzer
 * Examines the actual NSX-T gateway configuration to understand firewall structure
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

async function analyzeGatewayConfiguration(): Promise<void> {
  console.log('🔍 Gateway Configuration Analysis - Perth Zone');
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

    // Get the first edge gateway
    const edgeGatewaysResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'edgeGateway', pageSize: '1' }
    }, zone);

    if (edgeGatewaysResult.status === 200 && typeof edgeGatewaysResult.data === 'string') {
      const gatewayMatch = edgeGatewaysResult.data.match(/href="([^"]*edgeGateway[^"]*)"/);
      if (gatewayMatch) {
        const gatewayHref = gatewayMatch[1];
        const gatewayId = gatewayHref.split('/').pop();
        
        console.log(`🎯 Analyzing Gateway: ${gatewayId}`);
        
        // Get the full gateway configuration
        const gatewayResult = await client.makeRequest({
          method: 'GET',
          url: `/admin/edgeGateway/${gatewayId}`
        }, zone);

        if (gatewayResult.status === 200 && typeof gatewayResult.data === 'string') {
          console.log(`✅ Gateway configuration retrieved (${gatewayResult.data.length} characters)`);
          
          // Analyze the configuration structure
          await analyzeConfigurationStructure(gatewayResult.data, gatewayId!);
          
          // Test for NSX-T policy endpoints
          await testNSXTPolicyEndpoints(client, zone, gatewayId!);
          
          // Test for cloud API endpoints  
          await testCloudAPIEndpoints(client, zone, gatewayId!);
          
        } else {
          console.log(`❌ Failed to get gateway configuration: ${gatewayResult.status}`);
        }
      }
    }

  } catch (error) {
    console.error('\n💥 Analysis failed:', error instanceof Error ? error.message : String(error));
  }
}

async function analyzeConfigurationStructure(xmlData: string, gatewayId: string): Promise<void> {
  console.log('\n📋 Configuration Structure Analysis:');
  
  // Key elements to look for
  const elements = [
    'EdgeGateway',
    'Configuration',
    'GatewayBackingConfig',
    'GatewayInterfaces',
    'FirewallService',
    'NatService',
    'LoadBalancerService',
    'VpnService',
    'DhcpService',
    'EdgeGatewayServiceConfiguration',
    'DistributedRouting',
    'AdvancedNetworkingEnabled',
    'GatewayType',
    'BackingInfo'
  ];
  
  console.log('   🔍 XML Elements Found:');
  elements.forEach(element => {
    const found = xmlData.includes(`<${element}`) || xmlData.includes(`<${element.toLowerCase()}`);
    console.log(`     ${found ? '✅' : '❌'} ${element}`);
  });

  // Look for NSX-T specific elements
  const nsxtElements = [
    'nsxT',
    'NSX-T', 
    'policy',
    'gatewayType="NSXT_BACKED"',
    'distributed',
    'tier0',
    'tier1'
  ];
  
  console.log('\n   🔥 NSX-T Specific Elements:');
  nsxtElements.forEach(element => {
    const found = xmlData.toLowerCase().includes(element.toLowerCase());
    console.log(`     ${found ? '✅' : '❌'} ${element}`);
  });

  // Extract key configuration values
  console.log('\n   ⚙️  Key Configuration:');
  const gatewayType = extractTagValue(xmlData, 'GatewayType');
  const distributedRouting = extractTagValue(xmlData, 'DistributedRouting');
  const advancedNetworking = extractTagValue(xmlData, 'AdvancedNetworkingEnabled');
  const version = extractAttribute(xmlData, 'EdgeGateway', 'vCloudExtension');
  
  console.log(`     - Gateway Type: ${gatewayType || 'Not specified'}`);
  console.log(`     - Distributed Routing: ${distributedRouting || 'Not specified'}`);
  console.log(`     - Advanced Networking: ${advancedNetworking || 'Not specified'}`);
  console.log(`     - Version: ${version || 'Not specified'}`);

  // Look for service configurations
  console.log('\n   🔧 Service Configurations:');
  const serviceConfigStart = xmlData.indexOf('<EdgeGatewayServiceConfiguration');
  if (serviceConfigStart !== -1) {
    console.log('     ✅ EdgeGatewayServiceConfiguration found');
    const serviceConfigEnd = xmlData.indexOf('</EdgeGatewayServiceConfiguration>', serviceConfigStart);
    if (serviceConfigEnd !== -1) {
      const serviceConfig = xmlData.substring(serviceConfigStart, serviceConfigEnd);
      
      // Analyze services within the configuration
      const services = ['FirewallService', 'NatService', 'LoadBalancerService', 'VpnService', 'DhcpService'];
      services.forEach(service => {
        if (serviceConfig.includes(`<${service}`)) {
          console.log(`       🔥 ${service} configured`);
        } else {
          console.log(`       ❌ ${service} not found`);
        }
      });
    }
  } else {
    console.log('     ❌ No EdgeGatewayServiceConfiguration found');
    console.log('     ℹ️  This suggests NSX-T managed services (policy-based)');
  }

  // Look for NSX-T backing configuration
  const backingConfigStart = xmlData.indexOf('<GatewayBackingConfig');
  if (backingConfigStart !== -1) {
    console.log('\n   🏗️  Gateway Backing Configuration found');
    const backingConfigEnd = xmlData.indexOf('</GatewayBackingConfig>', backingConfigStart);
    if (backingConfigEnd !== -1) {
      const backingConfig = xmlData.substring(backingConfigStart, backingConfigEnd);
      console.log(`     - Backing Type: ${extractTagValue(backingConfig, 'BackingType')}`);
      console.log(`     - Gateway Type: ${extractTagValue(backingConfig, 'GatewayType')}`);
    }
  }
}

async function testNSXTPolicyEndpoints(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n🔥 Testing NSX-T Policy Endpoints:');
  
  // NSX-T Policy API endpoints
  const policyEndpoints = [
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/nat`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/dhcp`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/dns`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/routing`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}/services`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}`,
    `/cloudapi/2.0.0/edgeGateways/${gatewayId}/firewall`,
    `/cloudapi/2.0.0/edgeGateways/${gatewayId}`
  ];
  
  for (const endpoint of policyEndpoints) {
    try {
      console.log(`   Testing: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint
      }, zone);
      
      if (result.status === 200) {
        console.log(`     ✅ SUCCESS - Policy endpoint accessible!`);
        if (typeof result.data === 'string') {
          console.log(`     📊 Response: ${result.data.length} chars`);
          if (result.data.includes('firewall') || result.data.includes('rule')) {
            console.log(`     🔥 Contains firewall/rule data`);
          }
        } else {
          console.log(`     📊 JSON Response received`);
        }
      } else if (result.status === 403) {
        console.log(`     🔒 Forbidden - may need different permissions`);
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

async function testCloudAPIEndpoints(client: ZettagridClient, zone: string, gatewayId: string): Promise<void> {
  console.log('\n☁️  Testing Cloud API Endpoints:');
  
  // Cloud API endpoints for NSX-T gateways
  const cloudEndpoints = [
    `/cloudapi/1.0.0/edgeGateways`,
    `/cloudapi/1.0.0/edgeGateways/${gatewayId}`,
    `/cloudapi/1.0.0/firewallGroups`,
    `/cloudapi/1.0.0/applicationPortProfiles`,
    `/cloudapi/1.0.0/ipSecVpnTunnels`,
    `/cloudapi/2.0.0/edgeGateways/${gatewayId}`
  ];
  
  for (const endpoint of cloudEndpoints) {
    try {
      console.log(`   Testing: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint,
        headers: {
          'Accept': 'application/json'
        }
      }, zone);
      
      if (result.status === 200) {
        console.log(`     ✅ Cloud API endpoint accessible!`);
        if (typeof result.data === 'object') {
          console.log(`     📊 JSON data received`);
        } else if (typeof result.data === 'string') {
          console.log(`     📊 Response: ${result.data.length} chars`);
        }
      } else {
        console.log(`     ⚠️  HTTP ${result.status}`);
      }
    } catch (error) {
      console.log(`     ❌ Error`);
    }
  }
}

// Helper functions
function extractTagValue(xmlData: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i');
  const match = xmlData.match(pattern);
  return match?.[1] || '';
}

function extractAttribute(xmlData: string, elementName: string, attributeName: string): string {
  const elementPattern = new RegExp(`<${elementName}[^>]*`, 'i');
  const elementMatch = xmlData.match(elementPattern);
  if (elementMatch) {
    const attrPattern = new RegExp(`${attributeName}=[\"']([^\"']*)[\"']`, 'i');
    const attrMatch = elementMatch[0].match(attrPattern);
    return attrMatch?.[1] || '';
  }
  return '';
}

// Run analysis if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeGatewayConfiguration().catch(error => {
    console.error('Gateway configuration analysis failed:', error);
    process.exit(1);
  });
}

export { analyzeGatewayConfiguration };