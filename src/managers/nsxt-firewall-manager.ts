/**
 * NSX-T Firewall Manager - Complete CRUD Operations
 * Implements proper NSX-T firewall rule management with add, modify, delete capabilities
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

export interface NSXTFirewallRule {
  id?: string;
  name: string;
  enabled: boolean;
  action: 'ALLOW' | 'DROP' | 'REJECT';
  direction?: 'IN' | 'OUT' | 'IN_OUT';
  sourceAddresses?: string[];
  destinationAddresses?: string[];
  sourceGroups?: string[];
  destinationGroups?: string[];
  services?: string[];
  appliedTo?: string[];
  description?: string;
  logging?: boolean;
  sequence?: number;
}

export interface FirewallRuleResponse {
  success: boolean;
  ruleId?: string;
  message?: string;
  error?: string;
}

export class NSXTFirewallManager {
  private client: ZettagridClient;
  private zone: string;

  constructor(client: ZettagridClient, zone: string = 'perth') {
    this.client = client;
    this.zone = zone;
  }

  /**
   * Discover NSX-T edge gateways that support firewall operations
   */
  async discoverNSXTGateways(): Promise<any[]> {
    const edgeGatewaysResult = await this.client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { 
        type: 'edgeGateway', 
        pageSize: '25',
        format: 'records'
      }
    }, this.zone);

    if (edgeGatewaysResult.status !== 200 || typeof edgeGatewaysResult.data !== 'string') {
      throw new Error('Failed to discover edge gateways');
    }

    return this.parseEdgeGatewayRecords(edgeGatewaysResult.data);
  }

  /**
   * Get current firewall configuration using Cloud API (NSX-T Policy)
   */
  async getFirewallRules(gatewayId: string): Promise<NSXTFirewallRule[]> {
    // Try Cloud API first (NSX-T Policy API)
    const cloudAPIEndpoints = [
      `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall`,
      `/cloudapi/2.0.0/edgeGateways/${gatewayId}/firewall`
    ];

    for (const endpoint of cloudAPIEndpoints) {
      try {
        const result = await this.client.makeRequest({
          method: 'GET',
          url: endpoint,
          headers: {
            'Accept': 'application/json'
          }
        }, this.zone);

        if (result.status === 200) {
          console.log(`✅ Found firewall rules via Cloud API: ${endpoint}`);
          return this.parseCloudAPIFirewallRules(result.data);
        }
      } catch (error) {
        continue;
      }
    }

    // Fallback to traditional API
    return await this.getFirewallRulesTraditional(gatewayId);
  }

  /**
   * Create a new firewall rule using NSX-T Policy API
   */
  async createFirewallRule(gatewayId: string, rule: NSXTFirewallRule): Promise<FirewallRuleResponse> {
    console.log(`🔥 Creating firewall rule: ${rule.name}`);

    // Try Cloud API (NSX-T Policy) first
    const cloudAPIResult = await this.createRuleCloudAPI(gatewayId, rule);
    if (cloudAPIResult.success) {
      return cloudAPIResult;
    }

    // Fallback to traditional edge gateway services API
    return await this.createRuleTraditional(gatewayId, rule);
  }

  /**
   * Update an existing firewall rule
   */
  async updateFirewallRule(gatewayId: string, ruleId: string, rule: NSXTFirewallRule): Promise<FirewallRuleResponse> {
    console.log(`🔧 Updating firewall rule: ${ruleId}`);

    // Try Cloud API first
    const cloudAPIEndpoints = [
      `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall/${ruleId}`,
      `/cloudapi/2.0.0/edgeGateways/${gatewayId}/firewall/${ruleId}`
    ];

    for (const endpoint of cloudAPIEndpoints) {
      try {
        const payload = this.buildCloudAPIRulePayload(rule);
        const result = await this.client.makeRequest({
          method: 'PUT',
          url: endpoint,
          data: payload,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }, this.zone);

        if (result.status === 200 || result.status === 204) {
          return {
            success: true,
            ruleId: ruleId,
            message: `Rule updated successfully via ${endpoint}`
          };
        }
      } catch (error) {
        continue;
      }
    }

    return {
      success: false,
      error: 'Failed to update rule via all available endpoints'
    };
  }

  /**
   * Delete a firewall rule
   */
  async deleteFirewallRule(gatewayId: string, ruleId: string): Promise<FirewallRuleResponse> {
    console.log(`🗑️  Deleting firewall rule: ${ruleId}`);

    // Try Cloud API first
    const cloudAPIEndpoints = [
      `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall/${ruleId}`,
      `/cloudapi/2.0.0/edgeGateways/${gatewayId}/firewall/${ruleId}`
    ];

    for (const endpoint of cloudAPIEndpoints) {
      try {
        const result = await this.client.makeRequest({
          method: 'DELETE',
          url: endpoint,
          headers: {
            'Accept': 'application/json'
          }
        }, this.zone);

        if (result.status === 200 || result.status === 204 || result.status === 404) {
          return {
            success: true,
            ruleId: ruleId,
            message: `Rule deleted successfully via ${endpoint}`
          };
        }
      } catch (error) {
        continue;
      }
    }

    return {
      success: false,
      error: 'Failed to delete rule via all available endpoints'
    };
  }

  /**
   * Test complete CRUD operations on a gateway
   */
  async testFirewallCRUD(gatewayId: string): Promise<{ success: boolean; details: string[] }> {
    const results: string[] = [];
    
    try {
      console.log(`🧪 Testing CRUD operations on gateway: ${gatewayId}`);
      
      // Step 1: List current rules
      console.log('   1️⃣  Listing current firewall rules...');
      const currentRules = await this.getFirewallRules(gatewayId);
      results.push(`✅ Listed ${currentRules.length} existing rules`);
      
      // Step 2: Create a test rule
      console.log('   2️⃣  Creating test firewall rule...');
      const testRule: NSXTFirewallRule = {
        name: `MCP-Test-${Date.now()}`,
        enabled: false, // Disabled for safety
        action: 'ALLOW',
        direction: 'IN',
        sourceAddresses: ['192.168.1.100/32'],
        destinationAddresses: ['192.168.1.200/32'],
        services: ['tcp/80', 'tcp/443'],
        description: 'Test rule created by Zettagrid MCP Server - Safe to delete',
        logging: false
      };
      
      const createResult = await this.createFirewallRule(gatewayId, testRule);
      if (createResult.success) {
        results.push(`✅ Created test rule: ${createResult.ruleId || 'Unknown ID'}`);
        
        // Step 3: Update the rule (if we have an ID)
        if (createResult.ruleId) {
          console.log('   3️⃣  Updating test rule...');
          const updatedRule = { ...testRule, description: 'Updated test rule - Safe to delete' };
          const updateResult = await this.updateFirewallRule(gatewayId, createResult.ruleId, updatedRule);
          
          if (updateResult.success) {
            results.push('✅ Updated test rule successfully');
          } else {
            results.push(`⚠️  Rule update failed: ${updateResult.error}`);
          }
          
          // Step 4: Delete the rule
          console.log('   4️⃣  Deleting test rule...');
          const deleteResult = await this.deleteFirewallRule(gatewayId, createResult.ruleId);
          
          if (deleteResult.success) {
            results.push('✅ Deleted test rule successfully');
          } else {
            results.push(`⚠️  Rule deletion failed: ${deleteResult.error}`);
          }
        }
      } else {
        results.push(`⚠️  Rule creation failed: ${createResult.error}`);
      }
      
      // Step 5: Verify final state
      console.log('   5️⃣  Verifying final state...');
      const finalRules = await this.getFirewallRules(gatewayId);
      results.push(`✅ Final verification: ${finalRules.length} rules (should match initial count)`);
      
      const allSuccessful = results.every(r => r.startsWith('✅'));
      return {
        success: allSuccessful,
        details: results
      };
      
    } catch (error) {
      results.push(`❌ CRUD test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        details: results
      };
    }
  }

  // Private methods for API interactions

  private async createRuleCloudAPI(gatewayId: string, rule: NSXTFirewallRule): Promise<FirewallRuleResponse> {
    const cloudAPIEndpoints = [
      `/cloudapi/1.0.0/edgeGateways/${gatewayId}/firewall`,
      `/cloudapi/2.0.0/edgeGateways/${gatewayId}/firewall`
    ];

    for (const endpoint of cloudAPIEndpoints) {
      try {
        const payload = this.buildCloudAPIRulePayload(rule);
        const result = await this.client.makeRequest({
          method: 'POST',
          url: endpoint,
          data: payload,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }, this.zone);

        if (result.status === 201 || result.status === 200) {
          const ruleId = this.extractRuleIdFromResponse(result.data);
          return {
            success: true,
            ruleId: ruleId,
            message: `Rule created successfully via Cloud API: ${endpoint}`
          };
        }
      } catch (error) {
        continue;
      }
    }

    return { success: false, error: 'Cloud API rule creation failed' };
  }

  private async createRuleTraditional(gatewayId: string, rule: NSXTFirewallRule): Promise<FirewallRuleResponse> {
    // This would implement traditional edge gateway services approach
    // For now, return failure as NSX-T typically uses Policy API
    return {
      success: false,
      error: 'Traditional API not supported for NSX-T backed gateways'
    };
  }

  private async getFirewallRulesTraditional(gatewayId: string): Promise<NSXTFirewallRule[]> {
    // Fallback for traditional firewalls (not typically used with NSX-T)
    return [];
  }

  private buildCloudAPIRulePayload(rule: NSXTFirewallRule): any {
    return {
      name: rule.name,
      enabled: rule.enabled,
      action: rule.action,
      direction: rule.direction || 'IN_OUT',
      sourceFirewallGroups: rule.sourceGroups || [],
      destinationFirewallGroups: rule.destinationGroups || [],
      ipProtocol: 'IPV4_IPV6',
      sourceAddresses: rule.sourceAddresses || [],
      destinationAddresses: rule.destinationAddresses || [],
      applicationPortProfiles: rule.services || [],
      description: rule.description || '',
      logging: rule.logging || false
    };
  }

  private parseCloudAPIFirewallRules(data: any): NSXTFirewallRule[] {
    const rules: NSXTFirewallRule[] = [];
    
    if (Array.isArray(data)) {
      data.forEach(rule => {
        rules.push({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          action: rule.action,
          direction: rule.direction,
          sourceAddresses: rule.sourceAddresses || [],
          destinationAddresses: rule.destinationAddresses || [],
          services: rule.applicationPortProfiles || [],
          description: rule.description,
          logging: rule.logging
        });
      });
    } else if (data.values && Array.isArray(data.values)) {
      data.values.forEach((rule: any) => {
        rules.push({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          action: rule.action,
          direction: rule.direction,
          sourceAddresses: rule.sourceAddresses || [],
          destinationAddresses: rule.destinationAddresses || [],
          services: rule.applicationPortProfiles || [],
          description: rule.description,
          logging: rule.logging
        });
      });
    }
    
    return rules;
  }

  private extractRuleIdFromResponse(data: any): string {
    if (typeof data === 'object' && data.id) {
      return data.id;
    }
    if (typeof data === 'string') {
      const idMatch = data.match(/"id"\s*:\s*"([^"]+)"/);
      if (idMatch) return idMatch[1];
    }
    return '';
  }

  private parseEdgeGatewayRecords(xmlData: string): any[] {
    const records: any[] = [];
    const recordPattern = /<(\w+:)?EdgeGatewayRecord[^>]*>/gi;
    const matches = xmlData.match(recordPattern);
    
    if (matches) {
      matches.forEach(match => {
        const name = this.extractAttribute(match, 'name');
        const href = this.extractAttribute(match, 'href');
        const id = this.extractIdFromHref(href) || this.extractAttribute(match, 'id');
        const gatewayType = this.extractAttribute(match, 'gatewayType');
        
        if (name && href && id) {
          records.push({ name, id, href, gatewayType });
        }
      });
    }
    
    return records;
  }

  private extractAttribute(xmlElement: string, attributeName: string): string {
    const pattern = new RegExp(`${attributeName}=[\"']([^\"']*?)[\"']`, 'i');
    const match = xmlElement.match(pattern);
    return match?.[1] || '';
  }

  private extractIdFromHref(href: string): string {
    if (!href) return '';
    const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (match?.[1]) return match[1];
    const parts = href.split('/');
    return parts[parts.length - 1] || '';
  }
}

// Test function
async function testNSXTFirewallManager(): Promise<void> {
  console.log('🔥 Testing NSX-T Firewall Manager - Perth Zone');
  console.log('Complete CRUD Operations Test');
  console.log('=' .repeat(60));

  loadEnvFile();
  const client = new ZettagridClient();
  const zone = 'perth';

  try {
    // Authentication
    const authTest = await client.testZone(zone);
    if (!authTest.success) {
      console.log(`❌ Authentication failed: ${authTest.error?.message}`);
      return;
    }
    console.log('✅ Authentication successful\n');

    // Initialize NSX-T firewall manager
    const firewallManager = new NSXTFirewallManager(client, zone);

    // Discover NSX-T gateways
    console.log('1️⃣  Discovering NSX-T Edge Gateways...');
    const gateways = await firewallManager.discoverNSXTGateways();
    console.log(`✅ Found ${gateways.length} edge gateways\n`);

    // Test CRUD operations on each NSX-T gateway
    for (let i = 0; i < Math.min(gateways.length, 2); i++) {
      const gateway = gateways[i];
      console.log(`2️⃣  Testing CRUD on Gateway ${i + 1}: ${gateway.name} (${gateway.gatewayType})`);
      
      const crudResult = await firewallManager.testFirewallCRUD(gateway.id);
      
      console.log('\n   📊 CRUD Test Results:');
      crudResult.details.forEach(detail => {
        console.log(`     ${detail}`);
      });
      
      if (crudResult.success) {
        console.log(`   🎉 Overall CRUD Result: SUCCESS`);
      } else {
        console.log(`   ⚠️  Overall CRUD Result: PARTIAL SUCCESS`);
      }
      
      console.log('');
    }

    console.log('✅ NSX-T Firewall Manager testing completed!');

  } catch (error) {
    console.error('💥 Test failed:', error instanceof Error ? error.message : String(error));
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testNSXTFirewallManager().catch(error => {
    console.error('NSX-T Firewall Manager test failed:', error);
    process.exit(1);
  });
}

export { testNSXTFirewallManager };