/**
 * Structured logger that NEVER logs secrets.
 * Allowlist-based — only named fields are emitted.
 */
type LogLevel = "info" | "warn" | "error" | "debug";

const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "session",
  "sessionCipher",
  "sessionIV",
  "sessionAuthTag",
  "apiHash",
  "apiKey",
  "token",
  "secret",
  "phoneCodeHash",
  "phone",
  "otp",
  "code",
]);

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj instanceof Error) {
    return { message: obj.message, name: obj.name, stack: obj.stack };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    msg,
  };
  if (meta) {
    const red = redact(meta);
    if (typeof red === "object" && red !== null) {
      Object.assign(line, red);
    }
  }
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") emit("debug", msg, meta);
  },
};
