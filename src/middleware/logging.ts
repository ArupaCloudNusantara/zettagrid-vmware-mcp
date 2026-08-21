/**
 * Structured audit trail for tool invocations (A2.3). One JSON line per call, to stderr
 * (consistent with the rest of the server's logging). Never logs the raw token or api token —
 * only a prefix of its hash, which is enough to correlate calls from the same caller without
 * being a usable credential itself.
 */

export interface AuditLogEntry {
  credentialHashPrefix: string;
  organization: string;
  zone: string;
  tool: string;
  outcome: 'success' | 'error';
  durationMs: number;
  errorMessage?: string;
}

export function logAudit(entry: AuditLogEntry): void {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}
