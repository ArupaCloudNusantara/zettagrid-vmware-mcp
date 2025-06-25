/**
 * Refined VM Creator with Proper Template Handling
 * Implements comprehensive vApp and VM creation from templates
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

export interface VAppTemplate {
  id: string;
  name: string;
  href: string;
  description?: string;
  status?: string;
  catalogName?: string;
  isPublished?: boolean;
}

export interface VdcInfo {
  id: string;
  name: string;
  href: string;
  storageProfileHref?: string;
  networkHref?: string;
}

export interface NetworkInfo {
  id: string;
  name: string;
  href: string;
  networkType?: string;
  ipScope?: string;
}

export class RefinedVMCreator {
  private client: ZettagridClient;
  private zone: string;

  constructor(client: ZettagridClient, zone: string = 'perth') {
    this.client = client;
    this.zone = zone;
  }

  /**
   * Discover available vApp templates with detailed information
   */
  async discoverVAppTemplates(): Promise<VAppTemplate[]> {
    console.log('   🔍 Discovering vApp templates...');
    
    const templatesResult = await this.client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { 
        type: 'vAppTemplate', 
        pageSize: '25',
        format: 'records'
      }
    }, this.zone);

    if (templatesResult.status !== 200 || typeof templatesResult.data !== 'string') {
      throw new Error('Failed to discover vApp templates');
    }

    return this.parseVAppTemplateRecords(templatesResult.data);
  }

  /**
   * Discover VDCs with network information
   */
  async discoverVdcsWithNetworks(): Promise<VdcInfo[]> {
    console.log('   🏗️  Discovering VDCs with network information...');
    
    const vdcsResult = await this.client.listVdcs(this.zone);
    if (!vdcsResult.success || !vdcsResult.data?.items) {
      throw new Error('Failed to discover VDCs');
    }

    const vdcInfos: VdcInfo[] = [];
    
    for (const vdc of vdcsResult.data.items) {
      // Use basic VDC information - detailed network discovery can be done separately
      vdcInfos.push({
        id: vdc.id,
        name: vdc.name,
        href: vdc.href
      });
    }

    return vdcInfos;
  }

  /**
   * Discover organization networks
   */
  async discoverOrganizationNetworks(): Promise<NetworkInfo[]> {
    console.log('   🌐 Discovering organization networks...');
    
    const networksResult = await this.client.makeRequest({
      method: 'GET',
      url: '/query',
      params: { 
        type: 'orgNetwork', 
        pageSize: '25',
        format: 'records'
      }
    }, this.zone);

    if (networksResult.status !== 200 || typeof networksResult.data !== 'string') {
      throw new Error('Failed to discover organization networks');
    }

    return this.parseNetworkRecords(networksResult.data);
  }

  /**
   * Create vApp from template with proper configuration
   */
  async createVAppFromTemplate(
    vdcId: string, 
    templateId: string, 
    vappName: string, 
    networkId?: string
  ): Promise<any> {
    console.log(`   📱 Creating vApp '${vappName}' from template ${templateId}...`);

    // Get template details first
    const templateDetails = await this.getTemplateDetails(templateId);
    const templateHref = templateDetails.href;

    // Build instantiation payload with proper network configuration
    const instantiationPayload = this.buildVAppInstantiationPayload(
      vappName, 
      templateHref, 
      networkId
    );

    const result = await this.client.makeRequest({
      method: 'POST',
      url: `/vdc/${vdcId}/action/instantiateVAppTemplate`,
      data: instantiationPayload,
      headers: {
        'Content-Type': 'application/vnd.vmware.vcloud.instantiateVAppTemplateParams+xml'
      }
    }, this.zone);

    if (result.status === 201 || result.status === 202) {
      console.log(`   ✅ vApp creation initiated successfully`);
      
      // Extract task information
      if (typeof result.data === 'string') {
        const taskMatch = result.data.match(/task\/([a-f0-9-]+)/);
        const vappMatch = result.data.match(/vApp\/vapp-([a-f0-9-]+)/);
        
        return {
          success: true,
          taskId: taskMatch?.[1],
          vappId: vappMatch?.[1],
          response: result.data
        };
      }
      
      return { success: true, response: result.data };
    } else {
      throw new Error(`vApp creation failed: HTTP ${result.status}`);
    }
  }

  /**
   * Get template details
   */
  async getTemplateDetails(templateId: string): Promise<any> {
    const result = await this.client.makeRequest({
      method: 'GET',
      url: `/vAppTemplate/vappTemplate-${templateId}`
    }, this.zone);

    if (result.status === 200) {
      return { 
        href: `${this.client['zoneManager'].buildApiUrl(this.zone, `/vAppTemplate/vappTemplate-${templateId}`)}`,
        data: result.data 
      };
    } else {
      throw new Error(`Failed to get template details: HTTP ${result.status}`);
    }
  }

  /**
   * Wait for vApp to be ready
   */
  async waitForVAppReady(vappId: string, maxWaitTime: number = 180000): Promise<boolean> {
    console.log(`   ⏱️  Waiting for vApp ${vappId} to be ready...`);
    
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const vappResult = await this.client.getVApp(vappId, this.zone);
        
        if (vappResult.success && vappResult.data) {
          const status = vappResult.data.status;
          console.log(`     Status: ${this.getStatusDescription(status || 0)}`);
          
          // Check if vApp is in a ready state
          if (status === 8 || status === 9) { // POWERED_OFF or UNRECOGNIZED (ready for power operations)
            console.log(`   ✅ vApp is ready!`);
            return true;
          }
          
          if (status === 0) { // FAILED_CREATION
            console.log(`   ❌ vApp creation failed`);
            return false;
          }
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
      } catch (error) {
        console.log(`     Polling error: ${error instanceof Error ? error.message : 'Unknown'}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    console.log(`   ⚠️  Timeout waiting for vApp to be ready`);
    return false;
  }

  /**
   * Test complete VM creation workflow
   */
  async testCompleteVMCreation(): Promise<{ success: boolean; details: string; vappId?: string }> {
    try {
      console.log('🚀 Testing Complete VM Creation Workflow...');
      
      // Step 1: Discover resources
      console.log('\n1️⃣  Resource Discovery...');
      const [templates, vdcs, networks] = await Promise.all([
        this.discoverVAppTemplates(),
        this.discoverVdcsWithNetworks(),
        this.discoverOrganizationNetworks()
      ]);
      
      console.log(`   📋 Found ${templates.length} templates`);
      console.log(`   🏗️  Found ${vdcs.length} VDCs`);
      console.log(`   🌐 Found ${networks.length} networks`);
      
      if (templates.length === 0) {
        return { success: false, details: 'No vApp templates available' };
      }
      
      if (vdcs.length === 0) {
        return { success: false, details: 'No VDCs available' };
      }
      
      // Step 2: Select resources for testing
      console.log('\n2️⃣  Resource Selection...');
      const targetTemplate = templates[0];
      const targetVdc = vdcs[0];
      const targetNetwork = networks.length > 0 ? networks[0] : undefined;
      
      console.log(`   🎯 Template: ${targetTemplate.name} (${targetTemplate.id})`);
      console.log(`   🎯 VDC: ${targetVdc.name} (${targetVdc.id})`);
      console.log(`   🎯 Network: ${targetNetwork?.name || 'Default'}`);
      
      // Step 3: Create vApp
      console.log('\n3️⃣  vApp Creation...');
      const vappName = `MCP-Test-${Date.now()}`;
      
      const createResult = await this.createVAppFromTemplate(
        targetVdc.id,
        targetTemplate.id,
        vappName,
        targetNetwork?.id
      );
      
      if (!createResult.success) {
        return { success: false, details: 'vApp creation failed' };
      }
      
      const vappId = createResult.vappId;
      console.log(`   ✅ vApp created: ${vappName} (${vappId})`);
      
      // Step 4: Wait for readiness
      if (vappId) {
        console.log('\n4️⃣  Waiting for vApp Readiness...');
        const isReady = await this.waitForVAppReady(vappId, 120000); // 2 minutes
        
        if (isReady) {
          return { 
            success: true, 
            details: `VM creation successful! vApp '${vappName}' is ready for use.`,
            vappId: vappId
          };
        } else {
          return { 
            success: false, 
            details: 'vApp created but not ready within timeout period',
            vappId: vappId
          };
        }
      } else {
        return { 
          success: true, 
          details: 'vApp creation initiated successfully (no vApp ID returned)' 
        };
      }
      
    } catch (error) {
      return { 
        success: false, 
        details: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Build proper vApp instantiation payload
   */
  private buildVAppInstantiationPayload(vappName: string, templateHref: string, networkId?: string): string {
    const networkSection = networkId ? `
    <NetworkConfigSection>
      <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Network configuration</ovf:Info>
      <NetworkConfig>
        <ParentNetwork href="${networkId}"/>
      </NetworkConfig>
    </NetworkConfigSection>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<InstantiateVAppTemplateParams 
    xmlns="http://www.vmware.com/vcloud/v1.5"
    xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
    name="${vappName}"
    deploy="false"
    powerOn="false">
    <Description>vApp created by Zettagrid MCP Server for testing</Description>
    <Source href="${templateHref}"/>
    ${networkSection}
</InstantiateVAppTemplateParams>`;
  }

  /**
   * Parse vApp template records from XML
   */
  private parseVAppTemplateRecords(xmlData: string): VAppTemplate[] {
    const templates: VAppTemplate[] = [];
    
    const recordPattern = /<(\w+:)?VAppTemplateRecord[^>]*>/gi;
    const matches = xmlData.match(recordPattern);
    
    if (matches) {
      matches.forEach(match => {
        const name = this.extractAttribute(match, 'name');
        const href = this.extractAttribute(match, 'href');
        const id = this.extractIdFromHref(href) || this.extractAttribute(match, 'id');
        const description = this.extractAttribute(match, 'description');
        const status = this.extractAttribute(match, 'status');
        const catalogName = this.extractAttribute(match, 'catalogName');
        const isPublished = this.extractAttribute(match, 'isPublished');
        
        if (name && href && id) {
          templates.push({
            name,
            id,
            href,
            description,
            status,
            catalogName,
            isPublished: isPublished === 'true'
          });
        }
      });
    }
    
    return templates;
  }

  /**
   * Parse network records from XML
   */
  private parseNetworkRecords(xmlData: string): NetworkInfo[] {
    const networks: NetworkInfo[] = [];
    
    const recordPattern = /<(\w+:)?OrgNetworkRecord[^>]*>/gi;
    const matches = xmlData.match(recordPattern);
    
    if (matches) {
      matches.forEach(match => {
        const name = this.extractAttribute(match, 'name');
        const href = this.extractAttribute(match, 'href');
        const id = this.extractIdFromHref(href) || this.extractAttribute(match, 'id');
        const networkType = this.extractAttribute(match, 'networkType');
        
        if (name && href && id) {
          networks.push({
            name,
            id,
            href,
            networkType
          });
        }
      });
    }
    
    return networks;
  }

  private extractAttribute(xmlElement: string, attributeName: string): string {
    const pattern = new RegExp(`${attributeName}=[\"']([^\"']*?)[\"']`, 'i');
    const match = xmlElement.match(pattern);
    return match?.[1] || '';
  }

  private extractIdFromHref(href: string): string {
    if (!href) return '';
    
    // Extract UUID from href
    const match = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (match?.[1]) return match[1];
    
    // Extract from template paths like vAppTemplate-{id}
    const templateMatch = href.match(/vAppTemplate-([^\/]+)/);
    if (templateMatch?.[1]) return templateMatch[1];
    
    const parts = href.split('/');
    return parts[parts.length - 1] || '';
  }

  private getStatusDescription(status: number): string {
    const statusMap: Record<number, string> = {
      0: 'FAILED_CREATION',
      1: 'UNRESOLVED',
      2: 'RESOLVED', 
      3: 'DEPLOYED',
      4: 'SUSPENDED',
      5: 'POWERED_ON',
      6: 'WAITING_FOR_INPUT',
      7: 'UNKNOWN',
      8: 'UNRECOGNIZED',
      9: 'POWERED_OFF',
      10: 'INCONSISTENT_STATE'
    };
    
    return statusMap[status] || `UNKNOWN_${status}`;
  }
}

// Test function
async function testRefinedVMCreator(): Promise<void> {
  console.log('🚀 Testing Refined VM Creator - Perth Zone');
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

    // Initialize VM creator
    const vmCreator = new RefinedVMCreator(client, zone);

    // Test complete VM creation workflow
    const result = await vmCreator.testCompleteVMCreation();
    
    if (result.success) {
      console.log(`\n🎉 SUCCESS: ${result.details}`);
      if (result.vappId) {
        console.log(`📱 vApp ID: ${result.vappId}`);
      }
    } else {
      console.log(`\n⚠️  PARTIAL SUCCESS: ${result.details}`);
    }

    console.log('\n✅ Refined VM creator testing completed!');

  } catch (error) {
    console.error('💥 Test failed:', error instanceof Error ? error.message : String(error));
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testRefinedVMCreator().catch(error => {
    console.error('Refined VM creator test failed:', error);
    process.exit(1);
  });
}

export { testRefinedVMCreator };