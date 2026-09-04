# Songsfy 🎧

PWA de jogos musicais diários, no estilo Musicle/Heardle. Um desafio novo por dia, com prévias de 30s da **iTunes Search API** (gratuita, sem chave de API).

## Modos de jogo

### 🎧 Música do Dia
Adivinhe a faixa secreta em até **6 tentativas**. A cada erro:
- O trecho da prévia cresce: 1s → 2s → 4s → 7s → 11s → 16s
- Uma nova dica é revelada: gênero → ano de lançamento → capa do álbum (borrada) → inicial do artista → nome do artista

Com estatísticas persistentes (sequência de vitórias, recorde, distribuição) e compartilhamento de resultado em emojis.

### 🔥 Músicas do Dia
**6 prévias** para reconhecer entre **9 opções**, em seis categorias independentes: **Pop**, **Rock**, **Brasil**, **Sertanejo**, **Eletrônica** e **Hip-Hop**. Todas as faixas ficam disponíveis desde o início — ouça e acerte **na ordem que quiser**. Dois erros na mesma faixa revelam a resposta. Placar final compartilhável.

### 🖼️ Capa do Dia
Desafio diário visual: a capa do álbum começa **borrada (blur de 28px)** e vai ficando nítida a cada erro, em até 6 tentativas. Dicas de ano (2 erros) e gênero (4 erros). Estatísticas e compartilhamento próprios.

### 🏃 Maratona (arcade)
Modo infinito com **3 vidas**: prévias de 3s, 4 opções da mesma categoria, +100 pontos por acerto com **bônus de combo** (+25 × sequência). Recorde salvo localmente.

### ⚡ Relâmpago (arcade)
**60 segundos** no relógio: trechos de 2s, 4 opções, **+2s por acerto**, botão de pular. Recorde salvo localmente.

## Como funciona

- **Sorteio diário determinístico**: o desafio é derivado da data (seed `xmur3` + `mulberry32`), então todos os jogadores veem o mesmo desafio no mesmo dia — sem backend.
- **iTunes Search API**: busca prévia de 30s + capa do álbum em tempo real, com cache de 30 dias no `localStorage`. Músicas cujo original não aparece primeiro têm um `searchTerm` customizado no catálogo.
- **Progresso e estatísticas** ficam no `localStorage`; o estado do dia é retomado se o jogador recarregar a página.
- **PWA**: instalável, com service worker (`vite-plugin-pwa`) que faz cache da API, das capas e das fontes para uso offline parcial.

## Rodando

```bash
npm install
npm run dev      # desenvolvimento em http://localhost:5173
npm run build    # build de produção + service worker em dist/
npm run preview  # serve o build de produção
```

Os ícones do PWA são gerados por `node scripts/gen-icons.mjs` (sem dependências externas).

## Modo online (contas, rankings e catálogo no banco) — Supabase

O app roda em dois modos:

- **Local (padrão)**: sem configuração nenhuma — catálogo estático, sorteio por seed, progresso no navegador. É o comportamento quando o `.env.local` não existe.
- **Online**: contas (Google, e-mail ou anônimo com apelido), ranking diário e leaderboards arcade, estatísticas sincronizadas, catálogo vindo do banco (com prévias resolvidas pelo servidor — cliente não chama mais a Apple) e desafios diários idênticos para todos, gerados por um cron.

### Ativando o modo online

