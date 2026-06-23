/**
 * Zettagrid Authentication Token Manager
 * Handles API token authentication and session management for vCloud Director
 */

import { AuthToken, AuthSession, ZoneConfig } from '../types.js';

export class TokenManager {
  private sessions: Map<string, AuthSession> = new Map();
  private tokenCache: Map<string, AuthToken> = new Map();

  /**
   * Authenticate with a zone and create a session
   */
  async authenticateZone(zoneConfig: ZoneConfig): Promise<AuthSession> {
    const sessionKey = `${zoneConfig.name}-${zoneConfig.organizationName}`;
    
    // Check if we have a valid cached session
    const existingSession = this.sessions.get(sessionKey);
    if (existingSession && this.isTokenValid(existingSession.token)) {
      return existingSession;
    }

    try {
      // Get authentication token from vCloud Director
      const authToken = await this.getAuthToken(zoneConfig);
      
      // Create new session
      const session: AuthSession = {
        zoneId: zoneConfig.name,
        organizationId: '', // Will be populated after successful auth
        userId: '', // Will be populated after successful auth
        token: authToken
      };

      // Cache the session
      this.sessions.set(sessionKey, session);
      this.tokenCache.set(sessionKey, authToken);

      return session;
    } catch (error) {
      throw new Error(`Authentication failed for zone ${zoneConfig.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get authentication token by refreshing the API token through OAuth
   * The API token needs to be 'refreshed' to generate an access token for API calls
   */
  private async getAuthToken(zoneConfig: ZoneConfig): Promise<AuthToken> {
    try {
      // Build OAuth refresh URL: https://mycloud.per.zettagrid.com/oauth/tenant/your-org-name/token?grant_type=refresh_token&refresh_token=<token>
      const baseUrl = zoneConfig.apiEndpoint.replace('/api', '');
      const refreshUrl = `${baseUrl}/oauth/tenant/${zoneConfig.organizationName}/token?grant_type=refresh_token&refresh_token=${zoneConfig.apiToken}`;
      
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Zettagrid-MCP-Server/1.0.0'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      // Parse OAuth response
      const oauthResponse = await response.json() as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        token_type?: string;
      };
      
      if (!oauthResponse.access_token) {
        throw new Error('No access token received from OAuth refresh endpoint');
      }

      // Calculate expiration time (OAuth typically returns expires_in seconds)
      const expiresIn = oauthResponse.expires_in || 3600; // Default 1 hour
      const expiresAt = new Date(Date.now() + (expiresIn * 1000));

      const authToken: AuthToken = {
        token: oauthResponse.access_token,
        expiresAt
      };
      
      if (oauthResponse.refresh_token) {
        authToken.refreshToken = oauthResponse.refresh_token;
      }
      
      return authToken;
    } catch (error) {
      throw new Error(`Failed to refresh API token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get valid session for a zone
   */
  async getSession(zoneConfig: ZoneConfig): Promise<AuthSession> {
    const sessionKey = `${zoneConfig.name}-${zoneConfig.organizationName}`;
    const existingSession = this.sessions.get(sessionKey);

    if (existingSession && this.isTokenValid(existingSession.token)) {
      return existingSession;
    }

    // Re-authenticate if no valid session
    return await this.authenticateZone(zoneConfig);
  }

  /**
   * Get authentication headers for API requests
   */
  async getAuthHeaders(zoneConfig: ZoneConfig): Promise<Record<string, string>> {
    const session = await this.getSession(zoneConfig);
    
    return {
      'Authorization': `Bearer ${session.token.token}`,
      'Accept': `application/*+xml;version=${zoneConfig.apiVersion}`,
      'User-Agent': 'Zettagrid-MCP-Server/1.0.0'
    };
  }

  /**
   * Check if a token is still valid
   */
  private isTokenValid(token: AuthToken): boolean {
    if (!token || !token.token) {
      return false;
    }

    // Check if token has expired (with 5 minute buffer)
    const now = new Date();
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    return token.expiresAt.getTime() - now.getTime() > bufferTime;
  }

  /**
   * Refresh an authentication token
   */
  async refreshToken(zoneConfig: ZoneConfig, refreshToken: string): Promise<AuthToken> {
    const refreshUrl = `${zoneConfig.apiEndpoint}/sessions/refresh`;
    
    try {
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Accept': `application/*+xml;version=${zoneConfig.apiVersion}`,
          'Authorization': `Bearer ${refreshToken}`,
          'User-Agent': 'Zettagrid-MCP-Server/1.0.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: HTTP ${response.status}`);
      }

      const authHeader = response.headers.get('x-vmware-vcloud-access-token') || 
                        response.headers.get('x-vcloud-authorization');
      
      if (!authHeader) {
        throw new Error('No authentication token received during refresh');
      }

      const expiresHeader = response.headers.get('x-vmware-vcloud-token-expiry');
      const expiresAt = expiresHeader ? new Date(expiresHeader) : new Date(Date.now() + 2 * 60 * 60 * 1000);

      return {
        token: authHeader,
        expiresAt,
        refreshToken: response.headers.get('x-vmware-vcloud-refresh-token') || refreshToken
      };
    } catch (error) {
      throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Invalidate session for a zone
   */
  async invalidateSession(zoneConfig: ZoneConfig): Promise<void> {
    const sessionKey = `${zoneConfig.name}-${zoneConfig.organizationName}`;
    const session = this.sessions.get(sessionKey);
    
    if (session) {
      try {
        // Attempt to logout from vCloud Director
        await this.logout(zoneConfig, session.token.token);
      } catch (error) {
        // Log error but don't fail - session cleanup is still important
        console.warn(`Logout failed for zone ${zoneConfig.name}:`, error);
      }
      
      // Remove from local cache
      this.sessions.delete(sessionKey);
      this.tokenCache.delete(sessionKey);
    }
  }

  /**
   * Logout from vCloud Director
   */
  private async logout(zoneConfig: ZoneConfig, token: string): Promise<void> {
    const logoutUrl = `${zoneConfig.apiEndpoint}/session`;
    
    await fetch(logoutUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': `application/*+xml;version=${zoneConfig.apiVersion}`,
        'User-Agent': 'Zettagrid-MCP-Server/1.0.0'
      }
    });
  }

  /**
   * Clear all cached sessions
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.tokenCache.clear();
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
    sessionsByZone: Record<string, number>;
  } {
    let activeSessions = 0;
    let expiredSessions = 0;
    const sessionsByZone: Record<string, number> = {};

    for (const [, session] of this.sessions.entries()) {
      const zoneId = session.zoneId;
      sessionsByZone[zoneId] = (sessionsByZone[zoneId] || 0) + 1;

      if (this.isTokenValid(session.token)) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      expiredSessions,
      sessionsByZone
    };
  }

  /**
   * Validate session for zone
   */
  async validateSession(zoneConfig: ZoneConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.getSession(zoneConfig);
      
      // Test session with a simple API call
      const testUrl = `${zoneConfig.apiEndpoint}/org`;
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: await this.getAuthHeaders(zoneConfig)
      });

      if (response.ok) {
        return { valid: true };
      } else {
        return { valid: false, error: `Session validation failed: HTTP ${response.status}` };
      }
    } catch (error) {
      return { 
        valid: false, 
        error: `Session validation error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Get token expiration time for a zone
   */
  getTokenExpiration(zoneConfig: ZoneConfig): Date | null {
    const sessionKey = `${zoneConfig.name}-${zoneConfig.organizationName}`;
    const session = this.sessions.get(sessionKey);
    
    return session ? session.token.expiresAt : null;
  }

  /**
   * Check if session exists for zone
   */
  hasSession(zoneConfig: ZoneConfig): boolean {
    const sessionKey = `${zoneConfig.name}-${zoneConfig.organizationName}`;
    const session = this.sessions.get(sessionKey);
    
    return session !== undefined && this.isTokenValid(session.token);
  }
}