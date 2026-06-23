/**
 * Zettagrid Zone Manager - Multi-zone configuration and management
 */

import { ZoneConfig, ZettagridConfig, ZoneId } from '../types.js';

export class ZoneManager {
  private config: ZettagridConfig;
  private zones: Map<string, ZoneConfig> = new Map();

  constructor() {
    try {
      this.config = this.loadConfiguration();
      this.initializeZones();
    } catch (error) {
      console.error('Failed to initialize ZoneManager:', error);
      throw error;
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfiguration(): ZettagridConfig {
    const defaultZone = (process.env.ZETTAGRID_DEFAULT_ZONE || 'perth') as ZoneId;
    
    return {
      zones: {},
      defaultZone,
      timeout: parseInt(process.env.ZETTAGRID_TIMEOUT || '30000', 10),
      retryAttempts: parseInt(process.env.ZETTAGRID_RETRY_ATTEMPTS || '3', 10),
      enableCaching: process.env.ZETTAGRID_ENABLE_CACHING === 'true',
      debugLevel: (process.env.DEBUG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug'
    };
  }

  /**
   * Initialize all available zones from environment configuration
   */
  private initializeZones(): void {
    const zoneNames: ZoneId[] = ['sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'];
    
    for (const zoneName of zoneNames) {
      const zoneConfig = this.loadZoneConfig(zoneName);
      if (zoneConfig) {
        this.zones.set(zoneName, zoneConfig);
        this.config.zones[zoneName] = zoneConfig;
      }
    }

    if (this.zones.size === 0) {
      throw new Error('No valid zone configurations found. Please check your environment variables.');
    }

    // Validate default zone exists
    if (!this.zones.has(this.config.defaultZone)) {
      const availableZones = Array.from(this.zones.keys());
      throw new Error(
        `Default zone '${this.config.defaultZone}' is not configured. Available zones: ${availableZones.join(', ')}`
      );
    }
  }

  /**
   * Load configuration for a specific zone
   */
  private loadZoneConfig(zoneName: ZoneId): ZoneConfig | null {
    const tokenEnvVar = `ZETTAGRID_API_TOKEN_${zoneName.toUpperCase()}`;
    const apiToken = process.env[tokenEnvVar];
    
    if (!apiToken) {
      console.warn(`Zone '${zoneName}' not configured: missing ${tokenEnvVar}`);
      return null;
    }

    const organizationName = process.env.ZETTAGRID_ORGANIZATION;
    if (!organizationName) {
      console.error('ZETTAGRID_ORGANIZATION environment variable is not set');
      throw new Error('ZETTAGRID_ORGANIZATION environment variable is required');
    }

    // Zone code mapping for endpoint generation
    const zoneCodeMap: Record<ZoneId, string> = {
      sydney: 'syd',
      melbourne: 'mel',
      perth: 'per',
      brisbane: 'bri',
      adelaide: 'adl',
      darwin: 'dar',
      jakarta: 'jkt',
      cibitung: 'cbt'   // NOTE: zone code assumed — confirm with Zettagrid Indonesia support
    };

    // Indonesia zones use a different domain (.zettagrid.id) and URL separator (-) vs AU (.zettagrid.com, .)
    const idZones: ZoneId[] = ['jakarta', 'cibitung'];

    const zoneCode = zoneCodeMap[zoneName];

    // Auto-generate endpoints using the correct format per region
    const apiEndpoint = idZones.includes(zoneName)
      ? `https://mycloud-${zoneCode}.zettagrid.id/api`
      : `https://mycloud.${zoneCode}.zettagrid.com/api`;
    const oauthEndpoint = idZones.includes(zoneName)
      ? `https://mycloud-${zoneCode}.zettagrid.id/oauth/tenant/${organizationName}/token`
      : `https://mycloud.${zoneCode}.zettagrid.com/oauth/tenant/${organizationName}/token`;

    return {
      name: zoneName,
      apiEndpoint,
      oauthEndpoint,
      apiToken,
      organizationName,
      apiVersion: process.env.ZETTAGRID_API_VERSION || '39.1'
    };
  }

  /**
   * Get configuration for a specific zone
   */
  getZoneConfig(zoneId?: string): ZoneConfig {
    const targetZone = zoneId || this.config.defaultZone;
    const zoneConfig = this.zones.get(targetZone);
    
    if (!zoneConfig) {
      const availableZones = Array.from(this.zones.keys());
      throw new Error(`Zone '${targetZone}' not found. Available zones: ${availableZones.join(', ')}`);
    }
    
    return zoneConfig;
  }

  /**
   * Get all available zones
   */
  getAvailableZones(): string[] {
    return Array.from(this.zones.keys());
  }

  /**
   * Get default zone configuration
   */
  getDefaultZoneConfig(): ZoneConfig {
    return this.getZoneConfig();
  }

  /**
   * Get global configuration
   */
  getConfig(): ZettagridConfig {
    return { ...this.config };
  }

  /**
   * Check if a zone is available
   */
  isZoneAvailable(zoneId: string): boolean {
    return this.zones.has(zoneId);
  }

  /**
   * Get zone endpoint URL
   */
  getZoneEndpoint(zoneId?: string): string {
    return this.getZoneConfig(zoneId).apiEndpoint;
  }

  /**
   * Get zone API token
   */
  getZoneApiToken(zoneId?: string): string {
    return this.getZoneConfig(zoneId).apiToken;
  }

  /**
   * Get organization name for zone
   */
  getOrganizationName(zoneId?: string): string {
    return this.getZoneConfig(zoneId).organizationName;
  }

  /**
   * Get API version for zone
   */
  getApiVersion(zoneId?: string): string {
    return this.getZoneConfig(zoneId).apiVersion;
  }

  /**
   * Validate zone configuration
   */
  validateZoneConfig(zoneId: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!this.isZoneAvailable(zoneId)) {
      errors.push(`Zone '${zoneId}' is not configured`);
      return { valid: false, errors };
    }

    const config = this.zones.get(zoneId)!;
    
    if (!config.apiEndpoint) {
      errors.push(`Zone '${zoneId}' missing API endpoint`);
    } else if (!config.apiEndpoint.startsWith('https://')) {
      errors.push(`Zone '${zoneId}' API endpoint must use HTTPS`);
    }
    
    if (!config.apiToken) {
      errors.push(`Zone '${zoneId}' missing API token`);
    } else if (config.apiToken.length < 10) {
      errors.push(`Zone '${zoneId}' API token appears to be invalid (too short)`);
    }
    
    if (!config.organizationName) {
      errors.push(`Zone '${zoneId}' missing organization name`);
    }
    
    if (!config.apiVersion) {
      errors.push(`Zone '${zoneId}' missing API version`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate all zone configurations
   */
  validateAllZones(): { valid: boolean; zoneResults: Record<string, { valid: boolean; errors: string[] }> } {
    const zoneResults: Record<string, { valid: boolean; errors: string[] }> = {};
    let allValid = true;

    for (const zoneId of this.zones.keys()) {
      const result = this.validateZoneConfig(zoneId);
      zoneResults[zoneId] = result;
      if (!result.valid) {
        allValid = false;
      }
    }

    return { valid: allValid, zoneResults };
  }

  /**
   * Get zone statistics
   */
  getZoneStats(): {
    totalZones: number;
    configuredZones: number;
    availableZones: string[];
    defaultZone: string;
  } {
    return {
      totalZones: 8, // Total possible Zettagrid zones (6 AU + 2 ID)
      configuredZones: this.zones.size,
      availableZones: Array.from(this.zones.keys()),
      defaultZone: this.config.defaultZone
    };
  }

  /**
   * Build full API URL for a zone endpoint
   */
  buildApiUrl(zoneId: string | undefined, path: string): string {
    const config = this.getZoneConfig(zoneId);
    const baseUrl = config.apiEndpoint.endsWith('/') 
      ? config.apiEndpoint.slice(0, -1) 
      : config.apiEndpoint;
    
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${cleanPath}`;
  }

  /**
   * Get zone display name (formatted for UI)
   */
  getZoneDisplayName(zoneId: string): string {
    const zoneDisplayNames: Record<string, string> = {
      sydney: 'Sydney (NSW)',
      melbourne: 'Melbourne (VIC)', 
      perth: 'Perth (WA)',
      brisbane: 'Brisbane (QLD)',
      adelaide: 'Adelaide (SA)',
      darwin: 'Darwin (NT)',
      jakarta: 'Jakarta (ID)',
      cibitung: 'Cibitung (ID)'
    };
    
    return zoneDisplayNames[zoneId] || zoneId.charAt(0).toUpperCase() + zoneId.slice(1);
  }

  /**
   * Get recommended zone based on location or load balancing
   * For now, returns default zone but could be extended for smart routing
   */
  getRecommendedZone(): string {
    return this.config.defaultZone;
  }

  /**
   * Test zone connectivity (basic endpoint check)
   */
  async testZoneConnectivity(zoneId: string): Promise<{ success: boolean; error?: string; responseTime?: number }> {
    try {
      const config = this.getZoneConfig(zoneId);
      const startTime = Date.now();
      
      // Simple connectivity test - attempt to reach the API endpoint
      const response = await fetch(`${config.apiEndpoint}/versions`, {
        method: 'GET',
        headers: {
          'Accept': 'application/*+xml;version=' + config.apiVersion,
          'User-Agent': 'Zettagrid-MCP-Server/1.0.0'
        },
        signal: AbortSignal.timeout(this.config.timeout)
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        return { success: true, responseTime };
      } else {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown connectivity error' 
      };
    }
  }
}