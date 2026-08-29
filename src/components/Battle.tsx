import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { CATEGORIES } from '../data/catalog'
import { useAuth } from '../lib/auth'
import { gameSongById, getTrack } from '../lib/catalog-remote'
import { battleApi, consumeInviteCode, fetchClockOffset, inviteUrl, useBattleRoom, type RoomSettings, type RoomState } from '../lib/battle'
import { usePreviewPlayer } from '../hooks/usePreviewPlayer'
import { Equalizer } from './Equalizer'
import { ShareButton } from './ShareButton'
import type { CategoryId, TrackInfo } from '../types'

const ROOM_KEY = 'songsfy:battle:room:v1'
const ROUND_OPTIONS = [5, 10, 15]
const SECONDS_OPTIONS = [10, 15, 20]
const MEDALS = ['🥇', '🥈', '🥉']

function readRoomId(): string | null {
  try {
    return sessionStorage.getItem(ROOM_KEY)
  } catch {
    return null
  }
}
function writeRoomId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(ROOM_KEY, id)
    else sessionStorage.removeItem(ROOM_KEY)
  } catch {
    // sem espaço
  }
}

function nick(p: { nickname: string | null }): string {
  return p.nickname ?? 'Jogador'
}

export function Battle() {
  const auth = useAuth()
  const [roomId, setRoomId] = useState<string | null>(() => readRoomId())
  const [inviteCode] = useState<string | null>(() => consumeInviteCode())
  const { state, lost } = useBattleRoom(roomId)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!auth.online || !auth.user) return
    void fetchClockOffset().then(setOffset)
  }, [auth.online, auth.user])

  const enterRoom = (id: string | null) => {
    writeRoomId(id)
    setRoomId(id)
  }

  if (!auth.online) {
    return (
      <div className="game">
        <div className="account-card">
          <h2>Modo online não configurado 🔌</h2>
          <p className="account-card__hint">
            A Batalha usa salas em tempo real no Supabase. Siga a seção <strong>"Ativando o modo online"</strong> do README e rode
            também a migração <code>0002_battle.sql</code>.
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

  if (!auth.user) return <QuickSignIn inviteCode={inviteCode} />

  if (!roomId || lost || (state && state.room.status === 'finished' && !state.players.some((p) => p.user_id === auth.user!.id))) {
    return <Entry inviteCode={inviteCode} onEnter={enterRoom} />
  }

  if (!state) {
    return (
      <div className="game">
        <div className="splash" style={{ minHeight: 200 }}>
          <Equalizer active bars={5} />
          <p>Entrando na sala…</p>
        </div>
      </div>
    )
  }

  return <RoomView state={state} offset={offset} onLeave={() => enterRoom(null)} />
}

// ─── Login rápido (a Batalha exige uma conta, nem que seja só um apelido) ───

function QuickSignIn({ inviteCode }: { inviteCode: string | null }) {
  const auth = useAuth()
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="account-card">
        <span className="account-card__avatar">⚔️</span>
        <h2>{inviteCode ? `Convite para a sala ${inviteCode}` : 'Batalha'}</h2>
        <p className="account-card__hint">Escolha um apelido para aparecer no placar da sala. Você pode vincular um e-mail depois, na Conta.</p>
        <label className="account-field">
          Apelido
          <input
            type="text"
            value={nickname}
            maxLength={20}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Como os outros vão te ver"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nickname.trim().length >= 2) void submit()
            }}
          />
        </label>
        <button type="button" className="btn btn--play" disabled={busy || nickname.trim().length < 2} onClick={() => void submit()}>
          Entrar na batalha
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void auth.signInGoogle()}>
          Entrar com Google
        </button>
        {error && <p className="account-error">{error}</p>}
      </div>
    </motion.div>
  )

  async function submit() {
    setBusy(true)
    setError(null)
    const err = await auth.signInAnonymous(nickname)
    setBusy(false)
    if (err) setError(err)
  }
}

// ─── Entrada: criar sala ou entrar com código ───

