/**
 * HTTP credential extraction for multi-tenant mode.
 *
 * The HTTP transport is a stateless relay: every caller supplies their own VCD credentials
 * per request via headers, rather than the server holding one set of credentials for
 * everyone (as the env-scanned stdio path does). Nothing here is stored — extraction just
 * validates and shapes what's on the wire into InjectedZoneCredentials.
 */

import { IncomingHttpHeaders } from 'node:http';
import { InjectedZoneCredentials, ZoneId } from '../types.js';

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
  | { credentials: InjectedZoneCredentials }
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

  if (!apiToken || !organizationName || !zone) {
    return {
      error: {
        status: 401,
        message: 'Missing required headers: X-VCD-Token, X-VCD-Org, and X-VCD-Zone are all required.'
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

  return { credentials: { apiToken, organizationName, zone: zone as ZoneId } };
}
