/**
 * Firewall Configuration Investigation
 * Detailed analysis of edge gateway endpoints and firewall access
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

async function investigateFirewallConfiguration(): Promise<void> {
  console.log('🔥 Firewall Configuration Investigation - Perth Zone');
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

    // Step 1: Detailed edge gateway discovery
    console.log('1️⃣  Detailed Edge Gateway Discovery...');
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
      console.log('✅ Edge gateway query successful');
      
      // Parse edge gateway details more carefully
      const xmlData = edgeGatewaysResult.data;
      console.log('\n📋 Raw Edge Gateway Data Analysis:');
      
      // Extract gateway records with detailed parsing
      const gatewayRecords = parseEdgeGatewayRecords(xmlData);
      console.log(`   Found ${gatewayRecords.length} edge gateway records`);
      
      for (let i = 0; i < Math.min(gatewayRecords.length, 3); i++) {
        const gateway = gatewayRecords[i];
        console.log(`\n   Gateway ${i + 1}:`);
        console.log(`     Name: ${gateway.name}`);
        console.log(`     ID: ${gateway.id}`);
        console.log(`     Href: ${gateway.href}`);
        console.log(`     Gateway Type: ${gateway.gatewayType || 'Unknown'}`);
        
        // Test different firewall endpoints for this gateway
        await testFirewallEndpoints(client, zone, gateway);
      }
    } else {
      console.log(`❌ Edge gateway query failed: ${edgeGatewaysResult.status}`);
      return;
    }

    // Step 2: Test organization firewall endpoints
    console.log('\n2️⃣  Testing Organization-Level Firewall Access...');
    await testOrganizationFirewall(client, zone);

    // Step 3: Test network firewall endpoints
    console.log('\n3️⃣  Testing Network-Level Firewall Access...');
    await testNetworkFirewall(client, zone);

  } catch (error) {
    console.error('\n💥 Investigation failed:', error instanceof Error ? error.message : String(error));
  }
}

interface EdgeGatewayRecord {
  name: string;
  id: string;
  href: string;
  gatewayType?: string;
  orgVdcName?: string;
}

function parseEdgeGatewayRecords(xmlData: string): EdgeGatewayRecord[] {
  const records: EdgeGatewayRecord[] = [];
  
  // More comprehensive regex to capture edge gateway records
  const recordPattern = /<(\w+:)?EdgeGatewayRecord[^>]*>/gi;
  const matches = xmlData.match(recordPattern);
  
  if (matches) {
    matches.forEach(match => {
      const name = extractAttribute(match, 'name');
      const href = extractAttribute(match, 'href');
      const id = extractIdFromHref(href) || extractAttribute(match, 'id');
      const gatewayType = extractAttribute(match, 'gatewayType');
      const orgVdcName = extractAttribute(match, 'orgVdcName');
      
      if (name && href && id) {
        records.push({
          name,
          id,
          href,
          gatewayType,
          orgVdcName
        });
      }
    });
  }
  
  return records;
}

async function testFirewallEndpoints(client: ZettagridClient, zone: string, gateway: EdgeGatewayRecord): Promise<void> {
  console.log(`     🔧 Testing firewall endpoints for ${gateway.name}...`);
  
  const endpoints = [
    `/edgeGateway/${gateway.id}`,
    `/admin/edgeGateway/${gateway.id}`,
    `/edgeGateway/${gateway.id}/firewall/config`,
    `/admin/edgeGateway/${gateway.id}/firewall/config`,
    `/edgeGateway/${gateway.id}/services/firewall`,
    gateway.href.replace(/.*\/api/, '') // Use the exact href path
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`       Testing: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint
      }, zone);
      
      if (result.status === 200) {
        console.log(`       ✅ ${endpoint}: SUCCESS`);
        
        // If we found a working endpoint, try to analyze the response
        if (typeof result.data === 'string' && result.data.includes('firewall')) {
          console.log(`       📋 Found firewall configuration data`);
        }
      } else if (result.status === 403) {
        console.log(`       🔒 ${endpoint}: FORBIDDEN (may need different permissions)`);
      } else if (result.status === 404) {
        console.log(`       ❌ ${endpoint}: NOT FOUND`);
      } else {
        console.log(`       ⚠️  ${endpoint}: HTTP ${result.status}`);
      }
    } catch (error) {
      console.log(`       ❌ ${endpoint}: ERROR - ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }
}

async function testOrganizationFirewall(client: ZettagridClient, zone: string): Promise<void> {
  const orgEndpoints = [
    '/org',
    '/admin/org',
    '/admin/orgs/query'
  ];
  
  for (const endpoint of orgEndpoints) {
    try {
      console.log(`   Testing: ${endpoint}`);
      const result = await client.makeRequest({
        method: 'GET',
        url: endpoint
      }, zone);
      
      if (result.status === 200) {
        console.log(`   ✅ ${endpoint}: SUCCESS`);
        if (typeof result.data === 'string' && result.data.includes('org')) {
          // Try to find organization-specific firewall endpoints
          console.log(`   📋 Organization data received`);
        }
      } else {
        console.log(`   ⚠️  ${endpoint}: HTTP ${result.status}`);
      }
    } catch (error) {
      console.log(`   ❌ ${endpoint}: ERROR`);
    }
  }
}

async function testNetworkFirewall(client: ZettagridClient, zone: string): Promise<void> {
  // Get organization networks first
  const networksResult = await client.makeRequest({
    method: 'GET',
    url: '/query',
    params: { type: 'orgNetwork', pageSize: '5' }
  }, zone);

  if (networksResult.status === 200 && typeof networksResult.data === 'string') {
    console.log('   ✅ Network query successful');
    
    // Parse network hrefs
    const networkMatches = networksResult.data.match(/href="([^"]*network[^"]*)"/gi);
    if (networkMatches && networkMatches.length > 0) {
      const networkHref = networkMatches[0].replace(/href="([^"]*)"/, '$1');
      const networkPath = networkHref.replace(/.*\/api/, '');
      
      console.log(`   🌐 Testing network firewall: ${networkPath}`);
      
      try {
        const networkResult = await client.makeRequest({
          method: 'GET',
          url: networkPath
        }, zone);
        
        if (networkResult.status === 200) {
          console.log(`   ✅ Network access successful`);
        } else {
          console.log(`   ⚠️  Network access: HTTP ${networkResult.status}`);
        }
      } catch (error) {
        console.log(`   ❌ Network access failed`);
      }
    }
  }
}

function extractAttribute(xmlElement: string, attributeName: string): string {
  const pattern = new RegExp(`${attributeName}=[\"']([^\"']*?)[\"']`, 'i');
  const match = xmlElement.match(pattern);
  return match?.[1] || '';
}

function extractIdFromHref(href: string): string {
  if (!href) return '';
  
  // Extract UUID from href
  const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (match?.[1]) return match[1];
  
  // Extract from URLs ending with IDs
  const parts = href.split('/');
  return parts[parts.length - 1] || '';
}

// Run investigation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  investigateFirewallConfiguration().catch(error => {
    console.error('Firewall investigation failed:', error);
    process.exit(1);
  });
}

export { investigateFirewallConfiguration };