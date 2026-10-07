/**
 * Camera RAW format helpers.
 *
 * RAW files are preserved byte-for-byte in Telegram. The MIME is normalized
 * from the filename when file-type cannot identify a camera-specific format.
 */
const RAW_MIME_BY_EXTENSION: Record<string, string> = {
  cr2: "image/x-raw-canon-cr2",
  cr3: "image/x-raw-canon-cr3",
  nef: "image/x-raw-nikon",
  nrw: "image/x-raw-nikon",
  arw: "image/x-raw-sony",
  srf: "image/x-raw-sony",
  sr2: "image/x-raw-sony",
  dng: "image/x-adobe-dng",
  raf: "image/x-raw-fuji",
  rw2: "image/x-raw-panasonic",
  orf: "image/x-raw-olympus",
  orf2: "image/x-raw-olympus",
  pef: "image/x-raw-pentax",
  ptx: "image/x-raw-pentax",
  srw: "image/x-raw-samsung",
  x3f: "image/x-raw-sigma",
  iiq: "image/x-raw-phaseone",
  3fr: "image/x-raw-hasselblad",
  mos: "image/x-raw-leaf",
  mef: "image/x-raw-mamiya",
  mrw: "image/x-raw-minolta",
  erf: "image/x-raw-epson",
  kdc: "image/x-raw-kodak",
  dcr: "image/x-raw-kodak",
  raw: "image/x-raw",
};

export function rawMimeFromName(name: string): string | null {
  const match = /\.([^.\\/]+)$/.exec(name.trim().toLowerCase());
  return match ? RAW_MIME_BY_EXTENSION[match[1]] ?? null : null;
}

export function isRawFileName(name: string): boolean {
  return rawMimeFromName(name) !== null;
}

export function isRawMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("image/x-raw-") ||
    mime.trim().toLowerCase() === "image/x-adobe-dng" ||
    mime.trim().toLowerCase() === "image/x-raw";
}

export function rawExtensions(): string[] {
  return Object.keys(RAW_MIME_BY_EXTENSION);
}
