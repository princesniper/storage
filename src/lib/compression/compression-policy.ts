import type { CompressionMode } from "./types";

export const COMPRESSION_LIMIT_BYTES = 800 * 1024 * 1024;
const AUTO_MIN_SAVINGS_RATIO = 0.05;
const AUTO_MIN_SIZE_BYTES = 1 * 1024 * 1024;

export interface CompressionPolicyInput {
  mode: CompressionMode;
  size: number;
}

export interface CompressionPolicyDecision {
  eligible: boolean;
  shouldAttempt: boolean;
  reason?: string;
}

export function compressionPolicy({ mode, size }: CompressionPolicyInput): CompressionPolicyDecision {
  if (mode === "original") {
    return { eligible: false, shouldAttempt: false, reason: "original-mode" };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { eligible: false, shouldAttempt: false, reason: "invalid-size" };
  }
  if (size > COMPRESSION_LIMIT_BYTES) {
    return { eligible: false, shouldAttempt: false, reason: "over-800mb" };
  }
  if (mode === "balanced") {
    return { eligible: true, shouldAttempt: true };
  }
  if (size < AUTO_MIN_SIZE_BYTES) {
    return { eligible: true, shouldAttempt: false, reason: "auto-file-too-small" };
  }
  return { eligible: true, shouldAttempt: true };
}

export function shouldUseCompressedOutput(mode: CompressionMode, originalSize: number, outputSize: number): boolean {
  if (!Number.isFinite(originalSize) || originalSize <= 0) return false;
  if (!Number.isFinite(outputSize) || outputSize <= 0) return false;
  if (outputSize >= originalSize) return false;
  if (mode === "balanced") return true;
  return (originalSize - outputSize) / originalSize >= AUTO_MIN_SAVINGS_RATIO;
}

export function isWorthwhile(originalSize: number, outputSize: number): boolean {
  return shouldUseCompressedOutput("auto", originalSize, outputSize);
}
