/**
 * Zone-specific Authentication Handler
 * Manages authentication state and operations per Zettagrid zone
 */

import { ZoneConfig, AuthSession } from '../types.js';
import { TokenManager } from './token-manager.js';

export class ZoneAuth {
  private tokenManager: TokenManager;
  private zoneConfig: ZoneConfig;

  constructor(zoneConfig: ZoneConfig, tokenManager?: TokenManager) {
    this.zoneConfig = zoneConfig;
    this.tokenManager = tokenManager || new TokenManager();
  }

  /**
   * Initialize authentication for this zone
   */
  async initialize(): Promise<void> {
    try {
      await this.tokenManager.authenticateZone(this.zoneConfig);
    } catch (error) {
      throw new Error(`Failed to initialize authentication for zone ${this.zoneConfig.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get authenticated headers for API requests
   */
  async getAuthenticatedHeaders(): Promise<Record<string, string>> {
    return await this.tokenManager.getAuthHeaders(this.zoneConfig);
  }

  /**
   * Get the current session for this zone
   */
  async getSession(): Promise<AuthSession> {
    return await this.tokenManager.getSession(this.zoneConfig);
  }

  /**
   * Test authentication status
   */
  async testAuthentication(): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      const validation = await this.tokenManager.validateSession(this.zoneConfig);
      
      if (validation.valid) {
        const session = await this.getSession();
        return {
          success: true,
          details: {
            zoneId: this.zoneConfig.name,
            organization: this.zoneConfig.organizationName,
            tokenExpiry: session.token.expiresAt.toISOString(),
            hasRefreshToken: !!session.token.refreshToken
          }
        };
      } else {
        return {
          success: false,
          error: validation.error || 'Authentication validation failed'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication test failed'
      };
    }
  }

  /**
   * Refresh authentication token if needed
   */
  async refreshAuthentication(): Promise<void> {
    const session = await this.getSession();
    
    if (session.token.refreshToken) {
      try {
        const newToken = await this.tokenManager.refreshToken(this.zoneConfig, session.token.refreshToken);
        session.token = newToken;
      } catch (error) {
        // If refresh fails, re-authenticate from scratch
        await this.tokenManager.invalidateSession(this.zoneConfig);
        await this.initialize();
      }
    } else {
      // No refresh token available, re-authenticate
      await this.tokenManager.invalidateSession(this.zoneConfig);
      await this.initialize();
    }
  }

  /**
   * Get organization information
   */
  async getOrganizationInfo(): Promise<any> {
    try {
      const headers = await this.getAuthenticatedHeaders();
      const orgUrl = `${this.zoneConfig.apiEndpoint}/org`;
      
      const response = await fetch(orgUrl, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to get organization info: HTTP ${response.status}`);
      }

      const orgData = await response.text();
      return { 
        organization: this.zoneConfig.organizationName,
        zone: this.zoneConfig.name,
        apiVersion: this.zoneConfig.apiVersion,
        response: orgData 
      };
    } catch (error) {
      throw new Error(`Failed to get organization info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current user information
   */
  async getCurrentUser(): Promise<any> {
    try {
      const headers = await this.getAuthenticatedHeaders();
      const userUrl = `${this.zoneConfig.apiEndpoint}/session`;
      
      const response = await fetch(userUrl, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to get current user: HTTP ${response.status}`);
      }

      const userData = await response.text();
      return {
        zone: this.zoneConfig.name,
        user: userData
      };
    } catch (error) {
      throw new Error(`Failed to get current user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if current authentication has required permissions
   */
  async checkPermissions(requiredOperations: string[] = []): Promise<{ hasPermissions: boolean; missingPermissions: string[] }> {
    try {
      // For now, assume all permissions are available if authentication succeeds
      // In a full implementation, this would check specific vCloud Director rights
      const testResult = await this.testAuthentication();
      
      if (testResult.success) {
        return {
          hasPermissions: true,
          missingPermissions: []
        };
      } else {
        return {
          hasPermissions: false,
          missingPermissions: requiredOperations
        };
      }
    } catch (error) {
      return {
        hasPermissions: false,
        missingPermissions: requiredOperations
      };
    }
  }

  /**
   * Get zone configuration
   */
  getZoneConfig(): ZoneConfig {
    return { ...this.zoneConfig };
  }

  /**
   * Update zone configuration
   */
  updateZoneConfig(newConfig: Partial<ZoneConfig>): void {
    this.zoneConfig = { ...this.zoneConfig, ...newConfig };
  }

  /**
   * Logout and clear authentication
   */
  async logout(): Promise<void> {
    await this.tokenManager.invalidateSession(this.zoneConfig);
  }

  /**
   * Get authentication status
   */
  async getAuthStatus(): Promise<{
    authenticated: boolean;
    zone: string;
    organization: string;
    tokenExpiry?: string;
    error?: string;
  }> {
    try {
      const hasSession = this.tokenManager.hasSession(this.zoneConfig);
      
      if (hasSession) {
        const expiry = this.tokenManager.getTokenExpiration(this.zoneConfig);
        const result: {
          authenticated: boolean;
          zone: string;
          organization: string;
          tokenExpiry?: string;
        } = {
          authenticated: true,
          zone: this.zoneConfig.name,
          organization: this.zoneConfig.organizationName
        };
        
        if (expiry) {
          result.tokenExpiry = expiry.toISOString();
        }
        
        return result;
      } else {
        return {
          authenticated: false,
          zone: this.zoneConfig.name,
          organization: this.zoneConfig.organizationName
        };
      }
    } catch (error) {
      return {
        authenticated: false,
        zone: this.zoneConfig.name,
        organization: this.zoneConfig.organizationName,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Validate API token format
   */
  static validateApiToken(token: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!token) {
      errors.push('API token is required');
      return { valid: false, errors };
    }
    
    if (token.length < 10) {
      errors.push('API token appears to be too short');
    }
    
    if (token.includes(' ')) {
      errors.push('API token should not contain spaces');
    }
    
    // Basic format validation - Zettagrid tokens are typically alphanumeric
    if (!/^[a-zA-Z0-9]+$/.test(token)) {
      errors.push('API token contains invalid characters');
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate zone endpoint URL
   */
  static validateEndpoint(endpoint: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!endpoint) {
      errors.push('API endpoint is required');
      return { valid: false, errors };
    }
    
    try {
      const url = new URL(endpoint);
      
      if (url.protocol !== 'https:') {
        errors.push('API endpoint must use HTTPS');
      }
      
      if (!url.hostname.includes('zettagrid.com') && !url.hostname.includes('zettagrid.id')) {
        errors.push('API endpoint should be a Zettagrid domain (zettagrid.com or zettagrid.id)');
      }
      
      if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
        errors.push('API endpoint should include /api path');
      }
    } catch (error) {
      errors.push('API endpoint is not a valid URL');
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Create zone authentication instance with validation
   */
  static create(zoneConfig: ZoneConfig, tokenManager?: TokenManager): ZoneAuth {
    // Validate token
    const tokenValidation = ZoneAuth.validateApiToken(zoneConfig.apiToken);
    if (!tokenValidation.valid) {
      throw new Error(`Invalid API token for zone ${zoneConfig.name}: ${tokenValidation.errors.join(', ')}`);
    }
    
    // Validate endpoint
    const endpointValidation = ZoneAuth.validateEndpoint(zoneConfig.apiEndpoint);
    if (!endpointValidation.valid) {
      throw new Error(`Invalid API endpoint for zone ${zoneConfig.name}: ${endpointValidation.errors.join(', ')}`);
    }
    
    return new ZoneAuth(zoneConfig, tokenManager);
  }
}