1. **Crie um projeto no [Supabase](https://supabase.com)** (plano free).
2. **Rode as migrações**: abra o *SQL Editor* do projeto e execute, em ordem, os arquivos de [supabase/migrations/](supabase/migrations/) (ou `supabase db push`). A 0001 cria tabelas, RLS, RPCs, views e o seed das músicas curadas; as seguintes adicionam Batalha, cron, Amigos e push.
3. **Publique a função de catálogo**: instale o [Supabase CLI](https://supabase.com/docs/guides/cli), faça `supabase login`, vincule o projeto (`supabase link --project-ref SEU_REF`) e rode `supabase functions deploy refresh-catalog`. Defina o secret: `supabase secrets set CRON_SECRET=um-valor-secreto`.
4. **Execute a função uma vez** para preencher as prévias e gerar os desafios de hoje:
   `curl -X POST https://SEU-PROJETO.supabase.co/functions/v1/refresh-catalog -H "x-cron-secret: um-valor-secreto"`
   (a primeira execução preenche até 60 prévias; rode de novo se precisar)
5. **Agende o cron diário** (Dashboard → Integrations → Cron, ou pg_cron): uma chamada HTTP diária (ex.: 03:00) para a URL acima com o header `x-cron-secret`.
6. **Habilite os logins** em *Authentication → Providers*: **Anonymous sign-ins**, **Email** e **Google** (para o Google, crie um OAuth Client em console.cloud.google.com → Credentials, com redirect `https://SEU-PROJETO.supabase.co/auth/v1/callback`, e cole client id/secret no Supabase).
7. **Configure o app**: copie `.env.example` para `.env.local`, preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Settings → API do projeto) e rode `npm run build`.

Sem qualquer um desses passos o app continua funcionando no modo local — os botões de conta/ranking explicam o que falta.

### Amigos e comparativo por modo

Jogadores logados podem adicionar amigos (por apelido ou por um **código de 6 letras** / link `?friend=CODE`) e comparar pontos **separados por modo de jogo**: resultado de hoje, pontos da semana (Música/Capa: `(7 − tentativas) × 10` por vitória; Músicas: `acertos × 10` por categoria), sequência, vitórias e recordes arcade. O Ranking ganha os filtros **Global / Amigos** e **Hoje / Semana**.

1. Rode a migração [supabase/migrations/0006_friends.sql](supabase/migrations/0006_friends.sql) (tabela `friendships`, view `weekly_mode_points`, RPCs e código de amigo nos perfis).
2. Pronto — a tela **👥 Amigos** aparece na home. Pedidos e aceites atualizam ao vivo via Realtime enquanto o app está aberto.

### Notificações (push no celular + central de avisos)

Opcional. Usa Web Push com chaves VAPID; o envio sai de uma Edge Function disparada pelo banco (mesmo esquema `pg_net` + Vault da migração 0005).

Todo aviso passa por `public.push_notify()`: ele grava uma linha em `notifications` — que alimenta o sino da barra de topo, o contador no ícone do app e o toast de tela aberta — e só então dispara o push. Evento novo é uma chamada a mais de `push_notify` no SQL, sem tocar no envio.

1. Gere as chaves uma vez: `npx web-push generate-vapid-keys`.
2. Segredos da função: `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com` (o `CRON_SECRET` já existe do passo do catálogo).
3. Publique a função: `supabase functions deploy send-push`.
4. Rode as migrações [0007_push.sql](supabase/migrations/0007_push.sql) (tabela `push_subscriptions` e RPCs de assinatura) e [0008_notifications.sql](supabase/migrations/0008_notifications.sql) (tabelas `notifications` e `notification_prefs`, `push_notify`, os gatilhos dos eventos e o cron do lembrete diário). Elas reaproveitam os segredos `project_url` / `cron_secret` do Vault; sem eles o aviso é gravado e aparece no sino, só não vira push.
5. Coloque a chave **pública** no build: `VITE_VAPID_PUBLIC_KEY` no `.env.local` (ou `VAPID_PUBLIC_KEY` na Vercel) e faça `npm run build`.
6. Em **Conta** ou **Amigos**, toque em **Ativar avisos**. Teste com `npm run preview` — em `npm run dev` o service worker não é gerado.

**O que gera aviso** (cada um pode ser desligado em **Conta → O que avisar**):

| Evento | Quando | Origem |
| --- | --- | --- |
| Pedido / aceite de amizade | alguém te adiciona ou aceita seu pedido | trigger `friendships_notify` |
| Convite de batalha | um amigo te chama da sala dele (botão **Chamar amigos** no lobby) | RPC `battle_invite` |
| Fim da batalha | a sala termina — só para quem **não** respondeu a última rodada, porque quem respondeu está olhando o resultado | trigger `rooms_notify_finished` |
| Te ultrapassaram | um amigo passou sua pontuação no desafio do dia; no máximo um por dia/modo | trigger `results_notify_beat` |
| Lembrete diário | 12:00 (BRT) para quem tem push e ainda não jogou hoje | cron `songsfy-daily-reminder` |

A repetição é barrada por um índice único sobre `data ->> 'dedupe'`: o mesmo aviso não chega duas vezes nem se o gatilho rodar de novo.

Limitações: no iPhone o push só funciona com o app **instalado na tela inicial** (iOS 16.4+); a tela mostra essa dica. Ao sair da conta, o dispositivo é desassinado. Para depurar um envio: `select id, status_code, error_msg from net._http_response order by id desc limit 5;`, `select kind, count(*) from notifications group by 1;` e os logs da função no dashboard. Para disparar o lembrete na mão: `select public.notify_daily_reminder();`.

## iTunes Search API — como é usada e limitações

- **Endpoint**: `GET https://itunes.apple.com/search?term=<título+artista>&media=music&entity=song&limit=25&country=BR` — sem chave, sem cadastro, com CORS liberado (funciona direto do navegador).
- **O que vem na resposta**: `previewUrl` (prévia AAC de ~30s hospedada em `*.mzstatic.com`), `artworkUrl100` (trocamos `100x100` por `600x600` na URL para alta resolução) e `collectionName` (álbum).
- **Rate limit**: a Apple documenta "aproximadamente 20 chamadas por minuto" por IP (não é um limite rígido publicado; acima disso retorna 403 temporário). O app fica muito abaixo disso: cada música resolvida é **cacheada por 30 dias no localStorage**, os modos diários fazem 1–6 chamadas por dia, e os modos arcade pré-carregam só 2 rodadas à frente — em partidas repetidas o cache atende quase tudo.
- **Offline**: o service worker também guarda as respostas da API (NetworkFirst, 7 dias) e áudio/capas (CacheFirst, 30 dias), então faixas já ouvidas funcionam parcialmente sem rede.
- **Matching**: a busca às vezes retorna covers/karaokê antes do original. O app normaliza título+artista e procura o par exato na lista; quando o original não vem primeiro (ou não existe no iTunes BR), a música ganha um `searchTerm` customizado no catálogo — todas as faixas do catálogo foram validadas contra a API.
- **Termos de uso**: a API é gratuita para uso em apps/sites (é o programa de afiliados da Apple); prévias de 30s são o conteúdo licenciado para reprodução — não é permitido baixar/armazenar o áudio permanentemente nem reproduzir faixas completas.

## Catálogo

As músicas ficam em [src/data/catalog.ts](src/data/catalog.ts) — 82 faixas em 6 categorias (Pop, Rock, Brasil, Sertanejo, Eletrônica, Hip-Hop). Para adicionar uma música, inclua `id`, `title`, `artist`, `year`, `genre` e `category`. Se a busca `título + artista` no iTunes retornar covers antes do original, adicione um `searchTerm` customizado (verifique com a API antes).

## Stack

- Vite + React 19 + TypeScript
- Framer Motion (animações) + canvas-confetti
- vite-plugin-pwa (manifest + service worker via Workbox)
- iTunes Search API (prévias e capas — gratuita, sem autenticação)
