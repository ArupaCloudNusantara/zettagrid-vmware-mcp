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
  FirewallRule,
  VdcResourceSummary,
  EdgeNetworkConfig,
  ExternalIPInfo,
  EdgeGatewayInterfaceInfo,
  UplinkInfo,
  ExternalNetworkInfo,
  ProviderNetworkInfo,
  PaginationParams,
  ListResponse,
  VAppInstantiationParams,
  VAppVmConfig
} from '../types.js';
import {
  parseVdcRecords,
  parseVMRecords,
  parseVAppRecords,
  parseOrganizationRecords,
  parseQueryResults,
  parseEntityAttributes,
  normalizeIdFromHrefOrId,
  parseVmDetails,
  parseVAppDetails,
  parseTaskResponse
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

      const doFetch = () => this.executeWithRetry(
        () => fetch(url.toString(), requestConfig),
        globalConfig.retryAttempts
      );

      let response = await doFetch();

      // On 401, the server-side session expired independently of the local token cache.
      // Invalidate, re-authenticate, and retry once with fresh headers.
      if (response.status === 401) {
        await auth.logout();
        const freshHeaders = await auth.getAuthenticatedHeaders();
        requestConfig.headers = { ...freshHeaders, ...config.headers };
        response = await doFetch();
      }

      // Parse response
      const responseData = await this.parseResponse<T>(response);

      // Throw on HTTP errors — executeWithRetry returns 4xx without throwing
      if (!response.ok) {
        const errText = typeof responseData === 'string'
          ? (responseData.match(/<Error\b[^>]*message="([^"]+)"/) || [])[1] || (responseData as string).slice(0, 300)
          : JSON.stringify(responseData).slice(0, 300);
        throw new Error(`API ${config.method} ${config.url} → HTTP ${response.status}: ${errText}`);
      }

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

  /**
   * Make authenticated request to VCD CloudAPI (/cloudapi/1.0.0/...).
   * Uses same bearer token as legacy API but targets /cloudapi/1.0.0 path.
   * Returns parsed JSON — no XML involved.
   */
  private async makeCloudApiRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    zoneId?: string,
    body?: any
  ): Promise<T> {
    const auth = this.getZoneAuth(zoneId);
    const zoneConfig = this.zoneManager.getZoneConfig(zoneId);
    await auth.initialize();
    const authHeaders = await auth.getAuthenticatedHeaders();

    // Strip /api suffix, prepend /cloudapi/1.0.0
    const baseUrl = zoneConfig.apiEndpoint.replace(/\/api$/, '');
    const url = `${baseUrl}/cloudapi/1.0.0${path}`;

    const headers: Record<string, string> = {
      ...authHeaders,
      'Accept': `application/json;version=${zoneConfig.apiVersion}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30000),
    };
    if (body !== undefined) requestInit.body = JSON.stringify(body);

    let response = await fetch(url, requestInit);

    // On 401, the server-side session expired — invalidate, re-auth, retry once.
    if (response.status === 401) {
      await auth.logout();
      const freshHeaders = await auth.getAuthenticatedHeaders();
      requestInit.headers = {
        ...freshHeaders,
        'Accept': `application/json;version=${zoneConfig.apiVersion}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      };
      response = await fetch(url, requestInit);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`CloudAPI ${method} ${path} → HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }
    const text = await response.text();
    if (!text) return {} as T;
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  // === ORGANIZATION METHODS ===

  /**
   * List organizations
   */
  async listOrganizations(zoneId?: string): Promise<McpToolResponse<Organization[]>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'organization' }
      }, zoneId);

      const parsedOrgs = parseOrganizationRecords(response.data);
      const organizations: Organization[] = parsedOrgs.map(parsed => {
        const org: Organization = {
          href: parsed.href,
          id: parsed.id,
          name: parsed.name,
          type: parsed.type
        };
        if (parsed.fullName !== undefined) {
          org.fullName = parsed.fullName;
        }
        return org;
      });
      
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
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/org/${organizationId}`
      }, zoneId);

      const parsed = parseEntityAttributes(response.data, /<(\w+:)?Org\b[^>]*>/);
      return this.formatMcpResponse(parsed as unknown as Organization, zoneId || this.zoneManager.getConfig().defaultZone);
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
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vdc/${vdcId}`
      }, zoneId);

      const parsed = parseEntityAttributes(response.data, /<(\w+:)?Vdc\b[^>]*>/);
      return this.formatMcpResponse(parsed as unknown as Vdc, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as Vdc, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VDC_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VDC',
        details: error
      });
    }
  }

  /**
   * Show VDC resources with actual usage data
   * @param vdcIdOrHref - VDC ID or href URL 
   * @param zoneId - Optional zone ID
   */
  async showVdcResources(vdcIdOrHref: string, zoneId?: string): Promise<McpToolResponse<VdcResourceSummary>> {
    const vdcId = normalizeIdFromHrefOrId(vdcIdOrHref);
    
    try {
      // Get VDC details directly - this contains ComputeCapacity XML
      const vdcResponse = await this.makeRequest<string>({
        method: 'GET',
        url: `/vdc/${vdcId}`
      }, zoneId);

      if (!vdcResponse.data) {
        throw new Error('No VDC data received');
      }

      // Parse the VDC XML to extract name and ComputeCapacity
      const xmlData = vdcResponse.data;
      let vdcName = 'Unknown VDC';
      let memoryAllocatedMB = 0;
      let memoryUsedMB = 0;
      let cpuAllocatedMhz = 0;
      let cpuUsedMhz = 0;

      // Extract VDC name
      const nameMatch = xmlData.match(/name="([^"]+)"/);
      if (nameMatch && nameMatch[1]) {
        vdcName = nameMatch[1];
      }

      // Extract ComputeCapacity CPU values
      const cpuMatch = xmlData.match(/<Cpu>[\s\S]*?<Allocated>(\d+)<\/Allocated>[\s\S]*?<Used>(\d+)<\/Used>[\s\S]*?<\/Cpu>/);
      if (cpuMatch && cpuMatch[1] && cpuMatch[2]) {
        cpuAllocatedMhz = parseInt(cpuMatch[1], 10);
        cpuUsedMhz = parseInt(cpuMatch[2], 10);
      }

      // Extract ComputeCapacity Memory values
      const memoryMatch = xmlData.match(/<Memory>[\s\S]*?<Allocated>(\d+)<\/Allocated>[\s\S]*?<Used>(\d+)<\/Used>[\s\S]*?<\/Memory>/);
      if (memoryMatch && memoryMatch[1] && memoryMatch[2]) {
        memoryAllocatedMB = parseInt(memoryMatch[1], 10);
        memoryUsedMB = parseInt(memoryMatch[2], 10);
      }

      // Get storage statistics from orgVdcStorageProfile query
      let storageAllocatedMB = 0;
      let storageUsedMB = 0;
      
      try {
        const storageResponse = await this.makeRequest<string>({
          method: 'GET',
          url: `/query?type=orgVdcStorageProfile&filter=vdc==${vdcId}`
        }, zoneId);

        if (storageResponse.data) {
          const storageXml = storageResponse.data;
          
          // Extract storage values from OrgVdcStorageProfileRecord elements
          const storageRecords = storageXml.match(/<OrgVdcStorageProfileRecord[^>]*\/>/g) || [];
          
          for (const record of storageRecords) {
            const usedMatch = record.match(/storageUsedMB="(\d+)"/);
            const limitMatch = record.match(/storageLimitMB="(\d+)"/);
            
            if (usedMatch && usedMatch[1] && limitMatch && limitMatch[1]) {
              storageUsedMB += parseInt(usedMatch[1], 10);
              storageAllocatedMB += parseInt(limitMatch[1], 10);
            }
          }
        }
      } catch (error) {
        // Storage query failed, storage will show as 0
      }

      // Helper functions
      const formatNumber = (value: number): string => {
        return value.toFixed(1);
      };

      const calculateUtilization = (used: number, allocated: number): string => {
        if (allocated === 0) return '0%';
        return Math.round((used / allocated) * 100) + '%';
      };

      // Build the summary with actual parsed values
      const summary: VdcResourceSummary = {
        vdcId,
        vdcName,
        resources: {
          ram: {
            resource: 'RAM',
            units: 'GB',
            allocated: formatNumber(memoryAllocatedMB / 1024),
            used: formatNumber(memoryUsedMB / 1024),
            available: formatNumber((memoryAllocatedMB - memoryUsedMB) / 1024),
            utilization: calculateUtilization(memoryUsedMB, memoryAllocatedMB)
          },
          vcpu: {
            resource: 'vCPU',
            units: 'MHz',
            allocated: formatNumber(cpuAllocatedMhz),
            used: formatNumber(cpuUsedMhz),
            available: formatNumber(cpuAllocatedMhz - cpuUsedMhz),
            utilization: calculateUtilization(cpuUsedMhz, cpuAllocatedMhz)
          },
          storage: {
            resource: 'Storage',
            units: 'GB',
            allocated: storageAllocatedMB > 0 ? formatNumber(storageAllocatedMB / 1024) : 'N/A',
            used: storageUsedMB > 0 ? formatNumber(storageUsedMB / 1024) : 'N/A',
            available: (storageAllocatedMB > 0 && storageUsedMB >= 0) ? 
              formatNumber((storageAllocatedMB - storageUsedMB) / 1024) : 'N/A',
            utilization: (storageAllocatedMB > 0) ? 
              calculateUtilization(storageUsedMB, storageAllocatedMB) : 'N/A'
          }
        }
      };
      
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

      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params
      }, zoneId);

      const parsedVApps = parseVAppRecords(response.data);
      const vApps: VApp[] = parsedVApps.map(parsed => {
        const vapp: VApp = {
          href: parsed.href,
          id: parsed.id,
          name: parsed.name,
          type: parsed.type
        };
        if (parsed.status !== undefined) {
          vapp.status = parsed.status;
        }
        if (parsed.deployed !== undefined) {
          vapp.deployed = parsed.deployed;
        }
        return vapp;
      });

      const listResponse: ListResponse<VApp> = {
        items: vApps,
        total: vApps.length,
        page: pagination?.page || 1,
        pageSize: pagination?.pageSize || 25,
        hasMore: false
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
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vapp-${vAppId}`
      }, zoneId);

      // parseVAppDetails extracts root attributes + child VM summaries from <Children>
      const parsed = parseVAppDetails(response.data);
      return this.formatMcpResponse(parsed as unknown as VApp, zoneId || this.zoneManager.getConfig().defaultZone);
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
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${vAppId}/power/action/powerOn`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
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
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${vAppId}/power/action/powerOff`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_OFF_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power off vApp',
        details: error
      });
    }
  }

  /**
   * Undeploy a vApp — removes VMs from ESXi hosts without deleting data.
   * Required before DELETE when the vApp is still deployed (has suspended/mixed-state VMs).
   * UndeployPowerAction=powerOff forcibly shuts down any running VMs first.
   */
  async undeployVApp(vappId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<UndeployVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">
  <UndeployPowerAction>powerOff</UndeployPowerAction>
</UndeployVAppParams>`;
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${vappId}/action/undeploy`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' }
      }, zoneId);
      const task = response.data ? parseTaskResponse(response.data) : { _status: 'accepted' };
      return this.formatMcpResponse(
        { ...task, vappId, message: 'vApp undeploy task queued.' },
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'UNDEPLOY_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to undeploy vApp',
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
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}`
      }, zoneId);

      // parseVmDetails extracts root attributes + CPU/RAM/IP from child XML elements
      const parsed = parseVmDetails(response.data);
      return this.formatMcpResponse(parsed as unknown as Vm, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as Vm, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VM',
        details: error
      });
    }
  }

  /**
   * Update GuestCustomizationSection.ComputerName on a powered-off VM.
   * VCD uses this value to populate vCloud_computerName in guestinfo on the next boot,
   * which open-vm-tools reads to set the OS hostname.
   */
  async updateVMComputerName(vmId: string, computerName: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}/guestCustomizationSection`
      }, zoneId);

      const currentXml = getResp.data as unknown as string;
      const updatedXml = currentXml.includes('<ComputerName>')
        ? currentXml.replace(/<ComputerName>[^<]*<\/ComputerName>/, `<ComputerName>${computerName}</ComputerName>`)
        : currentXml.replace('</GuestCustomizationSection>', `    <ComputerName>${computerName}</ComputerName>\n</GuestCustomizationSection>`);

      const putResp = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/guestCustomizationSection`,
        data: updatedXml,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.guestCustomizationSection+xml' }
      }, zoneId);

      return this.formatMcpResponse(
        parseTaskResponse(putResp.data as unknown as string),
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'UPDATE_COMPUTER_NAME_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update computer name',
        details: error
      });
    }
  }

  /**
   * Power on VM
   */
  async powerOnVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/powerOn`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
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
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/powerOff`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'POWER_OFF_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to power off VM',
        details: error
      });
    }
  }

  /**
   * Graceful guest OS shutdown (preferred over powerOff for running VMs)
   */
  async shutdownVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/shutdown`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'SHUTDOWN_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to shutdown VM',
        details: error
      });
    }
  }

  /**
   * Graceful guest OS reboot
   */
  async rebootVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/reboot`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'REBOOT_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to reboot VM',
        details: error
      });
    }
  }

  /**
   * Suspend VM (save state to disk)
   */
  async suspendVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/suspend`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'SUSPEND_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to suspend VM',
        details: error
      });
    }
  }


  /**
   * Get VM console ticket
   */
  async getVMConsole(vmId: string, zoneId?: string): Promise<McpToolResponse<VmConsoleTicket>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/screen/action/acquireTicket`
      }, zoneId);

      const parsed = parseEntityAttributes(response.data, /<(\w+:)?ScreenTicket\b[^>]*>/);
      // The ticket URL lives in the element's text content, not in attributes
      const contentMatch = response.data.match(/>([^<]+)<\/(\w+:)?ScreenTicket/);
      if (contentMatch?.[1]) {
        parsed.ticket = contentMatch[1].trim();
      }
      return this.formatMcpResponse(parsed as unknown as VmConsoleTicket, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as VmConsoleTicket, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VM_CONSOLE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get VM console ticket',
        details: error
      });
    }
  }

  /** Build vApp-level InstantiationParams (NetworkConfigSection only) */
  private buildVAppInstantiationParamsXml(params?: VAppInstantiationParams): string {
    if (!params?.networkConfig?.length) return '';
    const configs = params.networkConfig.map(nc => {
      const parent = nc.parentNetworkHref ? `<ParentNetwork href="${nc.parentNetworkHref}" />` : '';
      return `<NetworkConfig networkName="${nc.networkName}">
            <Configuration>
                ${parent}
                <FenceMode>${nc.fenceMode}</FenceMode>
            </Configuration>
        </NetworkConfig>`;
    }).join('\n        ');
    return `\n    <InstantiationParams>
        <NetworkConfigSection>
            <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Network config</ovf:Info>
            ${configs}
        </NetworkConfigSection>
    </InstantiationParams>`;
  }

  /** Fetch routed org VDC networks available in a given VDC for auto-discovery during VM creation */
  private async fetchVdcNetworkOptions(vdcId: string, zoneId?: string): Promise<Array<{
    name: string; href: string; defaultGateway?: string; subnetPrefixLength?: number;
    availableIps: number; totalIps: number;
  }>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'orgVdcNetwork' }
      }, zoneId);
      const xml = response.data as unknown as string;
      const records = parseQueryResults(xml);
      return records
        .filter(r => r.vdc && String(r.vdc).includes(vdcId) && Number(r.linkType) === 1)
        .map(r => ({
          name: String(r.name ?? ''),
          href: String(r.href ?? ''),
          defaultGateway: r.defaultGateway ? String(r.defaultGateway) : undefined,
          subnetPrefixLength: r.subnetPrefixLength ? Number(r.subnetPrefixLength) : undefined,
          availableIps: (Number(r.totalIpCount) || 0) - (Number(r.usedIpCount) || 0),
          totalIps: Number(r.totalIpCount) || 0,
        }));
    } catch {
      return [];
    }
  }

  /** Fetch VM hrefs and their existing NIC network names from a vAppTemplate.
   *  Network names are needed to build NetworkAssignment elements that remap
   *  template NICs to vApp networks (without this vCD ignores the NIC override). */
  private async fetchTemplateVmHrefs(templateHref: string, zoneId?: string): Promise<{ href: string; templateNetworks: string[] }[]> {
    try {
      const pathMatch = templateHref.match(/\/api(\/.+)/);
      const relativePath = pathMatch?.[1] ?? templateHref;
      const response = await this.makeRequest<string>({ method: 'GET', url: relativePath }, zoneId);
      const xml = response.data as unknown as string;

      // Split template XML into per-VM blocks to pair hrefs with their NIC networks
      const result: { href: string; templateNetworks: string[] }[] = [];
      const vmBlockRe = /<Vm\b([^>]*)>([\s\S]*?)<\/Vm>/g;
      let m: RegExpExecArray | null;
      while ((m = vmBlockRe.exec(xml)) !== null) {
        const attrs = m[1] ?? '';
        const body  = m[2] ?? '';
        const hrefMatch = attrs.match(/href="([^"]+)"/);
        if (!hrefMatch?.[1]) continue;
        const href = hrefMatch[1];
        // Extract unique NIC network names within this VM block
        const networks: string[] = [];
        const ncRe = /<NetworkConnection\b[^>]*\bnetwork="([^"]+)"/g;
        let nm: RegExpExecArray | null;
        while ((nm = ncRe.exec(body)) !== null) {
          const net = nm[1];
          if (net && !networks.includes(net)) networks.push(net);
        }
        if (!result.some(r => r.href === href)) result.push({ href, templateNetworks: networks });
      }
      return result;
    } catch {
      return [];
    }
  }

  /** Build a complete SourcedItem XML block for one VM.
   *  templateNetworks: NIC network names the template VM already has (e.g. ["VM Network"]).
   *  When provided, NetworkAssignment elements are added to remap template NICs to the
   *  user-specified vApp networks — without these vCD silently ignores the NIC override. */
  private buildSourcedItemXml(vmHref: string, vmConfig: VAppVmConfig, fallbackName: string, templateNetworks?: string[], networkNameMap?: Map<string, string>): string {
    const vmName = vmConfig.vmName ?? fallbackName;
    const instSections: string[] = [];

    // Resolve computer name / hostname (priority: explicit gc.computerName → OVF hostname → vmName)
    const hostnameFromOvf = vmConfig.ovfProperties?.find(p => p.key === 'hostname')?.value;
    const resolvedComputerName = vmConfig.guestCustomization?.computerName || hostnameFromOvf || vmName;

    // Network connections
    if (vmConfig.networkConnections?.length) {
      const primary = vmConfig.networkConnections.find(n => n.isPrimary !== false) ?? vmConfig.networkConnections[0]!;
      const primaryIdx = vmConfig.networkConnections.indexOf(primary);
      const nics = vmConfig.networkConnections.map((nc, i) => {
        const idx = nc.index ?? i;
        const resolvedMode = nc.ipMode ?? 'POOL';
        const ipLine = resolvedMode === 'MANUAL' && nc.ipAddress ? `<IpAddress>${nc.ipAddress}</IpAddress>` : '';
        const resolvedNetName = networkNameMap?.get(nc.networkName) ?? nc.networkName;
        return `<NetworkConnection network="${resolvedNetName}">
                <NetworkConnectionIndex>${idx}</NetworkConnectionIndex>
                ${ipLine}
                <IsConnected>true</IsConnected>
                <IpAddressAllocationMode>${resolvedMode}</IpAddressAllocationMode>
            </NetworkConnection>`;
      }).join('\n            ');
      instSections.push(`<NetworkConnectionSection>
            <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Network connections</ovf:Info>
            <PrimaryNetworkConnectionIndex>${primaryIdx}</PrimaryNetworkConnectionIndex>
            ${nics}
        </NetworkConnectionSection>`);
    }

    // OVF ProductSection (cloud-init for Ubuntu).
    // Auto-inject hostname = resolvedComputerName when not explicitly provided by the caller.
    if (vmConfig.ovfProperties?.length) {
      const hasHostname = vmConfig.ovfProperties.some(p => p.key === 'hostname');
      const effectiveProps = hasHostname
        ? vmConfig.ovfProperties
        : [{ key: 'hostname', value: resolvedComputerName }, ...vmConfig.ovfProperties];
      const props = effectiveProps.map(p =>
        `<ovf:Property ovf:key="${p.key}" ovf:type="string" ovf:value="${p.value}"/>`
      ).join('\n            ');
      instSections.push(`<ovf:ProductSection xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">
            <ovf:Info>OVF properties</ovf:Info>
            ${props}
        </ovf:ProductSection>`);
    }

    // GuestCustomizationSection — always injected so ComputerName is stored in VCD.
    // For Linux cloud-init VMs (no explicit guestCustomization), NeedsCustomization stays
    // false so VCD's open-vm-tools agent is NOT triggered; the section is stored only.
    {
      const gc = vmConfig.guestCustomization ?? {};
      const fields = [
        gc.enabled !== undefined              ? `<Enabled>${gc.enabled}</Enabled>` : '',
        gc.changeSid !== undefined            ? `<ChangeSid>${gc.changeSid}</ChangeSid>` : '',
        gc.adminPasswordEnabled !== undefined  ? `<AdminPasswordEnabled>${gc.adminPasswordEnabled}</AdminPasswordEnabled>` : '',
        gc.adminPasswordAuto !== undefined     ? `<AdminPasswordAuto>${gc.adminPasswordAuto}</AdminPasswordAuto>` : '',
        gc.adminPassword                       ? `<AdminPassword>${gc.adminPassword}</AdminPassword>` : '',
        gc.resetPasswordRequired !== undefined ? `<ResetPasswordRequired>${gc.resetPasswordRequired}</ResetPasswordRequired>` : '',
        `<ComputerName>${resolvedComputerName}</ComputerName>`,
        gc.customizationScript                 ? `<CustomizationScript>${gc.customizationScript}</CustomizationScript>` : '',
      ].filter(Boolean).join('\n            ');
      instSections.push(`<GuestCustomizationSection>
            <ovf:Info xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">Guest customization</ovf:Info>
            ${fields}
        </GuestCustomizationSection>`);
    }

    const instParamsXml = instSections.length
      ? `\n        <InstantiationParams>\n            ${instSections.join('\n            ')}\n        </InstantiationParams>`
      : '';

    // StorageProfile is a direct child of SourcedItem
    const storageProfileXml = vmConfig.storageProfileHref
      ? `\n        <StorageProfile href="${vmConfig.storageProfileHref}" type="application/vnd.vmware.vcloud.vdcStorageProfile+xml" name="${vmConfig.storageProfileName ?? ''}" />`
      : '';

    // CPU/memory/disk cannot be set during instantiateVAppTemplate.
    // SourcedCompositionItemParam does not support VmSpecSection.
    // Resize CPU/memory/disk post-instantiation via PUT /vApp/vm-{id}/vmSpecSection.

    // NetworkAssignment — maps the template VM's existing NIC networks to vApp networks.
    // vCD uses these to connect the VM's NICs to the correct vApp network; without them
    // the NetworkConnectionSection override in InstantiationParams is silently ignored
    // and the VM falls back to the template's original network (e.g. "VM Network").
    let networkAssignmentsXml = '';
    // NetworkAssignment is only needed when vApp network names differ from template network
    // names. When networkNameMap is populated we already use template names in both the vApp
    // NetworkConfig and the NIC override, so no remapping is required.
    if (templateNetworks?.length && vmConfig.networkConnections?.length && !(networkNameMap?.size)) {
      const targetNames = vmConfig.networkConnections.map(nc => nc.networkName);
      networkAssignmentsXml = templateNetworks.map((templateNet, i) => {
        const innerNet = targetNames[i] ?? targetNames[0] ?? templateNet;
        return `\n        <NetworkAssignment networkName="${templateNet}" innerNetwork="${innerNet}"/>`;
      }).join('');
    }

    return `
    <SourcedItem>
        <Source href="${vmHref}" />
        <VmGeneralParams>
            <Name>${vmName}</Name>
            <NeedsCustomization>${vmConfig.guestCustomization ? 'true' : 'false'}</NeedsCustomization>
        </VmGeneralParams>${networkAssignmentsXml}${instParamsXml}${storageProfileXml}
    </SourcedItem>`;
  }

  /**
   * Create a new vApp from template.
   * Auto-discovers VDC networks when vmConfigs have no networkConnections:
   *   - 1 routed network  → uses it automatically (POOL mode)
   *   - 2+ routed networks → returns CLARIFICATION_REQUIRED with available options
   *   - 0 routed networks  → proceeds without network (isolated VM)
   */
  async createVApp(vdcId: string, templateId: string, vappName: string, zoneId?: string, instantiationParams?: VAppInstantiationParams): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Legacy: map old guestCustomization into vmConfigs[0]
      const effectiveVmConfigs: VAppVmConfig[] = instantiationParams?.vmConfigs?.length
        ? instantiationParams.vmConfigs
        : (instantiationParams?.guestCustomization
            ? [{ guestCustomization: instantiationParams.guestCustomization }]
            : []);

      // Lazy-fetch VDC networks once; reused by both auto-discovery and IP-mode resolution
      let cachedNets: Array<{ name: string; href: string; defaultGateway?: string; subnetPrefixLength?: number; availableIps: number; totalIps: number }> | undefined;
      const getNets = async () => {
        if (!cachedNets) cachedNets = await this.fetchVdcNetworkOptions(vdcId, zoneId);
        return cachedNets;
      };

      let resolvedParams = instantiationParams;
      let autoConfigured: { network: string; ipMode: string } | undefined;

      const wantsNetworkDiscovery = effectiveVmConfigs.length > 0
        && effectiveVmConfigs.every(c => !c.networkConnections?.length);

      if (wantsNetworkDiscovery) {
        const nets = await getNets();

        if (nets.length > 1) {
          return this.formatMcpResponse(
            {
              needsClarification: true,
              availableNetworks: nets.map(n => ({
                networkName: n.name,
                availableIps: n.availableIps,
                totalIps: n.totalIps,
                gateway: n.defaultGateway,
                prefix: n.subnetPrefixLength,
                suggestedIpMode: n.availableIps > 0 ? 'POOL' : 'DHCP',
              }))
            },
            zone,
            {
              code: 'CLARIFICATION_REQUIRED',
              message: `VDC has ${nets.length} routed networks — please specify networkConnections in vmConfigs (networkName + optionally ipMode). Available options are in data.availableNetworks.`,
            }
          );
        }

        if (nets.length === 1) {
          const net = nets[0]!;

          if (net.availableIps <= 0) {
            return this.formatMcpResponse(
              {
                needsClarification: true,
                network: net.name,
                poolStatus: { total: net.totalIps, available: 0 },
                options: [
                  { ipMode: 'MANUAL', note: 'Provide a specific static IP in the ipAddress field of networkConnections' },
                  { ipMode: 'DHCP', note: 'Request an IP via DHCP (requires DHCP service enabled on the network)' },
                ],
                hint: 'Or expand the static IP pool in VDC network settings, then retry (ipMode will default to POOL).',
              },
              zone,
              {
                code: 'CLARIFICATION_REQUIRED',
                message: `Network "${net.name}" has no available IPs in its static pool (pool size: ${net.totalIps}, all in use). Choose ipMode: MANUAL (with ipAddress) or DHCP, or expand the IP pool first.`,
              }
            );
          }

          autoConfigured = { network: net.name, ipMode: 'POOL' };
          resolvedParams = {
            ...instantiationParams,
            networkConfig: instantiationParams?.networkConfig?.length
              ? instantiationParams.networkConfig
              : [{ networkName: net.name, parentNetworkHref: net.href, fenceMode: 'bridged' }],
            vmConfigs: effectiveVmConfigs.map(c => ({
              ...c,
              networkConnections: [{ networkName: net.name, ipMode: 'POOL' as const }]
            }))
          };
        }
        // 0 networks → proceed without network config
      }

      let resolvedVmConfigs: VAppVmConfig[] = resolvedParams?.vmConfigs ?? effectiveVmConfigs;

      // Resolve missing ipMode on user-provided networkConnections.
      // Default to POOL when the network has available IPs; ask for clarification otherwise.
      const hasUnresolvedIpMode = resolvedVmConfigs.some(c =>
        c.networkConnections?.some(nc => !nc.ipMode)
      );

      if (hasUnresolvedIpMode) {
        const nets = await getNets();
        const netMap = new Map(nets.map(n => [n.name, n]));

        const exhausted: Array<{ networkName: string; totalIps: number }> = [];

        const finalVmConfigs = resolvedVmConfigs.map(c => ({
          ...c,
          networkConnections: c.networkConnections?.map(nc => {
            if (nc.ipMode) return nc;
            const info = netMap.get(nc.networkName);
            if (info && info.availableIps > 0) {
              return { ...nc, ipMode: 'POOL' as const };
            }
            exhausted.push({ networkName: nc.networkName, totalIps: info?.totalIps ?? 0 });
            return nc;
          })
        }));

        if (exhausted.length > 0) {
          return this.formatMcpResponse(
            {
              needsClarification: true,
              exhaustedNetworks: exhausted.map(e => ({
                networkName: e.networkName,
                poolStatus: { total: e.totalIps, available: 0 },
                options: [
                  { ipMode: 'MANUAL', note: 'Provide a specific static IP in the ipAddress field' },
                  { ipMode: 'DHCP', note: 'Request an IP via DHCP' },
                ],
              })),
              hint: 'Specify ipMode (MANUAL with ipAddress, or DHCP) for each affected NIC, or expand the static IP pool in VDC network settings and retry.',
            },
            zone,
            {
              code: 'CLARIFICATION_REQUIRED',
              message: `${exhausted.length} NIC(s) have no available IPs in their static pool: ${exhausted.map(e => `"${e.networkName}"`).join(', ')}. Specify ipMode: MANUAL (with ipAddress) or DHCP, or expand the IP pool first.`,
            }
          );
        }

        resolvedParams = { ...resolvedParams, vmConfigs: finalVmConfigs };
        resolvedVmConfigs = finalVmConfigs;
      }

      // Fetch template VM hrefs (and their NIC network names) early so we can use the
      // template's internal network name ("VM Network") directly in the vApp NetworkConfig
      // and NIC override — eliminating the need for NetworkAssignment.
      let templateVms: { href: string; templateNetworks: string[] }[] = [];
      if (resolvedVmConfigs.length > 0) {
        templateVms = await this.fetchTemplateVmHrefs(templateId, zoneId);
      }

      // Build map: user-specified org network name → template VM NIC network name.
      // When populated, the vApp network is named like the template (e.g. "VM Network")
      // and is bridged to the org network — the VM's NIC already matches so no
      // NetworkAssignment element is needed.
      const networkNameMap = new Map<string, string>();
      const firstVmTemplateNets = templateVms[0]?.templateNetworks ?? [];
      if (firstVmTemplateNets.length > 0) {
        resolvedVmConfigs.forEach(cfg => {
          cfg.networkConnections?.forEach((nc, i) => {
            const templateNet = firstVmTemplateNets[i] ?? firstVmTemplateNets[0]!;
            if (templateNet && templateNet !== nc.networkName) {
              networkNameMap.set(nc.networkName, templateNet);
            }
          });
        });
      }

      // Auto-populate vApp-level networkConfig when user supplied networkConnections but no
      // networkConfig. Use the template's internal network name as the vApp network name so
      // the VM's NIC matches without NetworkAssignment.
      if (!resolvedParams?.networkConfig?.length) {
        const neededNames = new Set<string>();
        resolvedVmConfigs.forEach(c => c.networkConnections?.forEach(nc => neededNames.add(nc.networkName)));
        if (neededNames.size > 0) {
          const nets = await getNets();
          const netMap = new Map(nets.map(n => [n.name, n]));
          const autoNetConfig = [...neededNames]
            .map(name => {
              const n = netMap.get(name);
              if (!n) return null;
              // Use template network name as vApp network name to avoid NetworkAssignment
              const vappNetName = networkNameMap.get(name) ?? name;
              return { networkName: vappNetName, parentNetworkHref: n.href, fenceMode: 'bridged' as const };
            })
            .filter((n): n is NonNullable<typeof n> => n !== null);
          if (autoNetConfig.length > 0) {
            resolvedParams = { ...resolvedParams, networkConfig: autoNetConfig };
          }
        }
      }

      const vappInstParamsXml = this.buildVAppInstantiationParamsXml(resolvedParams);

      // Build SourcedItem blocks — one per VM in the template
      let sourcedItemsXml = '';
      if (templateVms.length > 0 && resolvedVmConfigs.length > 0) {
        sourcedItemsXml = templateVms.map(({ href, templateNetworks }, i) => {
          const cfg = resolvedVmConfigs[i] ?? resolvedVmConfigs[0] ?? {};
          const fallbackName = templateVms.length === 1 ? vappName : `${vappName}-${i + 1}`;
          return this.buildSourcedItemXml(href, cfg, fallbackName, templateNetworks, networkNameMap);
        }).join('');
      }

      const createVAppPayload = `<?xml version="1.0" encoding="UTF-8"?>
