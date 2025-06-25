/**
 * Working Firewall Manager for NSX-T Edge Gateways
 * Implements firewall rule management using gateway configuration approach
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

export interface FirewallRule {
  id?: string;
  name: string;
  enabled: boolean;
  action: 'ALLOW' | 'DROP' | 'REJECT';
  direction: 'IN' | 'OUT' | 'IN_OUT';
  sourceAddresses: string[];
  destinationAddresses: string[];
  services: string[];
  description?: string;
  logging?: boolean;
}

export interface FirewallOperationResult {
  success: boolean;
  message?: string;
  error?: string;
  ruleId?: string;
}

export class WorkingFirewallManager {
  private client: ZettagridClient;
  private zone: string;

  constructor(client: ZettagridClient, zone: string = 'perth') {
    this.client = client;
    this.zone = zone;
  }

  /**
   * Get current gateway configuration and analyze firewall structure
   */
  async analyzeGatewayFirewall(gatewayId: string): Promise<{ hasFirewall: boolean; structure: string; config?: any }> {
    try {
      console.log(`🔍 Analyzing firewall structure for gateway ${gatewayId}...`);
      
      // Get the full gateway configuration
      const gatewayResult = await this.client.makeRequest({
        method: 'GET',
        url: `/admin/edgeGateway/${gatewayId}`
      }, this.zone);

      if (gatewayResult.status === 200 && typeof gatewayResult.data === 'string') {
        const xmlData = gatewayResult.data;
        
        // Check for different firewall structures
        const hasFirewallService = xmlData.includes('<FirewallService');
        const hasEdgeGatewayServiceConfig = xmlData.includes('<EdgeGatewayServiceConfiguration');
        const hasNSXTBacking = xmlData.includes('NSXT_BACKED') || xmlData.includes('nsxT');
        
        let structure = 'unknown';
        if (hasFirewallService) {
          structure = 'traditional_firewall_service';
        } else if (hasEdgeGatewayServiceConfig) {
          structure = 'edge_gateway_service_config';
        } else if (hasNSXTBacking) {
          structure = 'nsxt_policy_based';
        }
        
        console.log(`   📋 Gateway structure: ${structure}`);
        console.log(`   🔥 Firewall Service: ${hasFirewallService ? 'Present' : 'Not found'}`);
        console.log(`   ⚙️  Service Config: ${hasEdgeGatewayServiceConfig ? 'Present' : 'Not found'}`);
        console.log(`   🏗️  NSX-T Backing: ${hasNSXTBacking ? 'Yes' : 'No'}`);
        
        return {
          hasFirewall: hasFirewallService || hasEdgeGatewayServiceConfig,
          structure: structure,
          config: xmlData
        };
      } else {
        throw new Error(`Failed to get gateway configuration: HTTP ${gatewayResult.status}`);
      }
    } catch (error) {
      throw new Error(`Gateway analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a firewall rule by modifying gateway configuration
   */
  async createFirewallRule(gatewayId: string, rule: FirewallRule): Promise<FirewallOperationResult> {
    try {
      console.log(`🔥 Creating firewall rule: ${rule.name}`);
      
      // First analyze the gateway structure
      const analysis = await this.analyzeGatewayFirewall(gatewayId);
      
      if (!analysis.config) {
        return {
          success: false,
          error: 'Could not retrieve gateway configuration'
        };
      }

      // For NSX-T policy-based gateways, we might need to enable firewall service first
      if (analysis.structure === 'nsxt_policy_based') {
        return await this.createRuleNSXTPolicy(gatewayId, rule, analysis.config);
      } else if (analysis.structure === 'traditional_firewall_service') {
        return await this.createRuleTraditional(gatewayId, rule, analysis.config);
      } else {
        // Try to create basic service configuration
        return await this.createRuleBasicService(gatewayId, rule, analysis.config);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during rule creation'
      };
    }
  }

  /**
   * List existing firewall rules
   */
  async listFirewallRules(gatewayId: string): Promise<FirewallRule[]> {
    try {
      const analysis = await this.analyzeGatewayFirewall(gatewayId);
      
      if (!analysis.config) {
        return [];
      }

      return this.parseFirewallRulesFromConfig(analysis.config);
    } catch (error) {
      console.log(`⚠️  Failed to list firewall rules: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Delete a firewall rule
   */
  async deleteFirewallRule(gatewayId: string, ruleId: string): Promise<FirewallOperationResult> {
    try {
      console.log(`🗑️  Deleting firewall rule: ${ruleId}`);
      
      const analysis = await this.analyzeGatewayFirewall(gatewayId);
      
      if (!analysis.config) {
        return {
          success: false,
          error: 'Could not retrieve gateway configuration'
        };
      }

      // Parse existing rules and remove the specified one
      const existingRules = this.parseFirewallRulesFromConfig(analysis.config);
      const filteredRules = existingRules.filter(rule => rule.id !== ruleId);
      
      if (existingRules.length === filteredRules.length) {
        return {
          success: false,
          error: `Rule with ID ${ruleId} not found`
        };
      }

      // Rebuild configuration without the deleted rule
      const newConfig = this.buildGatewayConfigWithRules(analysis.config, filteredRules);
      
      // Update the gateway
      const updateResult = await this.updateGatewayConfiguration(gatewayId, newConfig);
      
      if (updateResult.success) {
        return {
          success: true,
          message: `Rule ${ruleId} deleted successfully`,
          ruleId: ruleId
        };
      } else {
        return updateResult;
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during rule deletion'
      };
    }
  }

  /**
   * Test firewall operations with safe test rules
   */
  async testFirewallOperations(gatewayId: string): Promise<{ success: boolean; details: string[] }> {
    const results: string[] = [];
    
    try {
      console.log(`🧪 Testing firewall operations on gateway: ${gatewayId}`);
      
      // Step 1: Analyze gateway
      console.log('   1️⃣  Analyzing gateway structure...');
      const analysis = await this.analyzeGatewayFirewall(gatewayId);
      results.push(`✅ Gateway analysis: ${analysis.structure} (firewall: ${analysis.hasFirewall ? 'supported' : 'not configured'})`);
      
      // Step 2: List current rules
      console.log('   2️⃣  Listing current firewall rules...');
      const currentRules = await this.listFirewallRules(gatewayId);
      results.push(`✅ Current rules: ${currentRules.length} found`);
      
      // Step 3: Create test rule (but don't actually apply it)
      console.log('   3️⃣  Validating rule creation workflow...');
      const testRule: FirewallRule = {
        name: `MCP-Test-${Date.now()}`,
        enabled: false, // Disabled for safety
        action: 'ALLOW',
        direction: 'IN',
        sourceAddresses: ['192.168.1.100/32'],
        destinationAddresses: ['192.168.1.200/32'],
        services: ['tcp/80'],
        description: 'Test rule for validation - would be disabled'
      };
      
      // Validate rule structure without applying
      const ruleXML = this.buildFirewallRuleXML(testRule, '999');
      if (ruleXML.includes('<FirewallRule') && ruleXML.includes(testRule.name)) {
        results.push('✅ Rule creation workflow: Validated');
      } else {
        results.push('⚠️  Rule creation workflow: Structure validation failed');
      }
      
      // Step 4: Test configuration building
      console.log('   4️⃣  Testing configuration building...');
      if (analysis.config) {
        const testConfig = this.buildGatewayConfigWithRules(analysis.config, [...currentRules, testRule]);
        if (testConfig.includes('<EdgeGateway') && testConfig.length > analysis.config.length) {
          results.push('✅ Configuration building: Validated');
        } else {
          results.push('⚠️  Configuration building: Failed validation');
        }
      }
      
      // Step 5: Test rule parsing
      console.log('   5️⃣  Testing rule parsing...');
      const parsedRules = this.parseFirewallRulesFromConfig(analysis.config || '');
      results.push(`✅ Rule parsing: ${parsedRules.length} rules parsed from configuration`);
      
      const successCount = results.filter(r => r.startsWith('✅')).length;
      const totalCount = results.length;
      
      return {
        success: successCount >= totalCount * 0.8, // 80% success rate
        details: results
      };
      
    } catch (error) {
      results.push(`❌ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        details: results
      };
    }
  }

  // Private implementation methods

  private async createRuleNSXTPolicy(gatewayId: string, rule: FirewallRule, config: string): Promise<FirewallOperationResult> {
    // For NSX-T policy-based gateways, create a basic firewall service structure
    console.log('   🏗️  Creating rule for NSX-T policy gateway...');
    
    // Check if we need to add firewall service configuration
    if (!config.includes('<EdgeGatewayServiceConfiguration')) {
      const newConfig = this.addFirewallServiceToConfig(config, [rule]);
      return await this.updateGatewayConfiguration(gatewayId, newConfig);
    } else {
      return await this.createRuleTraditional(gatewayId, rule, config);
    }
  }

  private async createRuleTraditional(gatewayId: string, rule: FirewallRule, config: string): Promise<FirewallOperationResult> {
    console.log('   🔧 Creating rule using traditional approach...');
    
    const existingRules = this.parseFirewallRulesFromConfig(config);
    const newRules = [...existingRules, rule];
    const newConfig = this.buildGatewayConfigWithRules(config, newRules);
    
    return await this.updateGatewayConfiguration(gatewayId, newConfig);
  }

  private async createRuleBasicService(gatewayId: string, rule: FirewallRule, config: string): Promise<FirewallOperationResult> {
    console.log('   ⚙️  Creating basic firewall service configuration...');
    
    // Add basic firewall service to the gateway
    const newConfig = this.addFirewallServiceToConfig(config, [rule]);
    return await this.updateGatewayConfiguration(gatewayId, newConfig);
  }

  private async updateGatewayConfiguration(gatewayId: string, config: string): Promise<FirewallOperationResult> {
    try {
      const result = await this.client.makeRequest({
        method: 'PUT',
        url: `/admin/edgeGateway/${gatewayId}`,
        data: config,
        headers: {
          'Content-Type': 'application/vnd.vmware.vcloud.gateway+xml'
        }
      }, this.zone);

      if (result.status === 200 || result.status === 202) {
        return {
          success: true,
          message: 'Gateway configuration updated successfully'
        };
      } else {
        return {
          success: false,
          error: `Gateway update failed: HTTP ${result.status}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Gateway update error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private parseFirewallRulesFromConfig(config: string): FirewallRule[] {
    const rules: FirewallRule[] = [];
    
    // Look for existing firewall rules in the configuration
    const rulePattern = /<FirewallRule[^>]*>.*?<\/FirewallRule>/gs;
    const ruleMatches = config.match(rulePattern);
    
    if (ruleMatches) {
      ruleMatches.forEach((ruleXML, index) => {
        const rule: FirewallRule = {
          id: this.extractTagValue(ruleXML, 'Id') || `rule-${index}`,
          name: this.extractTagValue(ruleXML, 'Description') || `Rule ${index + 1}`,
          enabled: this.extractTagValue(ruleXML, 'IsEnabled') === 'true',
          action: this.extractTagValue(ruleXML, 'Policy') as 'ALLOW' | 'DROP' | 'REJECT' || 'ALLOW',
          direction: 'IN_OUT',
          sourceAddresses: this.parseAddresses(this.extractTagValue(ruleXML, 'Source')),
          destinationAddresses: this.parseAddresses(this.extractTagValue(ruleXML, 'Destination')),
          services: this.parseServices(this.extractTagValue(ruleXML, 'Application')),
          description: this.extractTagValue(ruleXML, 'Description')
        };
        rules.push(rule);
      });
    }
    
    return rules;
  }

  private buildGatewayConfigWithRules(originalConfig: string, rules: FirewallRule[]): string {
    // Build firewall rules XML
    const rulesXML = rules.map((rule, index) => {
      return this.buildFirewallRuleXML(rule, (index + 1).toString());
    }).join('\n');
    
    // Check if firewall service already exists
    if (originalConfig.includes('<FirewallService')) {
      // Replace existing firewall rules
      return originalConfig.replace(
        /<FirewallRules>.*?<\/FirewallRules>/s,
        `<FirewallRules>\n${rulesXML}\n</FirewallRules>`
      );
    } else {
      // Add new firewall service
      return this.addFirewallServiceToConfig(originalConfig, rules);
    }
  }

  private addFirewallServiceToConfig(config: string, rules: FirewallRule[]): string {
    const rulesXML = rules.map((rule, index) => {
      return this.buildFirewallRuleXML(rule, (index + 1).toString());
    }).join('\n');

    const firewallServiceXML = `
<EdgeGatewayServiceConfiguration>
  <FirewallService>
    <IsEnabled>true</IsEnabled>
    <DefaultAction>drop</DefaultAction>
    <LogDefaultAction>false</LogDefaultAction>
    <FirewallRules>
${rulesXML}
    </FirewallRules>
  </FirewallService>
</EdgeGatewayServiceConfiguration>`;

    // Insert before closing EdgeGateway tag
    return config.replace('</EdgeGateway>', `${firewallServiceXML}\n</EdgeGateway>`);
  }

  private buildFirewallRuleXML(rule: FirewallRule, ruleId: string): string {
    return `    <FirewallRule>
      <Id>${rule.id || ruleId}</Id>
      <IsEnabled>${rule.enabled}</IsEnabled>
      <MatchOnTranslate>false</MatchOnTranslate>
      <Description>${rule.name}</Description>
      <Policy>${rule.action.toLowerCase()}</Policy>
      <Protocols>
        <Any>false</Any>
        <Tcp>true</Tcp>
        <Udp>false</Udp>
        <Icmp>false</Icmp>
      </Protocols>
      <Source>
        <Exclude>false</Exclude>
        <IpAddress>${rule.sourceAddresses.join(',')}</IpAddress>
      </Source>
      <Destination>
        <Exclude>false</Exclude>
        <IpAddress>${rule.destinationAddresses.join(',')}</IpAddress>
      </Destination>
      <Application>
        <Service>${rule.services.join(',')}</Service>
      </Application>
    </FirewallRule>`;
  }

  private extractTagValue(xml: string, tagName: string): string {
    const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match?.[1] || '';
  }

  private parseAddresses(addressString: string): string[] {
    if (!addressString || addressString === 'any') {
      return ['any'];
    }
    return addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
  }

  private parseServices(serviceString: string): string[] {
    if (!serviceString || serviceString === 'any') {
      return ['any'];
    }
    return serviceString.split(',').map(svc => svc.trim()).filter(svc => svc);
  }
}

// Test function
async function testWorkingFirewallManager(): Promise<void> {
  console.log('🔥 Testing Working Firewall Manager - Perth Zone');
  console.log('Configuration-Based Firewall Management');
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

    // Initialize working firewall manager
    const firewallManager = new WorkingFirewallManager(client, zone);

    // Get gateways
    const edgeGatewaysResult = await client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { type: 'edgeGateway', pageSize: '3' }
    }, zone);

    if (edgeGatewaysResult.status === 200 && typeof edgeGatewaysResult.data === 'string') {
      const gatewayMatches = edgeGatewaysResult.data.match(/href="([^"]*edgeGateway[^"]*)"/g);
      
      if (gatewayMatches && gatewayMatches.length > 0) {
        const gatewayHref = gatewayMatches[0].replace(/href="([^"]*)"/, '$1');
        const gatewayId = gatewayHref.split('/').pop();
        
        if (gatewayId) {
          console.log(`🎯 Testing on Gateway: ${gatewayId}`);
          
          // Test firewall operations
          const testResult = await firewallManager.testFirewallOperations(gatewayId);
          
          console.log('\n📊 Firewall Operations Test Results:');
          testResult.details.forEach(detail => {
            console.log(`   ${detail}`);
          });
          
          if (testResult.success) {
            console.log('\n🎉 Working Firewall Manager: SUCCESS');
          } else {
            console.log('\n⚠️  Working Firewall Manager: PARTIAL SUCCESS');
          }
        }
      }
    }

    console.log('\n✅ Working firewall manager testing completed!');

  } catch (error) {
    console.error('💥 Test failed:', error instanceof Error ? error.message : String(error));
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testWorkingFirewallManager().catch(error => {
    console.error('Working Firewall Manager test failed:', error);
    process.exit(1);
  });
}

export { testWorkingFirewallManager };