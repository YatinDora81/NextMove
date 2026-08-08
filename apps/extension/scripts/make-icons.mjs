import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'icons');
const SOURCE = join(HERE, '..', '..', 'web', 'public', 'logo.png');
const SIZES = [16, 48, 128];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** @param {Uint8Array} rgba @param {number} width @param {number} height */
function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** @param {Buffer} file @returns {{ width: number, height: number, rgba: Uint8Array }} */
function decodePng(file) {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${SOURCE} is not a PNG.`);

  let width = 0;
  let height = 0;
  const idat = [];

  for (let off = 8; off < file.length; ) {
    const length = file.readUInt32BE(off);
    const type = file.toString('ascii', off + 4, off + 8);
    const data = file.subarray(off + 8, off + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [bitDepth, colourType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
        throw new Error(
          `${SOURCE} must be 8-bit RGBA, non-interlaced (got bitDepth=${bitDepth}, ` +
            `colourType=${colourType}, interlace=${interlace}). Re-export it or teach this ` +
            `decoder the new format.`,
        );
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + length;
  }

  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`${SOURCE}: unexpected IDAT size after inflate.`);
  }

  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride);

    for (let i = 0; i < stride; i += 1) {
      const x = line[i];
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev === null || i < bpp ? 0 : prev[i - bpp];
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default: throw new Error(`${SOURCE}: unknown PNG filter ${filter} on row ${y}.`);
      }
      out[i] = value & 0xff;
    }
  }

  return { width, height, rgba };
}

function resample(src, size) {
  const out = new Uint8Array(size * size * 4);
  const scaleX = src.width / size;
  const scaleY = src.height / size;

  for (let dy = 0; dy < size; dy += 1) {
    const y0 = dy * scaleY;
    const y1 = y0 + scaleY;
    for (let dx = 0; dx < size; dx += 1) {
      const x0 = dx * scaleX;
      const x1 = x0 + scaleX;

      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let weight = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const coverY = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (coverY <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const coverX = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (coverX <= 0) continue;

          const w = coverX * coverY;
          const i = (sy * src.width + sx) * 4;
          const a = src.rgba[i + 3] / 255;
          r += src.rgba[i] * a * w;
          g += src.rgba[i + 1] * a * w;
          b += src.rgba[i + 2] * a * w;
          alpha += a * w;
          weight += w;
        }
      }

      const o = (dy * size + dx) * 4;
      if (alpha <= 0) {
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
        continue;
      }
      out[o] = Math.round(r / alpha);
      out[o + 1] = Math.round(g / alpha);
      out[o + 2] = Math.round(b / alpha);
      out[o + 3] = Math.round((alpha / weight) * 255);
    }
  }
  return out;
}

const source = decodePng(readFileSync(SOURCE));
process.stdout.write(`source ${SOURCE} (${source.width}x${source.height})\n`);

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(resample(source, size), size, size);
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, png);
  process.stdout.write(`wrote ${file} (${png.length} bytes)\n`);
}
