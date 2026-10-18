# API — Iluminação Pública Inteligente

Referência completa dos endpoints e retornos, para uso como contexto no
desenvolvimento do frontend (app Flutter). Todos os exemplos são respostas reais
da API rodando com o seed + `bun run db:backfill` padrão.

- **Base URL:** `http://localhost:3000` — sem prefixo, **sem autenticação**
- **WebSocket:** `ws://localhost:3000/tempo-real` (Socket.IO) — [seção WebSocket](#websocket--tempo-real)
- **Swagger UI:** `GET /docs` · **OpenAPI JSON:** `GET /docs-json`
- **Content-Type:** `application/json` em requests e responses
- **Datas:** string ISO 8601 em **UTC** (`"2026-09-10T16:12:47.067Z"`)
- **CORS:** liberado para qualquer origem

> **Mock acadêmico.** Os dados são sintéticos, mas coerentes com o PRD. As janelas
> de data são calculadas em UTC. Os dados ao vivo vêm da arquitetura em camadas
> (postes simulados → gateways fog → API, via MQTT) e mudam luminosidade, consumo e
> status continuamente. Ver [`GET /arquitetura`](#get-arquitetura).

---

## Índice

- [Tipos de referência](#tipos-de-referência)
- [Erros](#erros)
- **Postes**
  - [`GET /postes`](#get-postes)
  - [`GET /postes/:id`](#get-postesid)
  - [`GET /postes/:id/telemetria`](#get-postesidtelemetria)
  - [`GET /postes/:id/eventos`](#get-postesideventos)
  - [`PATCH /postes/:id/status`](#patch-postesidstatus)
- **KPIs**
  - [`GET /kpis`](#get-kpis)
  - [`GET /kpis/maior-consumo`](#get-kpismaior-consumo)
  - [`GET /kpis/postes-por-status`](#get-kpispostes-por-status)
- **Arquitetura**
  - [`GET /arquitetura`](#get-arquitetura)
- [`GET /`](#get-)
- [WebSocket — tempo real](#websocket--tempo-real)
- [Notas do mock](#notas-do-mock)

---

## Tipos de referência

### Enums

| Enum | Valores |
|---|---|
| `StatusPoste` | `NORMAL` · `CONSUMO_ALTO` · `FALHA_OFFLINE` · `MANUTENCAO` |
| `TipoEventoSensor` | `VEICULO_DETECTADO` · `RETORNO_AO_PISO` |
| `SentidoVeiculo` | `APROXIMANDO` · `AFASTANDO` |
| `PeriodoTelemetria` (query) | `hoje` · `semana` · `mes` |
| `PeriodoKpi` (query) | `dia` · `semana` · `mes` · `ano` |

Semântica de `StatusPoste` (PRD §6):

- `NORMAL` — consumo dentro da média do trecho.
- `CONSUMO_ALTO` — consumo acima da média nas últimas 24 h ("Atenção" na UI).
- `FALHA_OFFLINE` — sem telemetria há um intervalo definido; abre chamado automático.
- `MANUTENCAO` — atribuído manualmente pelo técnico.

### `PosteResumo` — usado na lista do mapa e nos snapshots de WebSocket

| Campo | Tipo | Nulo | Descrição |
|---|---|:--:|---|
| `id` | string (uuid) | não | Identificador do poste |
| `codigo` | string | não | Código de exibição, ex. `"P-042"` |
| `endereco` | string | não | Logradouro + número |
| `bairro` | string | não | Bairro |
| `latitude` | number | não | Coordenada (WGS84) |
| `longitude` | number | não | Coordenada (WGS84) |
| `status` | `StatusPoste` | não | Status atual |
| `luminosidadeAtual` | number | não | Percentual: `50` piso, `100` pico, `0` desligado (manutenção) |
| `consumoInstantaneoKw` | number | não | Consumo instantâneo em kW (`0` quando offline/manutenção) |
| `ultimaLeituraEm` | string (ISO) | **sim** | Timestamp da última leitura válida |

### `Poste` (detalhe) — `PosteResumo` + os campos abaixo

| Campo | Tipo | Nulo | Descrição |
|---|---|:--:|---|
| `cidade` | string | não | Sempre `"Itaguari"` |
| `uf` | string | não | Sempre `"GO"` |
| `criadoEm` | string (ISO) | não | Criação do registro |
| `atualizadoEm` | string (ISO) | não | Última atualização do registro |
| `chamadoAberto` | boolean | não | `true` ⟺ `status === "FALHA_OFFLINE"` |

---

## Erros

Formato padrão do NestJS:

```json
{ "message": "…", "error": "Bad Request", "statusCode": 400 }
```

`message` é **string** (erros de negócio) ou **array de string** (erros de validação).

| Situação | Status | `message` |
|---|:--:|---|
| Enum de query inválido | `400` | `["status must be one of the following values: NORMAL, CONSUMO_ALTO, FALHA_OFFLINE, MANUTENCAO"]` |
| Query param desconhecido | `400` | `["property zzz should not exist"]` |
| `:id` não é UUID | `400` | `"Validation failed (uuid is expected)"` |
| Body inválido (`PATCH status`) | `400` | `["status must be one of the following values: MANUTENCAO, NORMAL"]` |
| Poste inexistente | `404` | `"Poste <id> não encontrado."` |

---

## Postes

### `GET /postes`

Lista de postes para o mapa (PRD §5.1). Retorna **todos** os que casam com o filtro.

**Query params** (todos opcionais):

| Param | Tipo | Descrição |
|---|---|---|
| `status` | `StatusPoste` | Filtra por status. Omitir = todos. |
| `busca` | string (≤ 120) | Casa `endereco` **ou** `bairro`, sem distinção de acento/caixa. |

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `total` | number | Quantidade de postes retornados (após filtro) |
| `postes` | `PosteResumo[]` | Ordenados por `codigo` ascendente |

```json
{
  "total": 248,
  "postes": [
    {
      "id": "74bb5973-9bb3-4c89-8d9a-b7ba16d3c6b7",
      "codigo": "P-001",
      "endereco": "Avenida Goiás, 100",
      "bairro": "Centro",
      "latitude": -15.954802,
      "longitude": -49.590696,
      "status": "NORMAL",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.0535,
      "ultimaLeituraEm": "2026-09-10T16:12:45.103Z"
    },
    {
      "id": "62ced096-553b-4566-a0af-22786139830a",
      "codigo": "P-079",
      "endereco": "Rua Anhanguera, 112",
      "bairro": "Setor Oeste",
      "latitude": -15.952874,
      "longitude": -49.596962,
      "status": "FALHA_OFFLINE",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0,
      "ultimaLeituraEm": "2026-09-10T14:52:39.667Z"
    }
  ]
}
```

Exemplos: `GET /postes?status=FALHA_OFFLINE` · `GET /postes?busca=centro` ·
`GET /postes?status=NORMAL&busca=goiás`

---

### `GET /postes/:id`

Detalhe de um poste (PRD §5.2).

**Path param:** `id` — uuid do poste.

**Resposta `200`:** objeto [`Poste`](#poste-detalhe--posteresumo--os-campos-abaixo).

```json
{
  "id": "62ced096-553b-4566-a0af-22786139830a",
  "codigo": "P-079",
  "endereco": "Rua Anhanguera, 112",
  "bairro": "Setor Oeste",
  "latitude": -15.952874,
  "longitude": -49.596962,
  "cidade": "Itaguari",
  "uf": "GO",
  "status": "FALHA_OFFLINE",
  "luminosidadeAtual": 50,
  "consumoInstantaneoKw": 0,
  "ultimaLeituraEm": "2026-09-10T14:52:39.667Z",
  "criadoEm": "2026-09-10T16:08:53.981Z",
  "atualizadoEm": "2026-09-10T16:08:53.981Z",
  "chamadoAberto": true
}
```

**Erros:** `400` (id não-uuid) · `404` (não encontrado).

---

### `GET /postes/:id/telemetria`

Histórico de consumo do poste, agregado para o gráfico de barras + indicadores
Média / Pico / Economia (PRD §5.2).

**Path param:** `id` — uuid.

**Query param:**

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `periodo` | `hoje` \| `semana` \| `mes` | `hoje` | Janela do histórico |

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `posteId` | string (uuid) | |
| `periodo` | `PeriodoTelemetria` | Ecoa a query |
| `inicio` | string (ISO) | Início da janela. `hoje` = meia-noite local; `semana`/`mes` = meia-noite UTC N dias atrás |
| `fim` | string (ISO) | Instante da requisição |
| `resumo.consumoTotalKwh` | number | kWh no período |
| `resumo.custoTotalReais` | number | `consumoTotalKwh × 0,58` |
| `resumo.mediaKw` | number | Potência média |
| `resumo.picoKw` | number | Maior leitura |
| `resumo.economiaPct` | number | % gasto a menos vs. operar sempre em 100% pelas mesmas horas acesas |
| `serie` | array | Barras do gráfico — **por hora** em `hoje`, **por dia** em `semana`/`mes` |
| `serie[].inicio` | string (ISO) | Início do bucket (alinhado à hora/dia UTC) |
| `serie[].consumoKwh` | number | kWh no bucket |
| `serie[].mediaKw` | number | Potência média no bucket |
| `serie[].picoKw` | number | Pico no bucket |

```json
{
  "posteId": "1b5dc4a2-603f-4014-9e76-e14acf54d982",
  "periodo": "semana",
  "inicio": "2026-09-03T00:00:00.000Z",
  "fim": "2026-09-10T16:12:47.015Z",
  "resumo": {
    "consumoTotalKwh": 20.063,
    "custoTotalReais": 11.64,
    "mediaKw": 0.1044,
    "picoKw": 0.1957,
    "economiaPct": 42.5
  },
  "serie": [
    { "inicio": "2026-09-03T00:00:00.000Z", "consumoKwh": 2.46,  "mediaKw": 0.1025, "picoKw": 0.1938 },
    { "inicio": "2026-09-04T00:00:00.000Z", "consumoKwh": 2.688, "mediaKw": 0.112,  "picoKw": 0.1955 },
    { "inicio": "2026-09-05T00:00:00.000Z", "consumoKwh": 2.5,   "mediaKw": 0.1042, "picoKw": 0.1892 }
  ]
}
```

`periodo=hoje` → `serie` com um item por hora decorrida:

```json
{
  "posteId": "1b5dc4a2-603f-4014-9e76-e14acf54d982",
  "periodo": "hoje",
  "inicio": "2026-09-10T03:00:00.000Z",
  "fim": "2026-09-10T16:12:47.011Z",
  "resumo": { "consumoTotalKwh": 1.552, "custoTotalReais": 0.9, "mediaKw": 0.1083, "picoKw": 0.195, "economiaPct": 40.7 },
  "serie": [
    { "inicio": "2026-09-10T03:00:00.000Z", "consumoKwh": 0.122, "mediaKw": 0.1221, "picoKw": 0.1941 },
    { "inicio": "2026-09-10T04:00:00.000Z", "consumoKwh": 0.157, "mediaKw": 0.1565, "picoKw": 0.1937 }
  ]
}
```

Poste sem leituras no período → `serie: []` e `resumo` com zeros (`economiaPct: 0`).

**Erros:** `400` (id não-uuid ou `periodo` inválido) · `404`.

---

### `GET /postes/:id/eventos`

Log do sensor 360° do poste, mais recentes primeiro (PRD §5.2).

**Path param:** `id` — uuid.

**Query param:**

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `limite` | number (1–200) | `50` | Máximo de eventos |

**Resposta `200`:** array (pode ser `[]`).

| Campo | Tipo | Nulo | Descrição |
|---|---|:--:|---|
| `id` | string (uuid) | não | |
| `tipo` | `TipoEventoSensor` | não | `VEICULO_DETECTADO` (sobe a 100 %) ou `RETORNO_AO_PISO` (volta a 50 %) |
| `sentido` | `SentidoVeiculo` | **sim** | Direção do veículo |
| `luminosidadeResultante` | number | não | `100` na detecção, `50` no retorno |
| `timestamp` | string (ISO) | não | |

```json
[
  {
    "id": "a2c97dc6-87ff-4d36-aaaa-4529cc6600ce",
    "tipo": "RETORNO_AO_PISO",
    "sentido": "APROXIMANDO",
    "luminosidadeResultante": 50,
    "timestamp": "2026-09-10T15:40:13.566Z"
  },
  {
    "id": "cd77b7af-ff79-4669-8cee-d046b2bd882f",
    "tipo": "VEICULO_DETECTADO",
    "sentido": "AFASTANDO",
    "luminosidadeResultante": 100,
    "timestamp": "2026-09-10T15:40:00.000Z"
  }
]
```

**Erros:** `400` (id não-uuid ou `limite` fora de 1–200) · `404`.

---

### `PATCH /postes/:id/status`

Atribuição manual de status pelo técnico — ação "Agendar manutenção" / retomar
operação (PRD §5.2). A mudança é difundida pelo [WebSocket](#websocket--tempo-real).

**Path param:** `id` — uuid.

**Body:**

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:--:|---|
| `status` | `"MANUTENCAO"` \| `"NORMAL"` | sim | Só esses dois — `CONSUMO_ALTO` e `FALHA_OFFLINE` são derivados da telemetria e recusados com `400` |

```json
{ "status": "MANUTENCAO" }
```

**Resposta `200`:** o objeto [`Poste`](#poste-detalhe--posteresumo--os-campos-abaixo) atualizado
(**sem** `chamadoAberto`). Ao entrar em `MANUTENCAO`, `luminosidadeAtual` e
`consumoInstantaneoKw` vão a `0`; ao voltar para `NORMAL`, `luminosidadeAtual`
volta a `50`.

```json
{
  "id": "74bb5973-9bb3-4c89-8d9a-b7ba16d3c6b7",
  "codigo": "P-001",
  "endereco": "Avenida Goiás, 100",
  "bairro": "Centro",
  "latitude": -15.954802,
  "longitude": -49.590696,
  "cidade": "Itaguari",
  "uf": "GO",
  "status": "MANUTENCAO",
  "luminosidadeAtual": 0,
  "consumoInstantaneoKw": 0,
  "ultimaLeituraEm": "2026-09-10T16:12:45.103Z",
  "criadoEm": "2026-09-10T16:08:53.981Z",
  "atualizadoEm": "2026-09-10T16:12:47.025Z"
}
```

**Erros:** `400` (id não-uuid, body ausente/ inválido) · `404`.

---

## KPIs

### `GET /kpis`

Consumo, custo e variação da rede no período, para o dashboard (PRD §5.3).

**Query param:**

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `periodo` | `dia` \| `semana` \| `mes` \| `ano` | `mes` | Janela do dashboard |

**Regras de janela:** `atual` e `anterior` são blocos de **N dias inteiros (UTC)**
terminando à meia-noite de hoje — comparação período cheio vs. período cheio
(N = 1 / 7 / 30 / 365). O dia corrente parcial fica em `parcialHoje`, **fora** da
comparação.

**Resposta `200`:**

| Campo | Tipo | Nulo | Descrição |
|---|---|:--:|---|
| `periodo` | `PeriodoKpi` | não | Ecoa a query |
| `geradoEm` | string (ISO) | não | Instante do cálculo |
| `tarifa.classe` | string | não | `"B4a"` |
| `tarifa.descricao` | string | não | `"Iluminação pública"` |
| `tarifa.valorKwh` | number | não | `0.58` |
| `atual.inicio` / `atual.fim` | string (ISO) | não | Limites da janela atual |
| `atual.consumoKwh` | number | não | kWh da rede na janela |
| `atual.custoReais` | number | não | `consumoKwh × 0,58` |
| `anterior.*` | — | não | Mesma forma de `atual`, período anterior equivalente |
| `variacao.consumoPct` | number | **sim** | Variação % de `atual` vs. `anterior` (`null` se `anterior` = 0) |
| `variacao.custoPct` | number | **sim** | Igual a `consumoPct` (custo é linear) |
| `parcialHoje.inicio` / `.fim` | string (ISO) | não | Meia-noite de hoje (UTC) → agora |
| `parcialHoje.consumoKwh` / `.custoReais` | number | não | Consumo do dia corrente até agora |
| `serie.granularidade` | `"hora"` \| `"dia"` \| `"mes"` | não | `hora` para `dia`, `dia` para `semana`/`mes`, `mes` para `ano` |
| `serie.atual` | `{ inicio, consumoKwh }[]` | não | Barras da janela atual |
| `serie.anterior` | `{ inicio, consumoKwh }[]` | não | Barras da janela anterior, alinhadas por índice |

```json
{
  "periodo": "mes",
  "geradoEm": "2026-09-10T16:12:47.111Z",
  "tarifa": { "classe": "B4a", "descricao": "Iluminação pública", "valorKwh": 0.58 },
  "atual": {
    "inicio": "2026-08-11T00:00:00.000Z",
    "fim": "2026-09-10T00:00:00.000Z",
    "consumoKwh": 10695.629,
    "custoReais": 6203.46
  },
  "anterior": {
    "inicio": "2026-07-12T00:00:00.000Z",
    "fim": "2026-08-11T00:00:00.000Z",
    "consumoKwh": 11309.065,
    "custoReais": 6559.26
  },
  "variacao": { "consumoPct": -5.4, "custoPct": -5.4 },
  "parcialHoje": {
    "inicio": "2026-09-10T00:00:00.000Z",
    "fim": "2026-09-10T16:12:47.092Z",
    "consumoKwh": 234.473,
    "custoReais": 135.99
  },
  "serie": {
    "granularidade": "dia",
    "atual": [
      { "inicio": "2026-08-11T00:00:00.000Z", "consumoKwh": 375.967 },
      { "inicio": "2026-08-12T00:00:00.000Z", "consumoKwh": 356.105 }
    ],
    "anterior": [
      { "inicio": "2026-07-12T00:00:00.000Z", "consumoKwh": 372.403 },
      { "inicio": "2026-07-13T00:00:00.000Z", "consumoKwh": 383.884 }
    ]
  }
}
```

Contagem de barras em `serie` (atual / anterior): `dia` → 24 / 24;
`semana` → 7 / 7; `mes` → 30 / 30; `ano` → 13 / 13 (a janela de 365 dias
toca 13 meses calendário — o primeiro e o último parciais).

`periodo=ano` (recortado):

```json
{
  "periodo": "ano",
  "geradoEm": "2026-09-10T16:12:47.137Z",
  "tarifa": { "classe": "B4a", "descricao": "Iluminação pública", "valorKwh": 0.58 },
  "atual":    { "inicio": "2025-09-10T00:00:00.000Z", "fim": "2026-09-10T00:00:00.000Z", "consumoKwh": 130404.676, "custoReais": 75634.71 },
  "anterior": { "inicio": "2024-09-10T00:00:00.000Z", "fim": "2025-09-10T00:00:00.000Z", "consumoKwh": 134457.932, "custoReais": 77985.6 },
  "variacao": { "consumoPct": -3, "custoPct": -3 },
  "parcialHoje": { "inicio": "2026-09-10T00:00:00.000Z", "fim": "2026-09-10T16:12:47.113Z", "consumoKwh": 234.473, "custoReais": 135.99 },
  "serie": {
    "granularidade": "mes",
    "atual":    [ { "inicio": "2025-09-01T00:00:00.000Z", "consumoKwh": 7633.924 }, { "inicio": "2025-10-01T00:00:00.000Z", "consumoKwh": 10865.567 } ],
    "anterior": [ { "inicio": "2024-09-01T00:00:00.000Z", "consumoKwh": 7833.386 }, { "inicio": "2024-10-01T00:00:00.000Z", "consumoKwh": 11165.445 } ]
  }
}
```

**Erros:** `400` (`periodo` inválido).

---

### `GET /kpis/maior-consumo`

Ranking dos postes de maior consumo no período (PRD §5.3).

**Query params:**

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `periodo` | `dia` \| `semana` \| `mes` \| `ano` | `mes` | Janela |
| `limite` | number (1–20) | `5` | Tamanho do ranking |

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `periodo` | `PeriodoKpi` | Ecoa a query |
| `inicio` / `fim` | string (ISO) | Janela avaliada (N dias inteiros UTC) |
| `ranking` | array | Ordenado por consumo desc |
| `ranking[].posicao` | number | 1-based |
| `ranking[].posteId` | string (uuid) | |
| `ranking[].codigo` | string | |
| `ranking[].endereco` | string | |
| `ranking[].bairro` | string | |
| `ranking[].consumoKwh` | number | kWh no período |
| `ranking[].custoReais` | number | `consumoKwh × 0,58` |

```json
{
  "periodo": "semana",
  "inicio": "2026-09-03T00:00:00.000Z",
  "fim": "2026-09-10T00:00:00.000Z",
  "ranking": [
    { "posicao": 1, "posteId": "ea1faf52-05f5-4c6b-8df3-84a0a72c7584", "codigo": "P-034", "endereco": "Rua Coronel Ribeiro, 100", "bairro": "Centro",      "consumoKwh": 22.75, "custoReais": 13.19 },
    { "posicao": 2, "posteId": "93b251f9-b201-4a48-9444-a0dcaf6caf14", "codigo": "P-062", "endereco": "Rua do Cerrado, 136",    "bairro": "Setor Leste", "consumoKwh": 22.28, "custoReais": 12.92 },
    { "posicao": 3, "posteId": "9a8e98c1-2a4d-4289-931f-98e69e69408c", "codigo": "P-029", "endereco": "Rua São José, 112",       "bairro": "Centro",      "consumoKwh": 22.25, "custoReais": 12.9  },
    { "posicao": 4, "posteId": "f8aa1866-72a1-44bd-9f84-d13bf0e33e1f", "codigo": "P-054", "endereco": "Rua dos Ipês, 100",       "bairro": "Setor Leste", "consumoKwh": 21.02, "custoReais": 12.19 },
    { "posicao": 5, "posteId": "4c73eb3e-7168-4cd4-8db2-5f7a6177b684", "codigo": "P-068", "endereco": "Rua Nova Aurora, 148",    "bairro": "Setor Leste", "consumoKwh": 19.46, "custoReais": 11.29 }
  ]
}
```

**Erros:** `400` (`periodo` inválido ou `limite` fora de 1–20).

---

### `GET /kpis/postes-por-status`

Contagem de postes por status — barra empilhada do dashboard (PRD §5.3).

**Sem parâmetros.**

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `total` | number | Sempre `248` |
| `porStatus` | array | As **4 categorias**, sempre presentes (mesmo com `quantidade: 0`) |
| `porStatus[].status` | `StatusPoste` | |
| `porStatus[].quantidade` | number | Contagem absoluta |

```json
{
  "total": 248,
  "porStatus": [
    { "status": "NORMAL", "quantidade": 231 },
    { "status": "CONSUMO_ALTO", "quantidade": 9 },
    { "status": "FALHA_OFFLINE", "quantidade": 5 },
    { "status": "MANUTENCAO", "quantidade": 3 }
  ]
}
```

## Arquitetura

### `GET /arquitetura`

Estado das camadas **edge · fog · nuvem** — para a tela de arquitetura do app.
É um painel do "agora" (memória da API, não histórico). Atualiza a cada janela do
fog (60 s); para a tela, basta consultar a cada 10–15 s.

**Sem parâmetros.**

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `modo` | `"camadas"` \| `"interno"` | `camadas`: dados vêm do fog. `interno`: simulador embutido (modo de reserva) — aí `edge`, `fog` e `trafego` vêm `null` e `alertas` vazio |
| `nuvem.brokerConectado` | boolean | A API está conectada ao broker MQTT da nuvem |
| `edge` | object \| null | `null` até o primeiro relatório do fog |
| `edge.online` | boolean \| null | Simulador de campo (os 248 postes) no ar, visto pelo fog |
| `fog` | object \| null | `null` até o fog se anunciar |
| `fog.online` | boolean | Gateways no ar (vira `false` pelo *Last Will* se o fog cair) |
| `fog.gateways[]` | array | Um por bairro: `{ bairro, postes, online }` |
| `fog.buffer` | number | Mensagens guardadas no fog esperando a nuvem (0 = em dia) |
| `fog.atualizadoEm` | string (ISO) | Último relatório do fog |
| `trafego` | object \| null | Último relatório de banda (uma janela) |
| `trafego.janelaS` | number | Duração da janela, em segundos |
| `trafego.entrada` | `{ msgs, bytes }` | O que chegou dos postes ao fog na janela |
| `trafego.saida` | `{ msgs, bytes }` | O que o fog subiu para a nuvem na janela |
| `trafego.reducaoMsgsPct` / `reducaoBytesPct` | number \| null | Redução percentual (0–100) na subida |
| `trafego.postes` | `{ total, online }` | Postes reportando, segundo o fog |
| `trafego.em` | string (ISO) | Fim da janela |
| `alertas[]` | array | Até 20 mudanças de status diagnosticadas pelo fog, **mais recentes primeiro** |
| `alertas[].posteId` / `codigo` / `bairro` | string | |
| `alertas[].statusAnterior` / `status` | `StatusPoste` | |
| `alertas[].motivo` | string | Ex.: `"sem telemetria há 31 s"`, `"consumo 2,10× a mediana do bairro"` |
| `alertas[].em` | string (ISO) | |
| `geradoEm` | string (ISO) | |

```json
{
  "modo": "camadas",
  "nuvem": { "brokerConectado": true },
  "edge": { "online": true },
  "fog": {
    "online": true,
    "gateways": [
      { "bairro": "Centro", "postes": 46, "online": 46 },
      { "bairro": "Setor Leste", "postes": 31, "online": 31 }
    ],
    "buffer": 0,
    "atualizadoEm": "2026-10-18T18:11:06.722Z"
  },
  "trafego": {
    "janelaS": 60,
    "entrada": { "msgs": 1586, "bytes": 237231 },
    "saida": { "msgs": 137, "bytes": 98834 },
    "reducaoMsgsPct": 91,
    "reducaoBytesPct": 58,
    "postes": { "total": 248, "online": 243 },
    "em": "2026-10-18T18:11:06.722Z"
  },
  "alertas": [
    {
      "posteId": "e383b828-8b99-4e4d-9468-c5d8d50fda7c",
      "codigo": "P-062",
      "bairro": "Setor Leste",
      "statusAnterior": "CONSUMO_ALTO",
      "status": "NORMAL",
      "motivo": "consumo 0,98× a mediana do bairro",
      "em": "2026-10-18T18:11:26.712Z"
    }
  ],
  "geradoEm": "2026-10-18T18:11:46.729Z"
}
```

(`gateways` traz os 9 bairros; o exemplo mostra 2.)

---

## `GET /`

Metadados da API (não aparece no Swagger).

```json
{
  "nome": "Iluminação Pública Inteligente — API",
  "cidade": "Itaguari, GO",
  "docs": "/docs",
  "openapi": "/docs-json",
  "tempoReal": "/tempo-real (Socket.IO)"
}
```

---

## WebSocket — tempo real

**Endpoint:** `ws://localhost:3000/tempo-real` — protocolo **Socket.IO** (não é
WebSocket puro; use `socket.io-client`). Namespace `/tempo-real`. Sem
autenticação. CORS liberado.

As atualizações ao vivo vêm da camada fog (eventos do sensor na hora; telemetria
e status pelo resumo de cada minuto e pelos alertas). O formato é o mesmo no modo
de reserva (`SIMULADOR_MODO=interno`, simulador embutido). Com
`SIMULADOR_ENABLED=false` o gateway ainda entrega o estado inicial e as mudanças
manuais de status (via `PATCH`).

### Salas

| Sala | Uso |
|---|---|
| `mapa` | Atualização de vários postes ao mesmo tempo (tela do mapa / KPIs) |
| `poste:<id>` | Consumo e luminosidade ao vivo de um poste (tela de detalhe) |

### Cliente → servidor

Todos respondem via **ack** (callback do `emit`).

| Evento | Payload | Ack | Efeito |
|---|---|---|---|
| `assinar:mapa` | — | `{ ok: true, total: 248 }` | Entra na sala `mapa`; dispara `mapa:estado` |
| `desassinar:mapa` | — | `{ ok: true }` | Sai da sala |
| `assinar:poste` | `{ "posteId": "<uuid>" }` | `{ ok: true }` ou `{ ok: false }` | Entra na sala do poste; dispara `poste:estado`. `posteId` inválido/inexistente → `{ ok: false }` + evento `erro` |
| `desassinar:poste` | `{ "posteId": "<uuid>" }` | `{ ok: true }` | Sai da sala |

### Servidor → cliente

#### `mapa:estado` — ao assinar o mapa

Estado inicial completo (todos os 248 postes, com coordenadas).

| Campo | Tipo | Descrição |
|---|---|---|
| `postes` | `PosteResumo[]` | Ordenados por `codigo` |
| `em` | string (ISO) | Timestamp do snapshot |

```json
{
  "postes": [
    {
      "id": "74bb5973-9bb3-4c89-8d9a-b7ba16d3c6b7",
      "codigo": "P-001",
      "endereco": "Avenida Goiás, 100",
      "bairro": "Centro",
      "latitude": -15.954802,
      "longitude": -49.590696,
      "status": "NORMAL",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.0521,
      "ultimaLeituraEm": "2026-09-10T16:12:45.103Z"
    }
  ],
  "em": "2026-09-10T16:12:47.169Z"
}
```

#### `postes:atualizados` — sala `mapa`, a cada tick / mudança

Somente os postes que mudaram no tick.

| Campo | Tipo | Descrição |
|---|---|---|
| `origem` | `"sensores"` \| `"telemetria"` \| `"status"` | O que disparou o lote |
| `postes` | `SnapshotPoste[]` | `posteId`, `codigo`, `status`, `luminosidadeAtual`, `consumoInstantaneoKw`, `ultimaLeituraEm` |
| `em` | string (ISO) | |

```json
{
  "origem": "sensores",
  "postes": [
    {
      "posteId": "558166c3-4945-46a8-bbb7-6d854cc57393",
      "codigo": "P-074",
      "status": "NORMAL",
      "luminosidadeAtual": 100,
      "consumoInstantaneoKw": 0.052,
      "ultimaLeituraEm": "2026-09-10T16:12:48.103Z"
    }
  ],
  "em": "2026-09-10T16:12:48.123Z"
}
```

#### `poste:estado` — ao assinar um poste

```json
{
  "poste": {
    "id": "74bb5973-9bb3-4c89-8d9a-b7ba16d3c6b7",
    "codigo": "P-001",
    "endereco": "Avenida Goiás, 100",
    "bairro": "Centro",
    "latitude": -15.954802,
    "longitude": -49.590696,
    "status": "NORMAL",
    "luminosidadeAtual": 50,
    "consumoInstantaneoKw": 0.0521,
    "ultimaLeituraEm": "2026-09-10T16:12:45.103Z"
  },
  "em": "2026-09-10T16:12:47.477Z"
}
```

#### `poste:atualizado` — sala `poste:<id>`, quando aquele poste muda

`SnapshotPoste` + `origem` + `em`.

```json
{
  "posteId": "74bb5973-9bb3-4c89-8d9a-b7ba16d3c6b7",
  "codigo": "P-001",
  "status": "NORMAL",
  "luminosidadeAtual": 50,
  "consumoInstantaneoKw": 0.0495,
  "ultimaLeituraEm": "2026-09-10T16:12:48.103Z",
  "origem": "telemetria",
  "em": "2026-09-10T16:12:48.171Z"
}
```

#### `erro`

```json
{ "evento": "assinar:poste", "mensagem": "posteId inválido." }
```

### Exemplo de cliente (Dart / `socket_io_client`)

```dart
final socket = io('http://localhost:3000/tempo-real',
    OptionBuilder().setTransports(['websocket']).build());

socket.onConnect((_) {
  socket.emitWithAck('assinar:mapa', null, ack: (res) => print(res)); // { ok: true, total: 248 }
});
socket.on('mapa:estado', (data) { /* data['postes'] -> lista inicial */ });
socket.on('postes:atualizados', (data) { /* aplicar deltas por posteId */ });

// tela de detalhe:
socket.emitWithAck('assinar:poste', {'posteId': id}, ack: (res) {});
socket.on('poste:estado', (data) {});
socket.on('poste:atualizado', (data) {});
```

---

## Notas do mock

- **Dados sintéticos.** `bun run db:seed` cria 248 postes de Itaguari, GO (231
  normal / 9 consumo alto / 5 falha / 3 manutenção). `bun run db:backfill` gera
  ~30 dias de telemetria/eventos + ~2 anos de agregados diários (para a
  comparação anual dos KPIs).
- **Fuso.** Todo cálculo de janela e todo `date_trunc` é em **UTC**. O único
  ponto que usa hora local é o início de `telemetria?periodo=hoje`.
- **Camadas (padrão no docker compose, `SIMULADOR_MODO=camadas`).** Os 248 postes
  rodam como dispositivos MQTT (edge) e decidem a luminosidade localmente (piso
  50 % ↔ pico 100 %). Os gateways por bairro (fog) diagnosticam `CONSUMO_ALTO` e
  `FALHA_OFFLINE` e sobem para a API um **resumo por minuto** (uma leitura média por
  poste), os eventos do sensor na hora e os alertas. `MANUTENCAO` só muda via
  `PATCH`, que também envia o comando até o poste.
- **Reserva (`SIMULADOR_MODO=interno`).** O simulador embutido na API faz o mesmo
  papel, com leituras a cada 10 s, no mesmo formato de resposta.
- **`consumoInstantaneoKw`** típico: ~0,05 kW no piso, ~0,10 kW no pico,
  ~0,10–0,25 kW quando `CONSUMO_ALTO`, `0` quando `FALHA_OFFLINE`/`MANUTENCAO`.
- Ver também: [`docs/contrato-api.md`](./docs/contrato-api.md),
  [`docs/requests.http`](./docs/requests.http), Swagger em `/docs`.
```
