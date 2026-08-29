// Gera a imagem de resultado no formato Stories (1080×1920) com Canvas 2D.
// Usada pelo ShareButton para compartilhar via navigator.share({ files }) ou download.

export type StoryCell = 'ok' | 'bad' | 'skip'

export interface StoryData {
  /** Ex.: "Música do Dia" */
  mode: string
  emoji: string
  /** Número do desafio diário; ausente nos modos arcade */
  day?: number
  /** Grade de tentativas; ausente nos modos arcade */
  cells?: StoryCell[]
  /** Ex.: "Acertei em 3/6!" */
  headline: string
  /** Ex.: "Pop" */
  subline?: string
  /** Linhas extras abaixo da headline (ex.: pódio da Batalha) */
  lines?: string[]
  stats?: { label: string; value: string | number }[]
}

const W = 1080
const H = 1920
const FONT = "'Outfit', system-ui, 'Segoe UI', sans-serif"

const COLORS = {
  bg: '#1c0c14',
  bg2: '#2a1220',
  text: '#fff3e9',
  dim: '#d9a88f',
  amber: '#ffc02e',
  orange: '#ff8c1a',
  coral: '#ff4d5a',
  pink: '#ff2e88',
  ok: '#3ddc84',
  bad: '#ff4d5a',
  skip: '#8a7a80',
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function gradientText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number) {
  const g = ctx.createLinearGradient(x - width / 2, y, x + width / 2, y)
  g.addColorStop(0, COLORS.amber)
  g.addColorStop(0.4, COLORS.orange)
  g.addColorStop(0.7, COLORS.coral)
  g.addColorStop(1, COLORS.pink)
  ctx.fillStyle = g
  ctx.fillText(text, x, y)
}

async function ensureFont() {
  try {
    await Promise.all([
      document.fonts.load(`900 100px ${FONT}`),
      document.fonts.load(`700 48px ${FONT}`),
      document.fonts.load(`600 40px ${FONT}`),
    ])
  } catch {
    // sem Font Loading API — usa fallback do sistema
  }
}

export async function renderStoryImage(data: StoryData): Promise<Blob> {
  await ensureFont()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas indisponível')

  // ── Fundo: mesmo radial do app ──
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, W, H)
  let rg = ctx.createRadialGradient(W * 0.2, -H * 0.05, 0, W * 0.2, -H * 0.05, 1100)
  rg.addColorStop(0, '#3a1425')
  rg.addColorStop(1, 'rgba(28,12,20,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, W, H)
  rg = ctx.createRadialGradient(W * 1.1, H * 1.05, 0, W * 1.1, H * 1.05, 900)
  rg.addColorStop(0, '#38160e')
  rg.addColorStop(1, 'rgba(28,12,20,0)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, W, H)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ── Logo ──
  ctx.font = `900 112px ${FONT}`
  gradientText(ctx, 'Songsfy', W / 2, 400, 460)

  ctx.font = `600 40px ${FONT}`
  ctx.fillStyle = COLORS.dim
  ctx.fillText('jogos de música · um por dia', W / 2, 480)

  // ── Cartão central (altura depende do que há para mostrar) ──
  const cells = data.cells ?? []
  const lines = data.lines ?? []
  const hasStats = !!data.stats?.length
  const cardX = 90
  const cardW = W - 180
  const cellsH = cells.length ? 150 : 0
  const linesH = lines.length * 80
  const statsH = hasStats ? 200 : 0
  const cardH = 300 + cellsH + 120 + linesH + statsH + 60
  const cardY = Math.max(560, Math.round((H - cardH) / 2) - 60)
  ctx.save()
  ctx.shadowColor = 'rgba(255,77,90,0.25)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 16
  roundRect(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.fillStyle = COLORS.bg2
  ctx.fill()
  ctx.restore()
  roundRect(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.strokeStyle = 'rgba(255,160,90,0.22)'
  ctx.lineWidth = 3
  ctx.stroke()

  // Modo + dia
  ctx.font = `700 54px ${FONT}`
  ctx.fillStyle = COLORS.text
  ctx.fillText(`${data.emoji} ${data.mode}`, W / 2, cardY + 110)
  const meta = [data.day != null ? `#${data.day}` : null, data.subline ?? null].filter(Boolean).join(' · ')
  ctx.font = `600 38px ${FONT}`
  ctx.fillStyle = COLORS.dim
  if (meta) ctx.fillText(meta, W / 2, cardY + 175)

  let y = cardY + (meta ? 240 : 200)

  // Quadradinhos
  if (cells.length) {
    const cellSize = 96
    const gap = 20
    const totalW = cells.length * cellSize + (cells.length - 1) * gap
    let cx = W / 2 - totalW / 2
    const cy = y + cellSize / 2
    for (const cell of cells) {
      roundRect(ctx, cx, cy - cellSize / 2, cellSize, cellSize, 22)
      ctx.fillStyle = COLORS[cell]
      ctx.fill()
      if (cell === 'skip') {
        ctx.fillStyle = COLORS.text
        ctx.font = `700 52px ${FONT}`
        ctx.fillText('›', cx + cellSize / 2, cy + 2)
      }
      cx += cellSize + gap
    }
    y += cellsH
  }

  // Headline
  ctx.font = `800 64px ${FONT}`
  ctx.fillStyle = COLORS.text
  ctx.fillText(data.headline, W / 2, y + 50)
  y += 120

  // Linhas extras (pódio etc.)
  if (lines.length) {
    ctx.font = `600 44px ${FONT}`
    ctx.fillStyle = COLORS.text
    for (const line of lines) {
      ctx.fillText(line, W / 2, y + 30)
      y += 80
    }
  }

  // Stats
  if (data.stats?.length) {
    const cols = data.stats.length
    const colW = (cardW - 80) / cols
    const sy = y + 90
    data.stats.forEach((s, i) => {
      const sx = cardX + 40 + colW * i + colW / 2
      ctx.font = `900 72px ${FONT}`
      gradientText(ctx, String(s.value), sx, sy, colW)
      ctx.font = `600 30px ${FONT}`
      ctx.fillStyle = COLORS.dim
      ctx.fillText(s.label.toUpperCase(), sx, sy + 66)
    })
  }

  // ── Rodapé / CTA ──
  ctx.font = `700 44px ${FONT}`
  ctx.fillStyle = COLORS.text
  ctx.fillText('Consegue fazer melhor? 🎧', W / 2, 1560)
  ctx.font = `600 36px ${FONT}`
  ctx.fillStyle = COLORS.dim
  ctx.fillText(window.location.host, W / 2, 1625)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falhou'))), 'image/png')
  })
}
