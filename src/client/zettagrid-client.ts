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
  VAppVmConfig,
  VAppNetworkConnection
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
  parseProductSectionProperties,
  parseVAppDetails,
  parseTaskResponse
} from '../utils/xml-parser.js';

// VCD ID FORMAT NOTE — recurring source of bugs, read before touching ID-handling code.
//
// VCD exposes three ID formats for the same entity:
//   URN (canonical):  urn:vcloud:vm:UUID  /  urn:vcloud:vapp:UUID
//   REST path:        /vApp/vm-UUID        /  /vApp/vapp-UUID
//   Query/filter:     bare UUID only       (NOT the URN form)
//
// Rules:
//   - REST API URL paths: always strip the URN prefix → use vmUuid()/vappUuid()
//   - /query?filter=container==VALUE: pass bare UUID (vappUuid()), NOT the full URN
//   - Client inputs and fixture config may be in any format; always normalise before use
//   - formatMcpResponse data.vappId / data.vmId are bare UUIDs (extracted from hrefs)
//
// If a list/filter call returns 0 results when you expect VMs, check the ID format first.
function vmUuid(vmId: string): string {
  return vmId.startsWith('urn:vcloud:vm:') ? vmId.slice(14) : vmId;
}
function vappUuid(vappId: string): string {
  return vappId.startsWith('urn:vcloud:vapp:') ? vappId.slice(16) : vappId;
}

