// Liga/desliga os avisos do sistema neste dispositivo. Aparece na tela Amigos e na
// tela Conta — o status é compartilhado (usePushStatus), então os dois cartões e o
// toast do App ficam sempre falando a mesma coisa.

import { useState } from 'react'
import { disablePush, enablePush, refreshPushStatus, usePushStatus } from '../lib/push'

export function PushSettings() {
  const status = usePushStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sem chave VAPID no build ou navegador sem Push API: nada a oferecer.
  if (!status || status === 'unconfigured' || status === 'unsupported') return null

  const toggle = async () => {
    setBusy(true)
    setError(null)
    if (status === 'on') await disablePush()
    else {
      const err = await enablePush()
      if (err) setError(err)
    }
    await refreshPushStatus()
    setBusy(false)
  }

  const text =
    status === 'on' ? 'Você recebe um aviso neste dispositivo quando alguém te adiciona ou aceita seu pedido.'
    : status === 'denied' ? 'Notificações bloqueadas. Reative nas permissões do site no navegador.'
    : status === 'ios-not-installed' ? 'No iPhone, instale o Songsfy na tela inicial (Compartilhar → Adicionar à Tela de Início) para receber avisos.'
    : 'Receba um aviso quando alguém te adicionar ou aceitar seu pedido.'

  return (
    <div className="friends-push">
      <div className="friends-push__text">
        <strong>{status === 'on' ? '🔔 Avisos ativados' : '🔕 Avisos desativados'}</strong>
        <span>{text}</span>
        {error && <span className="account-error">{error}</span>}
      </div>
      {(status === 'on' || status === 'off') && (
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void toggle()}>
          {status === 'on' ? 'Desativar' : 'Ativar'}
        </button>
      )}
    </div>
  )
}