function Entry({ inviteCode, onEnter }: { inviteCode: string | null; onEnter: (id: string) => void }) {
  const [tab, setTab] = useState<'join' | 'create'>(inviteCode ? 'join' : 'create')
  const [code, setCode] = useState(inviteCode ?? '')
  const [settings, setSettings] = useState<RoomSettings>({ rounds: 10, roundSeconds: 15, category: null })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const autoJoined = useRef(false)

  const run = async (fn: () => Promise<{ data: string | null; error: string | null }>) => {
    setBusy(true)
    setError(null)
    const { data, error: err } = await fn()
    setBusy(false)
    if (err) setError(err)
    else if (data) onEnter(data)
  }

  // Veio por link de convite: entra direto
  useEffect(() => {
    if (inviteCode && !autoJoined.current) {
      autoJoined.current = true
      void run(() => battleApi.joinRoom(inviteCode))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode])

  return (
    <motion.div className="game" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
      <div className="arcade-intro">
        <span className="arcade-intro__emoji">⚔️</span>
        <h2>Batalha</h2>
        <p>
          Crie uma sala, chame os amigos e a cada rodada toca uma música: <strong>quem acerta mais rápido</strong> leva mais pontos.
        </p>

        <div className="cats" role="tablist">
          <button type="button" className={`cats__tab ${tab === 'create' ? 'cats__tab--on' : ''}`} onClick={() => setTab('create')}>
            ➕ Criar sala
          </button>
          <button type="button" className={`cats__tab ${tab === 'join' ? 'cats__tab--on' : ''}`} onClick={() => setTab('join')}>
            🔑 Entrar com código
          </button>
        </div>

        {tab === 'join' ? (
          <>
            <label className="account-field">
              Código da sala
              <input
                className="battle-codeinput"
                type="text"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="ABC123"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === 6) void run(() => battleApi.joinRoom(code))
                }}
              />
            </label>
            <button type="button" className="btn btn--play" disabled={busy || code.length !== 6} onClick={() => void run(() => battleApi.joinRoom(code))}>
              {busy ? 'Entrando…' : 'Entrar na sala'}
            </button>
          </>
        ) : (
          <>
            <div className="battle-setting">
              <span className="battle-setting__label">Rodadas</span>
              <div className="battle-setting__opts">
                {ROUND_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${settings.rounds === n ? 'chip--on' : ''}`}
                    onClick={() => setSettings({ ...settings, rounds: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="battle-setting">
              <span className="battle-setting__label">Tempo por música</span>
              <div className="battle-setting__opts">
                {SECONDS_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${settings.roundSeconds === n ? 'chip--on' : ''}`}
                    onClick={() => setSettings({ ...settings, roundSeconds: n })}
                  >
                    {n}s
                  </button>
                ))}
              </div>
            </div>
            <div className="battle-setting">
              <span className="battle-setting__label">Estilo</span>
              <div className="battle-setting__opts">
                <button
                  type="button"
                  className={`chip ${settings.category === null ? 'chip--on' : ''}`}
                  onClick={() => setSettings({ ...settings, category: null })}
                >
                  🎲 Todos
                </button>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${settings.category === c.id ? 'chip--on' : ''}`}
                    onClick={() => setSettings({ ...settings, category: c.id as CategoryId })}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn--play" disabled={busy} onClick={() => void run(() => battleApi.createRoom(settings))}>
              {busy ? 'Criando…' : 'Criar sala'}
            </button>
          </>
        )}

        {error && <p className="account-error">{error}</p>}
      </div>
    </motion.div>
  )
}

// ─── Sala (lobby / rodada / revelação / fim) ───

function RoomView({ state, offset, onLeave }: { state: RoomState; offset: number; onLeave: () => void }) {
  const auth = useAuth()
  const me = auth.user!.id
  const { room, players, answers } = state
  const isHost = room.host_id === me
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<{ error: string | null }>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await fn()
    setBusy(false)
    if (err) setError(err)
  }

  const leave = async () => {
    await battleApi.leave(room.id)
    onLeave()
  }

  const ranked = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players])

  if (room.status === 'lobby') {
    return (
      <Lobby
        state={state}
        isHost={isHost}
        busy={busy}
        error={error}
        onStart={() => void act(() => battleApi.start(room.id))}
        onLeave={() => void leave()}
      />
    )
  }

  if (room.status === 'finished') {
    return <Podium ranked={ranked} me={me} onLeave={onLeave} />
  }

  return (
    <RoundView
      key={`${room.id}:${room.round_index}`}
      state={state}
      me={me}
      isHost={isHost}
      offset={offset}
      ranked={ranked}
      answers={answers}
      busy={busy}
      error={error}
      onAnswer={(songId) => void act(() => battleApi.answer(room.id, room.round_index, songId))}
      onAdvance={() => void act(() => battleApi.advance(room.id))}
      onLeave={() => void leave()}
    />
  )
}

function Lobby({
  state,
  isHost,
  busy,
  error,
  onStart,
  onLeave,
}: {
  state: RoomState
  isHost: boolean
  busy: boolean
  error: string | null
  onStart: () => void
  onLeave: () => void
}) {
  const { room, players } = state
  const [copied, setCopied] = useState(false)
  const category = CATEGORIES.find((c) => c.id === room.settings.category)
  const link = inviteUrl(room.code)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard bloqueado — o código continua visível
    }
  }

  return (
    <motion.div className="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="battle-lobby">
        <p className="battle-lobby__hint">Código da sala</p>
        <div className="battle-code" aria-label={`Código ${room.code}`}>
          {room.code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        <div className="battle-lobby__actions">
          <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
            {copied ? 'Copiado ✓' : '🔗 Copiar link'}
          </button>
          <ShareButton text={`Bora de Batalha no Songsfy? ⚔️ Entre na sala ${room.code}: ${link}`} />
        </div>
        <p className="battle-lobby__settings">
          {room.settings.rounds} rodadas · {room.settings.roundSeconds}s por música · {category ? `${category.emoji} ${category.label}` : '🎲 Todos os estilos'}
        </p>
      </div>

      <h3 className="battle-players__title">
        Jogadores <span>{players.length}</span>
      </h3>
      <ul className="battle-players">
        <AnimatePresence>
          {players.map((p) => (
            <motion.li
              key={p.user_id}
              className={`player-chip ${p.user_id === room.host_id ? 'player-chip--host' : ''}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            >
              <span className="player-chip__avatar">{p.avatar_emoji}</span>
              {nick(p)}
              {p.user_id === room.host_id && <span className="player-chip__tag">anfitrião</span>}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {isHost ? (
        <button type="button" className="btn btn--play" style={{ alignSelf: 'center' }} disabled={busy} onClick={onStart}>
          {busy ? 'Sorteando…' : players.length < 2 ? '▶ Começar sozinho' : '▶ Começar'}
        </button>
      ) : (
        <p className="game__help">
          Aguardando o anfitrião começar… <Equalizer active bars={3} />
        </p>
      )}
      {error && <p className="account-error" style={{ textAlign: 'center' }}>{error}</p>}
      <button type="button" className="btn btn--ghost" onClick={onLeave}>
        {isHost ? 'Fechar sala' : 'Sair da sala'}
      </button>
    </motion.div>
  )
}

