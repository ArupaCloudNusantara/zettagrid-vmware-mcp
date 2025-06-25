/**
 * Zettagrid vCloud Director API Client
 * Provides comprehensive API access to Zettagrid's vCloud Director infrastructure
 */

import { ZoneManager } from '../managers/zone-manager.js';
import { TokenManager } from '../auth/token-manager.js';
import { ZoneAuth } from '../auth/zone-auth.js';
import { 
  ApiRequestConfig, 
  ApiResponse, 
  McpToolResponse,
  Organization,
  Vdc,
  VApp,
  Vm,
  VmConsoleTicket,
  EdgeGateway,
  FirewallRule,
  VdcResourceSummary,
  VdcResourceTable,
  VdcResourceRow,
  EdgeNetworkConfig,
  ExternalIPInfo,
  EdgeGatewayInterfaceInfo,
  UplinkInfo,
  ExternalNetworkInfo,
  ProviderNetworkInfo,
  QueryResultRecords,
  PaginationParams,
  ListResponse
} from '../types.js';
import { 
  parseVdcRecords, 
  parseVMRecords
} from '../utils/xml-parser.js';

export class ZettagridClient {
  private zoneManager: ZoneManager;
  private tokenManager: TokenManager;
  private zoneAuth: Map<string, ZoneAuth> = new Map();

  constructor() {
    this.zoneManager = new ZoneManager();
    this.tokenManager = new TokenManager();
    this.initializeZoneAuth();
  }

  /**
   * Initialize authentication for all configured zones
   */
  private initializeZoneAuth(): void {
    const availableZones = this.zoneManager.getAvailableZones();
    
    for (const zoneId of availableZones) {
      const zoneConfig = this.zoneManager.getZoneConfig(zoneId);
      const auth = ZoneAuth.create(zoneConfig, this.tokenManager);
      this.zoneAuth.set(zoneId, auth);
    }
  }

  /**
   * Get zone authentication handler
   */
  private getZoneAuth(zoneId?: string): ZoneAuth {
    const targetZone = zoneId || this.zoneManager.getConfig().defaultZone;
    const auth = this.zoneAuth.get(targetZone);
    
    if (!auth) {
      throw new Error(`No authentication handler found for zone: ${targetZone}`);
    }
    
    return auth;
  }