// XML escaping utility — prevents injection and XML parsing errors in user-provided values
function xmlEscape(value: string | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class ZettagridClient {
  private zoneManager: ZoneManager;
  private tokenManager: TokenManager;
  private zoneAuth: Map<string, ZoneAuth> = new Map();

  /** Bare-UUID test — used to tell an already-resolved id apart from a friendly name that
   *  still needs a list_vdcs/list_vapps lookup. */
  private isUuidLike(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  /** Resolve a VDC identifier that may be a bare UUID, urn:vcloud:vdc:UUID, an href, or a
   *  friendly VDC name (e.g. "DC_1139703") into the bare UUID VCD's /query filters and REST
   *  paths require. Passing a friendly name straight through (the pre-fix behavior) produces a
   *  generic HTTP 500/400 from VCD that reads like a permissions failure, not an input error.
   *  UUID/URN/href forms resolve locally with no extra API call; a name costs one list_vdcs call. */
  private async resolveVdcId(vdcIdOrName: string, zoneId?: string): Promise<string> {
    const normalized = normalizeIdFromHrefOrId(vdcIdOrName);
    const stripped = normalized.startsWith('urn:vcloud:vdc:') ? normalized.slice(15) : normalized;
    if (this.isUuidLike(stripped)) return stripped;

    const vdcs = await this.listVdcs(zoneId);
    const match = vdcs.data?.items?.find(v => v.name === vdcIdOrName);
    if (!match?.id) {
      throw new Error(`VDC "${vdcIdOrName}" not found by name — use list_vdcs to find the correct id.`);
    }
    return String(match.id);
  }

  /** Same resolution as resolveVdcId, for vApp identifiers (list_vapps lookup by name). */
  private async resolveVAppId(vAppIdOrName: string, zoneId?: string): Promise<string> {
    const stripped = vappUuid(normalizeIdFromHrefOrId(vAppIdOrName));
    if (this.isUuidLike(stripped)) return stripped;

    const vapps = await this.listVApps(undefined, zoneId);
    const match = vapps.data?.items?.find(v => v.name === vAppIdOrName);
    if (!match?.id) {
      throw new Error(`vApp "${vAppIdOrName}" not found by name — use list_vapps to find the correct id.`);
    }
    return String(match.id);
  }

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

    // `data` must always be attached, error or not — many call sites intentionally pass
    // diagnostic data ALONGSIDE an error (CLARIFICATION_REQUIRED's availableNetworks,
    // exhausted-pool details, orphanVmId, delete_vapp's multi-VM guard details, etc.), and
    // their own error messages tell the caller to look in `data` for that clarifying data.
    // The previous else-branch here silently dropped `data` on every single error response.
    const response: McpToolResponse<T> = {
      success: !error,
      metadata: {
        zone: zoneId,
        organization: zoneConfig.organizationName,
        timestamp: new Date().toISOString()
      },
      data,
    };

    if (error) {
      response.error = error;
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
      const resolvedVdcId = await this.resolveVdcId(vdcId, zoneId);
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vdc/${resolvedVdcId}`
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
    try {
      const vdcId = await this.resolveVdcId(vdcIdOrHref, zoneId);

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

      if (vdcId) params.filter = `vdc==${await this.resolveVdcId(vdcId, zoneId)}`;
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
        url: `/vApp/vapp-${vappUuid(vAppId)}`
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
        url: `/vApp/vapp-${vappUuid(vAppId)}/power/action/powerOn`
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
        url: `/vApp/vapp-${vappUuid(vAppId)}/power/action/powerOff`
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
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    const uuid = vappUuid(vappId);
    const makeUndeployPayload = (action: string) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<UndeployVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">\n  <UndeployPowerAction>${action}</UndeployPowerAction>\n</UndeployVAppParams>`;

    // Strategy 1: standard force powerOff + undeploy
    try {
      const response = await this.makeRequest<string>({
        method: 'POST', url: `/vApp/vapp-${uuid}/action/undeploy`,
        data: makeUndeployPayload('powerOff'),
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' }
      }, zoneId);
      const task = response.data ? parseTaskResponse(response.data) : { _status: 'accepted' };
      return this.formatMcpResponse({ ...task, vappId, message: 'vApp undeploy task queued.' }, zone);
    } catch (e1: any) {
      // Strategy 2: power off individual VMs then undeploy with default action
      try {
        // Get VM UUIDs from vApp XML
        const vappResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vapp-${uuid}` }, zoneId);
        const vmUuids = [...String(vappResp.data).matchAll(/\/vApp\/vm-([0-9a-f-]{36})/g)].map(m => m[1] as string);
        const seen = new Set<string>();
        for (const vmId of vmUuids) {
          if (seen.has(vmId)) continue;
          seen.add(vmId);
          await this.makeRequest<string>({
            method: 'POST', url: `/vApp/vm-${vmId}/power/action/powerOff`
          }, zoneId).catch(() => {});
        }
        // Wait for individual power-offs to settle before retrying undeploy
        await new Promise(r => setTimeout(r, 15000));
        const response2 = await this.makeRequest<string>({
          method: 'POST', url: `/vApp/vapp-${uuid}/action/undeploy`,
          data: makeUndeployPayload('powerOff'),
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' }
        }, zoneId);
        const task2 = response2.data ? parseTaskResponse(response2.data) : { _status: 'accepted' };
        return this.formatMcpResponse({ ...task2, vappId, message: 'vApp undeploy task queued (fallback).' }, zone);
      } catch (e2: any) {
        return this.formatMcpResponse({}, zone, {
          code: 'UNDEPLOY_VAPP_ERROR',
          message: e1 instanceof Error ? e1.message : 'Failed to undeploy vApp',
          details: e1
        });
      }
    }
  }

  // === VM METHODS ===

  /**
   * List Virtual Machines
   */
  async listVMs(vAppId?: string, zoneId?: string, pagination?: PaginationParams): Promise<McpToolResponse<ListResponse<Vm>>> {
    try {
      const params: Record<string, string> = { type: 'vm' };

      // VCD query filter requires bare UUID — passing a full URN silently returns 0 results.
      // resolveVAppId also accepts a friendly vApp name (extra list_vapps lookup) or href.
      if (vAppId) params.filter = `container==${await this.resolveVAppId(vAppId, zoneId)}`;
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
      // Fetch entity XML, disk sub-resource, and OVF product-section properties in parallel.
      // The disk sub-resource is authoritative for current disk sizes after hot-resize (the
      // full entity XML may lag behind); productSections isn't in the entity XML at all — it's
      // the only way to verify what a VM was actually configured with (e.g. SSH key injection).
      const uuid = vmUuid(vmId);
      const zone = zoneId || this.zoneManager.getConfig().defaultZone;
      const [entityResp, diskResp, productSectionsResp] = await Promise.all([
        this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId),
        this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}/virtualHardwareSection/disks` }, zoneId)
          .catch(() => null),
        this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}/productSections` }, zoneId)
          .catch(() => null),
      ]);

      // parseVmDetails extracts root attributes + CPU/RAM/IP from child XML elements
      const parsed = parseVmDetails(entityResp.data);

      if (productSectionsResp) {
        const ovfProperties = parseProductSectionProperties(productSectionsResp.data as unknown as string);
        if (ovfProperties.length > 0) parsed.ovfProperties = ovfProperties;
      }

      // Override disk info with sub-resource data (avoids stale entity XML after hot-resize).
      // Uses the same <Item>...</Item> pattern as updateVMDisk — no namespace prefix in this endpoint.
      // Sort: InstanceID 2000 (standard VCD boot disk) first so disks[0] matches updateVMDisk's target.
      if (diskResp) {
        const diskXml = diskResp.data as unknown as string;
        const itemPattern = /<Item\b[\s\S]*?<\/Item>/g;
        const parsed_disks: Array<{instanceId: string; name: string; capacityMB: number; capacityGB: number}> = [];
        let im: RegExpExecArray | null;
        let idx = 0;
        while ((im = itemPattern.exec(diskXml)) !== null) {
          const item = im[0];
          const capMatch = /\w+:capacity="(\d+)"/.exec(item);
          if (!capMatch?.[1]) continue;
          const capacityMB = parseInt(capMatch[1], 10);
          if (capacityMB <= 0) continue;
          const nameMatch = /<rasd:ElementName>(.*?)<\/rasd:ElementName>/.exec(item);
          const idMatch   = /<rasd:InstanceID>(\d+)<\/rasd:InstanceID>/.exec(item);
          parsed_disks.push({
            instanceId: idMatch?.[1] ?? '9999',
            name: nameMatch?.[1] ?? `Hard disk ${idx + 1}`,
            capacityMB,
            capacityGB: Math.round(capacityMB / 1024 * 10) / 10,
          });
          idx++;
        }
        // InstanceID 2000 first; remaining by capacity descending
        parsed_disks.sort((a, b) => {
          if (a.instanceId === '2000') return -1;
          if (b.instanceId === '2000') return 1;
          return b.capacityMB - a.capacityMB;
        });
        const refreshed = parsed_disks.map(({ name, capacityMB, capacityGB }) => ({ name, capacityMB, capacityGB }));
        if (refreshed.length > 0) parsed.disks = refreshed;
      }

      return this.formatMcpResponse(parsed as unknown as Vm, zone);
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
        url: `/vApp/vm-${vmUuid(vmId)}/guestCustomizationSection`
      }, zoneId);

      const currentXml = getResp.data as unknown as string;
      const updatedXml = currentXml.includes('<ComputerName>')
        ? currentXml.replace(/<ComputerName>[^<]*<\/ComputerName>/, `<ComputerName>${computerName}</ComputerName>`)
        : currentXml.replace('</GuestCustomizationSection>', `    <ComputerName>${computerName}</ComputerName>\n</GuestCustomizationSection>`);

      const putResp = await this.makeRequest<string>({
        method: 'PUT',
        url: `/vApp/vm-${vmUuid(vmId)}/guestCustomizationSection`,
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/powerOn`
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/powerOff`
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/shutdown`
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/reboot`
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/suspend`
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
        url: `/vApp/vm-${vmUuid(vmId)}/screen/action/acquireTicket`
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

  /** Fetch all org VDC networks available in a given VDC for auto-discovery during VM creation
   *  — routed AND isolated (and any other type). Do not filter by linkType: a caller may
   *  legitimately want an isolated network (e.g. internal-only VMs), and both createVApp's
   *  auto-discovery and add_vm_to_vapp's clarification path should offer every real option,
   *  not silently assume routed is the only kind worth listing. */
  private async fetchVdcNetworkOptions(vdcId: string, zoneId?: string): Promise<Array<{
    name: string; href: string; defaultGateway?: string; subnetPrefixLength?: number;
    availableIps: number; totalIps: number; linkType?: number;
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
        .filter(r => r.vdc && String(r.vdc).includes(vdcId))
        .map(r => ({
          name: String(r.name ?? ''),
          href: String(r.href ?? ''),
          defaultGateway: r.defaultGateway ? String(r.defaultGateway) : undefined,
          subnetPrefixLength: r.subnetPrefixLength ? Number(r.subnetPrefixLength) : undefined,
          availableIps: (Number(r.totalIpCount) || 0) - (Number(r.usedIpCount) || 0),
          totalIps: Number(r.totalIpCount) || 0,
          linkType: r.linkType !== undefined ? Number(r.linkType) : undefined,
        }));
    } catch {
      return [];
    }
  }

  /** Fetch detailed network configuration including IP ranges, gateway, and allocated IPs from VM network connections */
  private async fetchNetworkDetailedConfig(networkHref: string, vdcId?: string, networkName?: string, zoneId?: string): Promise<{ gateway?: string; subnetMask?: string; ipRanges?: Array<{ startAddress: string; endAddress: string }>; dhcp?: boolean; dhcpPools?: Array<{ startAddress: string; endAddress: string }>; usedIps?: string[] } | null> {
    try {
      const pathMatch = networkHref.match(/\/api(\/.+)/);
      const relativePath = pathMatch?.[1] ?? networkHref;
      const response = await this.makeRequest<string>({ method: 'GET', url: relativePath }, zoneId);
      const xml = response.data as unknown as string;

      // Extract gateway
      const gatewayMatch = xml.match(/<Gateway>([^<]+)<\/Gateway>/);
      const gateway = gatewayMatch?.[1];

      // Extract subnet mask
      const maskMatch = xml.match(/<Netmask>([^<]+)<\/Netmask>/);
      const subnetMask = maskMatch?.[1];

      // Extract IP ranges from StaticIpPool
      const ipRanges: Array<{ startAddress: string; endAddress: string }> = [];
      const rangeRe = /<IpRange>\s*<StartAddress>([^<]+)<\/StartAddress>\s*<EndAddress>([^<]+)<\/EndAddress>\s*<\/IpRange>/g;
      let m;
      while ((m = rangeRe.exec(xml)) !== null) {
        if (m[1] && m[2]) {
          ipRanges.push({ startAddress: m[1], endAddress: m[2] });
        }
      }

      // Check if DHCP is enabled
      const dhcpMatch = xml.match(/<DhcpService>\s*<IsEnabled>([^<]+)<\/IsEnabled>/);
      const dhcpEnabled = dhcpMatch?.[1] === 'true';

      // Extract DHCP pools (DhcpPools section contains IP ranges available for DHCP assignment)
      const dhcpPools: Array<{ startAddress: string; endAddress: string }> = [];
      const dhcpPoolsMatch = xml.match(/<DhcpPools>([\s\S]*?)<\/DhcpPools>/);
      if (dhcpPoolsMatch?.[1]) {
        const dhcpPoolsXml = dhcpPoolsMatch[1];
        const dhcpRangeRe = /<IpRange>\s*<StartAddress>([^<]+)<\/StartAddress>\s*<EndAddress>([^<]+)<\/EndAddress>\s*<\/IpRange>/g;
        let dhcpM;
        while ((dhcpM = dhcpRangeRe.exec(dhcpPoolsXml)) !== null) {
          if (dhcpM[1] && dhcpM[2]) {
            dhcpPools.push({ startAddress: dhcpM[1], endAddress: dhcpM[2] });
          }
        }
      }

      const dhcpFullyConfigured = dhcpEnabled && dhcpPools.length > 0;

      // Extract allocated/used IPs: first try from network XML, then fall back to querying VMs
      const usedIps: Set<string> = new Set();

      // Try to extract from network XML first (some vCD installations may include this)
      const usedPoolRe = /<UsedIpAddress>([^<]+)<\/UsedIpAddress>/g;
      let usedMatch;
      while ((usedMatch = usedPoolRe.exec(xml)) !== null) {
        if (usedMatch[1]) {
          usedIps.add(usedMatch[1]);
        }
      }

      // If XML extraction found nothing, query VMs to get allocated IPs
      if (usedIps.size === 0 && vdcId && networkName) {
        try {
          const resolvedVdcId = await this.resolveVdcId(vdcId, zoneId);
          const params: Record<string, string> = {
            type: 'vm',
            filter: `vdc==${resolvedVdcId}`
          };
          const vmListResponse = await this.makeRequest<string>({
            method: 'GET',
            url: '/query',
            params
          }, zoneId);

          // Extract IPs from VM network connections for this specific network
          const vmNetworkRe = /<NetworkConnection\s+network="([^"]*)"[^>]*>[\s\S]*?<IpAddress>([^<]+)<\/IpAddress>/g;
          let vmMatch;
          while ((vmMatch = vmNetworkRe.exec(vmListResponse.data as unknown as string)) !== null) {
            const [, connNetwork, ipAddr] = vmMatch;
            // Only add IPs from VMs connected to this specific network
            if (connNetwork === networkName && ipAddr) {
              usedIps.add(ipAddr);
            }
          }
        } catch {
          // If VM query fails, continue without used IPs data; this is not critical
        }
      }

      return {
        gateway,
        subnetMask,
        ipRanges: ipRanges.length > 0 ? ipRanges : undefined,
        dhcp: dhcpFullyConfigured,
        dhcpPools: dhcpPools.length > 0 ? dhcpPools : undefined,
        usedIps: usedIps.size > 0 ? Array.from(usedIps) : undefined
      };
    } catch (e) {
      return null;
    }
  }

  /** Generate suggested available IPs from a network's IP range, skipping already-used IPs */
  private generateSuggestedIps(gateway: string | undefined, startAddress: string | undefined, endAddress: string | undefined, count: number = 5, usedIps?: string[]): string[] {
    try {
      if (!startAddress || !endAddress) return [];

      // Parse IP addresses
      const parts = (str: string) => str.split('.').map(Number);
      const start = parts(startAddress);
      const end = parts(endAddress);

      if (start.length !== 4 || end.length !== 4) return [];

      // Convert to number for easier manipulation
      const startNum = (start[0]! << 24) | (start[1]! << 16) | (start[2]! << 8) | start[3]!;
      const endNum = (end[0]! << 24) | (end[1]! << 16) | (end[2]! << 8) | end[3]!;
      const range = endNum - startNum;

      const suggested: string[] = [];
      const usedSet = new Set(usedIps || []);
      if (range < 1) return [];

      // Generate IPs spread across the range, avoiding gateway and already-used IPs
      const step = Math.max(1, Math.floor(range / (count + 1)));
      for (let i = 1; i <= count * 3 && suggested.length < count; i++) { // Try up to 3x the candidates to account for used IPs
        const ip = startNum + (step * i);
        if (ip >= startNum && ip <= endNum) {
          const ipStr = `${(ip >>> 24) & 0xFF}.${(ip >>> 16) & 0xFF}.${(ip >>> 8) & 0xFF}.${ip & 0xFF}`;

          // Skip gateway, broadcast, and already-used IPs
          if (gateway && ipStr === gateway) continue;
          if (ipStr === endAddress) continue;
          if (usedSet.has(ipStr)) continue;

          suggested.push(ipStr);
        }
      }

      return suggested.slice(0, count);
    } catch {
      return [];
    }
  }

  /** Detect if template name indicates Ubuntu 24.04 or later */
  private async isUbuntuModernTemplate(templateHref: string, zoneId?: string): Promise<boolean> {
    try {
      const pathMatch = templateHref.match(/\/api(\/.+)/);
      const relativePath = pathMatch?.[1] ?? templateHref;
      const response = await this.makeRequest<string>({ method: 'GET', url: relativePath }, zoneId);
      const xml = response.data as unknown as string;

      // Extract template name and description
      const nameMatch = xml.match(/<VAppTemplate\b[^>]*name="([^"]+)"/i) || xml.match(/<Name>([^<]+)<\/Name>/);
      const name = nameMatch?.[1]?.toLowerCase() ?? '';

      const descMatch = xml.match(/<Description>([^<]*)<\/Description>/i);
      const desc = descMatch?.[1]?.toLowerCase() ?? '';

      const combined = `${name} ${desc}`;

      // Check for Ubuntu 24.04 or later
      // Patterns: "ubuntu 24", "ubuntu-24", "ubuntu 25", "noble", "oracular"
      return /ubuntu\s*[2-9][4-9]|ubuntu\D*24\.|ubuntu\D*25\.|noble|oracular/.test(combined);
    } catch {
      return false;
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

  /** Fetch the set of network names already configured on an existing vApp's NetworkConfigSection
   *  (excluding the special "none" entry). Used by addVMToVApp to decide whether a requested
   *  network needs to be newly bridged in via InstantiationParams, or already exists on the vApp
   *  and can be referenced directly as a NetworkAssignment containerNetwork. */
  private async fetchVAppNetworkNames(vappId: string, zoneId?: string): Promise<Set<string>> {
    try {
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vapp-${vappUuid(vappId)}`
      }, zoneId);
      const xml = response.data as unknown as string;
      const names = new Set<string>();
      const re = /<NetworkConfig\b[^>]*\bnetworkName="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const name = m[1];
        if (name && name.toLowerCase() !== 'none') names.add(name);
      }
      return names;
    } catch {
      return new Set<string>();
    }
  }

  /** Compute {innerNetwork, containerNetwork} NetworkAssignment pairs for a VM whose template
   *  NIC network name doesn't match the vApp network name it should attach to. Callers that pre-
   *  rename networkConnections to already match the template name (see createVApp) naturally get
   *  an empty result here, since innerNetwork === containerNetwork for every pair.
   *  "none" (the template NIC was never connected to anything at capture time) is excluded too —
   *  it's not a real OVF-declared network name, so vCD rejects a NetworkAssignment referencing it
   *  as innerNetwork. A disconnected NIC is attached directly via the NetworkConnectionSection
   *  override alone; there's nothing to remap away from. */
  private computeNetworkAssignments(
    templateNetworks: string[],
    networkConnections?: VAppNetworkConnection[]
  ): Array<{ innerNetwork: string; containerNetwork: string }> {
    if (!templateNetworks.length || !networkConnections?.length) return [];
    const targetNames = networkConnections.map(nc => nc.networkName);
    return templateNetworks
      .map((innerNetwork, i) => ({
        innerNetwork,
        containerNetwork: targetNames[i] ?? targetNames[0] ?? innerNetwork,
      }))
      .filter(a => a.innerNetwork !== a.containerNetwork && a.innerNetwork.toLowerCase() !== 'none');
  }

  /** Generate netplan v2 configuration YAML for cloud-init to apply during boot.
   *  Used for Ubuntu 24.04+ VMs with MANUAL IP mode instead of relying on vCD guest customization. */
  private generateNetplanUserData(
    nicIndex: number,
    ipAddress: string,
    gateway: string | undefined,
    subnetMask: string | undefined
  ): string {
    // Calculate CIDR notation from subnet mask
    let cidr = '/24'; // Default to /24
    if (subnetMask) {
      const parts = subnetMask.split('.');
      if (parts.length === 4) {
        const octets = parts.map(Number);
        let bits = 0;
        for (const octet of octets) {
          let mask = octet;
          while (mask > 0) {
            bits += mask & 1;
            mask >>= 1;
          }
        }
        cidr = `/${bits}`;
      }
    }

    const ethName = `eth${nicIndex}`;
    const netplanYaml = `#cloud-config
network:
  version: 2
  ethernets:
    ${ethName}:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${ipAddress}${cidr}
${gateway ? `      gateway4: ${gateway}` : ''}
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]`;

    // Encode as cloud-config for cloud-init
    return netplanYaml;
  }

  /** Enable guest customization on an existing VM (POST-deployment).
   *  For non-cloud-init templates with POOL/MANUAL IP modes, we need to enable guest customization
   *  after the VM is created, since vCD may not respect instantiation-time settings for Linux VMs. */
  private async enableVmGuestCustomization(vmHref: string, computerName: string, zoneId?: string): Promise<void> {
    try {
      const vmId = vmUuid(vmHref);

      // Fetch current guest customization section
      const response = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmId}/guestCustomizationSection`,
      }, zoneId);

      // Parse the current section
      let guestCustomizationXml = response.data as unknown as string;

      // Update or inject <Enabled>true</Enabled>
      if (guestCustomizationXml.includes('<Enabled>')) {
        guestCustomizationXml = guestCustomizationXml.replace(
          /<Enabled>.*?<\/Enabled>/,
          '<Enabled>true</Enabled>'
        );
      } else {
        // Inject <Enabled>true</Enabled> after <ovf:Info>
        guestCustomizationXml = guestCustomizationXml.replace(
          /<ovf:Info[^>]*>.*?<\/ovf:Info>/,
          m => m + '\n            <Enabled>true</Enabled>'
        );
      }

      // Ensure ComputerName is set
      if (!guestCustomizationXml.includes('<ComputerName>')) {
        guestCustomizationXml = guestCustomizationXml.replace(
          /<\/GuestCustomizationSection>/,
          `            <ComputerName>${xmlEscape(computerName)}</ComputerName>\n        </GuestCustomizationSection>`
        );
      } else {
        guestCustomizationXml = guestCustomizationXml.replace(
          /<ComputerName>.*?<\/ComputerName>/,
          `<ComputerName>${xmlEscape(computerName)}</ComputerName>`
        );
      }

      // PUT the updated section back
      await this.makeRequest({
        method: 'PUT',
        url: `/vApp/vm-${vmId}/guestCustomizationSection`,
        data: guestCustomizationXml,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.guestCustomizationSection+xml' }
      }, zoneId);
    } catch (e) {
      // Log but don't fail the overall operation if guest customization update fails
      console.error(`Failed to enable guest customization on VM: ${vmHref}`, e);
    }
  }

  /** Build a complete SourcedItem XML block for one VM.
   *  networkAssignments: precomputed {innerNetwork, containerNetwork} pairs — innerNetwork is the
   *  template VM's existing NIC network name (e.g. "VM Network"), containerNetwork is the vApp
   *  network it should be remapped to. Only needed when the two names differ; without a
   *  NetworkAssignment for a differing pair, vCD silently ignores the NIC override and leaves
   *  the VM on its template-original (often nonexistent, in the target VDC) network. */
  private buildSourcedItemXml(vmHref: string, vmConfig: VAppVmConfig, fallbackName: string, networkAssignments?: Array<{ innerNetwork: string; containerNetwork: string }>): string {
    const vmName = vmConfig.vmName ?? fallbackName;
    const instSections: string[] = [];

    // Resolve computer name / hostname (priority: explicit gc.computerName → OVF hostname → vmName)
    const hostnameFromOvf = vmConfig.ovfProperties?.find(p => p.key === 'hostname')?.value;
    const resolvedComputerName = vmConfig.guestCustomization?.computerName || hostnameFromOvf || vmName;

    // For cloud-init templates (detected by presence of hostname/password/instance-id OVF properties),
    // we disable vCD guest customization and rely on cloud-init's user-data instead.
    // This is more reliable for Ubuntu 24.04+ which uses cloud-init.
    const ovfPropKeys = vmConfig.ovfProperties?.map(p => p.key) ?? [];
    const isCloudInitTemplate = ovfPropKeys.includes('hostname') || ovfPropKeys.includes('password') || ovfPropKeys.includes('instance-id');

    // For cloud-init templates with MANUAL IP mode, user-data will handle network configuration.
    // For non-cloud-init templates or DHCP mode, guest customization may still be needed.
    let needsCustomization: boolean;
    if (isCloudInitTemplate) {
      // Cloud-init templates: disable vCD guest customization, use user-data instead
      needsCustomization = false;
    } else if (vmConfig.guestCustomization !== undefined) {
      needsCustomization = !!vmConfig.guestCustomization;
    } else if (vmConfig.networkConnections?.length) {
      // Auto-detect based on IP mode: POOL and MANUAL require customization to apply IP (for non-cloud-init templates)
      const hasPoolOrManual = vmConfig.networkConnections.some(nc => {
        const resolvedMode = nc.ipMode ?? 'POOL';
        return resolvedMode === 'POOL' || resolvedMode === 'MANUAL';
      });
      needsCustomization = hasPoolOrManual;
    } else {
      // Default: if no network connections or explicit setting, enable customization for safety
      needsCustomization = true;
    }

    // Network connections
    if (vmConfig.networkConnections?.length) {
      const primary = vmConfig.networkConnections.find(n => n.isPrimary !== false) ?? vmConfig.networkConnections[0]!;
      const primaryIdx = vmConfig.networkConnections.indexOf(primary);
      const nics = vmConfig.networkConnections.map((nc, i) => {
        const idx = nc.index ?? i;
        const resolvedMode = nc.ipMode ?? 'POOL';
        const ipLine = resolvedMode === 'MANUAL' && nc.ipAddress ? `<IpAddress>${nc.ipAddress}</IpAddress>` : '';
        // NetworkAdapterType must be the LAST child of NetworkConnection (after
        // IpAddressAllocationMode/SecondaryIpAddressAllocationMode) — confirmed via live
        // vCD response inspection, not documented anywhere obvious.
        const adapterLine = nc.adapterType ? `<NetworkAdapterType>${nc.adapterType}</NetworkAdapterType>` : '';
        return `<NetworkConnection network="${nc.networkName}">
                <NetworkConnectionIndex>${idx}</NetworkConnectionIndex>
                ${ipLine}
                <IsConnected>true</IsConnected>
                <IpAddressAllocationMode>${resolvedMode}</IpAddressAllocationMode>
                ${adapterLine}
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
        `<ovf:Property ovf:key="${xmlEscape(p.key)}" ovf:type="string" ovf:value="${xmlEscape(p.value)}"/>`
      ).join('\n            ');
      instSections.push(`<ovf:ProductSection xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1">
            <ovf:Info>OVF properties</ovf:Info>
            ${props}
        </ovf:ProductSection>`);
    }

    // GuestCustomizationSection — always injected so ComputerName is stored in VCD.
    // Enable customization when needed (POOL/MANUAL modes require vCD to apply IP).
    {
      const gc = vmConfig.guestCustomization ?? {};
      // Enable customization if explicitly set, or if needsCustomization is true (POOL/MANUAL modes)
      const enabledFlag = gc.enabled !== undefined
        ? gc.enabled
        : needsCustomization;
      const fields = [
        `<Enabled>${enabledFlag}</Enabled>`,
        gc.changeSid !== undefined            ? `<ChangeSid>${gc.changeSid}</ChangeSid>` : '',
        gc.adminPasswordEnabled !== undefined  ? `<AdminPasswordEnabled>${gc.adminPasswordEnabled}</AdminPasswordEnabled>` : '',
        gc.adminPasswordAuto !== undefined     ? `<AdminPasswordAuto>${gc.adminPasswordAuto}</AdminPasswordAuto>` : '',
        gc.adminPassword                       ? `<AdminPassword>${xmlEscape(gc.adminPassword)}</AdminPassword>` : '',
        gc.resetPasswordRequired !== undefined ? `<ResetPasswordRequired>${gc.resetPasswordRequired}</ResetPasswordRequired>` : '',
        `<ComputerName>${xmlEscape(resolvedComputerName)}</ComputerName>`,
        gc.customizationScript                 ? `<CustomizationScript>${xmlEscape(gc.customizationScript)}</CustomizationScript>` : '',
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

    // NetworkAssignment — maps the template VM's existing NIC network (innerNetwork) to the
    // vApp network it should connect to (containerNetwork). vCD's schema for NetworkAssignment
    // takes ONLY innerNetwork + containerNetwork — there is no "networkName" attribute. Without
    // a NetworkAssignment for a pair that differs, the NetworkConnectionSection override above is
    // silently ignored and the VM stays on its template-original network (e.g. "VM Network"),
    // which typically doesn't exist as a network in the target vApp/VDC.
    const networkAssignmentsXml = (networkAssignments ?? [])
      .map(a => `\n        <NetworkAssignment innerNetwork="${a.innerNetwork}" containerNetwork="${a.containerNetwork}"/>`)
      .join('');

    return `
    <SourcedItem>
        <Source href="${vmHref}" />
        <VmGeneralParams>
            <Name>${xmlEscape(vmName)}</Name>
            <NeedsCustomization>${needsCustomization ? 'true' : 'false'}</NeedsCustomization>
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
  /**
   * Create a new vApp from template.
   *
   * ⚠️ PARAMETER ORDER: vdcId, templateId, vappName, zoneId (optional), instantiationParams (optional)
   *
   * Common mistakes (caught by TypeScript):
   * - ❌ createVApp(vdcId, templateId, vappName, instantiationParams, zoneId)  // WRONG ORDER
   * - ✅ createVApp(vdcId, templateId, vappName, zoneId, instantiationParams)  // CORRECT
   * - ❌ createVApp(vdcId, templateId, vappName, { vmConfigs }, "cibitung")   // WRONG ORDER
   * - ✅ createVApp(vdcId, templateId, vappName, "cibitung", { vmConfigs })   // CORRECT
   */
  async createVApp(vdcId: string, templateId: string, vappName: string, zoneId?: string, instantiationParams?: VAppInstantiationParams): Promise<McpToolResponse<any>> {
    // Runtime guard: detect if parameters were reversed (zoneId is an object instead of string)
    if (zoneId && typeof zoneId === 'object') {
      throw new Error(
        'PARAMETER ORDER ERROR in createVApp: parameters appear to be reversed.\n' +
        'Expected: createVApp(vdcId, templateId, vappName, zoneId, instantiationParams)\n' +
        'Got: createVApp(vdcId, templateId, vappName, <object>, <string>)\n' +
        'The 4th parameter should be zoneId (string), not instantiationParams (object).'
      );
    }
    // Runtime guard: detect if instantiationParams is a string (likely zoneId in wrong position)
    if (instantiationParams && typeof instantiationParams === 'string') {
      throw new Error(
        'PARAMETER ORDER ERROR in createVApp: parameters appear to be reversed.\n' +
        'Expected: createVApp(vdcId, templateId, vappName, zoneId, instantiationParams)\n' +
        'Got: createVApp(vdcId, templateId, vappName, <string>, <string>)\n' +
        'The 5th parameter should be instantiationParams (object), not zoneId (string).'
      );
    }

    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Resolve catalogItem href → vAppTemplate href (VCD instantiateVAppTemplate requires vAppTemplate URL)
      if (templateId && templateId.includes('/api/catalogItem/')) {
        try {
          const uuid = templateId.split('/api/catalogItem/').pop()!.split('?')[0]!;
          const itemResp = await this.makeRequest<string>({ method: 'GET', url: `/catalogItem/${uuid}` }, zoneId);
          const entityMatch = String(itemResp.data).match(/<Entity\b[^>]*href="([^"]*vAppTemplate[^"]*)"[^>]*>/i);
          if (entityMatch?.[1]) templateId = entityMatch[1];
        } catch {}
      }

      // Legacy: map old guestCustomization into vmConfigs[0]
      const effectiveVmConfigs: VAppVmConfig[] = instantiationParams?.vmConfigs?.length
        ? instantiationParams.vmConfigs
        : (instantiationParams?.guestCustomization
            ? [{ guestCustomization: instantiationParams.guestCustomization }]
            : []);

      // Lazy-fetch VDC networks once; reused by both auto-discovery and IP-mode resolution
      let cachedNets: Array<{ name: string; href: string; defaultGateway?: string; subnetPrefixLength?: number; availableIps: number; totalIps: number; linkType?: number }> | undefined;
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
          const isUbuntuModern = await this.isUbuntuModernTemplate(templateId, zoneId);

          // For Ubuntu 24.04+, include IP suggestions and recommend DHCP/MANUAL modes
          let networkDataForResponse: any[] = nets.map(n => ({
            networkName: n.name,
            networkType: n.linkType === 1 ? 'routed' : n.linkType === 2 ? 'isolated' : 'unknown',
            availableIps: n.availableIps,
            totalIps: n.totalIps,
            gateway: n.defaultGateway,
            prefix: n.subnetPrefixLength,
            // For Ubuntu 24.04+, suggest DHCP only if available; otherwise MANUAL; fall back to DHCP for other templates if IPs available
            suggestedIpMode: isUbuntuModern ? 'MANUAL' : (n.availableIps > 0 ? 'POOL' : 'DHCP'),
          }));

          // If Ubuntu 24.04+, add IP suggestions for routed networks and include DHCP pool info
          if (isUbuntuModern) {
            for (let i = 0; i < networkDataForResponse.length; i++) {
              const net = nets[i]!;
              if (net && net.linkType === 1) { // routed network
                try {
                  const netDetail = await this.fetchNetworkDetailedConfig(net.href, vdcId, net.name, zoneId);
                  if (netDetail?.ipRanges?.length) {
                    const range = netDetail.ipRanges[0]!;
                    const suggestedIps = this.generateSuggestedIps(netDetail.gateway, range.startAddress, range.endAddress, 5, netDetail.usedIps);
                    if (suggestedIps.length > 0) {
                      networkDataForResponse[i].suggestedIps = suggestedIps;
                    }
                  }
                  // Include DHCP pool info
                  if (netDetail?.dhcpPools?.length) {
                    networkDataForResponse[i].dhcpPoolCount = netDetail.dhcpPools.length;
                    networkDataForResponse[i].dhcpAvailable = true;
                  } else {
                    networkDataForResponse[i].dhcpAvailable = false;
                    networkDataForResponse[i].dhcpWarning = 'DHCP service or DHCP pools not configured on this network';
                  }
                } catch {
                  // Continue if network details fail
                }
              }
            }
          }

          const clarificationMessage = isUbuntuModern
            ? `Ubuntu 24.04+ detected. VDC has ${nets.length} networks. Please specify networkConnections with: networkName (required), ipMode and ipAddress (MANUAL with ipAddress from suggestedIps is RECOMMENDED — netplan will be auto-generated and injected via cloud-init user-data; or DHCP if both DHCP service AND DHCP pools are configured on the network). ⚠️ CRITICAL: DHCP requires BOTH (1) DHCP service enabled AND (2) DHCP pools configured. If either is missing, use MANUAL mode with one of the suggestedIps.`
            : `VDC has ${nets.length} routed networks — please specify networkConnections in vmConfigs (networkName + optionally ipMode). Available options including DHCP availability are in data.availableNetworks. ⚠️ WARNING: DHCP mode requires BOTH active DHCP service AND configured DHCP pools on the network. If unsure, use MANUAL with a specific ipAddress.`;

          return this.formatMcpResponse(
            {
              needsClarification: true,
              isUbuntuModern,
              availableNetworks: networkDataForResponse
            },
            zone,
            {
              code: 'CLARIFICATION_REQUIRED',
              message: clarificationMessage,
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
                  { ipMode: 'DHCP', note: '⚠️ Request IP via DHCP — REQUIRES active DHCP server running on network. If uncertain, use MANUAL mode instead.' },
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

          // Ubuntu 24.04+ requires MANUAL IP mode instead of POOL (POOL mode enables guest customization
          // which interferes with cloud-init). For these templates, ask user to choose from suggested IPs.
          const isUbuntuModern = await this.isUbuntuModernTemplate(templateId, zoneId);

          if (isUbuntuModern) {
            // Fetch detailed network config to get IP ranges
            const netDetail = await this.fetchNetworkDetailedConfig(net.href, vdcId, net.name, zoneId);
            if (netDetail?.ipRanges?.length) {
              const range = netDetail.ipRanges[0]!;
              const suggestedIps = this.generateSuggestedIps(netDetail.gateway, range.startAddress, range.endAddress, 5, netDetail.usedIps);

              if (suggestedIps.length > 0) {
                return this.formatMcpResponse(
                  {
                    needsClarification: true,
                    network: net.name,
                    reason: 'Ubuntu 24.04+ uses cloud-init for network config. MANUAL IP mode with auto-generated netplan is RECOMMENDED.',
                    suggestedIps,
                    gateway: netDetail.gateway,
                    subnetMask: netDetail.subnetMask,
                    dhcpAvailable: netDetail.dhcp,
                    options: [
                      {
                        ipMode: 'MANUAL',
                        note: 'Recommended: select one of the suggested IPs. Netplan YAML will be auto-generated and injected via cloud-init user-data.'
                      },
                      {
                        ipMode: 'DHCP',
                        note: 'Alternative: use DHCP if enabled on the network'
                      },
                    ],
                    instructions: 'Call create_vapp again with networkConnections: [{ networkName: "' + net.name + '", ipMode: "MANUAL", ipAddress: "<chosen-ip>" }] in instantiationParams.vmConfigs[0]',
                  },
                  zone,
                  {
                    code: 'CLARIFICATION_REQUIRED',
                    message: `Ubuntu 24.04+ detected. Choose a suggested IP for MANUAL mode — netplan will be auto-generated and injected via cloud-init, or select DHCP if available.`,
                  }
                );
              }
            }
          }

          autoConfigured = { network: net.name, ipMode: isUbuntuModern ? 'DHCP' : 'POOL' };
          resolvedParams = {
            ...instantiationParams,
            networkConfig: instantiationParams?.networkConfig?.length
              ? instantiationParams.networkConfig
              : [{ networkName: net.name, parentNetworkHref: net.href, fenceMode: 'bridged' }],
            vmConfigs: effectiveVmConfigs.map(c => ({
              ...c,
              networkConnections: [{ networkName: net.name, ipMode: isUbuntuModern ? 'DHCP' : 'POOL' as const }]
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
        const isUbuntuModern = await this.isUbuntuModernTemplate(templateId, zoneId);

        // Check if Ubuntu 24.04+ with unresolved ipMode - ask for clarification with IP suggestions
        if (isUbuntuModern) {
          const unboundNics = resolvedVmConfigs
            .flatMap(c => c.networkConnections?.filter(nc => !nc.ipMode) ?? [])
            .filter((nc, i, arr) => arr.findIndex(x => x.networkName === nc.networkName) === i); // unique networkNames

          if (unboundNics.length > 0) {
            const clarifications = [];
            for (const nc of unboundNics) {
              const net = netMap.get(nc.networkName);
              if (!net) continue;

              const netDetail = await this.fetchNetworkDetailedConfig(net.href, vdcId, nc.networkName, zoneId);
              if (netDetail?.ipRanges?.length) {
                const range = netDetail.ipRanges[0]!;
                const suggestedIps = this.generateSuggestedIps(netDetail.gateway, range.startAddress, range.endAddress, 5, netDetail.usedIps);
                if (suggestedIps.length > 0) {
                  clarifications.push({
                    networkName: nc.networkName,
                    reason: 'Ubuntu 24.04+ requires MANUAL IP mode instead of POOL (POOL mode interferes with cloud-init)',
                    suggestedIps,
                    gateway: netDetail.gateway,
                    subnetMask: netDetail.subnetMask,
                    dhcpAvailable: netDetail.dhcp,
                  });
                }
              }
            }

            if (clarifications.length > 0) {
              return this.formatMcpResponse(
                {
                  needsClarification: true,
                  networks: clarifications,
                  options: [
                    {
                      ipMode: 'MANUAL',
                      note: '✅ RECOMMENDED: select one of the suggestedIps or provide your own static IP in the ipAddress field'
                    },
                    {
                      ipMode: 'DHCP',
                      note: '⚠️ CRITICAL: REQUIRES BOTH (1) DHCP service enabled AND (2) DHCP pools configured. If either is missing, VM initialization will fail. Use MANUAL with suggestedIps instead if unsure.'
                    },
                  ],
                  instructions: 'Call create_vapp again with networkConnections specifying ipMode: "MANUAL" with ipAddress (from suggestedIps) or "DHCP" only if DHCP is confirmed active',
                },
                zone,
                {
                  code: 'CLARIFICATION_REQUIRED',
                  message: `Ubuntu 24.04+ detected. MANUAL mode with suggestedIps is recommended. Avoid POOL. Use DHCP only if DHCP server is confirmed running on the network.`,
                }
              );
            }
          }
        }

        const finalVmConfigs = resolvedVmConfigs.map(c => ({
          ...c,
          networkConnections: c.networkConnections?.map(nc => {
            if (nc.ipMode) return nc;
            const info = netMap.get(nc.networkName);
            if (info && info.availableIps > 0) {
              // Ubuntu 24.04+ should default to DHCP instead of POOL when IP mode is unspecified
              const ipMode = isUbuntuModern ? ('DHCP' as const) : ('POOL' as const);
              return { ...nc, ipMode };
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
                  { ipMode: 'DHCP', note: '⚠️ REQUIRES BOTH DHCP service enabled AND DHCP pools configured on network. Check network settings before choosing this mode.' },
                ],
              })),
              hint: 'Specify ipMode (MANUAL with ipAddress is safer, or DHCP if DHCP server confirmed active) for each affected NIC, or expand the static IP pool in VDC network settings and retry.',
            },
            zone,
            {
              code: 'CLARIFICATION_REQUIRED',
              message: `${exhausted.length} NIC(s) have no available IPs in their static pool: ${exhausted.map(e => `"${e.networkName}"`).join(', ')}. Choose ipMode: MANUAL (with ipAddress) or DHCP (requires active DHCP server), or expand the IP pool first.`,
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

      // Build map: user-specified org network name → template VM NIC network name, and
      // auto-populate the vApp-level networkConfig with that template name — but ONLY when no
      // networkConfig has been set yet at this point. A networkConfig can already be set here
      // via the single-routed-network auto-discovery branch above (using the real org network
      // name, e.g. "DC_1138718") or by the caller explicitly. In either of those cases the vApp's
      // NetworkConfigSection is already using a real (non-template) name; renaming the NIC to the
      // template's name here — while leaving that vApp-level entry alone — would point the NIC at
      // a vApp network that doesn't exist ("entity network 'VM Network' does not exist"). This
      // exact mismatch was confirmed live: single-network auto-discovery sets networkConfig using
      // the real org name, then this block used to unconditionally rename the NIC to the
      // template's name regardless, breaking the two apart. When networkConfig is already set,
      // networkNameMap stays empty, so the NIC keeps its real name and computeNetworkAssignments
      // (below) emits a proper NetworkAssignment bridging the template name to it instead.
      const networkNameMap = new Map<string, string>();
      if (!resolvedParams?.networkConfig?.length) {
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
        const sourcedItems = await Promise.all(templateVms.map(async ({ href, templateNetworks }, i) => {
          const cfg = resolvedVmConfigs[i] ?? resolvedVmConfigs[0] ?? {};
          const fallbackName = templateVms.length === 1 ? vappName : `${vappName}-${i + 1}`;
          // Rename NIC targets to the template's own network name when networkNameMap has an
          // entry — the vApp-level NetworkConfig was auto-populated under that same name above,
          // so the NIC override already matches and no NetworkAssignment is needed.
          let renamedCfg: VAppVmConfig = cfg.networkConnections?.length
            ? { ...cfg, networkConnections: cfg.networkConnections.map(nc => ({
                ...nc,
                networkName: networkNameMap.get(nc.networkName) ?? nc.networkName,
              })) }
            : cfg;

          // For cloud-init templates with MANUAL IP mode, generate netplan user-data
          const ovfPropKeys = renamedCfg.ovfProperties?.map(p => p.key) ?? [];
          const isCloudInitTemplate = ovfPropKeys.includes('hostname') || ovfPropKeys.includes('password') || ovfPropKeys.includes('instance-id');
          if (isCloudInitTemplate && renamedCfg.networkConnections?.length) {
            const manualNic = renamedCfg.networkConnections.find(nc => nc.ipMode === 'MANUAL' && nc.ipAddress);
            if (manualNic && manualNic.ipAddress) {
              try {
                // Fetch network details to get gateway and subnet for netplan
                const nets = await this.fetchVdcNetworkOptions(vdcId, zoneId);
                const matchedNet = nets.find(n => n.name === manualNic.networkName);
                if (matchedNet) {
                  const netDetail = await this.fetchNetworkDetailedConfig(matchedNet.href, vdcId, manualNic.networkName, zoneId);
                  const nicIndex = renamedCfg.networkConnections.indexOf(manualNic);
                  const userDataYaml = this.generateNetplanUserData(nicIndex, manualNic.ipAddress, netDetail?.gateway, netDetail?.subnetMask);
                  // Inject user-data as an OVF property (cloud-init will pick it up)
                  const hasUserData = renamedCfg.ovfProperties?.some(p => p.key === 'user-data');
                  if (!hasUserData) {
                    renamedCfg = {
                      ...renamedCfg,
                      ovfProperties: [...(renamedCfg.ovfProperties ?? []), { key: 'user-data', value: userDataYaml }]
                    };
                  }
                }
              } catch (e) {
                // If fetching network details fails, proceed without user-data
                // (cloud-init will fall back to DHCP or other defaults)
              }
            }
          }

          const networkAssignments = this.computeNetworkAssignments(templateNetworks, renamedCfg.networkConnections);
          return this.buildSourcedItemXml(href, renamedCfg, fallbackName, networkAssignments);
        }));
        sourcedItemsXml = sourcedItems.join('');
      }

      const createVAppPayload = `<?xml version="1.0" encoding="UTF-8"?>
<InstantiateVAppTemplateParams
    xmlns="http://www.vmware.com/vcloud/v1.5"
    name="${xmlEscape(vappName)}"
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

      // Response is the new VApp entity XML — extract key fields.
      // VCD returns HTTP 201 with the VApp XML body; the VApp's own href gives vappId.
      // An embedded <Task> tracks background configuration — callers MUST poll it before using the vApp.
      const vappXml  = response.data;
      const vappHref = (vappXml.match(/href="([^"]+\/vApp\/vapp-[^"]+)"/) || [])[1] || '';
      const vmHref   = (vappXml.match(/href="([^"]+\/vApp\/vm-[^"]+)"/) || [])[1] || '';
      const vappId   = vappHref.split('/vApp/vapp-')[1] || '';
      const vmId     = vmHref.split('/vApp/vm-')[1] || '';
      const resolvedName = (vappXml.match(/<(\w+:)?VApp\b[^>]*name="([^"]+)"/) || [])[2] || vappName;
      const taskHref = (vappXml.match(/<Task\b[^>]*href="([^"]+)"/) || [])[1] || '';
      const taskStatus = (vappXml.match(/<Task\b[^>]*status="([^"]+)"/) || [])[1] || '';
      // Expose bare taskId at top level so callers can poll with get_task without parsing the href
      const taskId   = taskHref.split('/task/')[1] || '';

      // For non-cloud-init templates with POOL/MANUAL IP mode, enable guest customization post-deployment
      // This works around vCD not respecting instantiation-time NeedsCustomization for Linux VMs
      if (vmHref && resolvedVmConfigs.length > 0) {
        const cfg = resolvedVmConfigs[0];
        const ovfPropKeys = cfg?.ovfProperties?.map(p => p.key) ?? [];
        const isCloudInitTemplate = ovfPropKeys.includes('hostname') || ovfPropKeys.includes('password') || ovfPropKeys.includes('instance-id');
        const hasPoolOrManualMode = cfg?.networkConnections?.some(nc => nc.ipMode === 'POOL' || nc.ipMode === 'MANUAL');

        if (!isCloudInitTemplate && hasPoolOrManualMode) {
          // Enable guest customization for non-cloud-init templates that need IP configuration
          const vmName = cfg?.vmName || (templateVms.length === 1 ? vappName : `${vappName}-1`);
          // Fire async (don't await) so we return immediately; vCD will accept the update while task runs
          this.enableVmGuestCustomization(vmHref, vmName, zoneId).catch(e => {
            console.error('Post-deployment guest customization update failed (continuing anyway)', e);
          });
        }
      }

      return this.formatMcpResponse(
        { vappId, vmId, vappName: resolvedName, vappHref, vmHref,
          taskId,
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
      // Resolve catalogItem href → vAppTemplate href
      if (templateId && templateId.includes('/api/catalogItem/')) {
        try {
          const uuid = templateId.split('/api/catalogItem/').pop()!.split('?')[0]!;
          const itemResp = await this.makeRequest<string>({ method: 'GET', url: `/catalogItem/${uuid}` }, zoneId);
          const entityMatch = String(itemResp.data).match(/<Entity\b[^>]*href="([^"]*vAppTemplate[^"]*)"[^>]*>/i);
          if (entityMatch?.[1]) templateId = entityMatch[1];
        } catch {}
      }

      // Resolve the first VM href from the template
      const templateVms = await this.fetchTemplateVmHrefs(templateId, zoneId);
      if (!templateVms.length) {
        throw new Error('No VMs found in template — verify templateId is a valid vAppTemplate href');
      }
      const vmHrefs = templateVms;

      let finalVmConfig: VAppVmConfig = { ...vmConfig, vmName };

      // When the caller omits networkConnections entirely, decide based on what the vApp
      // itself already has configured — add_vm_to_vapp can only attach to a network the vApp
      // already has (see NETWORK_NOT_CONFIGURED_ON_VAPP below; recomposeVApp can't bridge a new
      // one in). Exactly one existing network is unambiguous — use it. More than one means we
      // can't guess which the caller wants; ask instead of silently leaving the VM on the
      // template's own (often broken/nonexistent) default network — the exact failure mode a
      // real MCP user hit. Zero existing networks: fall through unchanged (nothing usable to
      // pick from without a portal change first).
      if (!finalVmConfig.networkConnections?.length) {
        const existingVappNetworks = [...await this.fetchVAppNetworkNames(vappId, zoneId)];
        if (existingVappNetworks.length === 1) {
          finalVmConfig = { ...finalVmConfig, networkConnections: [{ networkName: existingVappNetworks[0]! }] };
        } else if (existingVappNetworks.length > 1) {
          return this.formatMcpResponse(
            { needsClarification: true, availableNetworks: existingVappNetworks },
            zone,
            {
              code: 'CLARIFICATION_REQUIRED',
              message: `This vApp has ${existingVappNetworks.length} networks configured (${existingVappNetworks.join(', ')}) — specify networkConnections (networkName + optionally ipMode) so the new VM connects to the right one.`,
            }
          );
        }
      }

      // Resolve missing ipMode on network connections
      const hasUnresolvedIpMode = finalVmConfig.networkConnections?.some(nc => !nc.ipMode);
      if (hasUnresolvedIpMode) {
        // Check if template is Ubuntu 24.04+ which requires MANUAL instead of POOL
        const isUbuntuModern = await this.isUbuntuModernTemplate(templateId, zoneId);

        if (vdcId) {
          const nets = await this.fetchVdcNetworkOptions(vdcId, zoneId);
          const netMap = new Map(nets.map(n => [n.name, n]));
          const exhausted: Array<{ networkName: string; totalIps: number; networkHref?: string }> = [];

          // For Ubuntu 24.04+, ask user to choose IP instead of defaulting to POOL/DHCP
          const ubuntuNicsNeedingIp: Array<{ nic: VAppNetworkConnection; networkInfo: typeof nets[0] }> = [];
          const resolvedNics: VAppNetworkConnection[] = finalVmConfig.networkConnections!.map(nc => {
            if (nc.ipMode) return nc;
            const info = netMap.get(nc.networkName);
            if (info && info.availableIps > 0) {
              if (isUbuntuModern) {
                // For Ubuntu 24.04+, collect NICs that need IP selection
                ubuntuNicsNeedingIp.push({ nic: nc, networkInfo: info });
                return nc; // Return unresolved for now
              }
              const ipMode: 'DHCP' | 'POOL' = 'POOL';
              return { ...nc, ipMode };
            }
            exhausted.push({ networkName: nc.networkName, totalIps: info?.totalIps ?? 0, networkHref: info?.href });
            return nc;
          });

          // If Ubuntu 24.04+ with available IPs, suggest IPs to user
          if (isUbuntuModern && ubuntuNicsNeedingIp.length > 0) {
            const suggestedIpsByNetwork: Record<string, { suggestedIps: string[]; gateway?: string; subnetMask?: string; dhcpAvailable?: boolean }> = {};

            for (const { nic, networkInfo } of ubuntuNicsNeedingIp) {
              const netDetail = await this.fetchNetworkDetailedConfig(networkInfo.href, vdcId, nic.networkName, zoneId);
              if (netDetail?.ipRanges?.length) {
                const range = netDetail.ipRanges[0]!;
                const suggestedIps = this.generateSuggestedIps(netDetail.gateway, range.startAddress, range.endAddress, 5, netDetail.usedIps);
                suggestedIpsByNetwork[nic.networkName] = {
                  suggestedIps,
                  gateway: netDetail.gateway,
                  subnetMask: netDetail.subnetMask,
                  dhcpAvailable: netDetail.dhcp
                };
              }
            }

            // If we got suggestions for at least one NIC, return clarification
            if (Object.keys(suggestedIpsByNetwork).length > 0) {
              return this.formatMcpResponse(
                {
                  needsClarification: true,
                  vappId,
                  vmName,
                  reason: 'Ubuntu 24.04+ requires MANUAL IP mode instead of POOL (POOL mode interferes with cloud-init)',
                  suggestedIpsByNetwork,
                  options: [
                    {
                      ipMode: 'MANUAL',
                      note: 'Recommended: select one of the suggested IPs for each NIC and call add_vm_to_vapp again with ipAddress field'
                    },
                    {
                      ipMode: 'DHCP',
                      note: 'Alternative: use DHCP if enabled on the network'
                    },
                  ],
                  instructions: 'Call add_vm_to_vapp again with networkConnections including ipMode and ipAddress for MANUAL, or ipMode: "DHCP"',
                },
                zone,
                {
                  code: 'CLARIFICATION_REQUIRED',
                  message: `Ubuntu 24.04+ detected. Please choose IP addresses from the suggestions for MANUAL mode configuration, or use DHCP mode.`,
                }
              );
            }
          }

          if (exhausted.length > 0) {
            return this.formatMcpResponse(
              {
                needsClarification: true,
                exhaustedNetworks: exhausted.map(e => ({
                  networkName: e.networkName,
                  poolStatus: { total: e.totalIps, available: 0 },
                  options: [
                    { ipMode: 'MANUAL', note: 'Provide a specific static IP in the ipAddress field' },
                    { ipMode: 'DHCP', note: '⚠️ REQUIRES BOTH DHCP service enabled AND DHCP pools configured on network. Check network settings before choosing this mode.' },
                  ],
                })),
                hint: 'Specify ipMode (MANUAL with ipAddress is safer, or DHCP if DHCP server confirmed active), or expand the static IP pool in VDC network settings and retry.',
              },
              zone,
              {
                code: 'CLARIFICATION_REQUIRED',
                message: `${exhausted.length} NIC(s) have no available IPs in their static pool: ${exhausted.map(e => `"${e.networkName}"`).join(', ')}. Choose ipMode: MANUAL (with ipAddress) or DHCP (requires active DHCP server), or expand the pool first.`,
              }
            );
          }

          finalVmConfig = { ...finalVmConfig, networkConnections: resolvedNics };
        } else {
          // No vdcId — default unresolved NICs to POOL (or DHCP for Ubuntu 24.04+)
          const defaultIpMode: 'DHCP' | 'POOL' = isUbuntuModern ? 'DHCP' : 'POOL';
          const resolvedNics: VAppNetworkConnection[] = (finalVmConfig.networkConnections ?? []).map(nc => ({
            ...nc,
            ipMode: (nc.ipMode ?? defaultIpMode) as 'DHCP' | 'POOL' | 'MANUAL' | 'NONE'
          }));
          finalVmConfig = {
            ...finalVmConfig,
            networkConnections: resolvedNics,
          };
        }
      }

      const { href: firstHref, templateNetworks: firstTemplateNetworks } = vmHrefs[0]!;

      // Resolve NetworkAssignment mappings. Unlike createVApp (a fresh vApp with no existing
      // networks), an existing vApp already has its own NetworkConfigSection — recomposeVApp's
      // schema has no top-level InstantiationParams/NetworkConfigSection to bridge a brand-new
      // network in (unlike instantiateVAppTemplate), so containerNetwork must reference a
      // network the vApp already has. Fail clearly rather than emit XML vCD will reject.
      if (finalVmConfig.networkConnections?.length && firstTemplateNetworks.length) {
        const existingVappNetworks = await this.fetchVAppNetworkNames(vappId, zoneId);
        const missing = finalVmConfig.networkConnections.filter(nc => !existingVappNetworks.has(nc.networkName));

        if (missing.length > 0) {
          return this.formatMcpResponse(
            { existingVappNetworks: [...existingVappNetworks], missingNetworks: missing.map(m => m.networkName) },
            zone,
            {
              code: 'NETWORK_NOT_CONFIGURED_ON_VAPP',
              message: `Network(s) ${missing.map(m => `"${m.networkName}"`).join(', ')} are not configured on this vApp (existing: ${[...existingVappNetworks].join(', ') || 'none'}). Add the network to the vApp first (e.g. via the vCD portal), then retry with a networkName from data.existingVappNetworks.`,
            }
          );
        }
      }

      // For cloud-init templates with MANUAL IP mode, generate netplan user-data
      let configForXml = finalVmConfig;
      const ovfPropKeys = configForXml.ovfProperties?.map(p => p.key) ?? [];
      const isCloudInitTemplate = ovfPropKeys.includes('hostname') || ovfPropKeys.includes('password') || ovfPropKeys.includes('instance-id');
      if (isCloudInitTemplate && configForXml.networkConnections?.length && vdcId) {
        const manualNic = configForXml.networkConnections.find(nc => nc.ipMode === 'MANUAL' && nc.ipAddress);
        if (manualNic && manualNic.ipAddress) {
          try {
            // Fetch network details to get gateway and subnet for netplan
            const nets = await this.fetchVdcNetworkOptions(vdcId, zoneId);
            const matchedNet = nets.find(n => n.name === manualNic.networkName);
            if (matchedNet) {
              const netDetail = await this.fetchNetworkDetailedConfig(matchedNet.href, vdcId, manualNic.networkName, zoneId);
              const nicIndex = configForXml.networkConnections.indexOf(manualNic);
              const userDataYaml = this.generateNetplanUserData(nicIndex, manualNic.ipAddress, netDetail?.gateway, netDetail?.subnetMask);
              // Inject user-data as an OVF property (cloud-init will pick it up)
              const hasUserData = configForXml.ovfProperties?.some(p => p.key === 'user-data');
              if (!hasUserData) {
                configForXml = {
                  ...configForXml,
                  ovfProperties: [...(configForXml.ovfProperties ?? []), { key: 'user-data', value: userDataYaml }]
                };
              }
            }
          } catch (e) {
            // If fetching network details fails, proceed without user-data
          }
        }
      }

      const networkAssignments = this.computeNetworkAssignments(firstTemplateNetworks, configForXml.networkConnections);
      const sourcedItemXml = this.buildSourcedItemXml(firstHref, configForXml, vmName, networkAssignments);

      // name attribute is intentionally omitted — avoids renaming the parent vApp
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<RecomposeVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">
    <Description>VM added by Zettagrid MCP Server</Description>${sourcedItemXml}
</RecomposeVAppParams>`;

      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${vappUuid(vappId)}/action/recomposeVApp`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.recomposeVAppParams+xml' }
      }, zoneId);

      const task = parseTaskResponse(response.data as unknown as string);

      // For non-cloud-init templates with POOL/MANUAL IP mode, enable guest customization post-deployment
      if (configForXml && firstHref) {
        const ovfPropKeys = configForXml.ovfProperties?.map(p => p.key) ?? [];
        const isCloudInitTemplate = ovfPropKeys.includes('hostname') || ovfPropKeys.includes('password') || ovfPropKeys.includes('instance-id');
        const hasPoolOrManualMode = configForXml.networkConnections?.some(nc => nc.ipMode === 'POOL' || nc.ipMode === 'MANUAL');

        if (!isCloudInitTemplate && hasPoolOrManualMode) {
          // Enable guest customization for non-cloud-init templates that need IP configuration
          // Fire async (don't await) so we return immediately
          this.enableVmGuestCustomization(firstHref, vmName, zoneId).catch(e => {
            console.error('Post-deployment guest customization update failed (continuing anyway)', e);
          });
        }
      }

      return this.formatMcpResponse(
        {
          ...task, vappId, vmName,
          message: 'VM add task queued. Use get_task to poll for completion. If the task ends in error, ' +
            `list_vms may still show a partially-created VM named "${vmName}" — use delete_vm to remove it before retrying.`,
        },
        zone
      );
    } catch (error) {
      // The recompose can fail after partially creating the VM (e.g. a network-mismatch
      // rejection arriving after the VM object was already composed) — the same orphan-VM
      // problem reported as H1. Look it up so the caller has an id to clean up with delete_vm
      // instead of being stuck with only delete_vapp (which would destroy the whole vApp).
      let orphanVmId: string | undefined;
      try {
        const vms = await this.listVMs(vappId, zoneId);
        orphanVmId = vms.data?.items?.find(v => v.name === vmName)?.id;
      } catch { /* best-effort only — don't let this mask the original error */ }

      return this.formatMcpResponse(
        orphanVmId ? { orphanVmId } : {},
        zone,
        {
          code: 'ADD_VM_TO_VAPP_ERROR',
          message: (error instanceof Error ? error.message : 'Failed to add VM to vApp') +
            (orphanVmId ? ` A VM named "${vmName}" (id: ${orphanVmId}) was partially created — use delete_vm to remove it before retrying.` : ''),
          details: error
        }
      );
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
        url: `/vApp/vm-${vmUuid(vmId)}/snapshotSection`
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
        url: `/vApp/vm-${vmUuid(vmId)}/action/createSnapshot`,
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
        url: `/vApp/vm-${vmUuid(vmId)}/action/revertToCurrentSnapshot`
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
        url: `/vApp/vm-${vmUuid(vmId)}/action/removeAllSnapshots`
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
      // VCD CloudAPI PUT uses "name" (not "displayName") for the EdgeFirewallRule model
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
        url: `/vApp/vm-${vmUuid(vmId)}/power/action/reset`
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
  async updateVMCpu(vmId: string, cpuCount: number, coresPerSocket?: number, zoneId?: string, cpuHotAdd?: boolean): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // GET current CPU config: preserves coresPerSocket for hot-add and detects current count for reduction guard.
      let currentCpuCount = 0;
      try {
        const cpuXml = await this.makeRequest<string>({
          method: 'GET',
          url: `/vApp/vm-${vmUuid(vmId)}/virtualHardwareSection/cpu`,
        }, zoneId);
        const cpsMatch = /<vmw:CoresPerSocket[^>]*>(\d+)<\/vmw:CoresPerSocket>/.exec(cpuXml.data);
        const vqMatch = /<rasd:VirtualQuantity>(\d+)<\/rasd:VirtualQuantity>/.exec(cpuXml.data);
        if (coresPerSocket === undefined) {
          coresPerSocket = cpsMatch?.[1] ? parseInt(cpsMatch[1], 10) : Math.min(cpuCount, 16);
        }
        currentCpuCount = vqMatch?.[1] ? parseInt(vqMatch[1], 10) : 0;
      } catch {
        if (coresPerSocket === undefined) coresPerSocket = Math.min(cpuCount, 16);
      }

      // Block CPU reduction on a powered-on VM — vSphere supports hot-add only, not hot-remove.
      if (currentCpuCount > 0 && cpuCount < currentCpuCount) {
        const vmResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${vmUuid(vmId)}` }, zoneId);
        const isPoweredOn = /\bstatus="4"/.test(vmResp.data as unknown as string);
        if (isPoweredOn) {
          return this.formatMcpResponse({}, zone, {
            code: 'CPU_REDUCE_REQUIRES_POWER_OFF',
            message: `Cannot reduce vCPUs from ${currentCpuCount} to ${cpuCount} on a powered-on VM. ` +
              `vSphere supports hot-add (increasing) only, not hot-remove. Power off the VM first.`,
            details: { currentCpuCount, requestedCpuCount: cpuCount }
          });
        }
      }
      const cpuPayload = `<?xml version="1.0" encoding="UTF-8"?>
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
        url: `/vApp/vm-${vmUuid(vmId)}/virtualHardwareSection/cpu`,
        data: cpuPayload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItem+xml' }
      }, zoneId);

      const taskResult = parseTaskResponse(response.data);

      // Optionally update CPU hot-add capability
      if (cpuHotAdd !== undefined) {
        // Wait for CPU update task to complete before touching vmCapabilities
        const cpuTaskId = taskResult.taskId as string | undefined;
        if (cpuTaskId) {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const t = await this.getTask(cpuTaskId, zoneId);
            const s = t.data?.taskStatus;
            if (s === 'success') break;
            if (s === 'error' || s === 'aborted') throw new Error(`CPU update task ${cpuTaskId} ended with status=${s}`);
          }
        }

        // GET current capabilities to preserve MemoryHotAddEnabled
        const capsResp = await this.makeRequest<string>({
          method: 'GET',
          url: `/vApp/vm-${vmUuid(vmId)}/vmCapabilities`,
        }, zoneId);
        const memHotAdd = /<MemoryHotAddEnabled>(true|false)<\/MemoryHotAddEnabled>/.exec(capsResp.data)?.[1] ?? 'false';

        const capsPayload = `<?xml version="1.0" encoding="UTF-8"?>
<VmCapabilities xmlns="http://www.vmware.com/vcloud/v1.5"
    xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
    xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
    xmlns:vmw="http://www.vmware.com/schema/ovf">
  <MemoryHotAddEnabled>${memHotAdd}</MemoryHotAddEnabled>
  <CpuHotAddEnabled>${cpuHotAdd}</CpuHotAddEnabled>
</VmCapabilities>`;
        const capsUpdateResp = await this.makeRequest<string>({
          method: 'PUT',
          url: `/vApp/vm-${vmUuid(vmId)}/vmCapabilities`,
          data: capsPayload,
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.vmCapabilitiesSection+xml' }
        }, zoneId);
        // Wait for vmCapabilities task (VCD returns HTTP 202 with a Task)
        const capsTaskResult = parseTaskResponse(capsUpdateResp.data);
        if (capsTaskResult.taskId) {
          const capsDeadline = Date.now() + 120_000;
          while (Date.now() < capsDeadline) {
            await new Promise(r => setTimeout(r, 3000));
            const t = await this.getTask(capsTaskResult.taskId, zoneId);
            const s = t.data?.taskStatus;
            if (s === 'success') break;
            if (s === 'error' || s === 'aborted') throw new Error(`vmCapabilities task ${capsTaskResult.taskId} ended with status=${s}`);
          }
        }
      }

      return this.formatMcpResponse(
        { ...taskResult, cpuCount, coresPerSocket, ...(cpuHotAdd !== undefined && { cpuHotAdd }) },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
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
  async updateVMMemory(vmId: string, memoryMB: number, zoneId?: string, memoryHotAdd?: boolean): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      // Guards for powered-on VMs: check state once, apply all rules.
      const THREE_GB_MB = 3072;
      {
        const vmResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${vmUuid(vmId)}` }, zoneId);
        const isPoweredOn = /\bstatus="4"/.test(vmResp.data as unknown as string);
        if (isPoweredOn) {
          const memResp = await this.makeRequest<string>({
            method: 'GET', url: `/vApp/vm-${vmUuid(vmId)}/virtualHardwareSection/memory`
          }, zoneId);
          const currentMemMatch = /<rasd:VirtualQuantity>(\d+)<\/rasd:VirtualQuantity>/.exec(memResp.data as unknown as string);
          const currentMemMB = currentMemMatch?.[1] ? parseInt(currentMemMatch[1], 10) : 0;

          // Block reduction — vSphere does not support memory hot-remove.
          if (currentMemMB > 0 && memoryMB < currentMemMB) {
            return this.formatMcpResponse({}, zone, {
              code: 'MEMORY_REDUCE_REQUIRES_POWER_OFF',
              message: `Cannot reduce memory from ${currentMemMB} MB to ${memoryMB} MB on a powered-on VM. ` +
                `vSphere supports hot-add (increasing) only, not hot-remove. Power off the VM first.`,
              details: { currentMemMB, requestedMemMB: memoryMB }
            });
          }

          // Block 3 GB boundary crossing — Linux guests freeze (VMware KB 343190).
          if (memoryMB > THREE_GB_MB && currentMemMB <= THREE_GB_MB) {
            return this.formatMcpResponse({}, zone, {
              code: 'MEMORY_HOT_ADD_BOUNDARY_VIOLATION',
              message:
                `Cannot hot-add memory from ${currentMemMB} MB to ${memoryMB} MB on a powered-on VM: ` +
                `crossing the 3 GB boundary (≤3072 MB → >3072 MB) causes Linux guests to freeze (VMware KB 343190). ` +
                `Safe path: (1) power off the VM, (2) call update_vm_memory with memoryMB=${memoryMB} and memoryHotAdd=true, ` +
                `(3) power on. The VM will then start above 3 GB and you can hot-add freely up to 16× that size.`,
              details: { currentMemMB, requestedMemMB: memoryMB, boundaryMB: THREE_GB_MB }
            });
          }
        }
      }

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
        url: `/vApp/vm-${vmUuid(vmId)}/virtualHardwareSection/memory`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItem+xml' }
      }, zoneId);
      const taskResult = parseTaskResponse(response.data);

      if (memoryHotAdd !== undefined) {
        // Wait for memory update task before touching vmCapabilities
        const memTaskId = taskResult.taskId as string | undefined;
        if (memTaskId) {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const t = await this.getTask(memTaskId, zoneId);
            const s = t.data?.taskStatus;
            if (s === 'success') break;
            if (s === 'error' || s === 'aborted') throw new Error(`Memory update task ${memTaskId} ended with status=${s}`);
          }
        }
        // GET current capabilities to preserve CpuHotAddEnabled
        const capsResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${vmUuid(vmId)}/vmCapabilities` }, zoneId);
        const cpuHotAdd = /<CpuHotAddEnabled>(true|false)<\/CpuHotAddEnabled>/.exec(capsResp.data)?.[1] ?? 'false';
        const capsPayload = `<?xml version="1.0" encoding="UTF-8"?>
<VmCapabilities xmlns="http://www.vmware.com/vcloud/v1.5"
    xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
    xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
    xmlns:vmw="http://www.vmware.com/schema/ovf">
  <MemoryHotAddEnabled>${memoryHotAdd}</MemoryHotAddEnabled>
  <CpuHotAddEnabled>${cpuHotAdd}</CpuHotAddEnabled>
</VmCapabilities>`;
        const capsUpdateResp2 = await this.makeRequest<string>({ method: 'PUT', url: `/vApp/vm-${vmUuid(vmId)}/vmCapabilities`, data: capsPayload, headers: { 'Content-Type': 'application/vnd.vmware.vcloud.vmCapabilitiesSection+xml' } }, zoneId);
        // Wait for vmCapabilities task (VCD returns HTTP 202 with a Task)
        const capsTaskResult2 = parseTaskResponse(capsUpdateResp2.data);
        if (capsTaskResult2.taskId) {
          const capsDeadline2 = Date.now() + 120_000;
          while (Date.now() < capsDeadline2) {
            await new Promise(r => setTimeout(r, 3000));
            const t = await this.getTask(capsTaskResult2.taskId, zoneId);
            const s = t.data?.taskStatus;
            if (s === 'success') break;
            if (s === 'error' || s === 'aborted') throw new Error(`vmCapabilities task ${capsTaskResult2.taskId} ended with status=${s}`);
          }
        }
      }

      return this.formatMcpResponse(
        { ...taskResult, memoryMB, ...(memoryHotAdd !== undefined && { memoryHotAdd }) },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
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
      const uuid = vmUuid(vmId);

      // Find primary disk item: InstanceID 2000 first, then largest capacity as fallback
      const findDiskItem = (xmlStr: string): string | null => {
        const pat = /<Item\b[\s\S]*?<\/Item>/g;
        let m: RegExpExecArray | null;
        while ((m = pat.exec(xmlStr)) !== null) {
          if (m[0].includes('<rasd:InstanceID>2000</rasd:InstanceID>')) return m[0];
        }
        pat.lastIndex = 0;
        let maxCap = 0; let found: string | null = null;
        while ((m = pat.exec(xmlStr)) !== null) {
          const capM = /\w+:capacity="(\d+)"/.exec(m[0]);
          if (capM?.[1]) { const cap = parseInt(capM[1], 10); if (cap > maxCap) { maxCap = cap; found = m[0]; } }
        }
        return found;
      };

      // Build updated disk XML with new capacity (capacity in MB, VirtualQuantity in bytes)
      const buildUpdatedXml = (xmlStr: string, item: string): string => {
        const diskSizeBytes = diskSizeMB * 1024 * 1024;
        const capacityPrefix = item.match(/(\w+):capacity="\d+"/)?.[1] ?? 'ns10';
        const updatedItem = item
          .replace(/\w+:capacity="\d+"/, `${capacityPrefix}:capacity="${diskSizeMB}"`)
          .replace(/(<rasd:VirtualQuantity>)\d+(<\/rasd:VirtualQuantity>)/, `$1${diskSizeBytes}$2`);
        return xmlStr.replace(item, updatedItem);
      };

      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`
      }, zoneId);
      const xml = getResp.data as unknown as string;

      const diskItem = findDiskItem(xml);
      if (!diskItem) {
        const ids = [...xml.matchAll(/<rasd:InstanceID>(\d+)<\/rasd:InstanceID>/g)].map(x => x[1]);
        throw new Error(`No disk item found in virtualHardwareSection/disks. Present IDs: [${ids.join(', ')}]`);
      }

      // Block shrink — vCD/vSphere does not support decreasing disk size
      const currentCapacityMatch = /\w+:capacity="(\d+)"/.exec(diskItem);
      const currentDiskMB = currentCapacityMatch?.[1] ? parseInt(currentCapacityMatch[1], 10) : 0;
      if (diskSizeMB < currentDiskMB) {
        return this.formatMcpResponse({}, zone, {
          code: 'DISK_SHRINK_NOT_SUPPORTED',
          message: `Cannot shrink disk from ${currentDiskMB} MB to ${diskSizeMB} MB. ` +
            `vSphere/vCD does not support decreasing disk size. ` +
            `To reclaim space, delete and redeploy the VM with a smaller disk.`,
          details: { currentDiskMB, requestedDiskMB: diskSizeMB }
        });
      }

      // Strategy 1: Legacy PUT (works for powered-off VMs or VMs with hot-extend support)
      try {
        const putResp = await this.makeRequest<string>({
          method: 'PUT',
          url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`,
          data: buildUpdatedXml(xml, diskItem),
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItemsList+xml' }
        }, zoneId);
        return this.formatMcpResponse({ ...parseTaskResponse(putResp.data), diskSizeMB }, zone);
      } catch {
        // Strategy 2: CloudAPI hot-extend (VCD 10.3+, /cloudapi/1.0.0/vms/{id}/disks)
        try {
          const vmUrn = vmId.startsWith('urn:') ? vmId : `urn:vcloud:vm:${uuid}`;
          const disksData = await this.makeCloudApiRequest<any>('GET', `/vms/${vmUrn}/disks`, zoneId);
          const disks: any[] = disksData.values ?? [];
          const primaryDisk = disks.find((d: any) => d.busNumber === 0 && d.unitNumber === 0)
            ?? (disks.length > 0 ? disks.reduce((a: any, b: any) => ((b.sizeInMb ?? 0) > (a.sizeInMb ?? 0) ? b : a)) : null);
          if (!primaryDisk) throw new Error('No primary disk found via CloudAPI');
          const putResult = await this.makeCloudApiRequest<any>(
            'PUT', `/vms/${vmUrn}/disks/${primaryDisk.id}`, zoneId,
            { ...primaryDisk, sizeInMb: diskSizeMB }
          );
          return this.formatMcpResponse({ ...putResult, diskSizeMB }, zone);
        } catch {
          // Strategy 3: Power off → extend → power on (VMs without hot-extend on older VCD).
          // VMs inside a "deployed" vApp cannot be individually powered off (VAPP_DEPLOY 400).
          // Fall back: try VM-level undeploy, then vApp-level undeploy with individual-VM pre-poweroff.
          let parentVappUuid: string | null = null;
          const undeployXml = '<?xml version="1.0" encoding="UTF-8"?>\n<UndeployVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">\n  <UndeployPowerAction>powerOff</UndeployPowerAction>\n</UndeployVAppParams>';
          const undeployHdrs = { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' };
          try {
            await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/power/action/powerOff` }, zoneId);
          } catch (vmPowerOffErr) {
            const errMsg = vmPowerOffErr instanceof Error ? vmPowerOffErr.message : String(vmPowerOffErr);
            if (!errMsg.includes('VAPP_DEPLOY') && !errMsg.includes('400')) throw vmPowerOffErr;
            // Brief pause so VCD processes the rejected request before next call
            await new Promise(r => setTimeout(r, 2000));
            // Attempt A: VM-level undeploy (less disruptive than whole-vApp undeploy)
            let vmUndeployOk = false;
            try {
              await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
              vmUndeployOk = true;
            } catch { /* fall through to vApp undeploy */ }
            if (!vmUndeployOk) {
              // Find parent vApp UUID from the VM entity XML
              const vmXmlResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId);
              const vmXml = vmXmlResp.data as unknown as string;
              const vappM = /Link[^>]+rel="up"[^>]+href="[^"]*\/vApp\/vapp-([0-9a-f-]{36})/.exec(vmXml)
                         || /\/vApp\/vapp-([0-9a-f-]{36})/.exec(vmXml);
              if (!vappM) throw new Error(`VAPP_DEPLOY on VM ${uuid}: cannot locate parent vApp in VM XML`);
              parentVappUuid = vappM[1] ?? null;
              // Attempt B: direct vApp undeploy
              try {
                await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
              } catch {
                // Attempt C: power off each VM individually first (mirrors undeployVApp strategy 2)
                const vappXmlResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vapp-${parentVappUuid}` }, zoneId);
                const vmUuids = [...String(vappXmlResp.data).matchAll(/\/vApp\/vm-([0-9a-f-]{36})/g)].map(m => m[1] as string);
                const seenVms = new Set<string>();
                for (const vid of vmUuids) {
                  if (seenVms.has(vid)) continue; seenVms.add(vid);
                  await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${vid}/power/action/powerOff` }, zoneId).catch(() => {});
                }
                await new Promise(r => setTimeout(r, 15000));
                await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
              }
            }
          }
          let poweredOff = false;
          const offDeadline = Date.now() + 120_000;
          while (Date.now() < offDeadline) {
            await new Promise(r => setTimeout(r, 3000));
            if (Date.now() >= offDeadline) break;
            const vmResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId);
            if ((vmResp.data as unknown as string).includes('status="8"')) { poweredOff = true; break; }
          }
          if (!poweredOff) throw new Error('VM did not power off within 120s for disk extend');
          const getResp2 = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}/virtualHardwareSection/disks` }, zoneId);
          const xml2 = getResp2.data as unknown as string;
          const diskItem2 = findDiskItem(xml2);
          if (!diskItem2) throw new Error('No disk item found after power off');
          const putResp2 = await this.makeRequest<string>({
            method: 'PUT',
            url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`,
            data: buildUpdatedXml(xml2, diskItem2),
            headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItemsList+xml' }
          }, zoneId);
          // Restore powered-on state (fire and forget — disk extend is already done)
          if (parentVappUuid) {
            await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/power/action/powerOn` }, zoneId).catch(() => {});
          } else {
            await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/power/action/powerOn` }, zoneId).catch(() => {});
          }
          return this.formatMcpResponse({ ...parseTaskResponse(putResp2.data), diskSizeMB }, zone);
        }
      }
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'UPDATE_VM_DISK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to resize disk',
        details: error
      });
    }
  }

  /**
   * Force a VM to powered-off, handling the common case where a VM inside a "deployed" vApp
   * rejects an individual power-off (VAPP_DEPLOY 400) by falling back through VM-level undeploy,
   * then vApp-level undeploy, then powering off every sibling VM before vApp undeploy. Polls
   * until the VM actually reports powered-off (status="8") or throws after 120s.
   * Returns the parent vApp's UUID when a vApp-level undeploy path was used (so the caller can
   * restore power at the vApp level afterward), or null when a plain VM-level power-off sufficed.
   * Used by addVMDisk; kept separate from updateVMDisk's own inline copy of this same fallback
   * rather than refactoring that already-proven code path.
   */
  private async forcePowerOffVM(uuid: string, zoneId?: string): Promise<string | null> {
    const undeployXml = '<?xml version="1.0" encoding="UTF-8"?>\n<UndeployVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">\n  <UndeployPowerAction>powerOff</UndeployPowerAction>\n</UndeployVAppParams>';
    const undeployHdrs = { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' };
    let parentVappUuid: string | null = null;
    try {
      await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/power/action/powerOff` }, zoneId);
    } catch (vmPowerOffErr) {
      const errMsg = vmPowerOffErr instanceof Error ? vmPowerOffErr.message : String(vmPowerOffErr);
      if (!errMsg.includes('VAPP_DEPLOY') && !errMsg.includes('400')) throw vmPowerOffErr;
      await new Promise(r => setTimeout(r, 2000));
      let vmUndeployOk = false;
      try {
        await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
        vmUndeployOk = true;
      } catch { /* fall through to vApp undeploy */ }
      if (!vmUndeployOk) {
        const vmXmlResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId);
        const vmXml = vmXmlResp.data as unknown as string;
        const vappM = /Link[^>]+rel="up"[^>]+href="[^"]*\/vApp\/vapp-([0-9a-f-]{36})/.exec(vmXml)
                   || /\/vApp\/vapp-([0-9a-f-]{36})/.exec(vmXml);
        if (!vappM) throw new Error(`VAPP_DEPLOY on VM ${uuid}: cannot locate parent vApp in VM XML`);
        parentVappUuid = vappM[1] ?? null;
        try {
          await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
        } catch {
          const vappXmlResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vapp-${parentVappUuid}` }, zoneId);
          const vmUuids = [...String(vappXmlResp.data).matchAll(/\/vApp\/vm-([0-9a-f-]{36})/g)].map(m => m[1] as string);
          const seenVms = new Set<string>();
          for (const vid of vmUuids) {
            if (seenVms.has(vid)) continue; seenVms.add(vid);
            await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${vid}/power/action/powerOff` }, zoneId).catch(() => {});
          }
          await new Promise(r => setTimeout(r, 15000));
          await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/action/undeploy`, data: undeployXml, headers: undeployHdrs }, zoneId);
        }
      }
    }

    let poweredOff = false;
    const offDeadline = Date.now() + 120_000;
    while (Date.now() < offDeadline) {
      await new Promise(r => setTimeout(r, 3000));
      if (Date.now() >= offDeadline) break;
      const vmResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId);
      if ((vmResp.data as unknown as string).includes('status="8"')) { poweredOff = true; break; }
    }
    if (!poweredOff) throw new Error(`VM ${uuid} did not power off within 120s`);
    return parentVappUuid;
  }

  /** Restore power after forcePowerOffVM — at the vApp level if that's what was undeployed, else the VM itself. */
  private async restorePowerAfterForceOff(uuid: string, parentVappUuid: string | null, zoneId?: string): Promise<void> {
    if (parentVappUuid) {
      await this.makeRequest<string>({ method: 'POST', url: `/vApp/vapp-${parentVappUuid}/power/action/powerOn` }, zoneId).catch(() => {});
    } else {
      await this.makeRequest<string>({ method: 'POST', url: `/vApp/vm-${uuid}/power/action/powerOn` }, zoneId).catch(() => {});
    }
  }

  /**
   * Add a brand-new disk to a VM — distinct from updateVMDisk, which only resizes the
   * existing boot/primary disk. Clones an existing disk's RASD <Item> as a structural
   * template (vCD's CIM-based virtualHardwareSection schema requires a specific set of
   * nil-or-valued child elements in a fixed order; reusing a known-valid item avoids
   * hand-authoring that shape from scratch) and assigns it a fresh InstanceID and the next
   * free AddressOnParent on the same controller.
   * Adding a disk is not supported hot in this environment — the VM is powered off first if
   * needed (same VAPP_DEPLOY-aware fallback as updateVMDisk's Strategy 3) and restored to its
   * original power state afterward.
   */
  async addVMDisk(vmId: string, diskSizeMB: number, storageProfileHref?: string, zoneId?: string): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const uuid = vmUuid(vmId);

      const buildNewDiskXml = (xmlStr: string): { xml: string; instanceId: number } => {
        const items = xmlStr.match(/<Item>[\s\S]*?<\/Item>/g) ?? [];
        if (items.length === 0) {
          throw new Error('No hardware items found in virtualHardwareSection/disks.');
        }

        // Boot disk (InstanceID 2000) as structural template; largest-capacity disk as fallback.
        let templateItem = items.find(i => i.includes('<rasd:InstanceID>2000</rasd:InstanceID>'));
        if (!templateItem) {
          let maxCap = 0;
          for (const item of items) {
            const capM = /\w+:capacity="(\d+)"/.exec(item);
            if (capM?.[1]) { const cap = parseInt(capM[1], 10); if (cap > maxCap) { maxCap = cap; templateItem = item; } }
          }
        }
        if (!templateItem) {
          throw new Error('Could not find an existing disk item to use as a template for the new disk.');
        }

        // Unique InstanceID — one past the highest InstanceID anywhere in the document
        // (controllers included). Disk InstanceIDs conventionally start at 2000; only
        // uniqueness matters here.
        const allIds = [...xmlStr.matchAll(/<rasd:InstanceID>(\d+)<\/rasd:InstanceID>/g)].map(m => parseInt(m[1]!, 10));
        const newInstanceId = Math.max(2000, ...allIds) + 1;

        // Next free AddressOnParent on the same controller (rasd:Parent) as the template disk.
        const parentId = /<rasd:Parent>(\d+)<\/rasd:Parent>/.exec(templateItem)?.[1];
        const siblingAddresses = parentId
          ? items
              .filter(i => i.includes(`<rasd:Parent>${parentId}</rasd:Parent>`))
              .map(i => /<rasd:AddressOnParent>(\d+)<\/rasd:AddressOnParent>/.exec(i)?.[1])
              .filter((s): s is string => s !== undefined)
              .map(s => parseInt(s, 10))
          : [];
        const newAddress = siblingAddresses.length ? Math.max(...siblingAddresses) + 1 : 0;

        const diskCount = items.filter(i => /<rasd:ResourceType>17<\/rasd:ResourceType>/.test(i)).length;
        const diskSizeBytes = diskSizeMB * 1024 * 1024;
        const capacityPrefix = templateItem.match(/(\w+):capacity="\d+"/)?.[1] ?? 'ns10';

        let newItem = templateItem
          .replace(/<rasd:AddressOnParent>\d+<\/rasd:AddressOnParent>/, `<rasd:AddressOnParent>${newAddress}</rasd:AddressOnParent>`)
          .replace(/<rasd:ElementName>[^<]*<\/rasd:ElementName>/, `<rasd:ElementName>Hard disk ${diskCount + 1}</rasd:ElementName>`)
          .replace(/<rasd:InstanceID>\d+<\/rasd:InstanceID>/, `<rasd:InstanceID>${newInstanceId}</rasd:InstanceID>`)
          .replace(/\w+:capacity="\d+"/, `${capacityPrefix}:capacity="${diskSizeMB}"`)
          .replace(/(<rasd:VirtualQuantity>)\d+(<\/rasd:VirtualQuantity>)/, `$1${diskSizeBytes}$2`);

        if (storageProfileHref) {
          newItem = /\w+:storageProfileHref="[^"]*"/.test(newItem)
            ? newItem.replace(/\w+:storageProfileHref="[^"]*"/, `${capacityPrefix}:storageProfileHref="${storageProfileHref}"`)
            : newItem.replace(/(\w+:capacity="\d+")/, `${capacityPrefix}:storageProfileHref="${storageProfileHref}" $1`);
        }

        // Insert right after the template item — RasdItemsList has no elements after the
        // <Item> list that ordering would conflict with (unlike NetworkConnectionSection's
        // trailing Link tail, which add-NIC has to avoid).
        return { xml: xmlStr.replace(templateItem, `${templateItem}\n    ${newItem}`), instanceId: newInstanceId };
      };

      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`
      }, zoneId);

      // Built once outside the strategy try/catch — a parsing failure here is a genuine setup
      // problem, not a "VM needs to be powered off" signal, and shouldn't trigger Strategy 2.
      const { xml: xml1, instanceId: instanceId1 } = buildNewDiskXml(getResp.data as unknown as string);

      // Strategy 1: direct PUT — works when the VM is already powered off.
      try {
        const putResp = await this.makeRequest<string>({
          method: 'PUT',
          url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`,
          data: xml1,
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItemsList+xml' }
        }, zoneId);
        return this.formatMcpResponse({ ...parseTaskResponse(putResp.data), vmId, diskSizeMB, instanceId: instanceId1 }, zone);
      } catch {
        // Strategy 2: power off (VAPP_DEPLOY-aware), add the disk, restore power.
        const parentVappUuid = await this.forcePowerOffVM(uuid, zoneId);
        const getResp2 = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}/virtualHardwareSection/disks` }, zoneId);
        const { xml: xml2, instanceId } = buildNewDiskXml(getResp2.data as unknown as string);
        const putResp2 = await this.makeRequest<string>({
          method: 'PUT',
          url: `/vApp/vm-${uuid}/virtualHardwareSection/disks`,
          data: xml2,
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.rasdItemsList+xml' }
        }, zoneId);
        await this.restorePowerAfterForceOff(uuid, parentVappUuid, zoneId);
        return this.formatMcpResponse({ ...parseTaskResponse(putResp2.data), vmId, diskSizeMB, instanceId }, zone);
      }
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'ADD_VM_DISK_ERROR',
        message: error instanceof Error ? error.message : 'Failed to add disk to VM',
        details: error
      });
    }
  }

  /**
   * Delete a vApp and all VMs inside it.
   * If the vApp is still deployed (deployed=true), automatically undeployes first and
   * polls the undeploy task before issuing DELETE.
   */
  async deleteVApp(vappId: string, zoneId?: string, force?: boolean): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const vappInfo = await this.getVApp(vappId, zoneId);

      // Safety guard: delete_vapp is the only delete tool reachable for a multi-VM vApp, and it
      // destroys every VM inside — an agent trying to remove one bad VM has no other option.
      // Require an explicit force:true to proceed when more than one VM would be destroyed.
      // getVApp's runtime shape (parseVAppDetails) is a bare array of VM summaries, not the
      // formal VAppChildren{vm,vApp} type — same `as unknown as VApp` looseness getVApp itself uses.
      const children = ((vappInfo.data as any)?.children ?? []) as Array<{ id?: string; name?: string }>;
      if (!force && children.length > 1) {
        return this.formatMcpResponse(
          { vmCount: children.length, vms: children.map((c: any) => ({ id: c.id, name: c.name })) },
          zone,
          {
            code: 'DELETE_VAPP_MULTIPLE_VMS_GUARD',
            message: `This vApp contains ${children.length} VMs — delete_vapp would destroy all of them. To remove a single VM, use delete_vm instead. To delete the whole vApp anyway, pass force: true.`,
          }
        );
      }

      // Auto-undeploy if vApp is still deployed
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
        url: `/vApp/vapp-${vappUuid(vappId)}`
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
   * Remove a single VM from its vApp without touching the vApp's other VMs.
   * Undeploys the VM first if it's still deployed (recomposeVApp's DeleteItem rejects a running
   * VM), discovers the parent vApp via the VM entity's rel="up" link (no vappId needed from the
   * caller), then removes it via RecomposeVAppParams/DeleteItem.
   */
  async deleteVM(vmId: string, zoneId?: string): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const uuid = vmUuid(vmId);

      const entityResp = await this.makeRequest<string>({ method: 'GET', url: `/vApp/vm-${uuid}` }, zoneId);
      const xml = entityResp.data as unknown as string;

      const upLink = xml.match(/<(?:\w+:)?Link\b[^>]*\brel="up"[^>]*\bhref="([^"]+)"/i)?.[1];
      if (!upLink) {
        throw new Error('Could not determine the parent vApp for this VM (no rel="up" link in VM entity).');
      }
      const parentVappUuid = upLink.split('/vApp/vapp-')[1]?.split(/[?#]/)[0];
      if (!parentVappUuid) {
        throw new Error(`Could not parse a vApp id from parent link: ${upLink}`);
      }

      // Undeploy (power off + release from ESXi) if the VM is still deployed. A VM inside a
      // deployed vApp can't be removed via recompose while running. Best-effort: if the VM is
      // already undeployed/powered off, this call fails harmlessly and we proceed anyway.
      try {
        const undeployXml = '<?xml version="1.0" encoding="UTF-8"?>\n<UndeployVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">\n  <UndeployPowerAction>powerOff</UndeployPowerAction>\n</UndeployVAppParams>';
        const undeployResp = await this.makeRequest<string>({
          method: 'POST',
          url: `/vApp/vm-${uuid}/action/undeploy`,
          data: undeployXml,
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.undeployVAppParams+xml' }
        }, zoneId);
        const undeployTask = parseTaskResponse(undeployResp.data as unknown as string);
        if (undeployTask.taskId) {
          const start = Date.now();
          while ((Date.now() - start) / 1000 < 120) {
            await new Promise(r => setTimeout(r, 5000));
            const t = await this.getTask(undeployTask.taskId, zoneId);
            const s = t.data?.taskStatus;
            if (s === 'success' || s === 'error' || s === 'aborted') break;
          }
        }
      } catch { /* already undeployed/powered off — proceed */ }

      const apiEndpoint = this.zoneManager.getZoneConfig(zoneId).apiEndpoint;
      const vmHref = `${apiEndpoint}/vApp/vm-${uuid}`;
      const payload = `<?xml version="1.0" encoding="UTF-8"?>
