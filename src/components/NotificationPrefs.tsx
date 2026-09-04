// Quais avisos você quer receber. Vale para o push e para o sino — o filtro é
// aplicado no banco, dentro de push_notify, então um tipo desligado nem chega a
// virar linha em `notifications`.

import { useState } from 'react'
import { useNotifications, type NotificationPrefs as Prefs } from '../lib/notifications'

const ROWS: { key: keyof Prefs; emoji: string; label: string; hint: string }[] = [
  { key: 'friends', emoji: '👋', label: 'Amizades', hint: 'Pedido recebido e pedido aceito' },
  { key: 'battle', emoji: '⚔️', label: 'Batalha', hint: 'Convite para uma sala e fim da partida' },
  { key: 'beaten', emoji: '😬', label: 'Te ultrapassaram', hint: 'Um amigo passou sua pontuação do dia' },
  { key: 'daily', emoji: '🎵', label: 'Lembrete diário', hint: 'Ao meio-dia, se você ainda não jogou' },
]

export function NotificationPrefsCard() {
  const { prefs, savePrefs } = useNotifications()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = async (key: keyof Prefs) => {
    setBusy(true)
    setError(null)
    const err = await savePrefs({ ...prefs, [key]: !prefs[key] })
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="prefs">
      <h3 className="prefs__title">O que avisar</h3>
      <ul className="prefs__list">
        {ROWS.map((row) => {
          const on = prefs[row.key]
          return (
            <li key={row.key} className="prefs__row">
              <span className="prefs__emoji" aria-hidden="true">
                {row.emoji}
              </span>
              <span className="prefs__text">
                <strong>{row.label}</strong>
                <span>{row.hint}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={row.label}
                className={`prefs__switch ${on ? 'prefs__switch--on' : ''}`}
                disabled={busy}
                onClick={() => void toggle(row.key)}
              >
                <span className="prefs__knob" />
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p className="account-error">{error}</p>}
    </div>
  )
}