  /**
   * Make authenticated API request to vCloud Director
   */
  async makeRequest<T = any>(config: ApiRequestConfig, zoneId?: string): Promise<ApiResponse<T>> {
    const auth = this.getZoneAuth(zoneId);
    const zoneConfig = this.zoneManager.getZoneConfig(zoneId);
    const globalConfig = this.zoneManager.getConfig();

    try {
      // Ensure authentication is valid
      await auth.initialize();
      
      // Get authenticated headers
      const authHeaders = await auth.getAuthenticatedHeaders();
      
      // Build full URL
      const fullUrl = this.zoneManager.buildApiUrl(zoneId, config.url);
      
      // Prepare request configuration
      const requestConfig: RequestInit = {
        method: config.method,
        headers: {
          ...authHeaders,
          ...config.headers
        },
        signal: AbortSignal.timeout(config.timeout || globalConfig.timeout)
      };

      // Add body for non-GET requests
      if (config.data && config.method !== 'GET') {
        if (typeof config.data === 'string') {
          requestConfig.body = config.data;
        } else {
          requestConfig.body = JSON.stringify(config.data);
          requestConfig.headers = {
            ...requestConfig.headers,
            'Content-Type': 'application/json'
          };
        }
      }

      // Add query parameters
      const url = new URL(fullUrl);
      if (config.params) {
        Object.entries(config.params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }

      // Execute request with retry logic
      const response = await this.executeWithRetry(
        () => fetch(url.toString(), requestConfig),
        globalConfig.retryAttempts
      );

      // Parse response
      const responseData = await this.parseResponse<T>(response);

      return {
        status: response.status,
        statusText: response.statusText,
        data: responseData,
        headers: Object.fromEntries(response.headers.entries())
      };
    } catch (error) {
      throw new Error(
        `API request failed for zone ${zoneConfig.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(
    requestFn: () => Promise<Response>,
    maxRetries: number
  ): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestFn();
        
        if (response.ok || response.status < 500) {
          return response;
        }
        
        // Server error, retry if attempts remaining
        if (attempt < maxRetries) {
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
          continue;
        }
        
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries) {
          await this.delay(1000 * (attempt + 1));
          continue;
        }
      }
    }
    
    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Parse API response
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    } else if (contentType.includes('xml')) {
      return (await response.text()) as T;
    } else {
      return (await response.text()) as T;
    }
  }

  /**
   * Delay utility for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format MCP tool response
   */
  private formatMcpResponse<T>(
    data: T, 
    zoneId: string, 
    error?: { code: string; message: string; details?: any }
  ): McpToolResponse<T> {
    const zoneConfig = this.zoneManager.getZoneConfig(zoneId);
    
    const response: McpToolResponse<T> = {
      success: !error,
      metadata: {
        zone: zoneId,
        organization: zoneConfig.organizationName,
        timestamp: new Date().toISOString()
      }
    };
    
    if (error) {
      response.error = error;
    } else {
      response.data = data;
    }
    
    return response;
  }

  // === ORGANIZATION METHODS ===

  /**
   * List organizations
   */
  async listOrganizations(zoneId?: string): Promise<McpToolResponse<Organization[]>> {
    try {
      await this.makeRequest<QueryResultRecords>({
        method: 'GET',
        url: '/org'
      }, zoneId);

      // Parse organizations from XML response (simplified)
      const organizations: Organization[] = []; // TODO: Parse XML response
      
      return this.formatMcpResponse(organizations, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse([], zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_ORGANIZATIONS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list organizations',
        details: error
      });
    }
  }

  /**
   * Get organization details
   */
  async getOrganization(organizationId: string, zoneId?: string): Promise<McpToolResponse<Organization>> {
    try {
      const response = await this.makeRequest<Organization>({
        method: 'GET',
        url: `/org/${organizationId}`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as Organization, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_ORGANIZATION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get organization',
        details: error
      });
    }
  }

  // === VDC METHODS ===

  /**
   * List Virtual Data Centers
   */
  async listVdcs(zoneId?: string, pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<Vdc>>> {
    try {
      const params: Record<string, string> = { type: 'orgVdc' };
      
      if (pagination) {
        if (pagination.page) params.page = pagination.page.toString();
        if (pagination.pageSize) params.pageSize = pagination.pageSize.toString();
        if (pagination.filter) params.filter = pagination.filter;
      }

      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params
      }, zoneId);

      // Parse VDCs from XML query response
      const parsedVdcs = parseVdcRecords(response.data);
      const vdcs: Vdc[] = parsedVdcs.map(parsed => {
        const vdc: Vdc = {
          href: parsed.href,
          id: parsed.id,
          name: parsed.name,
          type: parsed.type
        };
        if (parsed.status !== undefined) {
          vdc.status = parsed.status;
        }
        if (parsed.isEnabled !== undefined) {
          vdc.isEnabled = parsed.isEnabled;
        }
        return vdc;
      });

      const listResponse: ListResponse<Vdc> = {
        items: vdcs,
        total: parsedVdcs.length,
        page: pagination?.page || 1,
        pageSize: pagination?.pageSize || 25,
        hasMore: false // For now, we get all results
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Vdc>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_VDCS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list VDCs',
        details: error
      });
    }
  }

  /**
   * Get VDC details
   */
  async getVdc(vdcId: string, zoneId?: string): Promise<McpToolResponse<Vdc>> {
    try {
      const response = await this.makeRequest<Vdc>({
        method: 'GET',
        url: `/vdc/${vdcId}`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as Vdc, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VDC_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VDC',
        details: error
      });
    }
  }

  /**
   * Show VDC resources in table format
   */
  async showVdcResources(vdcId: string, zoneId?: string): Promise<McpToolResponse<VdcResourceSummary>> {
    try {
      // Get VDC details first
      const vdcResponse = await this.makeRequest<Vdc>({
        method: 'GET',
        url: `/vdc/${vdcId}`
      }, zoneId);

      const vdc = vdcResponse.data;
      
      // Helper function to format numbers
      const formatNumber = (value?: number): string => {
        if (value === undefined || value === null) return 'N/A';
        if (value >= 1024) return `${(value / 1024).toFixed(1)}`;
        return value.toString();
      };

      // Helper function to calculate utilization percentage
      const calculateUtilization = (used?: number, allocated?: number): string => {
        if (!used || !allocated || allocated === 0) return '0%';
        return `${Math.round((used / allocated) * 100)}%`;
      };

      // Process RAM (Memory)
      const memory = vdc.computeCapacity?.memory;
      const ramRow: VdcResourceRow = {
        resource: 'RAM',
        units: memory?.units === 'MB' ? 'GB' : (memory?.units || 'MB'),
        allocated: memory?.allocated ? (memory.units === 'MB' ? formatNumber(memory.allocated / 1024) : formatNumber(memory.allocated)) : 'N/A',
        used: memory?.used ? (memory.units === 'MB' ? formatNumber(memory.used / 1024) : formatNumber(memory.used)) : 'N/A',
        available: memory?.allocated && memory?.used ? 
          (memory.units === 'MB' ? formatNumber((memory.allocated - memory.used) / 1024) : formatNumber(memory.allocated - memory.used)) : 'N/A',
        utilization: calculateUtilization(memory?.used, memory?.allocated)
      };

      // Process vCPU
      const cpu = vdc.computeCapacity?.cpu;
      const vcpuRow: VdcResourceRow = {
        resource: 'vCPU',
        units: cpu?.units || 'MHz',
        allocated: formatNumber(cpu?.allocated),
        used: formatNumber(cpu?.used),
        available: cpu?.allocated && cpu?.used ? formatNumber(cpu.allocated - cpu.used) : 'N/A',
        utilization: calculateUtilization(cpu?.used, cpu?.allocated)
      };

      // Process Storage
      const storage = vdc.storageCapacity;
      const storageRow: VdcResourceRow = {
        resource: 'Storage',
        units: storage?.units === 'MB' ? 'GB' : (storage?.units || 'MB'),
        allocated: storage?.allocated ? (storage.units === 'MB' ? formatNumber(storage.allocated / 1024) : formatNumber(storage.allocated)) : 'N/A',
        used: storage?.used ? (storage.units === 'MB' ? formatNumber(storage.used / 1024) : formatNumber(storage.used)) : 'N/A',
        available: storage?.allocated && storage?.used ? 
          (storage.units === 'MB' ? formatNumber((storage.allocated - storage.used) / 1024) : formatNumber(storage.allocated - storage.used)) : 'N/A',
        utilization: calculateUtilization(storage?.used, storage?.allocated)
      };

      // Create resource table
      const resourceTable: VdcResourceTable = {
        ram: ramRow,
        vcpu: vcpuRow,
        storage: storageRow
      };

      // Create summary
      const summary: VdcResourceSummary = {
        vdcId: vdcId,
        vdcName: vdc.name || 'Unknown VDC',
        resources: resourceTable
      };

      // Add allocation model if available
      if (vdc.allocationModel) {
        summary.allocationModel = vdc.allocationModel;
      }

      return this.formatMcpResponse(summary, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as VdcResourceSummary, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'SHOW_VDC_RESOURCES_ERROR',
        message: error instanceof Error ? error.message : 'Failed to show VDC resources',
        details: error
      });
    }
  }

  // === VAPP METHODS ===

  /**
   * List vApps
   */
  async listVApps(vdcId?: string, zoneId?: string, pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<VApp>>> {
    try {
      const params: Record<string, string> = { type: 'vApp' };
      
      if (vdcId) params.filter = `vdc==${vdcId}`;
      if (pagination) {
        if (pagination.page) params.page = pagination.page.toString();
        if (pagination.pageSize) params.pageSize = pagination.pageSize.toString();
        if (pagination.filter) params.filter = (params.filter ? `${params.filter};` : '') + pagination.filter;
      }

      const response = await this.makeRequest<QueryResultRecords>({
        method: 'GET',
        url: '/query',
        params
      }, zoneId);

      // TODO: Parse vApps from query response
      const vApps: VApp[] = [];
      const listResponse: ListResponse<VApp> = {
        items: vApps,
        total: response.data.total || 0,
        page: pagination?.page || 1,
        pageSize: pagination?.pageSize || 25,
        hasMore: (pagination?.page || 1) * (pagination?.pageSize || 25) < (response.data.total || 0)
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<VApp>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_VAPPS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list vApps',
        details: error
      });
    }
  }

  /**
   * Get vApp details
   */
  async getVApp(vAppId: string, zoneId?: string): Promise<McpToolResponse<VApp>> {
    try {
      const response = await this.makeRequest<VApp>({
        method: 'GET',
        url: `/vApp/vapp-${vAppId}`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as VApp, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get vApp',
        details: error
      });
    }
  }

  /**
   * Power on vApp
   */
  async powerOnVApp(vAppId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: `/vApp/vapp-${vAppId}/action/powerOn`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_ON_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power on vApp',
        details: error
      });
    }
  }

  /**
   * Power off vApp
   */
  async powerOffVApp(vAppId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: `/vApp/vapp-${vAppId}/action/powerOff`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_OFF_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power off vApp',
        details: error
      });
    }
  }

  // === VM METHODS ===

  /**
   * List Virtual Machines
   */
  async listVMs(vAppId?: string, zoneId?: string, pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<Vm>>> {
    try {
      const params: Record<string, string> = { type: 'vm' };
      
      if (vAppId) params.filter = `container==${vAppId}`;
      if (pagination) {
        if (pagination.page) params.page = pagination.page.toString();
        if (pagination.pageSize) params.pageSize = pagination.pageSize.toString();
        if (pagination.filter) params.filter = (params.filter ? `${params.filter};` : '') + pagination.filter;
      }

      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params
      }, zoneId);

      // Parse VMs from XML query response
      const parsedVMs = parseVMRecords(response.data);
      const vms: Vm[] = parsedVMs.map(parsed => {
        const vm: Vm = {
          href: parsed.href,
          id: parsed.id,
          name: parsed.name,
          type: parsed.type,
          vAppScopedLocalId: parsed.id
        };
        if (parsed.status !== undefined) {
          vm.status = parsed.status;
        }
        if (parsed.deployed !== undefined) {
          vm.deployed = parsed.deployed;
        }
        return vm;
      });

      const listResponse: ListResponse<Vm> = {
        items: vms,
        total: parsedVMs.length,
        page: pagination?.page || 1,
        pageSize: pagination?.pageSize || 25,
        hasMore: false
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Vm>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_VMS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list VMs',
        details: error
      });
    }
  }

  /**
   * Get VM details
   */
  async getVM(vmId: string, zoneId?: string): Promise<McpToolResponse<Vm>> {
    try {
      const response = await this.makeRequest<Vm>({
        method: 'GET',
        url: `/vApp/vm-${vmId}`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as Vm, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VM',
        details: error
      });
    }
  }

  /**
   * Power on VM
   */
  async powerOnVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: `/vApp/vm-${vmId}/action/powerOn`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_ON_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power on VM',
        details: error
      });
    }
  }

  /**
   * Power off VM
   */
  async powerOffVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: `/vApp/vm-${vmId}/action/powerOff`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_OFF_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power off VM',
        details: error
      });
    }
  }

  /**
   * Get VM console ticket
   */
  async getVMConsole(vmId: string, zoneId?: string): Promise<McpToolResponse<VmConsoleTicket>> {
    try {
      const response = await this.makeRequest<VmConsoleTicket>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/screen/action/acquireTicket`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as VmConsoleTicket, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VM_CONSOLE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VM console ticket',
        details: error
      });
    }
  }

