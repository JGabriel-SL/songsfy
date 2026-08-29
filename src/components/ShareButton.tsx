import { useState } from 'react'
import { renderStoryImage, type StoryData } from '../lib/storyImage'

interface Props {
  text: string
  /** Quando informado, compartilha uma imagem no formato Stories (1080×1920) junto do texto */
  story?: StoryData
}

type Status = 'idle' | 'busy' | 'copied' | 'saved'

export function ShareButton({ text, story }: Props) {
  const [status, setStatus] = useState<Status>('idle')

  const flash = (s: 'copied' | 'saved') => {
    setStatus(s)
    setTimeout(() => setStatus('idle'), 2200)
  }

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard indisponível
    }
  }

  const share = async () => {
    if (status === 'busy') return
    setStatus('busy')

    let file: File | null = null
    if (story) {
      try {
        const blob = await renderStoryImage(story)
        file = new File([blob], `songsfy-${story.day}.png`, { type: 'image/png' })
      } catch {
        file = null
      }
    }

    // 1) Share nativo com imagem (Android/iOS abrem Instagram, WhatsApp etc.)
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text })
        setStatus('idle')
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          setStatus('idle')
          return
        }
        // não suportado de fato — cai para o download
      }
    }

    // 2) Share nativo só com texto (sem imagem gerada)
    if (!file && navigator.share) {
      try {
        await navigator.share({ text })
        setStatus('idle')
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          setStatus('idle')
          return
        }
      }
    }

    // 3) Desktop / sem share de arquivos: baixa o PNG e copia o texto
    if (file) {
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      await copyText()
      flash('saved')
      return
    }

    await copyText()
    flash('copied')
  }

  const label =
    status === 'busy' ? 'Gerando… ⏳'
    : status === 'copied' ? 'Copiado! ✓'
    : status === 'saved' ? 'Imagem salva! ✓'
    : story ? 'Compartilhar 📸'
    : 'Compartilhar 🔗'

  return (
    <button type="button" className="btn btn--share" onClick={() => void share()} disabled={status === 'busy'}>
      {label}
    </button>
  )
}