<RecomposeVAppParams xmlns="http://www.vmware.com/vcloud/v1.5">
    <Description>VM removed by Zettagrid MCP Server</Description>
    <DeleteItem href="${vmHref}" />
</RecomposeVAppParams>`;

      const response = await this.makeRequest<string>({
        method: 'POST',
        url: `/vApp/vapp-${parentVappUuid}/action/recomposeVApp`,
        data: payload,
        headers: { 'Content-Type': 'application/vnd.vmware.vcloud.recomposeVAppParams+xml' }
      }, zoneId);

      const task = parseTaskResponse(response.data as unknown as string);
      return this.formatMcpResponse(
        { ...task, vmId, vappId: parentVappUuid, message: 'VM removal task queued. Use get_task to poll for completion.' },
        zone
      );
    } catch (error) {
      return this.formatMcpResponse({}, zone, {
        code: 'DELETE_VM_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete VM',
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
      addNic?: boolean;
      adapterType?: 'VMXNET3' | 'E1000' | 'E1000E';
    },
    zoneId?: string
  ): Promise<McpToolResponse<any>> {
    const zone = zoneId || this.zoneManager.getConfig().defaultZone;
    try {
      const getResp = await this.makeRequest<string>({
        method: 'GET',
        url: `/vApp/vm-${vmUuid(vmId)}/networkConnectionSection`
      }, zoneId);

      let xml = getResp.data as unknown as string;

      // Extract all <NetworkConnection>...</NetworkConnection> blocks
      const ncPattern = /(<NetworkConnection\b[^>]*>[\s\S]*?<\/NetworkConnection>)/g;
      let m: RegExpExecArray | null;
      const allNcs: string[] = [];
      while ((m = ncPattern.exec(xml)) !== null) {
        const block = m[1] ?? '';
        if (block) allNcs.push(block);
      }
      const existingIndices = allNcs
        .map(block => block.match(/<NetworkConnectionIndex>(\d+)<\/NetworkConnectionIndex>/)?.[1])
        .filter((s): s is string => s !== undefined)
        .map(s => parseInt(s, 10));

      // Add-NIC path: appends a brand-new <NetworkConnection> instead of editing an existing
      // one. A VM created without a working network (e.g. B2's failure mode) has an empty
      // NetworkConnectionSection — nothing here to "update", only to add to.
      if (update.addNic) {
        if (!update.networkName) {
          throw new Error('addNic requires networkName to connect the new NIC to.');
        }
        const newIndex = update.nicIndex ?? (existingIndices.length ? Math.max(...existingIndices) + 1 : 0);
        if (existingIndices.includes(newIndex)) {
          throw new Error(`NIC index ${newIndex} already exists — pass a different nicIndex, or omit nicIndex to auto-assign the next available one.`);
        }
        const resolvedMode = update.ipMode ?? 'POOL';
        const ipLine = resolvedMode === 'MANUAL' && update.ipAddress ? `<IpAddress>${update.ipAddress}</IpAddress>` : '';
        // NetworkAdapterType must be the LAST child of NetworkConnection — confirmed via live
        // vCD response inspection (same ordering buildSourcedItemXml's NIC template follows).
        const adapterLine = update.adapterType ? `<NetworkAdapterType>${update.adapterType}</NetworkAdapterType>` : '';
        const newNicXml = `<NetworkConnection network="${update.networkName}">
                <NetworkConnectionIndex>${newIndex}</NetworkConnectionIndex>
                ${ipLine}
                <IsConnected>true</IsConnected>
                <IpAddressAllocationMode>${resolvedMode}</IpAddressAllocationMode>
                ${adapterLine}
            </NetworkConnection>`;
        // Must land after the last <NetworkConnection> but before any trailing <Link> elements —
        // NetworkConnectionSection's schema is Info, PrimaryNetworkConnectionIndex, NetworkConnection*,
        // Link* in that order, and vCD's own GET response includes those Link elements before the
        // closing tag. Inserting right before </NetworkConnectionSection> (after the Links) is invalid.
        if (allNcs.length > 0) {
          const lastNc = allNcs[allNcs.length - 1]!;
          xml = xml.replace(lastNc, `${lastNc}\n        ${newNicXml}`);
        } else {
          xml = xml.replace(
            /(<PrimaryNetworkConnectionIndex>\d+<\/PrimaryNetworkConnectionIndex>)/,
            `$1\n        ${newNicXml}`
          );
        }

        // First NIC ever added, or isPrimary explicitly requested: set it as primary.
        const makesPrimary = existingIndices.length === 0 || !!update.isPrimary;
        if (makesPrimary) {
          xml = xml.replace(
            /<PrimaryNetworkConnectionIndex>\d+<\/PrimaryNetworkConnectionIndex>/,
            `<PrimaryNetworkConnectionIndex>${newIndex}</PrimaryNetworkConnectionIndex>`
          );
        }

        const putResp = await this.makeRequest<string>({
          method: 'PUT',
          url: `/vApp/vm-${vmUuid(vmId)}/networkConnectionSection`,
          data: xml,
          headers: { 'Content-Type': 'application/vnd.vmware.vcloud.networkConnectionSection+xml' }
        }, zoneId);

        return this.formatMcpResponse(
          {
            ...parseTaskResponse(putResp.data as unknown as string),
            vmId,
            nicIndex: newIndex,
            added: { networkName: update.networkName, ipMode: resolvedMode, ipAddress: update.ipAddress, isPrimary: makesPrimary, adapterType: update.adapterType },
          },
          zone
        );
      }

      const nicIndex = update.nicIndex ?? 0;
      const targetNc = allNcs.find(block => {
        const idxMatch = block.match(/<NetworkConnectionIndex>(\d+)<\/NetworkConnectionIndex>/);
        return idxMatch?.[1] !== undefined && parseInt(idxMatch[1], 10) === nicIndex;
      }) ?? null;

      if (!targetNc) {
        throw new Error(`NIC index ${nicIndex} not found. Available NIC indices: [${existingIndices.join(', ')}]. Pass addNic: true to add a new NIC instead of updating an existing one.`);
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

      // Confirmed live: vCD rejects this outright — "Cannot change network adapter type of
      // existing virtual machine" — regardless of power state. Only works on a brand-new NIC
      // (see the addNic branch above). Left in place rather than pre-emptively blocked here:
      // vCD's own error message is already clear, and some environments/versions may differ.
      if (update.adapterType) {
        updatedNc = updatedNc.includes('<NetworkAdapterType>')
          ? updatedNc.replace(/<NetworkAdapterType>[^<]*<\/NetworkAdapterType>/, `<NetworkAdapterType>${update.adapterType}</NetworkAdapterType>`)
          // Must be the last child — insert right before the closing tag.
          : updatedNc.replace('</NetworkConnection>', `<NetworkAdapterType>${update.adapterType}</NetworkAdapterType>\n            </NetworkConnection>`);
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
        url: `/vApp/vm-${vmUuid(vmId)}/networkConnectionSection`,
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
            adapterType: update.adapterType,
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
      // VCD CloudAPI DELETE expects full URN in the path (HTTP 400 if only UUID is supplied)
      const id = profileId.startsWith('urn:vcloud:') ? profileId : `urn:vcloud:applicationPortProfile:${profileId}`;
      // Retry on BUSY_ENTITY: VCD locks the entity while its create task is still running
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await this.makeCloudApiRequest<any>('DELETE', `/applicationPortProfiles/${id}`, zoneId);
          return this.formatMcpResponse({ deleted: true, profileId }, zone);
        } catch (e: any) {
          if (attempt < 3 && String(e?.message || '').includes('BUSY_ENTITY')) {
            await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
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