  /**
   * Create a new vApp from template
   */
  async createVApp(vdcId: string, templateId: string, vappName: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      // vApp creation payload
      const createVAppPayload = `<?xml version="1.0" encoding="UTF-8"?>
<InstantiateVAppTemplateParams
    xmlns="http://www.vmware.com/vcloud/v1.5"
    name="${vappName}"
    deploy="false"
    powerOn="false">
    <Description>Created by Zettagrid MCP Server</Description>
    <Source href="${templateId}" />
</InstantiateVAppTemplateParams>`;

      const response = await this.makeRequest({
        method: 'POST',
        url: `/vdc/${vdcId}/action/instantiateVAppTemplate`,
        data: createVAppPayload,
        headers: {
          'Content-Type': 'application/vnd.vmware.vcloud.instantiateVAppTemplateParams+xml'
        }
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create vApp',
        details: error
      });
    }
  }

  /**
   * Create a simple VM within an existing vApp
   */
  async createVM(vappId: string, vmName: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      // Simple VM creation payload
      const createVMPayload = `<?xml version="1.0" encoding="UTF-8"?>
<RecomposeVAppParams
    xmlns="http://www.vmware.com/vcloud/v1.5"
    name="${vmName}">
    <Description>VM created by Zettagrid MCP Server</Description>
    <SourcedItem>
        <Source name="${vmName}"/>
        <InstantiationParams>
            <NetworkConnectionSection>
                <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Network configuration</ovf:Info>
            </NetworkConnectionSection>
            <GuestCustomizationSection>
                <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Guest customization</ovf:Info>
                <Enabled>true</Enabled>
                <ComputerName>${vmName}</ComputerName>
            </GuestCustomizationSection>
        </InstantiationParams>
    </SourcedItem>
</RecomposeVAppParams>`;

      const response = await this.makeRequest({
        method: 'POST',
        url: `/vApp/${vappId}/action/recomposeVApp`,
        data: createVMPayload,
        headers: {
          'Content-Type': 'application/vnd.vmware.vcloud.recomposeVAppParams+xml'
        }
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create VM',
        details: error
      });
    }
  }

  // === UTILITY METHODS ===

  /**
   * Test zone connectivity
   */
  async testZone(zoneId: string): Promise<McpToolResponse<any>> {
    try {
      const auth = this.getZoneAuth(zoneId);
      const result = await auth.testAuthentication();
      
      return this.formatMcpResponse(result, zoneId);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId, {
        code: 'ZONE_TEST_ERROR',
        message: error instanceof Error ? error.message : 'Zone test failed',
        details: error
      });
    }
  }

  /**
   * Get zone information
   */
  getZoneInfo(zoneId?: string): McpToolResponse<any> {
    try {
      const zoneConfig = this.zoneManager.getZoneConfig(zoneId);
      const zoneStats = this.zoneManager.getZoneStats();
      
      const info = {
        currentZone: zoneConfig.name,
        availableZones: zoneStats.availableZones,
        defaultZone: zoneStats.defaultZone,
        organization: zoneConfig.organizationName,
        apiVersion: zoneConfig.apiVersion,
        endpoint: zoneConfig.apiEndpoint
      };
      
      return this.formatMcpResponse(info, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'ZONE_INFO_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get zone info',
        details: error
      });
    }
  }

  // === EDGE GATEWAY AND FIREWALL METHODS ===

  /**
   * List edge gateways
   */
  async listEdgeGateways(zoneId?: string, pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<EdgeGateway>>> {
    try {
      const params: Record<string, string> = { type: 'edgeGateway' };
      
      if (pagination) {
        if (pagination.page) params.page = pagination.page.toString();
        if (pagination.pageSize) params.pageSize = pagination.pageSize.toString();
        if (pagination.filter) params.filter = pagination.filter;
      }

      const response = await this.makeRequest<QueryResultRecords>({
        method: 'GET',
        url: '/query',
        params
      }, zoneId);

      // TODO: Parse edge gateways from query response
      const edgeGateways: EdgeGateway[] = [];
      const listResponse: ListResponse<EdgeGateway> = {
        items: edgeGateways,
        total: response.data.total || 0,
        page: pagination?.page || 1,
        pageSize: pagination?.pageSize || 25,
        hasMore: (pagination?.page || 1) * (pagination?.pageSize || 25) < (response.data.total || 0)
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<EdgeGateway>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_EDGE_GATEWAYS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list edge gateways',
        details: error
      });
    }
  }

  /**
   * Get edge gateway details
   */
  async getEdgeGateway(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<EdgeGateway>> {
    try {
      const response = await this.makeRequest<EdgeGateway>({
        method: 'GET',
        url: `/admin/edgeGateway/${edgeGatewayId}`
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as EdgeGateway, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_EDGE_GATEWAY_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get edge gateway',
        details: error
      });
    }
  }

  /**
   * List firewall rules for an edge gateway
   */
  async listFirewallRules(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<ListResponse<FirewallRule>>> {
    try {
      const response = await this.makeRequest<EdgeGateway>({
        method: 'GET',
        url: `/admin/edgeGateway/${edgeGatewayId}`
      }, zoneId);

      // Extract firewall rules from edge gateway configuration
      const firewallRules = response.data.configuration?.edgeGatewayServiceConfiguration?.firewallService?.firewallRule || [];
      
      const listResponse: ListResponse<FirewallRule> = {
        items: firewallRules,
        total: firewallRules.length,
        page: 1,
        pageSize: firewallRules.length,
        hasMore: false
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<FirewallRule>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_FIREWALL_RULES_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list firewall rules',
        details: error
      });
    }
  }

  /**
   * Create a firewall rule
   */
  async createFirewallRule(
    edgeGatewayId: string, 
    firewallRule: Partial<FirewallRule>, 
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      // Create firewall rule XML payload
      const firewallRuleXml = `<?xml version="1.0" encoding="UTF-8"?>
<FirewallRule xmlns="http://www.vmware.com/vcloud/v1.5">
    <IsEnabled>${firewallRule.isEnabled || true}</IsEnabled>
    <Description>${firewallRule.description || ''}</Description>
    <Policy>${firewallRule.policy || 'allow'}</Policy>
    <Protocols>
        <Tcp>${firewallRule.protocols?.tcp || false}</Tcp>
        <Udp>${firewallRule.protocols?.udp || false}</Udp>
        <Icmp>${firewallRule.protocols?.icmp || false}</Icmp>
    </Protocols>
    <DestinationPortRange>${firewallRule.destinationPortRange || 'Any'}</DestinationPortRange>
    <DestinationIp>${firewallRule.destinationIp || 'Any'}</DestinationIp>
    <SourcePortRange>${firewallRule.sourcePortRange || 'Any'}</SourcePortRange>
    <SourceIp>${firewallRule.sourceIp || 'Any'}</SourceIp>
    <EnableLogging>${firewallRule.enableLogging || false}</EnableLogging>
</FirewallRule>`;

      const response = await this.makeRequest({
        method: 'POST',
        url: `/admin/edgeGateway/${edgeGatewayId}/action/configureServices`,
        data: firewallRuleXml,
        headers: {
          'Content-Type': 'application/vnd.vmware.vcloud.firewallRule+xml'
        }
      }, zoneId);

      return this.formatMcpResponse(response.data, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_FIREWALL_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create firewall rule',
        details: error
      });
    }
  }

  // === NETWORK CONFIGURATION METHODS ===

  /**
   * Show comprehensive edge gateway network configuration
   */
  async showEdgeNetworkConfig(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<EdgeNetworkConfig>> {
    try {
      // Get edge gateway details with network configuration
      const edgeResponse = await this.makeRequest<EdgeGateway>({
        method: 'GET',
        url: `/admin/edgeGateway/${edgeGatewayId}`
      }, zoneId);

      const edgeGateway = edgeResponse.data;
      
      // Extract network configuration information
      const config: EdgeNetworkConfig = {
        edgeGatewayId: edgeGatewayId,
        edgeGatewayName: edgeGateway.name || 'Unknown Edge Gateway',
        externalIPs: this.extractExternalIPs(edgeGateway),
        gatewayInterfaces: this.extractGatewayInterfaces(edgeGateway),
        uplinks: this.extractUplinks(edgeGateway),
        externalNetworks: await this.getExternalNetworks(zoneId),
        providerNetworks: await this.getProviderNetworks(zoneId)
      };

      return this.formatMcpResponse(config, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as EdgeNetworkConfig, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'SHOW_EDGE_NETWORK_CONFIG_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get edge network configuration',
        details: error
      });
    }
  }

  /**
   * List external networks
   */
  async listExternalNetworks(zoneId?: string): Promise<McpToolResponse<ListResponse<ExternalNetworkInfo>>> {
    try {
      const networks = await this.getExternalNetworks(zoneId);
      
      const listResponse: ListResponse<ExternalNetworkInfo> = {
        items: networks,
        total: networks.length,
        page: 1,
        pageSize: networks.length,
        hasMore: false
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<ExternalNetworkInfo>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_EXTERNAL_NETWORKS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list external networks',
        details: error
      });
    }
  }

  /**
   * Get provider network information
   */
  async getProviderNetworkInfo(zoneId?: string): Promise<McpToolResponse<ListResponse<ProviderNetworkInfo>>> {
    try {
      const networks = await this.getProviderNetworks(zoneId);
      
      const listResponse: ListResponse<ProviderNetworkInfo> = {
        items: networks,
        total: networks.length,
        page: 1,
        pageSize: networks.length,
        hasMore: false
      };

      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<ProviderNetworkInfo>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_PROVIDER_NETWORK_INFO_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get provider network information',
        details: error
      });
    }
  }

  // === PRIVATE HELPER METHODS FOR NETWORK EXTRACTION ===

  private extractExternalIPs(edgeGateway: EdgeGateway): ExternalIPInfo[] {
    const externalIPs: ExternalIPInfo[] = [];
    
    try {
      // Extract IPs from gateway interfaces
      const interfaces = edgeGateway.configuration?.gatewayInterfaces?.gatewayInterface || [];
      
      interfaces.forEach(intf => {
        if (intf.interfaceType === 'external' && intf.subnetParticipation) {
          intf.subnetParticipation.forEach(subnet => {
            if (subnet.gateway) {
              const externalIP: ExternalIPInfo = {
                ipAddress: subnet.gateway,
                isAllocated: true,
                isPrimary: true,
                usage: 'Gateway IP'
              };
              if (intf.name) externalIP.interfaceName = intf.name;
              if (intf.network?.name) externalIP.networkName = intf.network.name;
              externalIPs.push(externalIP);
            }
          });
        }
      });
    } catch (error) {
      console.warn('Failed to extract external IPs:', error);
    }
    
    return externalIPs;
  }

  private extractGatewayInterfaces(edgeGateway: EdgeGateway): EdgeGatewayInterfaceInfo[] {
    const interfaces: EdgeGatewayInterfaceInfo[] = [];
    
    try {
      const gatewayInterfaces = edgeGateway.configuration?.gatewayInterfaces?.gatewayInterface || [];
      
      gatewayInterfaces.forEach(intf => {
        const interfaceInfo: EdgeGatewayInterfaceInfo = {
          name: intf.name || 'Unknown',
          interfaceType: intf.interfaceType || 'internal',
          ipAddresses: [],
          isConnected: !!intf.network
        };

        // Add optional properties only if they exist
        if (intf.displayName) interfaceInfo.displayName = intf.displayName;
        if (intf.network?.name) interfaceInfo.networkName = intf.network.name;
        if (intf.network?.href) interfaceInfo.networkHref = intf.network.href;
        if (intf.useForDefaultRoute !== undefined) interfaceInfo.useForDefaultRoute = intf.useForDefaultRoute;

        // Extract IP addresses from subnet participation
        if (intf.subnetParticipation) {
          intf.subnetParticipation.forEach(subnet => {
            if (subnet.gateway) {
              interfaceInfo.ipAddresses.push(subnet.gateway);
              interfaceInfo.gateway = subnet.gateway;
            }
          });
        }

        // Extract rate limits
        if (intf.inRateLimit || intf.outRateLimit) {
          interfaceInfo.rateLimit = {};
          if (intf.inRateLimit) interfaceInfo.rateLimit.inbound = intf.inRateLimit;
          if (intf.outRateLimit) interfaceInfo.rateLimit.outbound = intf.outRateLimit;
        }

        interfaces.push(interfaceInfo);
      });
    } catch (error) {
      console.warn('Failed to extract gateway interfaces:', error);
    }
    
    return interfaces;
  }

  private extractUplinks(edgeGateway: EdgeGateway): UplinkInfo[] {
    const uplinks: UplinkInfo[] = [];
    
    try {
      const interfaces = edgeGateway.configuration?.gatewayInterfaces?.gatewayInterface || [];
      
      interfaces.forEach(intf => {
        if (intf.interfaceType === 'external') {
          const uplink: UplinkInfo = {
            name: intf.name || 'Unknown',
            interfaceType: intf.interfaceType,
            isConnected: !!intf.network,
            subnets: []
          };

          // Add optional properties only if they exist
          if (intf.network?.name) uplink.externalNetwork = intf.network.name;

          // Extract subnet information
          if (intf.subnetParticipation) {
            intf.subnetParticipation.forEach(subnet => {
              if (subnet.gateway) {
                uplink.subnets.push({
                  gateway: subnet.gateway,
                  netmask: '255.255.255.0', // Default, should be extracted from actual data
                  ipRanges: [],
                  primaryIp: subnet.gateway
                });
              }
            });
          }

          uplinks.push(uplink);
        }
      });
    } catch (error) {
      console.warn('Failed to extract uplinks:', error);
    }
    
    return uplinks;
  }

  private async getExternalNetworks(zoneId?: string): Promise<ExternalNetworkInfo[]> {
    const networks: ExternalNetworkInfo[] = [];
    
    try {
      // Query for external networks
      await this.makeRequest<QueryResultRecords>({
        method: 'GET',
        url: '/query',
        params: {
          type: 'externalNetwork'
        }
      }, zoneId);

      // Parse external networks (placeholder implementation)
      // This would need proper XML parsing based on actual response format
      
    } catch (error) {
      console.warn('Failed to get external networks:', error);
    }
    
    return networks;
  }

  private async getProviderNetworks(zoneId?: string): Promise<ProviderNetworkInfo[]> {
    const networks: ProviderNetworkInfo[] = [];
    
    try {
      // Query for provider networks 
      await this.makeRequest<QueryResultRecords>({
        method: 'GET',
        url: '/query',
        params: {
          type: 'providerVdcNetwork'
        }
      }, zoneId);

      // Parse provider networks (placeholder implementation)
      // This would need proper XML parsing based on actual response format
      
    } catch (error) {
      console.warn('Failed to get provider networks:', error);
    }
    
    return networks;
  }

  /**
   * Get client health status
   */
  async getHealthStatus(): Promise<McpToolResponse<any>> {
    try {
      const zoneStats = this.zoneManager.getZoneStats();
      const sessionStats = this.tokenManager.getSessionStats();
      const validation = this.zoneManager.validateAllZones();
      
      const health = {
        zones: zoneStats,
        sessions: sessionStats,
        validation: validation,
        timestamp: new Date().toISOString()
      };
      
      return this.formatMcpResponse(health, this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, this.zoneManager.getConfig().defaultZone, {
        code: 'HEALTH_CHECK_ERROR',
        message: error instanceof Error ? error.message : 'Health check failed',
        details: error
      });
    }
  }
}