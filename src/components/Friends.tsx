import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CATEGORIES } from '../data/catalog'
import { useAuth } from '../lib/auth'
import { inviteFriendUrl, nickOf, useFriends, type FriendOverview, type FriendRequest, type TodayEntry } from '../lib/friends'
import { PushSettings } from './PushSettings'
import { ShareButton } from './ShareButton'

type Board = 'single' | 'cover' | 'set' | 'marathon' | 'blitz'

const BOARDS: { id: Board; label: string }[] = [
  { id: 'single', label: '🎧 Música' },
  { id: 'cover', label: '🖼️ Capa' },
  { id: 'set', label: '🔥 Músicas' },
  { id: 'marathon', label: '🏃 Maratona' },
  { id: 'blitz', label: '⚡ Relâmpago' },
]

export function Friends() {
  const auth = useAuth()
  const fr = useFriends()

  if (!auth.online) {
    return (
      <div className="game">
        <div className="account-card">
          <h2>Modo online não configurado 🔌</h2>
          <p className="account-card__hint">
            Amigos e placares precisam de um projeto Supabase. Siga a seção <strong>"Ativando o modo online"</strong> do README e rode
            também a migração <code>0006_friends.sql</code>.
          </p>
        </div>
      </div>
    )
  }

  if (auth.loading) {
    return (
      <div className="game">
        <p className="game__error">Carregando…</p>
      </div>
    )
  }

  if (!auth.user) return <SignInCard inviteCode={fr.inviteCode} />

  return (
    <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <MyCode code={auth.profile?.friend_code ?? null} />
      <AddFriend />
      {fr.requests.length > 0 && <Requests requests={fr.requests} />}
      <PushSettings />
      <FriendList />
    </motion.div>
  )
}

// ─── Login rápido (amigos exigem uma conta, nem que seja só um apelido) ───

function SignInCard({ inviteCode }: { inviteCode: string | null }) {
  const auth = useAuth()
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const err = await auth.signInAnonymous(nickname)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="account-card">
        <span className="account-card__avatar">👥</span>
        <h2>{inviteCode ? `Convite de amigo ${inviteCode}` : 'Amigos'}</h2>
        <p className="account-card__hint">
          {inviteCode
            ? 'Escolha um apelido para aceitar o convite e comparar pontos.'
            : 'Entre com um apelido para adicionar amigos e comparar pontos por modo de jogo.'}
        </p>
        <label className="account-field">
          Apelido
          <input
            type="text"
            value={nickname}
            maxLength={20}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Como seus amigos vão te ver"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nickname.trim().length >= 2) void submit()
            }}
          />
        </label>
        <button type="button" className="btn btn--play" disabled={busy || nickname.trim().length < 2} onClick={() => void submit()}>
          Continuar
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void auth.signInGoogle()}>
          Entrar com Google
        </button>
        {error && <p className="account-error">{error}</p>}
      </div>
    </motion.div>
  )
}

// ─── Meu código ───

function MyCode({ code }: { code: string | null }) {
  const url = code ? inviteFriendUrl(code) : ''
  return (
    <div className="battle-lobby">
      <p className="battle-lobby__hint">Seu código de amigo</p>
      {code ? (
        <>
          <div className="battle-code" aria-label={`Código ${code}`}>
            {code}
          </div>
          <p className="battle-lobby__settings">Quem abrir o link já envia o pedido para você.</p>
          <div className="battle-lobby__actions">
            <ShareButton text={`Me adiciona no Songsfy! 🎧 Meu código de amigo é ${code}\n${url}`} />
          </div>
        </>
      ) : (
        <p className="battle-lobby__settings">Seu código ainda não foi gerado — recarregue o app (é preciso ter aplicado a migração 0006).</p>
      )}
    </div>
  )
}

// ─── Adicionar ───

function AddFriend() {
  const fr = useFriends()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async () => {
    if (query.trim().length < 2) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const err = await fr.sendRequest(query)
    setBusy(false)
    if (err) setError(err)
    else {
      setNotice('Pedido enviado! ✓')
      setQuery('')
    }
  }

  return (
    <div className="account-card friends-add">
      <h2>Adicionar amigo</h2>
      <label className="account-field">
        Apelido ou código
        <input
          type="text"
          value={query}
          maxLength={20}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ex.: mariazinha ou ABC123"
          autoCapitalize="none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </label>
      <button type="button" className="btn btn--play" disabled={busy || query.trim().length < 2} onClick={() => void submit()}>
        Enviar pedido
      </button>
      {error && <p className="account-error">{error}</p>}
      {notice && <p className="account-notice">{notice}</p>}
      {fr.inviteNotice && <p className="account-notice">{fr.inviteNotice}</p>}
    </div>
  )
}

