import * as fs from 'fs';
import * as path from 'path';
import { Request } from 'express';
import { logger } from './logger.js';

/* Append-only audit log of mutating user actions on the wallet UI.
 *
 * Scope: WALLET-side actions only. Plugin/lib emit their own structured
 * logs for protocol events. This log is for "who clicked what when" —
 * useful for post-incident review on mainnet.
 *
 * Format: one JSON object per line (JSONL). Each line:
 *   {
 *     ts: ISO-8601 timestamp,
 *     ip: source IP (best-effort, via req.ip with trust-proxy),
 *     ua: user-agent (truncated to 200 chars),
 *     event: short event name,
 *     details: arbitrary JSON object — small, never includes secrets
 *   }
 *
 * The log lives at process.env.APP_AUDIT_LOG_FILE (default
 * ./audit-log.jsonl). Operators should rotate it via logrotate.
 *
 * Failure to write is logged but not surfaced to the user — audit
 * logging must never break a working request. */

const AUDIT_LOG_PATH = process.env.APP_AUDIT_LOG_FILE || './audit-log.jsonl';

export type AuditEvent =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_reset'
  | 'config_export'
  | 'config_import'
  | 'cln_call_factory_create'
  | 'cln_call_factory_approve'
  | 'cln_call_factory_refuse'
  | 'cln_call_factory_rotate'
  | 'cln_call_factory_close'
  | 'cln_call_fundchannel'
  | 'cln_call_close';

interface AuditEntry {
  ts: string;
  ip: string;
  ua: string;
  event: AuditEvent;
  details?: Record<string, unknown>;
}

function safeIp(req: Request | undefined): string {
  if (!req) return 'unknown';
  return (req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown').slice(0, 64);
}

function safeUA(req: Request | undefined): string {
  if (!req) return '';
  return String(req.get?.('user-agent') || '').slice(0, 200);
}

/* Map a CLN method name to its audit event, or null if the method
 * isn't audit-worthy (read-only / high-volume gossip queries). Keeping
 * the audit log focused on mutating actions keeps it scannable. */
export function clnMethodToAuditEvent(method: string): AuditEvent | null {
  if (!method) return null;
  const m = method.toLowerCase();
  if (m === 'factory-create') return 'cln_call_factory_create';
  if (m === 'factory-approve-proposal') return 'cln_call_factory_approve';
  if (m === 'factory-refuse-proposal') return 'cln_call_factory_refuse';
  if (m === 'factory-rotate' || m === 'factory-open-channels') return 'cln_call_factory_rotate';
  if (m === 'factory-close-proposal' || m === 'factory-force-close') return 'cln_call_factory_close';
  if (m === 'fundchannel') return 'cln_call_fundchannel';
  if (m === 'close') return 'cln_call_close';
  return null;
}

export function appendAudit(
  event: AuditEvent,
  req: Request | undefined,
  details?: Record<string, unknown>,
): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    ip: safeIp(req),
    ua: safeUA(req),
    event,
    ...(details ? { details } : {}),
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err: any) {
    /* Logging-side failures must not break the request flow. Surface
     * to the regular log so the operator notices broken pipe / out-of-
     * disk rather than silently losing the audit trail. */
    logger.warn(`Audit log append failed: ${err?.message || err}`);
  }
}

/* Tail the last N entries — used by the /audit-log GET endpoint.
 * For high-volume cases, prefer rotating the file and reading the
 * current segment with a real log shipper. */
export function tailAuditLog(maxLines: number): AuditEntry[] {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  const limit = Math.max(1, Math.min(maxLines, 1000));
  const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const last = lines.slice(-limit);
  const out: AuditEntry[] = [];
  for (const line of last) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* Skip malformed lines rather than fail the whole request.
       * Manual log editing or a partial write can leave junk; the
       * audit endpoint should still surface the valid entries. */
    }
  }
  return out;
}
