// Generates a minimalist Orbit app icon with no image libraries:
// renders an RGBA bitmap in pure JS, encodes PNG via zlib, packs a multi-size
// ICO (PNG-in-ICO, supported by Windows Vista+ and electron-builder).
//
//   node scripts/make-icon.mjs
//
// Design: a neutral charcoal rounded tile with a light-gray orbit ring,
// a nucleus, and a small satellite dot. No vibrant colours — deliberately
// minimalist per the app's theme.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- colours (RGB) ----
const BG = [27, 27, 29] // charcoal tile
const MARK = [212, 214, 220] // light neutral gray

// ---- geometry, in a 256 reference space (scaled per size) ----
// New mark: two overlapping squares (one axis-aligned, one rotated 45° into a
// diamond) forming an 8-point geometric star, with a nucleus + a satellite dot.
// Straight edges only — no ovals.
const REF = 256
const cx = 128
const cy = 128
const squareHalf = 62 // half side-length of the squares at 256
const squareRadius = 12 // corner rounding of the squares
const squareStroke = 9 // stroke thickness at 256
const nucleusR = 20
const satR = 13
const sat = [178, 78] // satellite dot, upper-right (matches the SVG mark)

const tileInset = 10
const tileRadius = 50

function roundedRectCoverage(x, y) {
  // signed-distance to a rounded rect centred on the canvas
  const half = REF / 2 - tileInset
  const dx = Math.abs(x - cx) - (half - tileRadius)
  const dy = Math.abs(y - cy) - (half - tileRadius)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  const outside = Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - tileRadius
  return -outside // >0 inside
}

/** Signed distance to a rounded square centred on the tile, optionally rotated
    by `ang` radians. Negative inside, positive outside. */
function squareDistance(x, y, ang) {
  let px = x - cx
  let py = y - cy
  if (ang) {
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    ;[px, py] = [px * c + py * s, -px * s + py * c]
  }
  const h = squareHalf - squareRadius
  const qx = Math.abs(px) - h
  const qy = Math.abs(py) - h
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - squareRadius
}

/** Return [r,g,b,a] for a point in 256-space, supersampled by the caller. */
function sample(x, y) {
  // satellite dot (drawn on top)
  if (Math.hypot(x - sat[0], y - sat[1]) <= satR) return [...MARK, 255]
  // nucleus
  if (Math.hypot(x - cx, y - cy) <= nucleusR) return [...MARK, 255]
  // the two square outlines (axis-aligned + rotated 45°)
  if (Math.abs(squareDistance(x, y, 0)) <= squareStroke / 2) return [...MARK, 255]
  if (Math.abs(squareDistance(x, y, Math.PI / 4)) <= squareStroke / 2) return [...MARK, 255]
  // tile background
  if (roundedRectCoverage(x, y) >= 0) return [...BG, 255]
  return [0, 0, 0, 0]
}

function renderRGBA(size) {
  const scale = REF / size
  const ss = 4 // supersample factor
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let bl = 0
      let al = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale
          const y = (py + (sy + 0.5) / ss) * scale
          const [cr, cg, cb, ca] = sample(x, y)
          const w = ca / 255
          r += cr * w
          g += cg * w
          bl += cb * w
          al += ca
        }
      }
      const n = ss * ss
      const i = (py * size + px) * 4
      const cov = al / (n * 255)
      buf[i] = cov > 0 ? Math.round(r / (cov * n)) : 0
      buf[i + 1] = cov > 0 ? Math.round(g / (cov * n)) : 0
      buf[i + 2] = cov > 0 ? Math.round(bl / (cov * n)) : 0
      buf[i + 3] = Math.round(al / n)
    }
  }
  return buf
}

// ---- PNG encoding ----
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---- ICO packing (PNG-in-ICO) ----
function packICO(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + count * 16
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

// ---- build ----
mkdirSync(join(root, 'build'), { recursive: true })
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, data: encodePNG(size, renderRGBA(size)) }))

writeFileSync(join(root, 'build', 'icon.png'), pngs.find((p) => p.size === 256).data)
writeFileSync(join(root, 'build', 'icon.ico'), packICO(pngs))
console.log('Wrote build/icon.png (256) and build/icon.ico (' + sizes.join(',') + ')')
