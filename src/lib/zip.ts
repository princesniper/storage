import { ReadableStream } from "node:stream/web";

type ZipEntry = {
  name: string;
  getBytes?: () => Promise<Buffer>;
  directory?: boolean;
};

type CentralEntry = {
  name: Buffer;
  crc32: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

function u16(n: number) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(n & 0xffff); return b; }
function u32(n: number) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0); return b; }

function localHeader(name: Buffer, crc: number, size: number, time: number, date: number): Buffer {
  return Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(time), u16(date),
    u32(crc), u32(size), u32(size), u16(name.length), u16(0), name,
  ]);
}

function centralHeader(entry: CentralEntry): Buffer {
  return Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(entry.time), u16(entry.date),
    u32(entry.crc32), u32(entry.size), u32(entry.size), u16(entry.name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(entry.offset), entry.name,
  ]);
}

function endRecord(count: number, directorySize: number, directoryOffset: number): Buffer {
  return Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(count), u16(count),
    u32(directorySize), u32(directoryOffset), u16(0),
  ]);
}

function sanitizePath(input: string): string {
  const normalized = input.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/").replace(/[\u0000-\u001f]/g, "_").slice(0, 240) || "file";
}

export function createZipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const central: CentralEntry[] = [];
      let offset = 0;
      const used = new Set<string>();

      try {
        for (const rawEntry of entries) {
          let name = sanitizePath(rawEntry.name);
          if (rawEntry.directory && !name.endsWith("/")) name += "/";
          let candidate = name;
          let suffix = 1;
          while (used.has(candidate)) {
            const slash = name.endsWith("/") ? "/" : "";
            const base = name.endsWith("/") ? name.slice(0, -1) : name;
            candidate = `${base} (${suffix++})${slash}`;
          }
          name = candidate;
          used.add(name);

          const nameBytes = Buffer.from(name, "utf8");
          const { time, date } = dosDateTime();
          const bytes = rawEntry.directory ? Buffer.alloc(0) : await rawEntry.getBytes!();
          const crc = crc32(bytes);
          const header = localHeader(nameBytes, crc, bytes.length, time, date);
          controller.enqueue(header);
          offset += header.length;
          if (bytes.length) {
            controller.enqueue(bytes);
            offset += bytes.length;
          }
          central.push({ name: nameBytes, crc32: crc, size: bytes.length, offset: offset - bytes.length - header.length, time, date });
        }

        const directoryOffset = offset;
        const directory = Buffer.concat(central.map(centralHeader));
        controller.enqueue(directory);
        controller.enqueue(endRecord(central.length, directory.length, directoryOffset));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