<InstantiateVAppTemplateParams
    xmlns="http://www.vmware.com/vcloud/v1.5"
    name="${vappName}"
    deploy="false"
    powerOn="false">
    <Description>Created by Zettagrid MCP Server</Description>${vappInstParamsXml}
    <Source href="${templateId}" />${sourcedItemsXml}
    <AllEULAsAccepted>true</AllEULAsAccepted>
</InstantiateVAppTemplateParams>`;

      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vdc/${vdcId}/action/instantiateVAppTemplate`,
        data: createVAppPayload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.instantiateVAppTemplateParams+xml' }
      }, zoneId);

      // Response is the new VApp entity XML — extract key fields
      const vappXml  = response.data;
      const vappHref = (vappXml.match(/href="([^"]+\/vApp\/vapp-[^"]+)"/) || [])[1] || '';
      const vmHref   = (vappXml.match(/href="([^"]+\/vApp\/vm-[^"]+)"/) || [])[1] || '';
      const vappId   = vappHref.split('/vApp/vapp-')[1] || '';
      const vmId     = vmHref.split('/vApp/vm-')[1] || '';
      const resolvedName = (vappXml.match(/<(\w+:)?VApp\b[^>]*name="([^"]+)"/) || [])[2] || vappName;
      const taskHref = (vappXml.match(/<Task\b[^>]*href="([^"]+)"/) || [])[1] || '';
      const taskStatus = (vappXml.match(/<Task\b[^>]*status="([^"]+)"/) || [])[1] || '';
      return this.formatMcpResponse(
        { vappId, vmId, vappName: resolvedName, vappHref, vmHref,
          task: { href: taskHref, status: taskStatus },
          ...(autoConfigured ? { autoConfigured } : {})
        },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'CREATE_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create vApp',
        details: error
      });
    }
  }

  /**
   * Add a VM from a catalog template into an existing vApp via RecomposeVAppParams.
   * Supports the same per-VM config as createVApp (network, OVF properties, guest customization).
   * When ipMode is omitted and vdcId is supplied, pool availability is checked and
   * CLARIFICATION_REQUIRED is returned if the pool is exhausted. Without vdcId, POOL is assumed.
   * Compute overrides (cpuCount, memoryMB, diskSizeMB) in vmConfig are not applied during
   * instantiation — use update_vm_cpu / update_vm_memory / update_vm_disk afterward.
   */
  async addVMToVApp(
    vappId: string,
    templateId: string,
    vmName: string,
    vmConfig?: VAppVmConfig,
    vdcId?: string,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Resolve the first VM href from the template
      const templateVms = await this.fetchTemplateVmHrefs(templateId, zoneId);
      if (!templateVms.length) {
        throw new Error('No VMs found in template — verify templateId is a valid vAppTemplate href');
      }
      const vmHrefs = templateVms;

      let finalVmConfig: VAppVmConfig = { ...vmConfig, vmName };

      // Resolve missing ipMode on network connections
      const hasUnresolvedIpMode = finalVmConfig.networkConnections?.some(nc => !nc.ipMode);
      if (hasUnresolvedIpMode) {
        if (vdcId) {
          const nets = await this.fetchVdcNetworkOptions(vdcId, zoneId);
          const netMap = new Map(nets.map(n => [n.name, n]));
          const exhausted: Array<{ networkName: string; totalIps: number }> = [];

          const resolvedNics = finalVmConfig.networkConnections!.map(nc => {
            if (nc.ipMode) return nc;
            const info = netMap.get(nc.networkName);
            if (info && info.availableIps > 0) return { ...nc, ipMode: 'POOL' as const };
            exhausted.push({ networkName: nc.networkName, totalIps: info?.totalIps ?? 0 });
            return nc;
          });

          if (exhausted.length > 0) {
            return this.formatMcpResponse(
              {
                needsClarification: true,
                exhaustedNetworks: exhausted.map(e => ({
                  networkName: e.networkName,
                  poolStatus: { total: e.totalIps, available: 0 },
                  options: [
                    { ipMode: 'MANUAL', note: 'Provide a specific static IP in the ipAddress field' },
                    { ipMode: 'DHCP', note: 'Request an IP via DHCP' },
                  ],
                })),
                hint: 'Specify ipMode (MANUAL with ipAddress, or DHCP), or expand the static IP pool in VDC network settings and retry.',
              },
              zone,
              {
                code: 'CLARIFICATION_REQUIRED',
                message: `${exhausted.length} NIC(s) have no available IPs in their static pool: ${exhausted.map(e => `"${e.networkName}"`).join(', ')}. Specify ipMode: MANUAL (with ipAddress) or DHCP, or expand the pool first.`,
              }
            );
          }

          finalVmConfig = { ...finalVmConfig, networkConnections: resolvedNics };
        } else {
          // No vdcId — default unresolved NICs to POOL
          finalVmConfig = {
            ...finalVmConfig,
            networkConnections: finalVmConfig.networkConnections?.map(nc =>
              nc.ipMode ? nc : { ...nc, ipMode: 'POOL' as const }
            ),
          };
        }
      }

      const { href: firstHref, templateNetworks: firstTemplateNetworks } = vmHrefs[0]!;
      const sourcedItemXml = this.buildSourcedItemXml(firstHref, finalVmConfig, vmName, firstTemplateNetworks);

      // name attribute is intentionally omitted — avoids renaming the parent vApp
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<RecomposeVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">
    <Description>VM added by Zettagrid MCP Server</Description>${sourcedItemXml}
</RecomposeVAppParams>`;

      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${vappId}/action/recomposeVApp`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.recomposeVAppParams+xml' }
      }, zoneId);

      const task = parseTaskResponse(response.data as unknown as string);
      return this.formatMcpResponse(
        { ...task, vappId, vmName, message: 'VM add task queued. Use get_task to poll for completion, then list_vms to find the new VM ID.' },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'ADD_VM_TO_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to add VM to vApp',
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

  // === EDGE GATEWAY AND FIREWALL METHODS (CloudAPI — NSX-T) ===

  /**
   * List edge gateways via CloudAPI (required for NSX-T backed gateways).
   * Legacy /api/query?type=edgeGateway only works for NSX-V.
   */
  async listEdgeGateways(zoneId?: string, _pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<any>>> {
    try {
      const data = await this.makeCloudApiRequest<any>('GET', '/edgeGateways', zoneId);
      const items = data.values || (Array.isArray(data) ? data : []);

      // Normalise: extract UUID from URN id (urn:vcloud:gateway:{uuid})
      const normalised = items.map((gw: any) => {
        const entry: Record<string, any> = {
          id: gw.id?.replace(/^urn:vcloud:gateway:/, '') || gw.id,
          urn: gw.id,
          name: gw.name,
          status: gw.status,
          ownerVdc: gw.ownerRef?.name,
        };
        if (gw.description) entry.description = gw.description;
        if (gw.gatewayBacking?.backingType) entry.backingType = gw.gatewayBacking.backingType;
        if (gw.externalNetworkRef?.name) entry.externalNetwork = gw.externalNetworkRef.name;
        if (gw.primaryIp) entry.primaryIp = gw.primaryIp;
        const subnets = (gw.subnets?.values || []).map((s: any) => ({
          gateway: s.gateway, prefixLength: s.prefixLength, primaryIp: s.primaryIp,
          totalIpCount: s.totalIpCount, usedIpCount: s.usedIpCount,
        }));
        if (subnets.length > 0) entry.subnets = subnets;
        return entry;
      });

      const listResponse: ListResponse<any> = {
        items: normalised, total: normalised.length,
        page: 1, pageSize: normalised.length, hasMore: false,
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<any>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_EDGE_GATEWAYS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list edge gateways',
        details: error,
      });
    }
  }

  /**
   * Get edge gateway details via CloudAPI.
   */
  async getEdgeGateway(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      const data = await this.makeCloudApiRequest<any>('GET', `/edgeGateways/${gwUrn}`, zoneId);
      // Normalise similar to list
      const result = {
        id: data.id?.replace(/^urn:vcloud:gateway:/, '') || data.id,
        urn: data.id,
        name: data.name,
        description: data.description,
        status: data.status,
        backingType: data.gatewayBacking?.backingType,
        ownerVdc: data.ownerRef?.name,
        externalNetwork: data.externalNetworkRef?.name,
        primaryIp: data.primaryIp,
        subnets: (data.subnets?.values || []).map((s: any) => ({
          gateway: s.gateway,
          prefixLength: s.prefixLength,
          primaryIp: s.primaryIp,
          ipRanges: s.ipRanges?.values || [],
          totalIpCount: s.totalIpCount,
          usedIpCount: s.usedIpCount,
        })),
        orgVdcNetworkCount: data.orgVdcNetworkCount,
        _raw: data,
      };
      return this.formatMcpResponse(result, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as any, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_EDGE_GATEWAY_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get edge gateway',
        details: error,
      });
    }
  }

  /**
   * List firewall rules for an edge gateway via CloudAPI (NSX-T).
   */
  async listFirewallRules(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<ListResponse<any>>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      // Try /firewall/rules first, fall back to /firewall
      let data: any;
      try {
        data = await this.makeCloudApiRequest<any>('GET', `/edgeGateways/${gwUrn}/firewall/rules`, zoneId);
      } catch {
        data = await this.makeCloudApiRequest<any>('GET', `/edgeGateways/${gwUrn}/firewall`, zoneId);
      }

      // Response may be {userDefinedRules: [...], defaultRules: [...]} or {values: [...]} or []
      let userRules: any[] = [];
      let defaultRules: any[] = [];
      if (Array.isArray(data)) {
        userRules = data;
      } else if (data.values) {
        userRules = data.values;
      } else {
        userRules = data.userDefinedRules || [];
        defaultRules = data.defaultRules || [];
      }

      const allRules = [...userRules, ...defaultRules.map((r: any) => ({ ...r, _isDefault: true }))];

      const listResponse: ListResponse<any> = {
        items: allRules, total: allRules.length,
        page: 1, pageSize: allRules.length, hasMore: false,
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<any>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_FIREWALL_RULES_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list firewall rules',
        details: error,
      });
    }
  }

  /**
   * Create a firewall rule via CloudAPI (NSX-T).
   */
  async createFirewallRule(
    edgeGatewayId: string,
    firewallRule: Partial<FirewallRule>,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      edgeGatewayId = toGatewayUrn(edgeGatewayId);
      const portProfiles = firewallRule.portProfiles ?? (firewallRule as any).portProfiles as string[] | undefined;
      const portProfileId = (firewallRule as any).portProfileId as string | undefined;
      const allPortProfiles = [...(portProfiles ?? []), ...(portProfileId ? [portProfileId] : [])];
      const payload: Record<string, any> = {
        name: (firewallRule as any).name || firewallRule.description || 'MCP-Rule',
        enabled: firewallRule.isEnabled !== false,
        action: firewallRule.policy === 'allow' ? 'ALLOW' : 'DROP',
        ipProtocol: 'IPV4_IPV6',
        direction: 'IN_OUT',
        sourceFirewallGroups: (firewallRule.sourceFirewallGroups ?? []).map(id => ({ id })),
        destinationFirewallGroups: (firewallRule.destinationFirewallGroups ?? []).map(id => ({ id })),
        applicationPortProfiles: allPortProfiles.map(p => ({ id: p })),
        description: firewallRule.description || '',
        logging: firewallRule.enableLogging || false,
      };
      // VCD CloudAPI uses sourceFirewallIpAddresses / destinationFirewallIpAddresses (array of strings)
      if (firewallRule.sourceIp && firewallRule.sourceIp !== 'Any') {
        payload.sourceFirewallIpAddresses = [firewallRule.sourceIp];
      }
      if (firewallRule.destinationIp && firewallRule.destinationIp !== 'Any') {
        payload.destinationFirewallIpAddresses = [firewallRule.destinationIp];
      }

      const data = await this.makeCloudApiRequest<any>(
        'POST', `/edgeGateways/${edgeGatewayId}/firewall/rules`, zoneId, payload
      );
      // CloudAPI returns 202 with empty body — rule creation is async
      const result = (data && Object.keys(data).length > 0) ? data : {
        _status: 'accepted',
        ruleName: payload.name,
        message: 'Firewall rule creation accepted (202). Use list_firewall_rules to confirm the rule and retrieve its ID.',
      };
      return this.formatMcpResponse(result, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_FIREWALL_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create firewall rule',
        details: error,
      });
    }
  }

  /**
   * Show comprehensive edge gateway network configuration via CloudAPI.
   */
  async showEdgeNetworkConfig(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<EdgeNetworkConfig>> {
    try {
      const gw = await this.makeCloudApiRequest<any>('GET', `/edgeGateways/${toGatewayUrn(edgeGatewayId)}`, zoneId);

      const subnets = gw.subnets?.values || [];

      const externalIPs: ExternalIPInfo[] = subnets.map((s: any) => ({
        ipAddress: s.primaryIp || s.gateway,
        isAllocated: true,
        isPrimary: s.primaryIp === gw.primaryIp,
        networkName: gw.externalNetworkRef?.name,
        usage: `/${s.prefixLength}`,
      })).filter((e: ExternalIPInfo) => e.ipAddress);

      const uplinks: UplinkInfo[] = subnets.map((s: any) => ({
        name: gw.externalNetworkRef?.name || 'External',
        interfaceType: gw.gatewayBacking?.backingType || 'NSX_T',
        isConnected: gw.status === 'REALIZED',
        subnets: [{
          gateway: s.gateway,
          netmask: prefixToNetmask(s.prefixLength),
          primaryIp: s.primaryIp,
          ipRanges: (s.ipRanges?.values || []).map((r: any) => ({
            startAddress: r.startAddress,
            endAddress: r.endAddress,
          })),
        }],
        externalNetwork: gw.externalNetworkRef?.name,
      }));

      const gatewayInterfaces: EdgeGatewayInterfaceInfo[] = [{
        name: gw.externalNetworkRef?.name || 'External Uplink',
        interfaceType: 'external',
        networkName: gw.externalNetworkRef?.name,
        ipAddresses: subnets.map((s: any) => s.primaryIp).filter(Boolean),
        isConnected: gw.status === 'REALIZED',
        useForDefaultRoute: true,
      }];

      const config: EdgeNetworkConfig = {
        edgeGatewayId,
        edgeGatewayName: gw.name || 'Unknown',
        externalIPs,
        gatewayInterfaces,
        uplinks,
        externalNetworks: [],
        providerNetworks: [],
      };

      return this.formatMcpResponse(config, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as EdgeNetworkConfig, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'SHOW_EDGE_NETWORK_CONFIG_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get edge network configuration',
        details: error,
      });
    }
  }

  /**
   * List NAT rules for an edge gateway via CloudAPI.
   */
  async listNatRules(edgeGatewayId: string, zoneId?: string): Promise<McpToolResponse<ListResponse<any>>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      const data = await this.makeCloudApiRequest<any>('GET', `/edgeGateways/${gwUrn}/nat/rules`, zoneId);

      let items: any[] = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.values) {
        items = data.values;
      } else if (data.userDefinedRules) {
        items = data.userDefinedRules;
      } else if (data.natRules) {
        items = data.natRules;
      }

      const listResponse: ListResponse<any> = {
        items, total: items.length, page: 1, pageSize: items.length, hasMore: false,
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<any>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_NAT_RULES_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list NAT rules',
        details: error,
      });
    }
  }

  /**
   * List external networks (requires provider scope — returns empty for tenant users).
   */
  async listExternalNetworks(zoneId?: string): Promise<McpToolResponse<ListResponse<ExternalNetworkInfo>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'externalNetwork' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const items = records.map(r => ({
        id: r.id || '',
        name: r.name || '',
        description: r.description,
        gateway: r.gateway,
        netmask: r.netmask,
        ipRanges: [],
      } as ExternalNetworkInfo));
      const listResponse: ListResponse<ExternalNetworkInfo> = {
        items, total: items.length, page: 1, pageSize: items.length, hasMore: false,
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<ExternalNetworkInfo>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_EXTERNAL_NETWORKS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list external networks (requires provider scope)',
        details: error,
      });
    }
  }

  /**
   * Get provider network info (requires provider scope — returns empty for tenant users).
   */
  async getProviderNetworkInfo(zoneId?: string): Promise<McpToolResponse<ListResponse<ProviderNetworkInfo>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'providerVdcStorageProfile' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const items = records.map(r => ({
        id: r.id || '',
        name: r.name || '',
        networkType: 'VLAN' as const,
        isAvailable: true,
        isShared: false,
      } as ProviderNetworkInfo));
      const listResponse: ListResponse<ProviderNetworkInfo> = {
        items, total: items.length, page: 1, pageSize: items.length, hasMore: false,
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<ProviderNetworkInfo>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_PROVIDER_NETWORK_INFO_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get provider network info (requires provider scope)',
        details: error,
      });
    }
  }

  /**
   * Get current VM metrics via CloudAPI (CPU%, RAM%, IOPS, network throughput).
   * vmId should be the VM's UUID (will be formatted as URN internally).
   */
  async getVmMetrics(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    // CloudAPI uses URN format for VM IDs
    const vmUrn = vmId.startsWith('urn:') ? vmId : `urn:vcloud:vm:${vmId}`;
    try {
      const data = await this.makeCloudApiRequest<any>('GET', `/vms/${vmUrn}/metrics/current`, zoneId);

      // Parse metrics array into a readable object
      const raw: any[] = data.metrics || data.metricSeries || [];
      const metrics: Record<string, any> = {};
      for (const m of raw) {
        const key = m.name || m.metric;
        const val = m.value !== undefined ? m.value : (m.readings?.[0]?.value);
        if (key && val !== undefined) {
          metrics[key] = { value: parseFloat(val) || val, unit: m.unit };
        }
      }

      const summary = {
        vmId,
        vmUrn,
        timestamp: new Date().toISOString(),
        cpu: {
          usagePercent: metrics['cpu.usage.average']?.value,
          usageMhz: metrics['cpu.usagemhz.average']?.value,
        },
        memory: {
          usagePercent: metrics['mem.usage.average']?.value,
          consumedKB: metrics['mem.consumed.average']?.value,
          activeKB: metrics['mem.active.average']?.value,
        },
        disk: {
          throughputBps: metrics['disk.throughput.average']?.value,
          readThroughputBps: metrics['disk.read.average']?.value,
          writeThroughputBps: metrics['disk.write.average']?.value,
          iopsRead: metrics['disk.numberReadAveraged.average']?.value,
          iopsWrite: metrics['disk.numberWriteAveraged.average']?.value,
        },
        network: {
          throughputKBps: metrics['net.throughput.average']?.value,
          receivedKBps: metrics['net.received.average']?.value,
          transmittedKBps: metrics['net.transmitted.average']?.value,
        },
        allMetrics: metrics,
        _raw: data,
      };

      return this.formatMcpResponse(summary, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_VM_METRICS_ERROR',
        message: error instanceof Error ? error.message : 'VM metrics not available — the /cloudapi/1.0.0/vms/{id}/metrics/current endpoint is not exposed on this Zettagrid Jakarta VCD instance',
        details: error,
      });
    }
  }

  // === QUERY-BASED LIST METHODS (fork addition) ===

  /**
   * List independent (named) disks
   */
  async listDisks(zoneId?: string): Promise<McpToolResponse<ListResponse<Record<string, any>>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'disk' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const listResponse: ListResponse<Record<string, any>> = {
        items: records, total: records.length, page: 1, pageSize: records.length, hasMore: false
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Record<string, any>>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_DISKS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list disks',
        details: error
      });
    }
  }

  /**
   * List recent tasks (useful for polling async operation status)
   */
  async listTasks(zoneId?: string): Promise<McpToolResponse<ListResponse<Record<string, any>>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'task', sortDesc: 'startDate' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const listResponse: ListResponse<Record<string, any>> = {
        items: records, total: records.length, page: 1, pageSize: records.length, hasMore: false
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Record<string, any>>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_TASKS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list tasks',
        details: error
      });
    }
  }

  /**
   * List organization VDC networks
   */
  async listOrgNetworks(zoneId?: string): Promise<McpToolResponse<ListResponse<Record<string, any>>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'orgVdcNetwork' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const listResponse: ListResponse<Record<string, any>> = {
        items: records, total: records.length, page: 1, pageSize: records.length, hasMore: false
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Record<string, any>>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_ORG_NETWORKS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list org networks',
        details: error
      });
    }
  }

  /**
   * List catalogs
   */
  async listCatalogs(zoneId?: string): Promise<McpToolResponse<ListResponse<Record<string, any>>>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: '/query',
        params: { type: 'catalog' }
      }, zoneId);
      const records = parseQueryResults(response.data);
      const listResponse: ListResponse<Record<string, any>> = {
        items: records, total: records.length, page: 1, pageSize: records.length, hasMore: false
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Record<string, any>>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_CATALOGS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list catalogs',
        details: error
      });
    }
  }

  /**
   * List catalog items (templates) within a catalog — needed to discover template IDs for create_vapp
   */
  async listCatalogItems(catalogId?: string, zoneId?: string): Promise<McpToolResponse<ListResponse<Record<string, any>>>> {
    try {
      const PAGE_SIZE = 128;
      const allRecords: Record<string, any>[] = [];
      let page = 1;
      let total = Infinity;

      while (allRecords.length < total) {
        const params: Record<string, string> = {
          type: 'catalogItem',
          pageSize: String(PAGE_SIZE),
          page: String(page),
        };
        if (catalogId) params.filter = `catalog==${catalogId}`;

        const response = await this.makeRequest<string>({ method: 'GET', url: '/query', params }, zoneId);
        const xml = String(response.data);

        // Extract total from root element attribute
        if (total === Infinity) {
          const totalMatch = xml.match(/\btotal="(\d+)"/);
          total = totalMatch?.[1] ? parseInt(totalMatch[1], 10) : 0;
          if (total === 0) break;
        }

        const records = parseQueryResults(xml);
        if (!records.length) break;
        allRecords.push(...records);

        if (allRecords.length >= total) break;
        page++;
      }

      const listResponse: ListResponse<Record<string, any>> = {
        items: allRecords, total: allRecords.length, page: 1, pageSize: allRecords.length, hasMore: false
      };
      return this.formatMcpResponse(listResponse, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<Record<string, any>>, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_CATALOG_ITEMS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list catalog items',
        details: error
      });
    }
  }

  // === SNAPSHOT METHODS (fork addition, legacy API) ===

  /**
   * List VM snapshots
   */
  async listSnapshots(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}/snapshotSection`
      }, zoneId);

      const xmlData = response.data;
      const sectionInfo = parseEntityAttributes(xmlData, /<(\w+:)?SnapshotSection\b[^>]*>/);

      // Parse any child <Snapshot> elements (self-closing or open tags)
      const snapshots: Record<string, any>[] = [];
      const snapPattern = /<(\w+:)?Snapshot\b[^>]*>/g;
      let snapMatch;
      while ((snapMatch = snapPattern.exec(xmlData)) !== null) {
        snapshots.push(parseEntityAttributes(snapMatch[0], /<[^>]+>/));
      }

      return this.formatMcpResponse({ sectionInfo, snapshots }, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'LIST_SNAPSHOTS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list snapshots',
        details: error
      });
    }
  }

  /**
   * Create a VM snapshot
   */
  async createSnapshot(vmId: string, snapshotName?: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<CreateSnapshotParams xmlns="http://www.vmware.com/vcloud/v1.5" name="${snapshotName || 'snapshot'}" memory="false" quiesce="false" />`;
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/action/createSnapshot`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.createSnapshotParams+xml' }
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_SNAPSHOT_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create snapshot',
        details: error
      });
    }
  }

  /**
   * Revert VM to current snapshot
   */
  async revertSnapshot(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/snapshot/action/revertToCurrentSnapshot`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'REVERT_SNAPSHOT_ERROR',
        message: error instanceof Error ? error.message : 'Failed to revert snapshot',
        details: error
      });
    }
  }

  /**
   * Remove all snapshots for a VM
   */
  async removeAllSnapshots(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/snapshot/action/removeAllSnapshots`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // 404 means no snapshot section exists → treat as no-op success
      if (msg.includes('HTTP 404')) {
        return this.formatMcpResponse(
          { _status: 'no_snapshots', message: 'No snapshots found — nothing to remove.' },
          zoneId || this.zoneManager.getConfig().defaultZone
        );
      }
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'REMOVE_SNAPSHOTS_ERROR',
        message: msg || 'Failed to remove snapshots',
        details: error
      });
    }
  }

  /**
   * Get health status across all zones (fork addition: exposed as MCP tool get_zone_health)
   */
  async getZoneHealth(): Promise<McpToolResponse<any>> {
    return this.getHealthStatus();
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

  // === P1 NEW TOOLS ===

  /**
   * Update an existing firewall rule by ID.
   * Accepts the same fields as createFirewallRule plus the ruleId to update.
   */
  async updateFirewallRule(
    edgeGatewayId: string,
    ruleId: string,
    firewallRule: Partial<FirewallRule>,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      const portProfiles = firewallRule.portProfiles ?? (firewallRule as any).portProfiles as string[] | undefined;
      const portProfileId = (firewallRule as any).portProfileId as string | undefined;
      const allPortProfiles = [...(portProfiles ?? []), ...(portProfileId ? [portProfileId] : [])];
      const payload: Record<string, any> = {
        id: ruleId,
        name: (firewallRule as any).name || firewallRule.description || 'MCP-Rule',
        enabled: firewallRule.isEnabled !== false,
        action: firewallRule.policy === 'allow' ? 'ALLOW' : ((firewallRule.policy as string) === 'reject' ? 'REJECT' : 'DROP'),
        ipProtocol: 'IPV4_IPV6',
        direction: 'IN_OUT',
        sourceFirewallGroups: (firewallRule.sourceFirewallGroups ?? []).map(id => ({ id })),
        destinationFirewallGroups: (firewallRule.destinationFirewallGroups ?? []).map(id => ({ id })),
        applicationPortProfiles: allPortProfiles.map(p => ({ id: p })),
        description: firewallRule.description || '',
        logging: firewallRule.enableLogging || false,
      };
      if (firewallRule.sourceIp && firewallRule.sourceIp !== 'Any') {
        payload.sourceFirewallIpAddresses = [firewallRule.sourceIp];
      }
      if (firewallRule.destinationIp && firewallRule.destinationIp !== 'Any') {
        payload.destinationFirewallIpAddresses = [firewallRule.destinationIp];
      }
      const data = await this.makeCloudApiRequest<any>(
        'PUT', `/edgeGateways/${gwUrn}/firewall/rules/${ruleId}`, zoneId, payload
      );
      const result = (data && Object.keys(data).length > 0) ? data : {
        _status: 'accepted',
        ruleId,
        message: 'Firewall rule update accepted. Use list_firewall_rules to confirm.',
      };
      return this.formatMcpResponse(result, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'UPDATE_FIREWALL_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update firewall rule',
        details: error,
      });
    }
  }

  /**
   * Delete a firewall rule by ID.
   */
  async deleteFirewallRule(
    edgeGatewayId: string,
    ruleId: string,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      await this.makeCloudApiRequest<any>(
        'DELETE', `/edgeGateways/${gwUrn}/firewall/rules/${ruleId}`, zoneId
      );
      return this.formatMcpResponse(
        { deleted: true, ruleId, message: 'Firewall rule deleted.' },
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'DELETE_FIREWALL_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete firewall rule',
        details: error,
      });
    }
  }

  /**
   * Create a NAT rule (DNAT or SNAT) on an edge gateway.
   * For DNAT: externalAddresses = public IP, internalAddresses = private IP, externalPort/internalPort for port mapping.
   * For SNAT: externalAddresses = SNAT IP, internalAddresses = source subnet to translate.
   */
  async createNatRule(
    edgeGatewayId: string,
    natRule: {
      name: string;
      type: 'DNAT' | 'SNAT' | 'REFLEXIVE';
      externalAddresses: string;
      internalAddresses: string;
      externalPort?: string;
      internalPort?: string;
      description?: string;
      enabled?: boolean;
      applicationPortProfileId?: string;
      applicationPortProfileName?: string;
      firewallMatch?: string;
    },
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      const payload: Record<string, any> = {
        name: natRule.name,
        ruleType: natRule.type,
        enabled: natRule.enabled !== false,
        description: natRule.description || '',
        externalAddresses: natRule.externalAddresses,
        internalAddresses: natRule.internalAddresses,
        firewallMatch: natRule.firewallMatch || 'MATCH_INTERNAL_ADDRESS',
      };
      if (natRule.externalPort) payload.dnatExternalPort = natRule.externalPort;
      if (natRule.applicationPortProfileId) {
        payload.applicationPortProfile = {
          id: natRule.applicationPortProfileId,
          name: natRule.applicationPortProfileName || natRule.applicationPortProfileId.split(':').pop() || '',
        };
      }
      const data = await this.makeCloudApiRequest<any>(
        'POST', `/edgeGateways/${gwUrn}/nat/rules`, zoneId, payload
      );
      const result = (data && Object.keys(data).length > 0) ? data : {
        _status: 'accepted',
        ruleName: natRule.name,
        type: natRule.type,
        message: 'NAT rule creation accepted. Use list_nat_rules to confirm the rule and retrieve its ID.',
      };
      return this.formatMcpResponse(result, zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'CREATE_NAT_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create NAT rule',
        details: error,
      });
    }
  }

  /**
   * Delete a NAT rule by ID.
   */
  async deleteNatRule(
    edgeGatewayId: string,
    ruleId: string,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    try {
      const gwUrn = toGatewayUrn(edgeGatewayId);
      await this.makeCloudApiRequest<any>(
        'DELETE', `/edgeGateways/${gwUrn}/nat/rules/${ruleId}`, zoneId
      );
      return this.formatMcpResponse(
        { deleted: true, ruleId, message: 'NAT rule deleted.' },
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'DELETE_NAT_RULE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete NAT rule',
        details: error,
      });
    }
  }

  /**
   * Hard reset a VM (equivalent to pressing the reset button — no guest OS involvement).
   * Use when shutdown/reboot fail due to unresponsive guest.
   */
  async resetVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vm-${vmId}/power/action/reset`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'RESET_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to reset VM',
        details: error
      });
    }
  }

  /**
   * Update the vCPU count of a VM. VM must be POWERED_OFF (status=8).
   * coresPerSocket defaults to 1 (all cores in one socket).
   */
  async updateVMCpu(vmId: string, cpuCount: number, coresPerSocket: number = 1, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<Item xmlns="http://www.vmware.com/vcloud/v1.5"
      xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
      xmlns:vmw="http://www.vmware.com/schema/ovf">
  <rasd:AllocationUnits>hertz * 10^6</rasd:AllocationUnits>
  <rasd:Description>Number of Virtual CPUs</rasd:Description>
  <rasd:ElementName>${cpuCount} virtual CPU(s)</rasd:ElementName>
  <rasd:InstanceID>1</rasd:InstanceID>
  <rasd:ResourceType>3</rasd:ResourceType>
  <rasd:VirtualQuantity>${cpuCount}</rasd:VirtualQuantity>
  <vmw:CoresPerSocket>${coresPerSocket}</vmw:CoresPerSocket>
</Item>`;
      const response = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/virtualHardwareSection/cpu`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItem+xml' }
      }, zoneId);
      return this.formatMcpResponse(
        { ...parseTaskResponse(response.data), cpuCount, coresPerSocket },
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'UPDATE_VM_CPU_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update VM CPU — ensure VM is powered off',
        details: error
      });
    }
  }

  /**
   * Update the RAM of a VM. VM must be POWERED_OFF (status=8).
   * memoryMB is in megabytes (e.g. 8192 = 8 GB).
   */
  async updateVMMemory(vmId: string, memoryMB: number, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<Item xmlns="http://www.vmware.com/vcloud/v1.5"
      xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData">
  <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
  <rasd:Description>Memory Size</rasd:Description>
  <rasd:ElementName>${memoryMB} MB of memory</rasd:ElementName>
  <rasd:InstanceID>2</rasd:InstanceID>
  <rasd:ResourceType>4</rasd:ResourceType>
  <rasd:VirtualQuantity>${memoryMB}</rasd:VirtualQuantity>
</Item>`;
      const response = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/virtualHardwareSection/memory`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItem+xml' }
      }, zoneId);
      return this.formatMcpResponse(
        { ...parseTaskResponse(response.data), memoryMB },
        zoneId || this.zoneManager.getConfig().defaultZone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'UPDATE_VM_MEMORY_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update VM memory — ensure VM is powered off',
        details: error
      });
    }
  }

  /**
   * Resize the boot disk of a VM (must be POWERED_OFF).
   * Uses virtualHardwareSection/disks (RASD format) — modifies InstanceID 2000 capacity.
   */
  async updateVMDisk(vmId: string, diskSizeMB: number, zoneId?: string): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}/virtualHardwareSection/disks`
      }, zoneId);
      const xml = getResp.data as unknown as string;
      // Scan individual <Item>...</Item> blocks to avoid cross-block regex spanning
      const itemPattern = /<Item\b[\s\S]*?<\/Item>/g;
      let diskItem: string | null = null;
      let im: RegExpExecArray | null;
      while ((im = itemPattern.exec(xml)) !== null) {
        if (im[0].includes('<rasd:InstanceID>2000</rasd:InstanceID>')) {
          diskItem = im[0];
          break;
        }
      }
      if (!diskItem) {
        const ids = [...xml.matchAll(/<rasd:InstanceID>(\d+)<\/rasd:InstanceID>/g)].map(x => x[1]);
        throw new Error(`Disk InstanceID 2000 not found. Present IDs: [${ids.join(', ')}]`);
      }

      // VirtualQuantity is in bytes; capacity attribute is in MB with a dynamic namespace prefix
      const diskSizeBytes = diskSizeMB * 1024 * 1024;
      const capacityPrefix = diskItem.match(/(\w+):capacity="\d+"/)?.[1] ?? 'ns10';
      const updatedItem = diskItem
        .replace(/\w+:capacity="\d+"/, `${capacityPrefix}:capacity="${diskSizeMB}"`)
        .replace(/(<rasd:VirtualQuantity>)\d+(<\/rasd:VirtualQuantity>)/, `$1${diskSizeBytes}$2`);
      const updated = xml.replace(diskItem, updatedItem);

      const putResp = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/virtualHardwareSection/disks`,
        data: updated,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItemsList+xml' }
      }, zoneId);
      return this.formatMcpResponse(
        { ...parseTaskResponse(putResp.data), diskSizeMB },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'UPDATE_VM_DISK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to resize disk — ensure VM is powered off',
        details: error
      });
    }
  }

  /**
   * Delete a vApp and all VMs inside it.
   * If the vApp is still deployed (deployed=true), automatically undeployes first and
   * polls the undeploy task before issuing DELETE.
   */
  async deleteVApp(vappId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Auto-undeploy if vApp is still deployed
      const vappInfo = await this.getVApp(vappId, zoneId);
      if (vappInfo.success && vappInfo.data?.deployed === true) {
        const undeployResult = await this.undeployVApp(vappId, zoneId);
        if (!undeployResult.success) {
          return this.formatMcpResponse({}, zone, {
            code: 'UNDEPLOY_BEFORE_DELETE_ERROR',
            message: `Cannot delete: undeploy failed — ${undeployResult.error?.message}`,
            details: undeployResult.error
          });
        }
        // Poll undeploy task until complete (max 120s)
        const taskId = undeployResult.data?.taskId;
        const start = Date.now();
        while ((Date.now() - start) / 1000 < 120) {
          await new Promise(r => setTimeout(r, 5000));
          if (!taskId) break;
          const t = await this.getTask(taskId, zoneId);
          const s = t.data?.taskStatus;
          if (s === 'success') break;
          if (s === 'error' || s === 'aborted') {
            return this.formatMcpResponse({}, zone, {
              code: 'UNDEPLOY_TASK_FAILED',
              message: `Undeploy task ended with status=${s} — vApp may still be deployed`,
              details: t.data
            });
          }
        }
      }

      // DELETE returns 202 with a Task XML body
      const response = await this.makeRequest<string>({
        method: 'DELETE',
        url: `/vApp/vapp-${vappId}`
      }, zoneId);
      const task = response.data ? parseTaskResponse(response.data) : { _status: 'accepted' };
      return this.formatMcpResponse(
        { ...task, vappId, message: 'vApp deletion task queued.' },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'DELETE_VAPP_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete vApp',
        details: error
      });
    }
  }

  /**
   * Update a VM NIC's network connection properties (network, IP mode, IP address, primary flag).
   * Works on running or powered-off VMs. Fetches the current NetworkConnectionSection, patches the
   * target NIC by index, and PUTs the section back.
   */
  async updateVMNetwork(
    vmId: string,
    update: {
      nicIndex?: number;
      networkName?: string;
      ipMode?: 'DHCP' | 'POOL' | 'MANUAL' | 'NONE';
      ipAddress?: string;
      isPrimary?: boolean;
    },
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}/networkConnectionSection`
      }, zoneId);

      let xml = getResp.data as unknown as string;
      const nicIndex = update.nicIndex ?? 0;

      // Extract all <NetworkConnection>...</NetworkConnection> blocks
      const ncPattern = /(<NetworkConnection\b[^>]*>[\s\S]*?<\/NetworkConnection>)/g;
      let m: RegExpExecArray | null;
      const allNcs: string[] = [];
      let targetNc: string | null = null;
      while ((m = ncPattern.exec(xml)) !== null) {
        const block = m[1] ?? '';
        if (!block) continue;
        allNcs.push(block);
        const idxMatch = block.match(/<NetworkConnectionIndex>(\d+)<\/NetworkConnectionIndex>/);
        if (idxMatch && idxMatch[1] !== undefined && parseInt(idxMatch[1], 10) === nicIndex) {
          targetNc = block;
        }
      }

      if (!targetNc) {
        const found = allNcs
          .map(n => n.match(/<NetworkConnectionIndex>(\d+)<\/NetworkConnectionIndex>/)?.[1])
          .filter(Boolean)
          .join(', ');
        throw new Error(`NIC index ${nicIndex} not found. Available NIC indices: [${found}]`);
      }

      let updatedNc = targetNc;

      if (update.networkName) {
        updatedNc = updatedNc.replace(
          /(<NetworkConnection\b[^>]*\bnetwork=")[^"]*(")/,
          `$1${update.networkName}$2`
        );
      }

      if (update.ipMode) {
        updatedNc = updatedNc.replace(
          /<IpAddressAllocationMode>[^<]*<\/IpAddressAllocationMode>/,
          `<IpAddressAllocationMode>${update.ipMode}</IpAddressAllocationMode>`
        );
        if (update.ipMode !== 'MANUAL') {
          updatedNc = updatedNc.replace(/<IpAddress>[^<]*<\/IpAddress>\s*/g, '');
        }
      }

      if (update.ipAddress) {
        if (updatedNc.includes('<IpAddress>')) {
          updatedNc = updatedNc.replace(/<IpAddress>[^<]*<\/IpAddress>/, `<IpAddress>${update.ipAddress}</IpAddress>`);
        } else {
          updatedNc = updatedNc.replace('<IsConnected>', `<IpAddress>${update.ipAddress}</IpAddress>\n                <IsConnected>`);
        }
      }

      xml = xml.replace(targetNc, updatedNc);

      if (update.isPrimary) {
        xml = xml.replace(
          /<PrimaryNetworkConnectionIndex>\d+<\/PrimaryNetworkConnectionIndex>/,
          `<PrimaryNetworkConnectionIndex>${nicIndex}</PrimaryNetworkConnectionIndex>`
        );
      }

      const putResp = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/networkConnectionSection`,
        data: xml,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.networkConnectionSection+xml' }
      }, zoneId);

      return this.formatMcpResponse(
        {
          ...parseTaskResponse(putResp.data as unknown as string),
          vmId,
          nicIndex,
          updated: {
            networkName: update.networkName,
            ipMode: update.ipMode,
            ipAddress: update.ipAddress,
            isPrimary: update.isPrimary,
          },
        },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'UPDATE_VM_NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update VM network',
        details: error
      });
    }
  }

  /**
   * List application port profiles (system + tenant scope).
   * filter: 'ALL' | 'SYSTEM' | 'TENANT' (default ALL)
   */
  async listApplicationPortProfiles(filter?: string, zoneId?: string): Promise<McpToolResponse<ListResponse<any>>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const scope = filter?.toUpperCase() ?? 'ALL';
      const filterParam = scope === 'ALL' ? '' : `?filter=scope==${scope}`;
      const data = await this.makeCloudApiRequest<any>('GET', `/applicationPortProfiles${filterParam}`, zoneId);
      const items: any[] = Array.isArray(data) ? data : (data.values ?? data.resultTotal !== undefined ? data.values ?? [] : []);
      return this.formatMcpResponse(
        { items, total: data.resultTotal ?? items.length, page: 1, pageSize: items.length, hasMore: false } as ListResponse<any>,
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({} as ListResponse<any>, zone, {
        code: 'LIST_APP_PORT_PROFILES_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list application port profiles',
        details: error,
      });
    }
  }

  /**
   * Create a custom application port profile scoped to the tenant org.
   * contextEntityId is passed as-is — caller supplies the exact URN vCD requires.
   * orgRef is resolved automatically from the org query API.
   * ports: array of { protocol: 'TCP'|'UDP'|'ICMPv4'|'ICMPv6', destinationPorts: string[] }
   */
  async createApplicationPortProfile(
    name: string,
    contextEntityId: string,
    ports: Array<{ protocol: string; destinationPorts: string[] }>,
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Resolve org URN for orgRef — required by vCD alongside contextEntityId
      const orgListResp = await this.makeRequest<string>(
        { method: 'GET', url: '/query', params: { type: 'organization' } },
        zoneId
      );
      const orgs = parseOrganizationRecords(orgListResp.data);
      const rawOrgId = orgs[0]?.id || '';
      const orgUrn = rawOrgId.startsWith('urn:vcloud:org:') ? rawOrgId : `urn:vcloud:org:${rawOrgId}`;
      if (!rawOrgId) throw new Error('Could not resolve org URN for orgRef — listOrganizations returned no results');

      const payload = {
        name,
        scope: 'TENANT',
        contextEntityId,
        orgRef: { id: orgUrn },
        applicationPorts: ports.map(p => ({
          protocol: p.protocol.toUpperCase(),
          destinationPorts: p.destinationPorts,
        })),
      };
      const data = await this.makeCloudApiRequest<any>(
        'POST',
        '/applicationPortProfiles',
        zoneId,
        payload
      );
      return this.formatMcpResponse(data, zone);
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'CREATE_APP_PORT_PROFILE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create application port profile',
        details: error,
      });
    }
  }

  async deleteApplicationPortProfile(profileId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Strip URN prefix if present — CloudAPI path needs only the UUID
      const uuid = profileId.includes(':') ? profileId.split(':').pop()! : profileId;
      await this.makeCloudApiRequest<any>('DELETE', `/applicationPortProfiles/${uuid}`, zoneId);
      return this.formatMcpResponse({ deleted: true, profileId }, zone);
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'DELETE_APP_PORT_PROFILE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete application port profile',
        details: error,
      });
    }
  }

  /**
   * Get the status of an async task by its task ID.
   * Use after power ops, create_vapp, snapshots, etc. to poll for completion.
   * taskId is the UUID from the taskHref returned by those operations.
   */
  async getTask(taskId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/task/${taskId}`
      }, zoneId);
      return this.formatMcpResponse(parseTaskResponse(response.data), zoneId || this.zoneManager.getConfig().defaultZone);
    } catch (error) {
      return this.formatMcpResponse({}, zoneId || this.zoneManager.getConfig().defaultZone, {
        code: 'GET_TASK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get task status',
        details: error
      });
    }
  }
}

/**
 * Convert CIDR prefix length to dotted-decimal netmask
 */
function prefixToNetmask(prefix: number): string {
  const mask = ~(0xFFFFFFFF >>> prefix) >>> 0;
  return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.');
}

/**
 * Ensure an edge gateway ID is in full URN format for CloudAPI calls.
 * Accepts either bare UUID or urn:vcloud:gateway:{uuid}.
 */
function toGatewayUrn(id: string): string {
  return id.startsWith('urn:vcloud:gateway:') ? id : `urn:vcloud:gateway:${id}`;
}

