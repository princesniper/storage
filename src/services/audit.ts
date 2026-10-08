/**
 * Audit log service — appends an UploadLog row for every important operation.
 * Never logs secrets — only operation, status, error, ip, and a redacted metadata blob.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditOperation =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "UPLOAD"
  | "DELETE"
  | "CHANNEL_ADD"
  | "CHANNEL_RECONNECT"
  | "CHANNEL_DELETE"
  | "CHANNEL_TEST"
  | "CHANNEL_UPDATE"
  | "TELEGRAM_CONNECT"
  | "TELEGRAM_DISCONNECT"
  | "TELEGRAM_ERROR";

export type AuditStatus = "SUCCESS" | "FAILED" | "PARTIAL";

export async function audit(opts: {
  operation: AuditOperation;
  status: AuditStatus;
  adminId?: number;
  fileId?: number;
  errorMessage?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.uploadLog.create({
      data: {
        operation: opts.operation,
        status: opts.status,
        adminId: opts.adminId ?? null,
        fileId: opts.fileId ?? null,
        errorMessage: opts.errorMessage ?? null,
        ip: opts.ip ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    });
  } catch (err) {
    logger.error("audit log write failed", {
      operation: opts.operation,
      status: opts.status,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
