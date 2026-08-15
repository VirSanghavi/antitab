/**
 * Confirms the committed PNGs really are what dev/make-icons.mjs draws.
 *
 *   node dev/test/icon-check.mjs
 *
 * Compares decoded pixels, not file bytes: zlib's output differs between Node
 * versions, so a byte-for-byte diff would fail on a machine that changed
 * nothing. Pixels are the thing we actually care about.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { draw, SIZES } from '../make-icons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const failures = [];
const fail = (message) => { failures.push(message); console.log(`FAIL  ${message}`); };

/** Enough of a PNG reader for our own 8-bit RGBA, non-interlaced files. */
function decodePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error('not a PNG');
  }

  let offset = 8;
  let header = null;
  const data = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12]
      };
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error('no IHDR');
  if (header.depth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(`unexpected format: depth ${header.depth}, colour type ${header.colorType}`);
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * 4;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`unexpected scanline filter ${filter}`);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { ...header, pixels };
}

for (const size of SIZES) {
  const file = `icons/icon${size}.png`;
  let decoded;
  try {
    decoded = decodePng(readFileSync(join(ROOT, file)));
  } catch (error) {
    fail(`${file} could not be read: ${error.message}`);
    continue;
  }

  if (decoded.width !== size || decoded.height !== size) {
    fail(`${file} is ${decoded.width}x${decoded.height}, expected ${size}x${size}`);
    continue;
  }

  const expected = draw(size);
  if (!decoded.pixels.equals(expected)) {
    const differing = [...expected].filter((byte, i) => byte !== decoded.pixels[i]).length;
    fail(`${file} does not match the source drawing (${differing} bytes differ). Run: node dev/make-icons.mjs`);
    continue;
  }

  // A blank or fully transparent icon would still pass everything above.
  const opaque = [...decoded.pixels].filter((_, i) => i % 4 === 3).filter((alpha) => alpha > 0).length;
  if (opaque < size * size * 0.5) fail(`${file} is mostly transparent`);

  console.log(`PASS  ${file} matches the source drawing`);
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall good');
process.exit(failures.length ? 1 : 0);
