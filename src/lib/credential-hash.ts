/**
 * Single source of truth for turning a caller's credential into an opaque identity key.
 * Used by TokenManager (session cache key), the rate limiter (per-caller bucket key), and
 * audit logging (the hash prefix that stands in for "who" without ever storing the token).
 */

import { createHash } from 'node:crypto';

export function hashCredential(apiToken: string, organizationName: string, zone: string): string {
  return createHash('sha256').update(`${apiToken}:${organizationName}:${zone}`).digest('hex');
}
