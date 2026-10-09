/** Shared limits for the browser-to-server resumable upload protocol. */
// Keep ordinary/video chunks bounded while avoiding thousands of sequential
// HTTP requests for 300–800 MiB videos. RAW keeps its existing smaller chunk.
export const RESUMABLE_CHUNK_SIZE = 1024 * 1024;
export const MAX_RESUMABLE_CHUNKS = 1024;
export const RAW_RESUMABLE_CHUNK_SIZE = 256 * 1024;
export const MAX_RAW_RESUMABLE_CHUNKS = 16384;
