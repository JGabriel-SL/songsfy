// Gera os ícones PNG do PWA (vinil sobre gradiente quente) sem dependências externas.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─── Encoder PNG mínimo ───
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro: nenhum
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Desenho do ícone ───
const lerp = (a, b, t) => a + (b - a) * t

function drawIcon(size) {
  const img = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const discR = size * 0.4
  const labelR = size * 0.155
  const holeR = size * 0.028

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size)
      // fundo: gradiente âmbar → rosa
      let r = lerp(255, 255, t)
      let g = lerp(176, 46, t)
      let b = lerp(32, 136, t)

      const d = Math.hypot(x - cx, y - cy)
      if (d < discR) {
        // disco escuro com sulcos sutis
        const groove = Math.sin(d * 0.55) * 6
        r = 26 + groove
        g = 12 + groove * 0.6
        b = 20 + groove
        if (d < labelR) {
          const lt = d / labelR
          r = lerp(255, 255, lt)
          g = lerp(192, 77, lt)
          b = lerp(46, 90, lt)
        }
        if (d < holeR) {
          r = 28
          g = 12
          b = 20
        }
        // borda suave do disco
        if (d > discR - size * 0.01) {
          const edge = (discR - d) / (size * 0.01)
          const bgT = (x + y) / (2 * size)
          r = lerp(255, r, edge)
          g = lerp(lerp(176, 46, bgT), g, edge)
          b = lerp(lerp(32, 136, bgT), b, edge)
        }
      }

      const i = (y * size + x) * 4
      img[i] = Math.max(0, Math.min(255, Math.round(r)))
      img[i + 1] = Math.max(0, Math.min(255, Math.round(g)))
      img[i + 2] = Math.max(0, Math.min(255, Math.round(b)))
      img[i + 3] = 255
    }
  }
  return encodePng(size, img)
}

mkdirSync(join(root, 'public'), { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(join(root, 'public', `pwa-${size}.png`), drawIcon(size))
  console.log(`✔ public/pwa-${size}.png`)
}