function RoundView({
  state,
  me,
  isHost,
  offset,
  ranked,
  answers,
  busy,
  error,
  onAnswer,
  onAdvance,
  onLeave,
}: {
  state: RoomState
  me: string
  isHost: boolean
  offset: number
  ranked: RoomState['players']
  answers: RoomState['answers']
  busy: boolean
  error: string | null
  onAnswer: (songId: string) => void
  onAdvance: () => void
  onLeave: () => void
}) {
  const { room, players } = state
  const current = room.playlist[room.round_index]
  const seconds = room.settings.roundSeconds
  const startAt = room.round_started_at ? new Date(room.round_started_at).getTime() : 0
  const total = room.playlist.length

  const { play, stop, preload, playing } = usePreviewPlayer()
  const [now, setNow] = useState(() => Date.now() + offset)
  const rafId = useRef(0)
  const started = useRef(false)
  const advanced = useRef(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [revealTrack, setRevealTrack] = useState<TrackInfo | null>(null)
  const [revealSince] = useState(() => Date.now())

  const myAnswer = answers.find((a) => a.user_id === me)
  const elapsed = now - startAt
  const countdown = Math.ceil(-elapsed / 1000)
  const left = Math.max(0, seconds - elapsed / 1000)
  const isReveal = room.status === 'reveal'
  const answeredCount = answers.length

  // Relógio da rodada (compensado pelo desvio do servidor)
  useEffect(() => {
    const tick = () => {
      setNow(Date.now() + offset)
      rafId.current = requestAnimationFrame(tick)
    }
    rafId.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId.current)
  }, [offset])

  // Pré-carrega a prévia na contagem regressiva e toca exatamente no início
  useEffect(() => {
    if (!current) return
    preload(current.preview)
  }, [current, preload])

  useEffect(() => {
    if (!current || isReveal || started.current) return
    if (elapsed >= 0) {
      started.current = true
      play(current.preview, seconds)
    }
  }, [elapsed, current, isReveal, play, seconds])

  // Tempo esgotado: o anfitrião avança; os outros cobrem se ele sumir (servidor libera após +2s)
  useEffect(() => {
    if (isReveal || advanced.current) return
    const grace = isHost ? 300 : 3500
    if (elapsed > seconds * 1000 + grace) {
      advanced.current = true
      onAdvance()
    }
  }, [elapsed, isReveal, isHost, seconds, onAdvance])

  // Reveal travado (anfitrião caiu): qualquer um destrava depois de 20s
  const revealStuck = isReveal && !isHost && Date.now() - revealSince > 21000

  useEffect(() => {
    if (!isReveal) return
    stop()
    const song = room.revealed_answer ? gameSongById(room.revealed_answer) : undefined
    if (song) void getTrack(song).then(setRevealTrack)
  }, [isReveal, room.revealed_answer, stop])

  useEffect(() => {
    if (isReveal && myAnswer?.correct) {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 }, colors: ['#ff8c1a', '#ff4d5a', '#ffc02e'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReveal])

  useEffect(() => () => stop(), [stop])

  const options = useMemo(() => (current?.options ?? []).map((id) => gameSongById(id)).filter((s) => !!s), [current])
  const answerSong = room.revealed_answer ? gameSongById(room.revealed_answer) : undefined
  const urgent = !isReveal && left <= 5 && elapsed >= 0
  const isLast = room.round_index + 1 >= total

  const pick = (songId: string) => {
    if (picked || myAnswer || isReveal || elapsed < 0) return
    setPicked(songId)
    onAnswer(songId)
  }

  const myRank = ranked.findIndex((p) => p.user_id === me) + 1

  return (
    <div className="game">
      <div className="hud">
        <div className="hud__combo" style={{ textAlign: 'left' }}>
          Rodada {room.round_index + 1}/{total}
        </div>
        {!isReveal ? (
          <div className={`hud__timer ${urgent ? 'hud__timer--urgent' : ''}`}>⏱ {elapsed < 0 ? seconds : Math.ceil(left)}s</div>
        ) : (
          <div className="hud__timer">🎯</div>
        )}
        <div className="hud__score">{ranked.find((p) => p.user_id === me)?.score ?? 0} pts</div>
      </div>

      {!isReveal && (
        <div className={`timerbar ${urgent ? 'timerbar--urgent' : ''}`}>
          <div className="timerbar__fill" style={{ width: `${elapsed < 0 ? 100 : (left / seconds) * 100}%` }} />
        </div>
      )}

      <AnimatePresence mode="wait">
        {!isReveal && elapsed < 0 && (
          <motion.div
            key={`cd-${countdown}`}
            className="battle-countdown"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {countdown}
          </motion.div>
        )}
      </AnimatePresence>

      {!isReveal && elapsed >= 0 && (
        <>
          <div className="game__stage game__stage--compact">
            <button type="button" className="btn btn--play" onClick={() => (playing ? stop() : current && play(current.preview, left))}>
              {playing ? '◼ Parar' : '▶ Ouvir'}
              <Equalizer active={playing} bars={4} />
            </button>
          </div>

          <div className="optgrid optgrid--quad">
            {options.map((o, i) => {
              const mine = (picked ?? myAnswer?.song_id) === o.id
              return (
                <motion.button
                  key={o.id}
                  type="button"
                  className={`optcard battle-opt battle-opt--${i} ${mine ? 'battle-opt--picked' : ''} ${picked || myAnswer ? 'battle-opt--locked' : ''}`}
                  disabled={!!picked || !!myAnswer}
                  onClick={() => pick(o.id)}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24, delay: i * 0.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <strong>{o.title}</strong>
                  <span>{o.artist}</span>
                </motion.button>
              )
            })}
          </div>

          <p className="game__help">
            {picked || myAnswer ? 'Resposta enviada! ' : 'Toque na opção certa o mais rápido que puder. '}
            <strong>
              {answeredCount}/{players.length}
            </strong>{' '}
            {answeredCount === 1 ? 'respondeu' : 'responderam'}
          </p>
        </>
      )}

      {isReveal && (
        <motion.div className="battle-reveal" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
          <div className="battle-reveal__song">
            {revealTrack?.artworkUrl ? (
              <img className="battle-reveal__art" src={revealTrack.artworkUrl} alt="" />
            ) : (
              <div className="battle-reveal__art battle-reveal__art--ph">🎵</div>
            )}
            <div>
              <p className="battle-reveal__label">A resposta era</p>
              <strong>{answerSong?.title ?? '—'}</strong>
              <span>{answerSong?.artist}</span>
            </div>
          </div>

          <div className={`toast ${myAnswer?.correct ? 'toast--ok' : 'toast--fail'}`}>
            {myAnswer
              ? myAnswer.correct
                ? `Acertou em ${(myAnswer.elapsed_ms / 1000).toFixed(1)}s — +${myAnswer.points} pts 🎉`
                : 'Errou dessa vez 😬'
              : 'Tempo esgotado — sem resposta ⏱'}
          </div>

          <ol className="lb">
            {ranked.map((p, i) => {
              const a = answers.find((x) => x.user_id === p.user_id)
              return (
                <motion.li
                  key={p.user_id}
                  layout
                  className={`lb__row ${p.user_id === me ? 'lb__row--me' : ''}`}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                >
                  <span className="lb__pos">{i + 1}º</span>
                  <span className="lb__avatar">{p.avatar_emoji}</span>
                  <span className="lb__nick">{nick(p)}</span>
                  <span className="lb__squares">{a ? (a.correct ? `✅ +${a.points}` : '❌') : '⏱'}</span>
                  <span className="lb__value">{p.score}</span>
                </motion.li>
              )
            })}
          </ol>

          {isHost || revealStuck ? (
            <button type="button" className="btn btn--play" style={{ alignSelf: 'center' }} disabled={busy} onClick={onAdvance}>
              {isLast ? '🏁 Ver resultado final' : '▶ Próxima música'}
            </button>
          ) : (
            <p className="game__help">
              Você está em <strong>{myRank}º</strong>. Aguardando o anfitrião… <Equalizer active bars={3} />
            </p>
          )}
        </motion.div>
      )}

      {error && <p className="account-error" style={{ textAlign: 'center' }}>{error}</p>}
      <button type="button" className="btn btn--ghost" onClick={onLeave}>
        Sair da partida
      </button>
    </div>
  )
}

function Podium({ ranked, me, onLeave }: { ranked: RoomState['players']; me: string; onLeave: () => void }) {
  const myPos = ranked.findIndex((p) => p.user_id === me) + 1
  const top = ranked.slice(0, 3)

  useEffect(() => {
    if (myPos === 1) {
      confetti({ particleCount: 160, spread: 100, origin: { y: 0.4 }, colors: ['#ff8c1a', '#ff4d5a', '#ffc02e', '#ff2e88'] })
    }
  }, [myPos])

  return (
    <motion.div className="result" initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
      <h2 className={`result__title ${myPos === 1 ? 'result__title--win' : ''}`}>{myPos === 1 ? 'Você venceu! 🏆' : 'Fim de jogo! ⚔️'}</h2>

      <div className="podium">
        {[1, 0, 2].map((idx) => {
          const p = top[idx]
          if (!p) return <div key={idx} className="podium__slot podium__slot--empty" />
          return (
            <motion.div
              key={p.user_id}
              className={`podium__slot podium__slot--${idx + 1} ${p.user_id === me ? 'podium__slot--me' : ''}`}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + (2 - idx) * 0.2, type: 'spring', stiffness: 220, damping: 20 }}
            >
              <span className="podium__medal">{MEDALS[idx]}</span>
              <span className="podium__avatar">{p.avatar_emoji}</span>
              <span className="podium__nick">{nick(p)}</span>
              <span className="podium__score">{p.score}</span>
            </motion.div>
          )
        })}
      </div>

      {ranked.length > 3 && (
        <ol className="lb" style={{ width: '100%' }}>
          {ranked.slice(3).map((p, i) => (
            <li key={p.user_id} className={`lb__row ${p.user_id === me ? 'lb__row--me' : ''}`}>
              <span className="lb__pos">{i + 4}º</span>
              <span className="lb__avatar">{p.avatar_emoji}</span>
              <span className="lb__nick">{nick(p)}</span>
              <span className="lb__value">{p.score}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="result__meta">
        Você ficou em <strong>{myPos}º</strong> de {ranked.length} com {ranked.find((p) => p.user_id === me)?.score ?? 0} pontos
      </p>
      <ShareButton
        text={`Songsfy ⚔️ Batalha\n${top.map((p, i) => `${MEDALS[i]} ${nick(p)} — ${p.score} pts`).join('\n')}`}
        story={{
          mode: 'Batalha',
          emoji: '⚔️',
          subline: `${ranked.length} jogadores`,
          headline: myPos === 1 ? 'Venci a Batalha! 🏆' : `Fiquei em ${myPos}º lugar`,
          lines: top.map((p, i) => `${MEDALS[i]} ${p.avatar_emoji} ${nick(p)} — ${p.score} pts`),
          stats: [
            { label: 'Posição', value: `${myPos}º` },
            { label: 'Pontos', value: ranked.find((p) => p.user_id === me)?.score ?? 0 },
          ],
        }}
      />
      <button type="button" className="btn btn--ghost" onClick={onLeave}>
        🔄 Nova sala
      </button>
    </motion.div>
  )
}
