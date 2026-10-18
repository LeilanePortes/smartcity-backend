# Iluminação Pública Inteligente — Backend

API NestJS do mock de iluminação pública inteligente da Prefeitura de Itaguari, GO.
Trilha de backend desenvolvida primeiro; entrega a API completa com dados mockados
antes do início do app mobile (Flutter).

Ver [`PRD-iluminacao-publica-inteligente.md`](./PRD-iluminacao-publica-inteligente.md)
e [`roadmap-backend-nestjs.md`](./roadmap-backend-nestjs.md).

## Stack

- **NestJS 12** (Node + TypeScript), gerenciado com **Bun**
- **PostgreSQL 16** via Docker
- **Prisma 6** como ORM / camada de acesso a dados

## Pré-requisitos

- [Bun](https://bun.sh) ≥ 1.3
- Docker + Docker Compose

## Rodar tudo com Docker

Sobe **banco + API + simulador + brokers MQTT + camadas edge e fog** de uma vez (ver
[Camadas edge · fog · nuvem](#camadas-edge--fog--nuvem-mqtt)). Na primeira subida o container
aplica as migrations, roda o seed dos 248 postes e gera o histórico (backfill)
automaticamente — isso leva alguns minutos; nas próximas ele detecta o banco já
populado e vai direto para a API.

```bash
cp .env.example .env       # opcional: só para ajustar os defaults
bun run docker:up          # build + up (postgres + app)
bun run docker:logs        # acompanha o bootstrap e o simulador
bun run docker:down        # derruba a stack (o volume do banco é preservado)
```

API em `http://localhost:3000` (Swagger em `/docs`), WebSocket em
`ws://localhost:3000/tempo-real`.

Variáveis do serviço `app` (todas opcionais, lidas do `.env` na raiz):

| Variável | Default | |
|---|---|---|
| `PORT` | `3000` | porta publicada no host |
| `DB_BOOTSTRAP` | `auto` | `auto` = seed + backfill só com o banco vazio · `force` = sempre · `skip` = só migrations |
| `DIAS_RAW` / `DIAS_AGREGADO` | `30` / `740` | tamanho do histórico gerado no bootstrap |
| `SIMULADOR_*` | ver abaixo | mesmos controles do modo local |

O `DATABASE_URL` do `.env` **não** é usado pelo container: dentro da rede do
compose o host do banco é `postgres`, e o próprio `docker-compose.yml` já
define a URL correta.

Comandos dentro do container, se precisar:

```bash
docker compose exec app bun run db:seed
docker compose exec app bunx prisma migrate deploy
docker compose down -v      # zera também o volume do banco
```

## Setup local (API fora do Docker)

```bash
# 1. Dependências
bun install

# 2. Variáveis de ambiente
cp .env.example .env

# 3. Banco de dados (PostgreSQL em container)
bun run db:up

# 4. Cliente Prisma + migrations
bun run prisma:generate
bun run prisma:migrate

# 5. Seed da rede de 248 postes de Itaguari
bun run db:seed

# 6. Histórico: telemetria/eventos (30 d) + agregados diários (~2 anos, para os KPIs)
bun run db:backfill
```

## Executar

```bash
bun run start:dev      # http://localhost:3000 (watch mode)
```

- **API REST:** `http://localhost:3000` — documentação interativa em `/docs`
  (Swagger), OpenAPI JSON em `/docs-json`.
- **WebSocket:** `ws://localhost:3000/tempo-real` (Socket.IO).
- **Contrato completo com exemplos de payload:** [`docs/contrato-api.md`](./docs/contrato-api.md).
  Requisições prontas em [`docs/requests.http`](./docs/requests.http).

### Simulador de telemetria

Sobe **junto com a API** e passa a gravar leituras, eventos e transições de
status continuamente (ver seção abaixo). Controle por variáveis de ambiente
(defaults em `.env.example`):

| Variável | Default | |
|---|---|---|
| `SIMULADOR_ENABLED` | `true` | `false` sobe a API sem o worker |
| `SIMULADOR_INTERVALO_SENSORES_MS` | `5000` | tick de detecção de veículo |
| `SIMULADOR_INTERVALO_TELEMETRIA_MS` | `10000` | tick de leitura de consumo |
| `SIMULADOR_INTERVALO_STATUS_MS` | `30000` | tick de transição de status |
| `SIMULADOR_RETENCAO_DIAS` | `40` | corte da limpeza de leituras/eventos |

```bash
# ex.: demo com telemetria mais rápida
SIMULADOR_INTERVALO_TELEMETRIA_MS=3000 bun run start:dev
```

## Scripts úteis

| Script | Ação |
|---|---|
| `bun run docker:up` / `docker:down` | Sobe / derruba a stack inteira (PostgreSQL + API) |
| `bun run docker:logs` | Logs da API no container |
| `bun run db:up` / `db:down` | Sobe só o PostgreSQL / derruba a stack |
| `bun run prisma:migrate` | Cria e aplica migrations em desenvolvimento |
| `bun run prisma:studio` | Prisma Studio (inspeção visual do banco) |
| `bun run db:seed` | Popula a rede de 248 postes (idempotente) |
| `bun run db:backfill` | Histórico: telemetria/eventos (`DIAS_RAW`) + agregados diários (`DIAS_AGREGADO`) |
| `bun run db:reset` | Recria o banco do zero e roda o seed |
| `bun run build` / `bun run lint` | Compila para `dist/` · oxlint |

## Modelo de dados

Entidades em `prisma/schema.prisma` (PRD seção 7):

- **Poste** — código, endereço, bairro, coordenadas, status, luminosidade e consumo atuais.
- **LeituraTelemetria** — série temporal de consumo (kW) e luminosidade (%) por poste.
- **EventoSensor** — log do sensor 360° (veículo detectado / retorno ao piso, sentido).
- **AgregadoConsumo** — consumo e custo agregados por período (`posteId` nulo = rede inteira).

Enums: `StatusPoste`, `TipoEventoSensor`, `SentidoVeiculo`, `PeriodoAgregado`.

## Seed

`prisma/seed.ts` gera de forma **determinística** (PRNG com seed fixa) os 248 postes
distribuídos por 9 bairros de Itaguari, com endereços e coordenadas plausíveis em torno
do centro da cidade. A distribuição inicial de status segue o PRD:

| Status | Qtd |
|---|---|
| Normal | 231 |
| Consumo alto | 9 |
| Falha / Offline | 5 |
| Manutenção | 3 |

O seed limpa e recria a rede a cada execução.

## Simulador de telemetria (Fase 2)

Worker embutido na API (`src/simulador/`), ligado por padrão. A cada ciclo:

- **Sensores** (5 s): para cada poste, sorteia detecção de veículo (fluxo baixo de
  madrugada) — sobe ao pico de 100%, agenda o retorno ao piso de 50% e registra os
  eventos `VEICULO_DETECTADO` / `RETORNO_AO_PISO` com sentido.
- **Telemetria** (10 s): grava `LeituraTelemetria` com consumo coerente com a
  luminosidade e o status (postes offline não reportam; em manutenção reportam 0).
- **Status** (30 s): move postes entre `NORMAL`, `CONSUMO_ALTO` e `FALHA_OFFLINE`
  mantendo a distribuição perto do alvo do PRD. `MANUTENCAO` só muda manualmente.
- **Limpeza** (6 h): remove leituras/eventos além de `SIMULADOR_RETENCAO_DIAS`.

O estado vivo dos postes fica em memória e é sincronizado com o banco a cada tick.
Intervalos e retenção são configuráveis por env (ver `.env.example`).

## API — Postes (Fase 3)

Base URL: `http://localhost:3000`. Sem prefixo. CORS liberado. Validação estrita
(query/body desconhecidos → 400; `:id` deve ser UUID → 400; poste inexistente → 404).

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/postes?status=&busca=` | Lista para o mapa. `status` = `NORMAL`/`CONSUMO_ALTO`/`FALHA_OFFLINE`/`MANUTENCAO`; `busca` casa rua ou bairro (sem acento/caixa). Retorna `{ total, postes[] }`. |
| `GET` | `/postes/:id` | Detalhe do poste + `chamadoAberto` (true quando offline). |
| `GET` | `/postes/:id/telemetria?periodo=hoje\|semana\|mes` | Histórico agregado: `resumo` (consumo/custo/média/pico/**economia %**) + `serie[]` para o gráfico de barras (por hora em `hoje`, por dia em `semana`/`mes`). Default `hoje`. |
| `GET` | `/postes/:id/eventos?limite=` | Log do sensor 360°, mais recentes primeiro. `limite` 1–200 (default 50). |
| `PATCH` | `/postes/:id/status` | Body `{ "status": "MANUTENCAO" \| "NORMAL" }`. Só esses dois — os demais são derivados da telemetria. |

**Economia %** = consumo real frente a operar sempre em 100% pelas mesmas horas
em que a luz esteve acesa.

O `PATCH` de status emite um evento interno que o simulador escuta, para não
sobrescrever a mudança manual no tick seguinte.

## API — KPIs / Dashboard (Fase 4)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/kpis?periodo=dia\|semana\|mes\|ano` | Consumo (kWh) e custo (R$) da rede no período e no período anterior equivalente, `variacao` percentual, `parcialHoje` (dia corrente à parte) e `serie` comparativa (atual × anterior) para o gráfico — por hora (`dia`), dia (`semana`/`mes`) ou mês (`ano`). Default `mes`. |
| `GET` | `/kpis/maior-consumo?periodo=&limite=` | Ranking dos postes de maior consumo no período, com endereço e kWh/custo. `limite` 1–20 (default 5). |
| `GET` | `/kpis/postes-por-status` | `{ total, porStatus[] }` — contagem por categoria (barra empilhada do PRD). |

Custo = consumo × tarifa **B4a** (R$ 0,58/kWh), exposta em `tarifa` na resposta de `/kpis`.

As janelas de período são blocos de N dias inteiros (UTC) terminando à meia-noite
de hoje — período cheio vs. período cheio. O consumo consolidado vem de
`AgregadoConsumo` (rollup diário: cron às 00:15 + `db:backfill`); o dia corrente
é calculado ao vivo da telemetria.

## Tempo real — WebSocket (Fase 5)

Gateway **Socket.IO** no namespace `ws://localhost:3000/tempo-real` (CORS liberado).
Alimentado pelos eventos do simulador; com `SIMULADOR_ENABLED=false` ainda serve o
estado inicial e as mudanças manuais de status.

**Cliente → servidor** (com ack `{ ok }`):

| Evento | Payload | Efeito |
|---|---|---|
| `assinar:mapa` / `desassinar:mapa` | — | Entra/sai da sala do mapa. Ao entrar, recebe `mapa:estado`. |
| `assinar:poste` / `desassinar:poste` | `{ posteId }` | Entra/sai da sala de um poste. Ao entrar, recebe `poste:estado`. |

**Servidor → cliente:**

| Evento | Quando | Payload |
|---|---|---|
| `mapa:estado` | ao assinar o mapa | `{ postes[], em }` — todos os postes com coordenadas |
| `postes:atualizados` | a cada tick / mudança | `{ origem: 'sensores'\|'telemetria'\|'status', postes[], em }` — só os que mudaram |
| `poste:estado` | ao assinar um poste | `{ poste, em }` |
| `poste:atualizado` | quando aquele poste muda | `{ ...snapshot, origem, em }` |
| `erro` | payload inválido | `{ evento, mensagem }` |

Os snapshots de delta trazem `posteId`, `codigo`, `status`, `luminosidadeAtual`,
`consumoInstantaneoKw` e `ultimaLeituraEm`.

## Camadas edge · fog · nuvem (MQTT)

A rede está sendo separada nas três camadas de uma arquitetura IoT, ligadas por
**dois brokers MQTT** (Mosquitto): o do **campo** (`mosquitto`, porta `1883`),
entre postes e gateways, e o da **nuvem** (`mosquitto-nuvem`, porta `1884`),
entre gateways e API. Assim a queda da nuvem não afeta a rede local.

```
edge (248 postes) ──1883──► fog (9 gateways) ──1884──► nuvem (API)
   telemetria/10 s             diagnóstico              histórico, KPIs, app
   eventos na hora             resumo/min + alertas
   ◄────────── comandos ◄──────────── comandos ◄──────────
```

| Camada | Serviço | Papel |
|---|---|---|
| **Edge** | `edge` | Os 248 controladores de poste. Cada um decide a luminosidade **localmente** (sensor 360° → pico 100%, veículo se afasta → piso 50%), sem depender da rede, e publica o que mediu. |
| **Fog** | `fog` | Um gateway por bairro: diagnostica o status dos postes, agrega a telemetria e sobe para a nuvem só resumos, eventos e alertas. |
| **Nuvem** | `app` | API, histórico, KPIs e tempo real para o app. |

Por enquanto a nuvem ainda usa o simulador interno; edge e fog funcionam em
paralelo, e a API passa a consumir o fog na próxima etapa.

**Tópicos** — padrão `organização/área/dispositivo/grandeza`
([`src/common/topicos-mqtt.ts`](./src/common/topicos-mqtt.ts)):

| Tópico | Sentido | QoS | Quando |
|---|---|---|---|
| `itaguari/iluminacao/<bairro>/<poste>/telemetria` | edge → | 0 | a cada 10 s: `consumoKw`, `luminosidadePct` |
| `itaguari/iluminacao/<bairro>/<poste>/evento` | edge → | 1 | na hora: `VEICULO_DETECTADO` / `RETORNO_AO_PISO` |
| `itaguari/iluminacao/<bairro>/<poste>/saude` | edge → | 0 | a cada 30 s: `versaoFirmware`, `uptimeS`, `rssiDbm`, `memoriaLivreKb` |
| `itaguari/iluminacao/<bairro>/<poste>/comando` | → edge | 1 | `{ "status": "MANUTENCAO" \| "NORMAL" }` |
| `itaguari/iluminacao/_edge/estado` | edge → | 1 (retido) | presença do campo; *Last Will* publica `online: false` se ele cair |
| `itaguari/nuvem/<bairro>/resumo` | fog → nuvem | 1 | a cada minuto: por poste, status, média de consumo/luminosidade, energia (kWh), versão de firmware |
| `itaguari/nuvem/<bairro>/evento` | fog → nuvem | 1 | na hora: evento do sensor repassado com o bairro |
| `itaguari/nuvem/<bairro>/alerta` | fog → nuvem | 1 | na hora: mudança de status diagnosticada (`statusAnterior`, `status`, `motivo`) |
| `itaguari/nuvem/<bairro>/comando` | nuvem → fog | 1 | `{ "codigo": "P-042", "status": "MANUTENCAO" \| "NORMAL" }` — repassado ao poste |
| `itaguari/nuvem/_fog/estado` | fog → nuvem | 1 (retido) | presença dos gateways (*Last Will*) e tamanho do buffer |

O bairro vai sem acento e com hífen (`Jardim Primavera` → `jardim-primavera`).

**Como o edge simula o campo** ([`src/edge/`](./src/edge/)):

- **Provisionamento:** ao subir, pergunta à nuvem quais postes existem (`GET /postes`).
- **Falhas físicas:** o edge não declara status. Um driver degradado passa a gastar
  mais, e um poste em falha simplesmente **para de publicar** — é a ausência de
  telemetria que caracteriza o offline, como num aparelho real.
- **Banda:** a cada minuto o log mostra quantas mensagens e bytes o campo publicou
  (ordem de 1.600 mensagens/min para 248 postes).

**Regras do fog** ([`src/fog/gateway.ts`](./src/fog/gateway.ts)), configuráveis por `FOG_*`:

| Regra | Como funciona |
|---|---|
| `CONSUMO_ALTO` | Consumo **normalizado pela luminosidade** (kW a 100% de brilho, média das 3 últimas leituras) acima de **1,5×** a **mediana** do bairro; volta a `NORMAL` abaixo de 1,3× (histerese). Normalizar evita acusar um poste que só está no pico porque passou um carro; a mediana evita que os defeituosos puxem a referência. |
| `FALHA_OFFLINE` | Nenhuma telemetria por **30 s** (3 leituras perdidas); volta a `NORMAL` quando o poste reaparece. |
| `MANUTENCAO` | Só muda por comando do técnico; o fog não sobrescreve. |

- **Agregação:** a telemetria (uma leitura por poste a cada 10 s) vira **um resumo
  por bairro por minuto**. Eventos e alertas sobem na hora, para o mapa seguir ao vivo.
- **Buffer (store-and-forward):** se o broker da nuvem cair, o fog guarda o que
  iria subir e envia em ordem quando a conexão volta.
- **Banda:** a cada janela o log compara o que entrou do campo com o que subiu —
  na prática, **~88% menos mensagens e ~55% menos bytes**.

Acompanhar o tráfego, enviar um comando e testar o buffer:

```bash
docker compose logs -f edge fog
docker exec smartcity-mosquitto mosquitto_sub -t 'itaguari/iluminacao/#' -v   # campo
docker exec smartcity-mosquitto-nuvem mosquitto_sub -t 'itaguari/nuvem/#' -v  # nuvem

# comando do técnico: nuvem → fog → poste
docker exec smartcity-mosquitto-nuvem mosquitto_pub -q 1 \
  -t 'itaguari/nuvem/centro/comando' -m '{"codigo":"P-001","status":"MANUTENCAO"}'

# queda da nuvem: o fog guarda e reenvia ao voltar
docker compose stop mosquitto-nuvem; sleep 30; docker compose start mosquitto-nuvem
```

## Documentação (Fase 6)

- **Swagger UI:** `GET /docs` · **OpenAPI JSON:** `GET /docs-json`
- **Contrato para o time mobile:** [`docs/contrato-api.md`](./docs/contrato-api.md)
  — todos os endpoints REST e eventos WebSocket com exemplos de payload reais.
- **Requisições de teste:** [`docs/requests.http`](./docs/requests.http)

## Roadmap

- [x] **Fase 1** — Setup e modelagem de dados
- [x] **Fase 2** — Simulador de telemetria IoT
- [x] **Fase 3** — API REST · Postes
- [x] **Fase 4** — API REST · KPIs
- [x] **Fase 5** — Tempo real (WebSocket)
- [x] **Fase 6** — Documentação e fechamento da trilha

Trilha de backend **completa**: todos os endpoints respondem com dados mockados
coerentes com o PRD, o simulador roda de forma contínua e a documentação serve de
contrato para o desenvolvimento do app Flutter.
