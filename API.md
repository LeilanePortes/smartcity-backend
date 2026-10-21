# API — Iluminação Pública Inteligente

Referência completa dos endpoints e retornos, para uso como contexto no
desenvolvimento do frontend (app Flutter). Todos os exemplos são respostas reais
da API rodando com o seed + `bun run db:backfill` padrão.

- **Base URL:** `http://localhost:3000/api/v1` — API versionada; os caminhos abaixo são relativos a ela (ex.: `GET /postes` = `GET /api/v1/postes`). **Sem autenticação** por enquanto (só `GET /dispositivos/eu` e a ingestão usam o token do dispositivo)
- **Listagens:** paginadas e ordenáveis no mesmo padrão — ver [Paginação](#paginação)
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
- **OTA (firmware)**
  - [`GET /ota`](#get-ota)
  - [`POST /ota/implantacoes`](#post-otaimplantacoes)
  - [`POST /ota/reverter`](#post-otareverter)
- **Catálogo**
  - [Domínios](#get-catalogodominios--post-catalogodominios--get-catalogodominiosref)
  - [Perfis de dispositivo](#get-catalogoperfis--post-catalogoperfis--get-catalogoperfisref)
  - [Locais (sites)](#get-sites--post-sites--get-sitesref)
  - [Áreas](#get-sitesrefareas--post-sitesrefareas)
- **Dispositivos**
  - [`GET /dispositivos`](#get-dispositivos)
  - [`POST /dispositivos`](#post-dispositivos)
  - [Detalhe e atualização](#get-dispositivosref--patch-dispositivosref)
  - [Credenciais](#post-dispositivosrefcredenciais--delete-dispositivosrefcredenciais)
  - [`GET /dispositivos/eu`](#get-dispositivoseu)
- **Ingestão**
  - [`POST /ingestao`](#post-ingestao)
  - [`POST /ingestao/lote`](#post-ingestaolote)
  - [MQTT](#mqtt)
  - [`GET /ingestao/invalidas`](#get-ingestaoinvalidas)
- **Séries**
  - [`GET /series`](#get-series)
  - [`GET /dispositivos/:ref/telemetria`](#get-dispositivosreftelemetria)
  - [`GET /dispositivos/:ref/ultimos-valores`](#get-dispositivosrefultimos-valores)
- **Regras**
  - [Cadastro de regras](#get-regras--post-regras--get-regrasid--patch-regrasid--delete-regrasid)
  - [`GET /regras/:id/execucoes`](#get-regrasidexecucoes)
- **Alarmes**
  - [`GET /alarmes`](#get-alarmes)
  - [`GET /alarmes/:id`](#get-alarmesid)
  - [Reconhecer e resolver](#post-alarmesidreconhecer--post-alarmesidresolver)
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
| Item do catálogo / dispositivo inexistente | `404` | `"Dispositivo \"p-999\" não encontrado."` |
| Slug ou código repetido | `409` | `"Já existe o domínio \"energia\"."` |
| Token do dispositivo ausente, inválido ou revogado | `401` | `"Credencial ausente, inválida ou revogada."` |

---

## Paginação

Toda listagem aceita os **mesmos parâmetros** e responde no **mesmo envelope**
(RF-APP-07). Os filtros próprios de cada endpoint (`status`, `busca`, `periodo`…)
vêm junto.

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `pagina` | number (≥ 1) | `1` | Página |
| `tamanho` | number (1–500) | `50` (ranking: `5`) | Itens por página |
| `ordenar` | string | depende do endpoint | Campo de ordenação; prefixo `-` = decrescente (ex.: `-timestamp`). Campo fora da lista do endpoint → `400` com os aceitos |

```json
{ "itens": [ … ], "pagina": 1, "tamanho": 50, "total": 248, "totalPaginas": 5 }
```

Para trazer tudo de uma vez (ex.: os 248 postes do mapa): `?tamanho=500`.

---

## Postes

### `GET /postes`

Lista de postes para o mapa (PRD §5.1), paginada. Para o mapa inteiro, use `?tamanho=500`.

**Query params** (todos opcionais), além de `pagina` e `tamanho`:

| Param | Tipo | Descrição |
|---|---|---|
| `status` | `StatusPoste` | Filtra por status. Omitir = todos. |
| `busca` | string (≤ 120) | Casa `endereco` **ou** `bairro`, sem distinção de acento/caixa. |
| `ordenar` | string | `codigo` (padrão), `bairro`, `endereco`, `status`, `luminosidadeAtual`, `consumoInstantaneoKw`, `ultimaLeituraEm` |

**Resposta `200`:** envelope de [paginação](#paginação) com `itens: PosteResumo[]`.

```json
{
  "itens": [
    {
      "id": "08afd9da-5687-490c-90c0-b5b7ffb2ef78",
      "codigo": "P-001",
      "endereco": "Rua 10, 18",
      "bairro": "Centro",
      "latitude": -15.920691,
      "longitude": -49.606176,
      "status": "NORMAL",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.0528,
      "ultimaLeituraEm": "2026-10-20T21:33:07.456Z"
    },
    {
      "id": "a3e170ac-84a1-40e6-ae31-ce70fdb98d3a",
      "codigo": "P-002",
      "endereco": "Rua José Fernandes Carvalho, 403",
      "bairro": "Centro",
      "latitude": -15.920899,
      "longitude": -49.606047,
      "status": "NORMAL",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.0527,
      "ultimaLeituraEm": "2026-10-20T21:33:07.456Z"
    }
  ],
  "pagina": 1,
  "tamanho": 2,
  "total": 248,
  "totalPaginas": 124
}
```

Exemplos: `GET /postes?tamanho=500` (mapa) · `GET /postes?status=FALHA_OFFLINE` ·
`GET /postes?busca=centro&ordenar=-consumoInstantaneoKw`

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

Log do sensor 360° do poste, paginado; padrão: mais recentes primeiro (PRD §5.2).

**Path param:** `id` — uuid.

**Query params:** `pagina`, `tamanho` (padrão `50`) e `ordenar`: `-timestamp` (padrão), `timestamp`, `tipo`.

**Resposta `200`:** envelope de [paginação](#paginação); cada item de `itens`:

| Campo | Tipo | Nulo | Descrição |
|---|---|:--:|---|
| `id` | string (uuid) | não | |
| `tipo` | `TipoEventoSensor` | não | `VEICULO_DETECTADO` (sobe a 100 %) ou `RETORNO_AO_PISO` (volta a 50 %) |
| `sentido` | `SentidoVeiculo` | **sim** | Direção do veículo |
| `luminosidadeResultante` | number | não | `100` na detecção, `50` no retorno |
| `timestamp` | string (ISO) | não | |

```json
{
  "itens": [
    {
      "id": "3d648393-f483-4253-9a07-868d6d695c2b",
      "tipo": "RETORNO_AO_PISO",
      "sentido": "APROXIMANDO",
      "luminosidadeResultante": 50,
      "timestamp": "2026-10-20T21:33:27.619Z"
    },
    {
      "id": "fe1b93dc-6b59-4a7a-8286-6f635352ad62",
      "tipo": "VEICULO_DETECTADO",
      "sentido": "AFASTANDO",
      "luminosidadeResultante": 100,
      "timestamp": "2026-10-20T21:33:07.618Z"
    }
  ],
  "pagina": 1,
  "tamanho": 2,
  "total": 106,
  "totalPaginas": 53
}
```

**Erros:** `400` (id não-uuid, `tamanho` fora de 1–500 ou `ordenar` não aceito) · `404`.

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

Ranking dos postes de maior consumo no período (PRD §5.3), paginado.

**Query params:**

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `periodo` | `dia` \| `semana` \| `mes` \| `ano` | `mes` | Janela |
| `pagina` / `tamanho` | number | `1` / `5` | Página do ranking (padrão: top 5) |
| `ordenar` | string | `-consumoKwh` | `-consumoKwh` (maiores primeiro) ou `consumoKwh` |

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `periodo` | `PeriodoKpi` | Ecoa a query |
| `inicio` / `fim` | string (ISO) | Janela avaliada (N dias inteiros UTC) |
| `itens` | array | O ranking da página, na ordem pedida |
| `pagina` · `tamanho` · `total` · `totalPaginas` | number | Envelope de [paginação](#paginação); `total` = postes com consumo no período |
| `itens[].posicao` | number | Posição absoluta no ranking (1-based), também nas páginas seguintes |
| `itens[].posteId` | string (uuid) | |
| `itens[].codigo` | string | |
| `itens[].endereco` | string | |
| `itens[].bairro` | string | |
| `itens[].consumoKwh` | number | kWh no período |
| `itens[].custoReais` | number | `consumoKwh × 0,58` |

```json
{
  "periodo": "semana",
  "inicio": "2026-10-13T00:00:00.000Z",
  "fim": "2026-10-20T00:00:00.000Z",
  "itens": [
    { "posicao": 1, "posteId": "b86afe88-f381-44af-acfd-a3b9406f9e71", "codigo": "P-027", "endereco": "Rua 38, 158",  "bairro": "Centro",      "consumoKwh": 22.73, "custoReais": 13.19 },
    { "posicao": 2, "posteId": "571e892a-5576-465a-a48c-36294f5285a2", "codigo": "P-138", "endereco": "Rua Dez, 228", "bairro": "Setor Norte", "consumoKwh": 22.48, "custoReais": 13.04 }
  ],
  "pagina": 1,
  "tamanho": 2,
  "total": 248,
  "totalPaginas": 124
}
```

**Erros:** `400` (`periodo` inválido, `tamanho` fora de 1–500 ou `ordenar` não aceito).

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

## OTA (firmware)

### `GET /ota`

Atualização remota de firmware (OTA) com **grupo canário**: catálogo de versões,
distribuição atual da frota e a implantação em andamento (ou a última).
Requer `modo: "camadas"`. Para acompanhar, consulte a cada 5–10 s.

**Resposta `200`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `modo` | `"camadas"` \| `"interno"` | OTA só funciona em `camadas` |
| `catalogo[]` | `{ versao, descricao }` | Versões disponíveis. `2.5.0` estável; `3.0.0` e `3.0.1` têm defeito proposital (para a demonstração) |
| `versoesEmCampo` | `{ [versao]: number }` | Quantos postes rodam cada versão (último resumo do fog; `desconhecida` = sem reportar) |
| `criterios` | object | Critérios escritos antes de começar: `ondas` (% acumulado), `janelaS` (observação por onda), `limiarFalhaInstalacaoPct`, `limiarRazaoConsumo`, `minReportePct`, `maxExtensoes` |
| `implantacao` | object \| null | `null` se nenhuma foi iniciada desde que a API subiu |
| `implantacao.versao` / `versaoAnterior` | string | Versão nova / versão predominante quando começou |
| `implantacao.status` | `"EM_ANDAMENTO"` \| `"CONCLUIDA"` \| `"REVERTIDA"` | |
| `implantacao.iniciadaEm` / `encerradaEm` | string (ISO) \| null | |
| `implantacao.ondas` / `ondaAtual` / `ondaAtualPct` | number[] / number / number | Ex.: `[5,25,50,100]`, índice `1`, `25` |
| `implantacao.proximaAvaliacaoEm` | string (ISO) \| null | Próximo portão de decisão |
| `implantacao.aparelhos` | object | `elegiveis`, `enviados`, `instalados`, `falhas`, `pendentes`, `revertidos` |
| `implantacao.grupos.canario` / `controle` | string[] | Códigos dos postes: quem já está na versão nova × amostra que segue na antiga |
| `implantacao.metricas` | object \| null | Do último portão (`null` até o 1º portão): `canario` e `controle` (`{ aparelhos, reportaram, consumoNormalizadoMedio, consumoAltoPct }`), `referenciaConsumo`, `razaoConsumo`. `controle` vem `null` na onda de 100% (não sobra ninguém na versão antiga): aí `referenciaConsumo` é a linha de base medida no início da implantação. `consumoNormalizadoMedio`, `referenciaConsumo` e `razaoConsumo` podem vir `null` sem dados suficientes |
| `implantacao.falhas[]` | `{ codigo, motivo }` | Até 20 falhas de instalação |
| `implantacao.decisoes[]` | array | Histórico dos portões: `{ em, ondaPct, decisao, motivo, razaoConsumo }`, `decisao` = `AVANCAR` \| `ESTENDER` \| `CONCLUIR` \| `REVERTER` |

`consumoNormalizadoMedio` é o consumo em kW a 100% de luminosidade (independe de
pico/piso); `razaoConsumo` = canário ÷ controle.

```json
{
  "modo": "camadas",
  "catalogo": [
    { "versao": "2.4.1", "descricao": "Versão atualmente em campo (estável)." },
    { "versao": "2.5.0", "descricao": "Ajustes no sensor 360° e na reconexão MQTT (estável)." },
    { "versao": "3.0.0", "descricao": "Novo agrupamento de leituras para economizar banda — DEFEITO: ..." },
    { "versao": "3.0.1", "descricao": "Build corrompido — DEFEITO: falha no autoteste ..." }
  ],
  "versoesEmCampo": { "2.4.1": 231, "3.0.0": 13, "desconhecida": 4 },
  "criterios": {
    "ondas": [5, 25, 50, 100],
    "janelaS": 120,
    "limiarFalhaInstalacaoPct": 5,
    "limiarRazaoConsumo": 1.5,
    "minReportePct": 60,
    "maxExtensoes": 2
  },
  "implantacao": {
    "versao": "3.0.0",
    "versaoAnterior": "2.4.1",
    "status": "REVERTIDA",
    "iniciadaEm": "2026-10-18T18:43:21.000Z",
    "encerradaEm": "2026-10-18T18:45:26.000Z",
    "ondas": [5, 25, 50, 100],
    "ondaAtual": 0,
    "ondaAtualPct": 5,
    "proximaAvaliacaoEm": null,
    "aparelhos": { "elegiveis": 241, "enviados": 13, "instalados": 13, "falhas": 0, "pendentes": 0, "revertidos": 13 },
    "grupos": { "canario": ["P-012", "P-087", "P-140"], "controle": ["P-069", "P-175", "P-153"] },
    "metricas": {
      "canario": { "aparelhos": 13, "reportaram": 13, "consumoNormalizadoMedio": 0.1814, "consumoAltoPct": 100 },
      "controle": { "aparelhos": 13, "reportaram": 13, "consumoNormalizadoMedio": 0.0999, "consumoAltoPct": 0 },
      "referenciaConsumo": 0.0999,
      "razaoConsumo": 1.82
    },
    "falhas": [],
    "decisoes": [
      {
        "em": "2026-10-18T18:45:26.000Z",
        "ondaPct": 5,
        "decisao": "REVERTER",
        "motivo": "consumo do canário 1,82× o do grupo de controle (limite 1,50×)",
        "razaoConsumo": 1.82
      }
    ]
  }
}
```

(`grupos` traz todos os códigos; o exemplo mostra 3 de cada.)

### `POST /ota/implantacoes`

Inicia a distribuição de uma versão. Começa pelo canário (primeira onda, só
postes `NORMAL`, espalhados entre os bairros) e avança sozinha a cada portão.
Postes em `MANUTENCAO` ou `FALHA_OFFLINE` ficam de fora.

**Body:** `{ "versao": "2.5.0" }` (formato `X.Y.Z`).

**Respostas:** `201` com o mesmo corpo de `GET /ota` · `400` versão inválida ou
igual à atual · `409` já existe implantação em andamento, ou a API está no modo
`interno`.

### `POST /ota/reverter`

Decisão manual da equipe: para a implantação em andamento e reenvia a versão
anterior a quem instalou a nova. **Respostas:** `200` com o corpo de `GET /ota` ·
`409` se não houver implantação em andamento.

---

## Catálogo

O catálogo do inquilino segue a hierarquia **inquilino → local (site) → área →
dispositivo**, com **domínios** e **perfis de dispositivo** configuráveis
(RF-CEN-01 a 03). Tudo é dado, não código: um domínio novo é criado pela API.

O inquilino por enquanto é um só, a Prefeitura de Itaguari (`itaguari`). Na
subida, a API monta o catálogo inicial (`prisma/catalogo.ts`, idempotente):

- o domínio `iluminacao`;
- o perfil `luminaria-led`;
- os 9 bairros como locais, com o polígono de cada um;
- as ruas com postes como áreas, com o traçado real;
- **um dispositivo por poste** (código `p-001`…`p-248`, ligado pelo `posteId`).

**Referências nas URLs e nos corpos:** domínios, perfis, locais e áreas aceitam o
`id` (uuid) ou o `slug`; dispositivos aceitam o `id` ou o `codigo`.

**Slug:** letras minúsculas, números, `-` e `_` (ex.: `recursos_hidricos`). Slug
repetido → `409`.

**Listagens** (`GET /catalogo/dominios`, `/catalogo/perfis`, `/sites`,
`/sites/:ref/areas`): paginadas, com `busca` (slug ou nome) e `ordenar` ∈ `slug`,
`nome`, `criadoEm` (padrão `slug`).

### `GET /catalogo/dominios` · `POST /catalogo/dominios` · `GET /catalogo/dominios/:ref`

**Body do POST:** `{ "slug": "energia", "nome": "Energia", "descricao": "..." }`
(`descricao` opcional). **Respostas:** `201` · `400` slug inválido · `409` slug já existe.

```json
{
  "itens": [
    {
      "id": "483934d0-0d1f-4ea3-aa9e-ec1cda64dcf2",
      "slug": "iluminacao",
      "nome": "Iluminação pública",
      "descricao": "Telegestão e dimerização das luminárias da cidade.",
      "criadoEm": "2026-10-21T19:49:09.706Z",
      "atualizadoEm": "2026-10-21T19:49:09.706Z",
      "dispositivos": 248
    }
  ],
  "pagina": 1, "tamanho": 50, "total": 1, "totalPaginas": 1
}
```

### `GET /catalogo/perfis` · `POST /catalogo/perfis` · `GET /catalogo/perfis/:ref`

Perfil de dispositivo (RF-CEN-02): grandezas com unidade [UCUM](https://ucum.org)
e faixa válida, e o intervalo esperado de envio.

- O perfil não pertence a um domínio, então é **reutilizável entre projetos**.
- Uma medida fora da faixa não é descartada: é **marcada como suspeita**. Quem
  aplica a marca é a ingestão, com a função `avaliarMedidas`.

| Campo | Tipo | Descrição |
|---|---|---|
| `grandezas[]` | `{ grandeza, unidade, minimo?, maximo? }` | `grandeza` em minúsculas com `_`; mínimo ≤ máximo; sem repetir |
| `intervaloEnvioS` | int (1–604800) | Intervalo esperado entre mensagens, em segundos |
| `limiteOfflineS` | int (só na resposta) | `intervaloEnvioS × 3`: tempo sem mensagens até o dispositivo ficar offline |
| `dispositivos` | int (só na resposta) | Quantos dispositivos usam o perfil |

```json
{
  "id": "53588b5a-53a2-4968-805a-8d90e911ed52",
  "slug": "luminaria-led",
  "nome": "Luminária LED com sensor 360°",
  "descricao": "Controlador de poste: potência e luminosidade. A nuvem recebe a telemetria pelo resumo do fog, a cada 60 s.",
  "grandezas": [
    { "grandeza": "potencia", "unidade": "kW", "minimo": 0, "maximo": 0.25 },
    { "grandeza": "luminosidade", "unidade": "%", "minimo": 0, "maximo": 100 }
  ],
  "intervaloEnvioS": 60,
  "criadoEm": "2026-10-21T19:49:09.711Z",
  "atualizadoEm": "2026-10-21T19:49:09.711Z",
  "limiteOfflineS": 180,
  "dispositivos": 248
}
```

### `GET /sites` · `POST /sites` · `GET /sites/:ref`

Locais (bairro na cidade, fazenda no campo), com geometria **GeoJSON** em `[lon, lat]`.

- **Body do POST:** `{ slug, nome, tipo?, geometria? }`. O `tipo` é livre (padrão
  `bairro`).
- **`geometria`** aceita `Point`, `MultiPoint`, `LineString`, `MultiLineString`,
  `Polygon` ou `MultiPolygon`. Uma geometria inválida devolve `400`.
- **Na resposta**, `areas` e `dispositivos` trazem as contagens.

```json
{
  "id": "8550b724-4a1b-4a19-9f06-28162bdc15a2",
  "slug": "centro",
  "nome": "Centro",
  "tipo": "bairro",
  "geometria": {
    "type": "Polygon",
    "coordinates": [[[-49.604582, -15.920801], [-49.604606, -15.920536], "...", [-49.604582, -15.920801]]]
  },
  "criadoEm": "2026-10-21T19:49:09.718Z",
  "atualizadoEm": "2026-10-21T19:50:54.497Z",
  "areas": 12,
  "dispositivos": 53
}
```

### `GET /sites/:ref/areas` · `POST /sites/:ref/areas`

Áreas de um local (rua, praça, talhão, silo), com geometria.

- **Body do POST:** o mesmo dos locais. O `tipo` padrão é `area`.
- **Ruas criadas na subida:** são do tipo `rua` e trazem o traçado real, um
  `MultiLineString`.

```json
{
  "itens": [
    {
      "id": "2f915be3-a647-47f1-b98c-015026f8cfb1",
      "slug": "avenida-goias",
      "nome": "Avenida Goiás",
      "tipo": "rua",
      "geometria": { "type": "MultiLineString", "coordinates": [[[-49.606362, -15.922239], [-49.606496, -15.921187], "..."]] },
      "criadoEm": "2026-10-21T19:49:09.770Z",
      "atualizadoEm": "2026-10-21T19:50:54.580Z",
      "site": { "id": "8550b724-4a1b-4a19-9f06-28162bdc15a2", "slug": "centro", "nome": "Centro" },
      "dispositivos": 9
    }
  ],
  "pagina": 1, "tamanho": 1, "total": 12, "totalPaginas": 12
}
```

---

## Dispositivos

Cadastro com perfil, domínio, local, área, fabricante, firmware e inquilino
(RF-DIS-01), credencial única por dispositivo (RF-DIS-02) e online/offline pelo
intervalo do perfil (RF-DIS-06).

### `Dispositivo`

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (uuid) | |
| `codigo` | string | Único no inquilino; é o `{dispositivo}` do tópico MQTT. Não muda depois do cadastro |
| `nome` | string | |
| `inquilino` / `dominio` / `site` | `{ id, slug, nome }` | |
| `perfil` | `{ id, slug, nome }` | |
| `area` | `{ id, slug, nome }` \| null | |
| `fabricante` / `firmware` | string | O firmware das luminárias acompanha o que o campo relata, inclusive depois de um OTA |
| `modelo` | string \| null | |
| `geo` | GeoJSON `Point` \| null | `[lon, lat]` |
| `posteId` | string \| null | Poste ligado (só nos dispositivos de iluminação) |
| `conexao` | `{ online, ultimaMensagemEm, limiteOfflineS }` | `online` = última mensagem há no máximo `limiteOfflineS` (3 × o intervalo do perfil) |
| `credencial` | `{ ativa: true, prefixo, emitidaEm }` \| `{ ativa: false }` | Nunca traz o token |
| `criadoEm` / `atualizadoEm` | string (ISO) | |

### `GET /dispositivos`

Paginado. Filtros (todos opcionais):

- `dominio`, `perfil`, `site` e `area`: `id` ou `slug`;
- `conexao`: `online` ou `offline`;
- `busca`: procura no código ou no nome.

`ordenar` ∈ `codigo` (padrão), `nome`, `firmware`, `criadoEm`, `ultimaMensagemEm`.

```json
{
  "itens": [
    {
      "id": "0d228b7f-c654-40e9-90ef-7a93079b28b1",
      "codigo": "p-001",
      "nome": "Luminária P-001",
      "inquilino": { "id": "398b70e4-dfaf-4051-8dcc-1f288f2c8141", "slug": "itaguari", "nome": "Prefeitura de Itaguari" },
      "dominio": { "id": "483934d0-0d1f-4ea3-aa9e-ec1cda64dcf2", "slug": "iluminacao", "nome": "Iluminação pública" },
      "perfil": { "id": "53588b5a-53a2-4968-805a-8d90e911ed52", "slug": "luminaria-led", "nome": "Luminária LED com sensor 360°" },
      "site": { "id": "8550b724-4a1b-4a19-9f06-28162bdc15a2", "slug": "centro", "nome": "Centro" },
      "area": { "id": "6fe54801-b517-4790-a281-0b4578a98718", "slug": "rua-10", "nome": "Rua 10" },
      "fabricante": "Simulador SmartCity (edge)",
      "modelo": "LUM-LED-100W",
      "firmware": "2.4.1",
      "geo": { "type": "Point", "coordinates": [-49.606176, -15.920691] },
      "posteId": "08afd9da-5687-490c-90c0-b5b7ffb2ef78",
      "conexao": { "online": true, "ultimaMensagemEm": "2026-10-21T19:52:11.263Z", "limiteOfflineS": 180 },
      "credencial": { "ativa": false },
      "criadoEm": "2026-10-21T19:49:09.926Z",
      "atualizadoEm": "2026-10-21T19:49:09.926Z"
    }
  ],
  "pagina": 1, "tamanho": 1, "total": 53, "totalPaginas": 53
}
```

### `POST /dispositivos`

Cadastra o dispositivo e **emite a credencial**.

- **Campos obrigatórios:** `codigo`, `nome`, `dominio`, `perfil`, `site`,
  `fabricante` e `firmware`.
- **Campos opcionais:** `area` (precisa ser do mesmo local), `modelo`,
  `latitude` e `longitude`.
- **O `credencial.token` aparece só nesta resposta.** No banco fica apenas o hash
  SHA-256.

**Respostas:**

- `201`: cadastro feito;
- `400`: campo inválido, referência que não existe, área de outro local ou código
  reservado (`eu`);
- `409`: código já existe.

```json
{
  "dispositivo": { "codigo": "medidor-centro", "...": "mesmo formato de Dispositivo" },
  "credencial": {
    "token": "dsp_b93557b21ba7_FosgDz5O07JUU96bgBYZEHBglsLVpIS_",
    "prefixo": "b93557b21ba7",
    "emitidaEm": "2026-10-21T19:51:18.665Z",
    "aviso": "Guarde este token agora: ele não é mostrado de novo. Se perder, emita outro (o anterior é revogado)."
  }
}
```

### `GET /dispositivos/:ref` · `PATCH /dispositivos/:ref`

Detalhe e atualização.

- O `PATCH` aceita os mesmos campos do cadastro, menos o `codigo`.
- Trocar o `site` sem informar a `area` remove a área.
- `"area": null` também remove a área.

### `POST /dispositivos/:ref/credenciais` · `DELETE /dispositivos/:ref/credenciais`

- **`POST`** emite um token novo e **revoga o anterior**: cada dispositivo tem uma
  só credencial ativa. Resposta `201`: `{ dispositivo, token, prefixo, emitidaEm,
  anterioresRevogadas, aviso }`.
- **`DELETE`** revoga a credencial ativa. Resposta `200`: `{ dispositivo,
  revogadas, revogadaEm }`. Se não houver credencial ativa, devolve `404`.

### `GET /dispositivos/eu`

O próprio dispositivo consulta o seu cadastro com o cabeçalho
`Authorization: Bearer <token>`.

- **`200`:** o `Dispositivo`.
- **`401`:** token ausente, inválido ou **revogado**. A revogação vale na hora,
  já na conexão seguinte.

É a mesma checagem que a ingestão por HTTP vai usar.

---

## Ingestão

Pipeline no padrão **Pipes and Filters**: **receber → autenticar → validar →
deduplicar → ordenar → enriquecer → publicar**. HTTP, lote e MQTT passam pelo
mesmo caminho.

- **Validar:** usa o JSON Schema da versão da mensagem
  (`GET /contratos`). O que for recusado vai para a
  [fila de inválidas](#get-ingestaoinvalidas), com a etapa e o motivo (RF-ING-06).
- **Deduplicar:** uma mensagem com o mesmo `id_mensagem` é gravada uma única vez,
  mesmo que chegue por canais ou requisições diferentes (RF-ING-08).
- **Ordenar:** cada medição é gravada pela **hora da medição** (`timestamp`). Um
  dado atrasado entra na posição certa do histórico (RF-ING-04).
  - Ele é marcado `atrasada: true` quando chega depois do limite de offline do
    perfil (3 intervalos), para não disparar alarme como se fosse atual.
  - Ele não sobrescreve um último valor mais novo.
- **Enriquecer:** a mensagem gravada leva `cadastro: { inquilino, dominio, site,
  area, perfil }` (RF-PRO-01).
  - Cada medida é convertida para a unidade do perfil (ex.: `W` → `kW`, `cm` → `m`,
    `[degF]` → `Cel`).
  - Uma medida fora da faixa do perfil, de grandeza não prevista ou de unidade
    incompatível é gravada com `suspeita: true` e o `motivo`.
- **Publicar:** a mensagem vira série temporal ([`GET /series`](#get-series)),
  atualiza o [último valor](#get-dispositivosrefultimos-valores) e gera um evento
  interno para o motor de regras.

**Os postes continuam chegando pelo resumo do fog**, e o histórico deles também
aparece nas séries.

### `POST /ingestao`

Uma mensagem canônica por HTTP (RF-ING-02).

- **Cabeçalho:** `Authorization: Bearer <token do dispositivo>` (o token sai em
  [`POST /dispositivos`](#post-dispositivos)).
- **Body:** a mensagem canônica, de tipo `telemetria`, `evento` ou `estado`.

```json
{
  "versao": "1.0",
  "id_mensagem": "0b5c3a2e-6f0d-4a8e-9a57-2d1f1b6c9e41",
  "dispositivo": "medidor-centro",
  "tipo": "telemetria",
  "timestamp": "2026-10-21T20:00:00Z",
  "medidas": [
    { "grandeza": "potencia", "valor": 12400, "unidade": "W" },
    { "grandeza": "tensao", "valor": 260, "unidade": "V" }
  ]
}
```

| Status | Corpo | Quando |
|---|---|---|
| `202` | `{ "status": "aceita", "id_mensagem": "…", "atrasada": false }` | Gravada |
| `202` | `{ "status": "duplicada", … }` | Esse `id_mensagem` já foi gravado |
| `400` | `{ "message": "fora do JSON Schema", "etapa": "validar", "erros": ["/timestamp must match format \"date-time\"", "…"] }` | Fora do schema, versão desconhecida, `tipo: "comando"` ou `timestamp` mais de 5 min no futuro |
| `401` | `"Credencial ausente, inválida ou revogada."` | Token ausente, errado ou revogado |
| `403` | `{ "message": "mensagem do dispositivo \"x\" enviada com a credencial de \"y\"", "etapa": "autenticar" }` | A mensagem é de outro dispositivo |

### `POST /ingestao/lote`

Lote de até **5.000** mensagens, com resultado por mensagem (RF-ING-03).

- **Cabeçalho:** o mesmo do envio único.
- **Body:** um array de mensagens ou `{ "mensagens": [...] }`, até 10 MB.
- **As válidas são gravadas mesmo que outras sejam recusadas.**
- Se o lote passar de 5.000 mensagens, a API devolve `413`.

```json
{
  "total": 5000,
  "aceitas": 4997,
  "duplicadas": 0,
  "recusadas": 3,
  "resultados": [
    { "indice": 0, "id_mensagem": "…", "status": "aceita", "atrasada": false },
    { "indice": 10, "id_mensagem": "…", "status": "recusada", "etapa": "validar",
      "motivo": "fora do JSON Schema", "erros": ["/timestamp must match format \"date-time\""] }
  ]
}
```

(`resultados` traz uma linha por mensagem, na ordem enviada; o exemplo mostra 2.)

Medido com a stack local: 5.000 mensagens em ~1,9 s. Reenviar o mesmo lote devolve
`aceitas: 0, duplicadas: 4997`.

### MQTT

O pipeline assina, no broker da nuvem (`localhost:1884`), os tópicos
`itaguari/{site}/{dominio}/{dispositivo}/{telemetria|evento|estado}`. Uma mensagem
é recusada e vai para a fila de inválidas quando:

- o dispositivo não está cadastrado ou está sem credencial ativa (revogada);
- o tópico não confere com o cadastro (local, domínio, código e tipo).

Medido com a stack local: a mensagem fica gravada em ~0,2 s.

### `GET /ingestao/invalidas`

Fila de mensagens inválidas (DLQ). É paginada.

- **Filtros:** `canal` (`http`, `lote` ou `mqtt`), `etapa` (`autenticar`,
  `validar` ou `enriquecer`) e `dispositivo`.
- **`ordenar`:** `recebidoEm`, `canal` ou `etapa` (padrão `-recebidoEm`).

```json
{
  "itens": [
    {
      "id": "…",
      "recebidoEm": "2026-10-21T23:33:02.120Z",
      "canal": "mqtt",
      "etapa": "autenticar",
      "motivo": "tópico não confere com o cadastro (esperado itaguari/centro/energia/medidor-centro/telemetria)",
      "erros": ["tópico não confere com o cadastro (…)"],
      "dispositivo": "medidor-centro",
      "idMensagem": "…",
      "topico": "itaguari/setor-sul/energia/medidor-centro/telemetria",
      "payload": { "versao": "1.0", "…": "mensagem como chegou" }
    }
  ],
  "pagina": 1, "tamanho": 50, "total": 1, "totalPaginas": 1
}
```

---

## Séries

Séries temporais (RF-DAD-01) e último valor (RF-DAD-02).

- As séries juntam as medições do pipeline com o **histórico dos postes**
  (`potencia` em kW e `luminosidade` em %), em qualquer domínio.
- **Janela:** `inicio` e `fim` em ISO 8601. Se omitidos, valem as últimas 24 h.
  O período máximo é de 400 dias.
- **`intervalo`:** `bruto` (cada medição, até 10.000 pontos), `1m`, `5m`, `15m`,
  `1h` ou `1d`.
- **`intervalo=auto`** (o padrão) escolhe pelo tamanho do período: bruto até 2 h,
  `5m` até 2 dias, `1h` até 31 dias e `1d` acima disso.

Ponto agregado: `{ inicio, media, minimo, maximo, amostras, suspeitas }`.
Ponto bruto: `{ em, valor, suspeita, dispositivoId }`.

### `GET /series`

`grandeza` é obrigatória. Filtros que podem ser combinados: `dispositivo`, `area`,
`site` e `dominio` (cada um por `id` ou slug/código). Sem filtro, a consulta
cobre o inquilino todo.

```json
// GET /series?grandeza=potencia&area=avenida-goias&dominio=iluminacao&intervalo=1h
{
  "grandeza": "potencia",
  "filtros": { "dispositivo": null, "area": "avenida-goias", "site": null, "dominio": "iluminacao" },
  "inicio": "2026-10-20T23:33:00.000Z",
  "fim": "2026-10-21T23:33:00.000Z",
  "intervalo": "1h",
  "unidades": ["kW"],
  "truncada": false,
  "pontos": [
    { "inicio": "2026-10-21T23:00:00.000Z", "media": 0.0546, "minimo": 0.0473, "maximo": 0.0901, "amostras": 463, "suspeitas": 0 }
  ]
}
```

### `GET /dispositivos/:ref/telemetria`

Histórico de um dispositivo. Aceita `grandeza` (se omitida, traz todas as do
perfil), `inicio`, `fim` e `intervalo`. Medido com a stack local: 24 h de um
dispositivo em ~0,02 s.

```json
{
  "dispositivo": { "id": "…", "codigo": "p-001", "nome": "Luminária P-001" },
  "inicio": "…", "fim": "…", "intervalo": "5m",
  "series": [
    { "grandeza": "potencia", "inicio": "…", "fim": "…", "intervalo": "5m", "unidades": ["kW"], "truncada": false, "pontos": [ … ] },
    { "grandeza": "luminosidade", "…": "…" }
  ]
}
```

### `GET /dispositivos/:ref/ultimos-valores`

Último valor de cada grandeza, **sem consultar o histórico**. Nas luminárias, ele
vem do estado atual do poste.

```json
{
  "dispositivo": { "id": "0d228b7f-c654-40e9-90ef-7a93079b28b1", "codigo": "p-001", "nome": "Luminária P-001" },
  "valores": [
    { "grandeza": "luminosidade", "valor": 50, "unidade": "%", "medidoEm": "2026-10-21T23:32:10.394Z", "suspeita": false },
    { "grandeza": "potencia", "valor": 0.0494, "unidade": "kW", "medidoEm": "2026-10-21T23:32:10.394Z", "suspeita": false }
  ]
}
```

---

## Regras

Regras **condição → ação** configuradas pela API (RF-PRO-02 e 03). O motor avalia
cada mensagem aceita pelo pipeline no mesmo instante: o alarme abriu em ~0,1 s
nos testes, e o critério pede até 3 s.

**Condições:**

| `condicao` | Dispara quando |
|---|---|
| `{ "tipo": "limite", "grandeza": "temperatura", "operador": ">", "valor": 30 }` | Uma medição atende ao limite. `operador` ∈ `>` `>=` `<` `<=` `==` `!=` |
| `{ …, "duracaoS": 1800 }` | **Janela de tempo:** o limite vale por 30 min seguidos (ex.: "temperatura > 30 °C por 30 minutos"). Uma medição fora do limite reinicia a contagem |
| `{ "tipo": "ausencia", "duracaoS": 120 }` | O dispositivo fica 120 s sem mandar nada. É verificado a cada 15 s e vale também para os postes |

**Escopo** (opcional, combinável): `dominio`, `site`, `area` (área geográfica do
catálogo), `perfil` e `dispositivo`, por `id` ou slug/código. Sem escopo, a regra
vale para o inquilino todo.

**Comportamento:**

- **Cada episódio dispara uma vez só.** Enquanto a condição continuar valendo,
  não abre outro alarme nem repete as ações.
- **A regra resolve o alarme sozinha** quando a condição deixa de valer
  (`resolvidoPor: "automático"`).
- **Medição atrasada não dispara** (RF-ING-04): ela entra no histórico, mas não
  gera alarme como se fosse atual.

**Ações** (`acoes`, executadas na ordem, sempre com o alarme primeiro):

| Ação | O que faz |
|---|---|
| `{ "tipo": "alarme" }` | Abre um alarme com a `severidade` da regra (`INFO`, `AVISO` ou `CRITICO`) |
| `{ "tipo": "notificar", "email": "operador@itaguari.local" }` | Envia e-mail. Na demonstração vai para o Mailpit, cuja caixa fica em http://localhost:8025 |
| `{ "tipo": "comando", "nome": "ligar_ventilacao", "parametros": { … } }` | Publica um comando canônico em `itaguari/{site}/{dominio}/{dispositivo}/comando` |
| `{ "tipo": "webhook", "url": "https://…", "tentativas": 3 }` | Faz um POST JSON. Se o destino falhar, tenta de novo com espera crescente (1 s, 2 s, 4 s…); por padrão são 3 tentativas |
| `{ "tipo": "publicar", "topico": "itaguari/alarmes/criticos" }` | Publica o resumo do disparo num tópico MQTT do broker da nuvem |

O webhook, o e-mail e a publicação recebem o mesmo corpo:
`{ regra, alarmeId, severidade, titulo, detalhe, dispositivo, site, dominio, grandeza, valor, ocorridoEm }`.

### `GET /regras` · `POST /regras` · `GET /regras/:id` · `PATCH /regras/:id` · `DELETE /regras/:id`

- **Listagem:** paginada, com o filtro `ativa`. `ordenar` ∈ `nome`, `criadoEm`,
  `severidade`.
- **`PATCH`:** aceita qualquer campo; `{ "ativa": false }` pausa a regra e `null`
  num campo de escopo remove o filtro.
- **`DELETE`:** apaga a regra; os alarmes dela continuam no histórico.
- **Erros:** condição ou ação inválida → `400` com o motivo (ex.:
  `"condicao.operador deve ser um de: > >= < <= == !="`).

```json
// POST /regras
{
  "nome": "Temperatura do silo",
  "dominio": "armazenagem",
  "condicao": { "tipo": "limite", "grandeza": "temperatura", "operador": ">", "valor": 30, "duracaoS": 1800 },
  "severidade": "CRITICO",
  "acoes": [
    { "tipo": "alarme" },
    { "tipo": "notificar", "email": "operador@itaguari.local" },
    { "tipo": "webhook", "url": "https://rotas.exemplo/alarmes" }
  ]
}
// → 201
{
  "id": "7ba431bb-d442-41d6-938f-6a0af5289cd1",
  "nome": "Temperatura do silo",
  "descricao": null,
  "ativa": true,
  "escopo": {
    "dominio": { "id": "…", "slug": "armazenagem", "nome": "Armazenagem" },
    "site": null, "area": null, "perfil": null, "dispositivo": null
  },
  "condicao": { "tipo": "limite", "grandeza": "temperatura", "operador": ">", "valor": 30, "duracaoS": 1800 },
  "severidade": "CRITICO",
  "acoes": [ { "tipo": "alarme" }, { "tipo": "notificar", "email": "operador@itaguari.local" }, { "tipo": "webhook", "url": "https://rotas.exemplo/alarmes" } ],
  "alarmesAbertos": 0,
  "criadoEm": "…",
  "atualizadoEm": "…"
}
```

### `GET /regras/:id/execucoes`

Ações executadas pela regra. É paginada, dos mais recentes para os mais antigos:
`{ id, regraId, alarmeId, tipo, destino, status ("ok" | "falha"), tentativas, erro, criadoEm, concluidoEm }`.

---

## Alarmes

Alarmes com severidade e **ciclo de vida ATIVO → RECONHECIDO → RESOLVIDO**
(RF-PRO-05).

- **Duplicados:** enquanto um alarme está aberto (ativo ou reconhecido), o mesmo
  problema no mesmo dispositivo não abre outro.
- **`origem: "regra"`:** veio de uma regra da central.
- **`origem: "borda"`:** veio de um diagnóstico do fog (poste em falha/offline,
  com severidade `CRITICO`, ou com consumo alto, com `AVISO`). Ele fecha sozinho
  quando o poste volta ao normal.
- **`ocorridoEm`** é **quando aconteceu**: a hora da medição ou do diagnóstico na
  borda, mesmo que tenha chegado depois de uma desconexão. **`criadoEm`** é
  quando a central registrou.
- **Tempo real:** cada mudança é enviada a todos os conectados no evento
  Socket.IO `alarme:atualizado`.

### `GET /alarmes`

Paginado.

- **Filtros:** `status`, `severidade`, `origem` (`regra` ou `borda`),
  `dispositivo` (id ou código) e `regra` (id).
- **`ordenar`:** `ocorridoEm` (padrão `-ocorridoEm`), `criadoEm`, `severidade` ou
  `status`.

```json
{
  "itens": [
    {
      "id": "300f847c-6ceb-40ec-967b-adc1fb5d8560",
      "origem": "regra",
      "severidade": "CRITICO",
      "status": "RECONHECIDO",
      "titulo": "Temperatura do silo: temperatura > 30 Cel",
      "detalhe": "temperatura = 32 Cel por 60 s seguidos",
      "grandeza": "temperatura",
      "valor": 32,
      "ocorridoEm": "2026-10-21T23:48:59.419Z",
      "criadoEm": "2026-10-21T23:48:59.530Z",
      "reconhecidoEm": "2026-10-21T23:49:10.002Z",
      "reconhecidoPor": "leilane",
      "resolvidoEm": null,
      "resolvidoPor": null,
      "comentario": "Equipe a caminho",
      "dispositivo": { "id": "…", "codigo": "silo-02", "nome": "Silo 2" },
      "regra": { "id": "7ba431bb-d442-41d6-938f-6a0af5289cd1", "nome": "Temperatura do silo" }
    }
  ],
  "pagina": 1, "tamanho": 50, "total": 1, "totalPaginas": 1
}
```

### `GET /alarmes/:id`

O alarme e as ações que ele gerou (`execucoes[]`: `{ tipo, destino, status,
tentativas, erro, criadoEm, concluidoEm }`).

### `POST /alarmes/:id/reconhecer` · `POST /alarmes/:id/resolver`

- **Body (opcional):** `{ "por": "leilane", "comentario": "Equipe a caminho" }`.
  Até o login existir, quem fez vem no corpo; o padrão é `"operador"`.
- **`reconhecer`:** só funciona num alarme `ATIVO`.
- **`resolver`:** funciona num alarme `ATIVO` ou `RECONHECIDO`.
- **Respostas:** `200` com o alarme · `409` se a transição não for permitida ·
  `404` se o alarme não existir.

---

## `GET /`

Metadados da API (não aparece no Swagger). É a única rota fora do prefixo `/api/v1`.

```json
{
  "nome": "Iluminação Pública Inteligente — API",
  "cidade": "Itaguari, GO",
  "api": "/api/v1",
  "docs": "/docs",
  "openapi": "/docs-json",
  "contratos": "/api/v1/contratos",
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

#### `alarme:atualizado` — todos os conectados, quando um alarme abre, é reconhecido ou é resolvido

Mesmo formato de um item de [`GET /alarmes`](#get-alarmes). Não precisa assinar sala.

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
