export type CompressionMode = "original" | "balanced" | "auto";

export type CompressionState =
  | "waiting"
  | "analyzing"
  | "compressing"
  | "ready"
  | "fallback";

export interface CompressionResult {
  originalFile: File;
  file: File;
  compressed: boolean;
  originalSize: number;
  outputSize: number;
  savingsBytes: number;
  savingsRatio: number;
  mimeType: string;
  fallbackReason?: string;
}

export interface CompressionProgress {
  state: CompressionState;
  progress?: number;
  detail?: string;
}
