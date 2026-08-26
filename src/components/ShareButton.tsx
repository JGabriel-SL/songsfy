import { useState } from 'react'

export function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch {
      // usuário cancelou o share nativo — cai para a área de transferência
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard indisponível
    }
  }

  return (
    <button type="button" className="btn btn--share" onClick={() => void share()}>
      {copied ? 'Copiado! ✓' : 'Compartilhar 🔗'}
    </button>
  )
}
