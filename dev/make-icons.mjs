/**
 * Draws the Antitab toolbar icon at every size Chrome asks for and writes real
 * PNGs — no dependencies, no binary blobs checked in by hand.
 *
 *   node dev/make-icons.mjs
 *
 * The mark: a near-black rounded tile with a green play triangle, so it holds
 * up on both a light and a dark Chrome toolbar.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
export const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // supersampling per axis

const TILE = [0x16, 0x18, 0x1c];
const PLAY = [0x35, 0xc9, 0x8a];

// ------------------------------------------------------------------ geometry

function insideRoundedRect(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = x < min ? min : x > max ? max : x;
  const cy = y < min ? min : y > max ? max : y;
  const dx = x - cx;
  const dy = y - cy;
  if (x < 0 || y < 0 || x > size || y > size) return false;
  return dx * dx + dy * dy <= radius * radius;
}

function insideTriangle(x, y, a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([x, y], a, b);
  const d2 = sign([x, y], b, c);
  const d3 = sign([x, y], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export function draw(size) {
  const radius = size * 0.22;
  // Same proportions as the inline SVG mark used in the popup.
  const a = [size * 0.38, size * 0.31];
  const b = [size * 0.38, size * 0.69];
  const c = [size * 0.67, size * 0.5];

  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;
  const offset = step / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tileHits = 0;
      let playHits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + offset + sx * step;
          const y = py + offset + sy * step;
          if (!insideRoundedRect(x, y, size, radius)) continue;
          tileHits++;
          if (insideTriangle(x, y, a, b, c)) playHits++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = tileHits / total;
      const i = (py * size + px) * 4;
      if (alpha === 0) continue;

      // Composite the triangle over the tile. PNG wants straight alpha, so no
      // premultiplication here.
      const playRatio = tileHits ? playHits / tileHits : 0;
      for (let channel = 0; channel < 3; channel++) {
        pixels[i + channel] = Math.round(
          TILE[channel] * (1 - playRatio) + PLAY[channel] * playRatio
        );
      }
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

// --------------------------------------------------------------------- encode

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Only write when run directly, so the drawing can be imported and verified.
// zlib output differs between Node versions, which makes the compressed bytes a
// useless thing to diff; dev/test/icon-check.mjs compares pixels instead.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const file = join(OUT_DIR, `icon${size}.png`);
    writeFileSync(file, encodePng(size, draw(size)));
    console.log(`wrote icons/icon${size}.png`);
  }
}
