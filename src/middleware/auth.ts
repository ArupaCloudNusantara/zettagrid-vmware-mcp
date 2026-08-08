/**
 * HTTP credential extraction.
 *
 * Two supported modes, chosen per request:
 *  - Multi-tenant: caller supplies X-VCD-Token/X-VCD-Org/X-VCD-Zone, and the server relays to
 *    that caller's own VCD identity. Nothing here is stored — extraction just validates and
 *    shapes what's on the wire into InjectedZoneCredentials.
 *  - Self-hosted single-tenant: no X-VCD-* headers at all, in which case the server falls back
 *    to the same env-scanned credentials stdio mode uses. This is the pre-existing behavior
 *    the public self-hosting docs describe (`cp .env.example`, `docker compose up`, hit
 *    `/mcp`) — it must keep working with zero headers, since that flow predates the
 *    header-based mode and self-hosting customers were never told headers exist.
 *
 * Partial headers (e.g. token present but org missing) are treated as a caller who *meant* to
 * use header-based auth and got it wrong — that's a 401, not a silent fallback, since silently
 * using env credentials in that case could paper over a misconfigured client and use the wrong
 * identity without anyone noticing.
 */

import { IncomingHttpHeaders } from 'node:http';
import { InjectedZoneCredentials, ZoneId } from '../types.js';
import { hashCredential } from '../lib/credential-hash.js';

const VALID_ZONES: ZoneId[] = [
  'sydney', 'melbourne', 'perth', 'brisbane', 'adelaide', 'darwin', 'jakarta', 'cibitung'
];

// The org name is interpolated directly into an OAuth URL path (token-manager.ts). Trusted
// today because it comes from env; caller-supplied over HTTP, it must be constrained before
// it reaches that URL. Do not rely on URL-encoding alone to make this safe.
const ORG_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const MIN_TOKEN_LENGTH = 10;

export interface CredentialExtractionError {
  status: number;
  message: string;
}

export type CredentialExtractionResult =
  | { credentials: InjectedZoneCredentials; credentialHash: string }
  | { credentials: undefined; credentialHash: 'env' }
  | { error: CredentialExtractionError };

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function extractZoneCredentials(headers: IncomingHttpHeaders): CredentialExtractionResult {
  const apiToken = firstHeaderValue(headers['x-vcd-token']);
  const organizationName = firstHeaderValue(headers['x-vcd-org']);
  const zone = firstHeaderValue(headers['x-vcd-zone']);

  if (!apiToken && !organizationName && !zone) {
    // No X-VCD-* headers at all — fall back to the server's own env-scanned credentials,
    // exactly like stdio mode. Preserves the pre-existing self-hosted Docker+.env flow.
    return { credentials: undefined, credentialHash: 'env' };
  }

  if (!apiToken || !organizationName || !zone) {
    return {
      error: {
        status: 401,
        message: 'Partial X-VCD-* headers received — X-VCD-Token, X-VCD-Org, and X-VCD-Zone ' +
          'must all be present together to use per-request credentials, or all omitted to use ' +
          "this server's own environment credentials."
      }
    };
  }

  if (!ORG_NAME_PATTERN.test(organizationName)) {
    return {
      error: {
        status: 401,
        message: `X-VCD-Org is invalid: must match ${ORG_NAME_PATTERN}.`
      }
    };
  }

  if (!VALID_ZONES.includes(zone as ZoneId)) {
    return {
      error: {
        status: 401,
        message: `X-VCD-Zone "${zone}" is not a recognized zone. Valid zones: ${VALID_ZONES.join(', ')}.`
      }
    };
  }

  if (apiToken.length < MIN_TOKEN_LENGTH) {
    return {
      error: {
        status: 401,
        message: 'X-VCD-Token is malformed (too short).'
      }
    };
  }

  const credentials: InjectedZoneCredentials = { apiToken, organizationName, zone: zone as ZoneId };
  return { credentials, credentialHash: hashCredential(apiToken, organizationName, zone) };
}