// ─── Pedidos pendentes ───

function Requests({ requests }: { requests: FriendRequest[] }) {
  const fr = useFriends()
  const [busyId, setBusyId] = useState<number | null>(null)
  const incoming = requests.filter((r) => r.direction === 'incoming')
  const outgoing = requests.filter((r) => r.direction === 'outgoing')

  const act = async (id: number, fn: (id: number) => Promise<string | null>) => {
    setBusyId(id)
    await fn(id)
    setBusyId(null)
  }

  return (
    <div className="friends-section">
      {incoming.length > 0 && (
        <>
          <h3 className="friends-section__title">Pedidos recebidos</h3>
          <ul className="lb">
            {incoming.map((r) => (
              <li key={r.id} className="lb__row">
                <span className="lb__avatar">{r.avatar_emoji}</span>
                <span className="lb__nick">{nickOf(r)}</span>
                <button type="button" className="btn btn--mini btn--mini-ok" disabled={busyId === r.id} onClick={() => void act(r.id, fr.accept)}>
                  Aceitar
                </button>
                <button type="button" className="btn btn--mini" disabled={busyId === r.id} onClick={() => void act(r.id, fr.remove)}>
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <h3 className="friends-section__title">Pedidos enviados</h3>
          <ul className="lb">
            {outgoing.map((r) => (
              <li key={r.id} className="lb__row">
                <span className="lb__avatar">{r.avatar_emoji}</span>
                <span className="lb__nick">{nickOf(r)}</span>
                <span className="friends-wait">aguardando…</span>
                <button type="button" className="btn btn--mini" disabled={busyId === r.id} onClick={() => void act(r.id, fr.remove)}>
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// ─── Lista de amigos + comparativo ───

function FriendList() {
  const fr = useFriends()
  const [open, setOpen] = useState<string | null>(null)
  const friends = useMemo(() => [...fr.friends].sort((a, b) => nickOf(a).localeCompare(nickOf(b), 'pt-BR')), [fr.friends])

  return (
    <div className="friends-section">
      <h3 className="friends-section__title">Seus amigos {friends.length > 0 && <span className="friends-count">{friends.length}</span>}</h3>
      {fr.loading && friends.length === 0 && <p className="game__error">Carregando…</p>}
      {fr.error && <p className="game__error">{fr.error}</p>}
      {!fr.loading && !fr.error && friends.length === 0 && (
        <p className="game__help">Ninguém por aqui ainda — compartilhe seu código ou adicione alguém pelo apelido. 🎸</p>
      )}
      <ul className="friends-list">
        {friends.map((f) => (
          <li key={f.user_id} className={`friend-card ${open === f.user_id ? 'friend-card--open' : ''}`}>
            <button type="button" className="friend-card__head" onClick={() => setOpen(open === f.user_id ? null : f.user_id)}>
              <span className="lb__avatar">{f.avatar_emoji}</span>
              <span className="friend-card__nick">{nickOf(f)}</span>
              <span className="friend-card__today">{todaySummary(f)}</span>
              <span className="friend-card__chev">{open === f.user_id ? '▴' : '▾'}</span>
            </button>
            <AnimatePresence initial={false}>
              {open === f.user_id && fr.me && (
                <motion.div
                  className="friend-card__body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  <Compare me={fr.me} other={f} />
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    </div>
  )
}

function todaySummary(f: FriendOverview): string {
  const parts: string[] = []
  const s = f.today.single
  const c = f.today.cover
  parts.push(`🎧 ${fmtToday('single', s)}`)
  parts.push(`🖼️ ${fmtToday('cover', c)}`)
  const sets = Object.entries(f.today).filter(([m]) => m.startsWith('set:'))
  if (sets.length > 0) parts.push(`🔥 ${sets.reduce((acc, [, t]) => acc + (t.score ?? 0), 0)}/${sets.length * 6}`)
  return parts.join(' · ')
}

function fmtToday(mode: string, t: TodayEntry | undefined): string {
  if (!t) return '—'
  if (mode.startsWith('set:')) return `${t.score ?? 0}/6`
  return t.won ? `${t.attempts}/6` : '❌'
}

// valor numérico para decidir quem lidera hoje: mais alto = melhor
function todayRank(mode: string, t: TodayEntry | undefined): number | null {
  if (!t) return null
  if (mode.startsWith('set:')) return t.score ?? 0
  return t.won ? 100 - (t.attempts ?? 6) : 0
}

interface Row {
  label: string
  a: string
  b: string
  aVal: number | null
  bVal: number | null
}

function Compare({ me, other }: { me: FriendOverview; other: FriendOverview }) {
  const fr = useFriends()
  const [board, setBoard] = useState<Board>('single')
  const [category, setCategory] = useState(CATEGORIES[0].id)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const isArcade = board === 'marathon' || board === 'blitz'
  const mode = board === 'set' ? `set:${category}` : board

  const rows: Row[] = useMemo(() => {
    const num = (n: number | null | undefined) => (n == null ? '—' : String(n))
    if (isArcade) {
      const a = me.arcade[board as 'marathon' | 'blitz']
      const b = other.arcade[board as 'marathon' | 'blitz']
      const unit = board === 'marathon' ? 'pts' : 'acertos'
      return [{ label: 'Recorde', a: a != null ? `${a} ${unit}` : '—', b: b != null ? `${b} ${unit}` : '—', aVal: a ?? null, bVal: b ?? null }]
    }
    const ta = me.today[mode]
    const tb = other.today[mode]
    const wa = me.week[mode]
    const wb = other.week[mode]
    const sa = me.stats[mode]
    const sb = other.stats[mode]
    return [
      { label: 'Hoje', a: fmtToday(mode, ta), b: fmtToday(mode, tb), aVal: todayRank(mode, ta), bVal: todayRank(mode, tb) },
      { label: 'Pontos na semana', a: num(wa?.points), b: num(wb?.points), aVal: wa?.points ?? null, bVal: wb?.points ?? null },
      { label: 'Dias jogados na semana', a: num(wa?.days), b: num(wb?.days), aVal: wa?.days ?? null, bVal: wb?.days ?? null },
      { label: 'Sequência atual', a: num(sa?.streak), b: num(sb?.streak), aVal: sa?.streak ?? null, bVal: sb?.streak ?? null },
      { label: 'Melhor sequência', a: num(sa?.max_streak), b: num(sb?.max_streak), aVal: sa?.max_streak ?? null, bVal: sb?.max_streak ?? null },
      {
        label: 'Vitórias / jogos',
        a: sa ? `${sa.wins}/${sa.played}` : '—',
        b: sb ? `${sb.wins}/${sb.played}` : '—',
        aVal: sa && sa.played > 0 ? sa.wins / sa.played : null,
        bVal: sb && sb.played > 0 ? sb.wins / sb.played : null,
      },
    ]
  }, [me, other, mode, board, isArcade])

  const winner = (r: Row): 'a' | 'b' | null => {
    if (r.aVal == null && r.bVal == null) return null
    if (r.aVal == null) return 'b'
    if (r.bVal == null) return 'a'
    if (r.aVal === r.bVal) return null
    return r.aVal > r.bVal ? 'a' : 'b'
  }
  const wins = rows.reduce((acc, r) => acc + (winner(r) === 'a' ? 1 : 0), 0)
  const losses = rows.reduce((acc, r) => acc + (winner(r) === 'b' ? 1 : 0), 0)

  const removeFriend = async () => {
    if (other.friendship_id == null) return
    setBusy(true)
    await fr.remove(other.friendship_id)
    setBusy(false)
  }

  return (
    <div className="compare">
      <div className="cats">
        {BOARDS.map((b) => (
          <button key={b.id} type="button" className={`cats__tab ${board === b.id ? 'cats__tab--on' : ''}`} onClick={() => setBoard(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      {board === 'set' && (
        <div className="cats">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className={`cats__tab ${category === c.id ? 'cats__tab--on' : ''}`} onClick={() => setCategory(c.id)}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="compare__grid">
        <span className="compare__head" />
        <span className="compare__head compare__head--me">
          {me.avatar_emoji} Você
        </span>
        <span className="compare__head">
          {other.avatar_emoji} {nickOf(other)}
        </span>
        {rows.map((r) => {
          const w = winner(r)
          return (
            <div key={r.label} className="compare__row">
              <span className="compare__label">{r.label}</span>
              <span className={`compare__val ${w === 'a' ? 'compare__val--win' : ''}`}>{r.a}</span>
              <span className={`compare__val ${w === 'b' ? 'compare__val--win' : ''}`}>{r.b}</span>
            </div>
          )
        })}
      </div>

      <p className="game__help">
        {wins > losses ? `Você lidera em ${wins} de ${rows.length} 🏆` : losses > wins ? `${nickOf(other)} lidera em ${losses} de ${rows.length} 😤` : 'Empate técnico 🤝'}
      </p>

      {confirm ? (
        <div className="battle-lobby__actions">
          <button type="button" className="btn btn--mini" disabled={busy} onClick={() => void removeFriend()}>
            Confirmar remoção
          </button>
          <button type="button" className="btn btn--mini" disabled={busy} onClick={() => setConfirm(false)}>
            Voltar
          </button>
        </div>
      ) : (
        <button type="button" className="account-switch" onClick={() => setConfirm(true)}>
          Remover amigo
        </button>
      )}
    </div>
  )
}
