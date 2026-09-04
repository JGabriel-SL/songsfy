// Atualização do app instalado na tela inicial.
//
// O registerSW.js do vite-plugin-pwa só chama update() no evento `load`. Num PWA
// que fica na memória e é apenas retomado, esse evento não acontece de novo — o
// app nunca pergunta se saiu versão nova, e a única saída vira reinstalar pelo
// navegador. Aqui a pergunta passa a ser feita ao voltar para o app e de tempos
// em tempos; o sw.js já tem skipWaiting + clientsClaim, então a versão nova assume
// sozinha e só falta recarregar a página para o bundle novo entrar.

const CHECK_MS = 15 * 60 * 1000

// Recarregar no meio de uma partida cronometrada apaga o progresso: quando está
// bloqueado, a troca fica guardada e acontece assim que a pessoa sai do jogo.
let blocked = false
let pending = false

/** Segura (ou libera) o recarregamento — usado enquanto uma partida está aberta. */
export function setUpdateBlocked(value: boolean): void {
  blocked = value
  if (!blocked && pending) {
    pending = false
    window.location.reload()
  }
}

function applyUpdate(): void {
  if (blocked) {
    pending = true
    return
  }
  window.location.reload()
}

export function watchForUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // Na primeira visita o clientsClaim também dispara controllerchange, e aí não há
  // versão anterior para trocar — recarregar ali seria um susto à toa.
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    applyUpdate()
  })

  void navigator.serviceWorker.ready.then((registration) => {
    const check = () => {
      if (navigator.onLine === false) return
      void registration.update().catch(() => {})
    }
    check()
    setInterval(check, CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  })
}
