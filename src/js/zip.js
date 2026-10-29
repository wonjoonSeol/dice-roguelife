/* ============ zip: the image pack's zip, and reading the zips players upload ============ */
// record signatures and fixed lengths (PKWARE APPNOTE 4.3)
const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 };
const LOCAL_LEN = 30,
  CENTRAL_LEN = 46,
  END_LEN = 22;
const UTF8_NAMES = 0x0800;
const MAX32 = 0xffffffff; // a size or offset kept in the ZIP64 extra field instead

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// a stored (uncompressed) zip: the pictures are already compressed, and the parts stay Blobs so memory stays small
export async function makeZip(files) {
  const parts = [],
    central = [];
  let offset = 0;
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const nm = enc.encode(f.name);
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(LOCAL_LEN));
    h.setUint32(0, SIG.local, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, UTF8_NAMES, true);
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    parts.push(h.buffer, nm, data);
    const c = new DataView(new ArrayBuffer(CENTRAL_LEN));
    c.setUint32(0, SIG.central, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8_NAMES, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, nm);
    offset += LOCAL_LEN + nm.length + data.length;
  }
  const csize = central.reduce((a, p) => a + (p.byteLength || p.length), 0);
  const e = new DataView(new ArrayBuffer(END_LEN));
  e.setUint32(0, SIG.end, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

const zipError = code => Object.assign(new Error('zip: ' + code), { code });
const bytes = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());
const UTF8 = new TextDecoder(),
  STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true }),
  CP949 = new TextDecoder('euc-kr'); // the WHATWG label for windows-949, what Korean Windows Explorer writes
// A name without the UTF-8 flag is UTF-8 when it decodes as such, else Korean Windows' code page. macOS writes
// decomposed (NFD) Hangul, so every name is composed to match names typed elsewhere.
function entryName(u8, flags) {
  let s;
  if (flags & UTF8_NAMES) s = UTF8.decode(u8);
  else
    try {
      s = STRICT_UTF8.decode(u8);
    } catch {
      s = CP949.decode(u8);
    }
  return s.normalize('NFC');
}

// The entries of a zip, read in slices so a pack of hundreds of MB is never in memory at once. Each has a path and
// either open (resolves a Blob: a slice when stored, inflated when deflated) or skip, why it can't be opened:
// 'encrypted', 'zip64' or 'method'. Throws code 'not_zip', or 'zip64' when the entry list itself needs ZIP64.
export async function readZip(file) {
  const tail = await bytes(file, Math.max(0, file.size - END_LEN - 0xffff), file.size); // a comment is up to 64 KB
  let e = tail.byteLength - END_LEN;
  while (e >= 0 && tail.getUint32(e, true) !== SIG.end) e--;
  if (e < 0) throw zipError('not_zip');
  const count = tail.getUint16(e + 10, true),
    size = tail.getUint32(e + 12, true),
    at = tail.getUint32(e + 16, true);
  if (count === 0xffff || size === MAX32 || at === MAX32) throw zipError('zip64');
  if (at + size > file.size) throw zipError('not_zip');
  const cd = await bytes(file, at, at + size);
  const out = [];
  for (let p = 0, i = 0; i < count; i++) {
    if (p + CENTRAL_LEN > cd.byteLength || cd.getUint32(p, true) !== SIG.central) throw zipError('not_zip');
    const flags = cd.getUint16(p + 8, true),
      method = cd.getUint16(p + 10, true),
      csize = cd.getUint32(p + 20, true),
      usize = cd.getUint32(p + 24, true),
      nameLen = cd.getUint16(p + 28, true),
      off = cd.getUint32(p + 42, true);
    const path = entryName(new Uint8Array(cd.buffer, cd.byteOffset + p + CENTRAL_LEN, nameLen), flags);
    p += CENTRAL_LEN + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
    const skip =
      flags & 1
        ? 'encrypted'
        : [csize, usize, off].includes(MAX32)
          ? 'zip64'
          : method !== 0 && method !== 8
            ? 'method'
            : '';
    out.push(skip ? { path, skip } : { path, open: () => openEntry(file, off, method, csize, usize) });
  }
  return out;
}

async function openEntry(file, off, method, csize, usize) {
  const h = await bytes(file, off, off + LOCAL_LEN);
  if (h.byteLength < LOCAL_LEN || h.getUint32(0, true) !== SIG.local) throw zipError('bad_entry');
  // the local header's name and extra field need not match the central directory's
  const from = off + LOCAL_LEN + h.getUint16(26, true) + h.getUint16(28, true);
  const data = file.slice(from, from + csize);
  if (method === 0 && data.size === usize) return data;
  if (method === 8)
    try {
      const out = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      if (out.size === usize) return out;
    } catch {
      // damaged data: told the same way as a short entry
    }
  throw zipError('bad_entry');
}
