# Contrato da API — Iluminação Pública Inteligente

Referência de payloads para o time mobile (Flutter). Todos os exemplos abaixo
foram capturados da API rodando com o seed + `db:backfill` padrão.

- **Base URL:** `http://localhost:3000` (sem prefixo, sem autenticação)
- **Swagger / OpenAPI:** `GET /docs` (UI) · `GET /docs-json` (JSON)
- **WebSocket:** `ws://localhost:3000/tempo-real` (Socket.IO) — ver o fim deste doc
- **Datas:** ISO 8601 em UTC (`2026-09-10T16:04:34.453Z`)
- **Números:** kWh e kW já arredondados; custo em reais

## Convenções de erro

| Situação | HTTP | Corpo |
|---|---|---|
| Query/param/body inválido | `400` | `{ "message": [ "..." ], "error": "Bad Request", "statusCode": 400 }` |
| `:id` fora do formato UUID | `400` | idem |
| Poste inexistente | `404` | `{ "message": "Poste <id> não encontrado.", "error": "Not Found", "statusCode": 404 }` |

Enums:

- `StatusPoste`: `NORMAL` · `CONSUMO_ALTO` · `FALHA_OFFLINE` · `MANUTENCAO`
- `TipoEventoSensor`: `VEICULO_DETECTADO` · `RETORNO_AO_PISO`
- `SentidoVeiculo`: `APROXIMANDO` · `AFASTANDO`

---

## Postes

### `GET /postes`

Lista para o mapa. Query (todos opcionais):

| Param | Valores | Efeito |
|---|---|---|
| `status` | um `StatusPoste` | filtra por status |
| `busca` | texto (≤120) | casa rua **ou** bairro, sem distinção de acento/caixa |

```jsonc
// GET /postes?status=CONSUMO_ALTO
{
  "total": 9,
  "postes": [
    {
      "id": "4d1fc7c5-a83d-44dd-ba74-c137bee57a3b",
      "codigo": "P-009",
      "endereco": "Rua Itaguari, 136",
      "bairro": "Centro",
      "latitude": -15.954637,
      "longitude": -49.589536,
      "status": "CONSUMO_ALTO",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.111,
      "ultimaLeituraEm": "2026-09-10T15:54:50.923Z"
    }
    // ...
  ]
}
```

### `GET /postes/:id`

Detalhe do poste. `chamadoAberto` é `true` sempre que `status === "FALHA_OFFLINE"`.

```jsonc
// GET /postes/27ffac97-e509-4d7f-b4b3-6a66a7529ec4
{
  "id": "27ffac97-e509-4d7f-b4b3-6a66a7529ec4",
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
  "ultimaLeituraEm": "2026-09-10T14:38:37.070Z",
  "criadoEm": "2026-09-10T15:54:51.536Z",
  "atualizadoEm": "2026-09-10T15:54:51.536Z",
  "chamadoAberto": true
}
```

### `GET /postes/:id/telemetria?periodo=hoje|semana|mes`

Histórico de consumo do poste. `periodo` default `hoje`. `serie` tem bucket **por
hora** em `hoje` e **por dia** em `semana`/`mes`.

`economiaPct` = quanto se gastou a menos frente a operar sempre em 100% pelas
mesmas horas em que a luz esteve acesa.

```jsonc
// GET /postes/4d1fc7c5-.../telemetria?periodo=semana
{
  "posteId": "4d1fc7c5-a83d-44dd-ba74-c137bee57a3b",
  "periodo": "semana",
  "inicio": "2026-09-03T00:00:00.000Z",
  "fim": "2026-09-10T16:04:34.385Z",
  "resumo": {
    "consumoTotalKwh": 24.42,
    "custoTotalReais": 14.16,
    "mediaKw": 0.1271,
    "picoKw": 0.239,
    "economiaPct": 42.7
  },
  "serie": [
    { "inicio": "2026-09-03T00:00:00.000Z", "consumoKwh": 3.299, "mediaKw": 0.1375, "picoKw": 0.2375 }
    // ... um item por dia (ou por hora em periodo=hoje)
  ]
}
```

### `GET /postes/:id/eventos?limite=`

Log do sensor 360°, mais recentes primeiro. `limite` 1–200 (default 50).
`sentido` pode ser `null`.

```jsonc
// GET /postes/4d1fc7c5-.../eventos?limite=3
[
  {
    "id": "601391ee-c5f0-4e9e-963d-ee90a48d0040",
    "tipo": "RETORNO_AO_PISO",
    "sentido": "APROXIMANDO",
    "luminosidadeResultante": 50,
    "timestamp": "2026-09-10T13:20:11.323Z"
  },
  {
    "id": "6d0fb39e-52a8-4c37-b705-793144958513",
    "tipo": "VEICULO_DETECTADO",
    "sentido": "AFASTANDO",
    "luminosidadeResultante": 100,
    "timestamp": "2026-09-10T13:20:00.000Z"
  }
]
```

### `PATCH /postes/:id/status`

Atribuição manual pelo técnico. Body: `{ "status": "MANUTENCAO" | "NORMAL" }`
(qualquer outro valor → `400`). Retorna o poste atualizado. A mudança é
difundida pelo WebSocket.

```jsonc
// PATCH /postes/4d1fc7c5-.../status   { "status": "MANUTENCAO" }
{
  "id": "4d1fc7c5-a83d-44dd-ba74-c137bee57a3b",
  "codigo": "P-009",
  "endereco": "Rua Itaguari, 136",
  "bairro": "Centro",
  "latitude": -15.954637,
  "longitude": -49.589536,
  "cidade": "Itaguari",
  "uf": "GO",
  "status": "MANUTENCAO",
  "luminosidadeAtual": 0,
  "consumoInstantaneoKw": 0,
  "ultimaLeituraEm": "2026-09-10T15:54:50.923Z",
  "criadoEm": "2026-09-10T15:54:51.536Z",
  "atualizadoEm": "2026-09-10T16:04:34.417Z"
}
```

---

## KPIs / Dashboard

### `GET /kpis?periodo=dia|semana|mes|ano`

`periodo` default `mes`. `atual` e `anterior` são blocos de N dias inteiros (UTC)
— comparação período cheio vs. período cheio. `parcialHoje` é o dia corrente,
**fora** da comparação. `serie` tem buckets por hora (`dia`), dia
(`semana`/`mes`) ou mês (`ano`), alinhados por índice entre `atual` e `anterior`.

`variacao.consumoPct` e `custoPct` são iguais (custo é linear no consumo); vêm
`null` quando não há base anterior.

```jsonc
// GET /kpis?periodo=mes
{
  "periodo": "mes",
  "geradoEm": "2026-09-10T16:04:34.453Z",
  "tarifa": { "classe": "B4a", "descricao": "Iluminação pública", "valorKwh": 0.58 },
  "atual":    { "inicio": "2026-08-11T00:00:00.000Z", "fim": "2026-09-10T00:00:00.000Z", "consumoKwh": 10698.019, "custoReais": 6204.85 },
  "anterior": { "inicio": "2026-07-12T00:00:00.000Z", "fim": "2026-08-11T00:00:00.000Z", "consumoKwh": 11317.786, "custoReais": 6564.32 },
  "variacao": { "consumoPct": -5.5, "custoPct": -5.5 },
  "parcialHoje": { "inicio": "2026-09-10T00:00:00.000Z", "fim": "2026-09-10T16:04:34.434Z", "consumoKwh": 237.202, "custoReais": 137.58 },
  "serie": {
    "granularidade": "dia",
    "atual":    [ { "inicio": "2026-08-11T00:00:00.000Z", "consumoKwh": 376.206 } /* ... */ ],
    "anterior": [ { "inicio": "2026-07-12T00:00:00.000Z", "consumoKwh": 372.211 } /* ... */ ]
  }
}
```

Para `periodo=ano`, `serie.granularidade` é `"mes"` e há 13 buckets em cada
série (a janela de 365 dias toca 13 meses de calendário).

### `GET /kpis/maior-consumo?periodo=&limite=`

Ranking dos postes de maior consumo no período. `limite` 1–20 (default 5).

```jsonc
// GET /kpis/maior-consumo?periodo=semana&limite=5
{
  "periodo": "semana",
  "inicio": "2026-09-03T00:00:00.000Z",
  "fim": "2026-09-10T00:00:00.000Z",
  "ranking": [
    {
      "posicao": 1,
      "posteId": "86211274-c46c-4d25-a5b3-34d152afb156",
      "codigo": "P-145",
      "endereco": "Rua Boa Esperança, 112",
      "bairro": "Setor Sul",
      "consumoKwh": 23.37,
      "custoReais": 13.55
    }
    // ...
  ]
}
```

### `GET /kpis/postes-por-status`

```jsonc
// GET /kpis/postes-por-status
{
  "total": 248,
  "porStatus": [
    { "status": "NORMAL",        "quantidade": 231 },
    { "status": "CONSUMO_ALTO",  "quantidade": 9 },
    { "status": "FALHA_OFFLINE", "quantidade": 5 },
    { "status": "MANUTENCAO",    "quantidade": 3 }
  ]
}
```

As 4 categorias vêm sempre, mesmo com `quantidade: 0`.

---

## Arquitetura

### `GET /arquitetura`

Estado das camadas edge · fog · nuvem (memória da API; atualiza a cada janela do
fog, 60 s). Com `modo: "interno"` (simulador embutido), `edge`, `fog` e `trafego`
vêm `null` e `alertas` vazio.

```jsonc
// GET /arquitetura
{
  "modo": "camadas",                       // "camadas" | "interno"
  "nuvem": { "brokerConectado": true },
  "edge": { "online": true },              // null até o 1º relatório do fog
  "fog": {                                 // null até o fog se anunciar
    "online": true,
    "gateways": [                          // um por bairro (9)
      { "bairro": "Centro", "postes": 46, "online": 46 }
    ],
    "buffer": 0,                           // msgs guardadas esperando a nuvem
    "atualizadoEm": "2026-10-18T18:11:06.722Z"
  },
  "trafego": {                             // última janela
    "janelaS": 60,
    "entrada": { "msgs": 1586, "bytes": 237231 },   // postes → fog
    "saida":   { "msgs": 137,  "bytes": 98834 },    // fog → nuvem
    "reducaoMsgsPct": 91,
    "reducaoBytesPct": 58,
    "postes": { "total": 248, "online": 243 },
    "em": "2026-10-18T18:11:06.722Z"
  },
  "alertas": [                             // até 20, mais recentes primeiro
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

---

## OTA (firmware)

### `GET /ota` · `POST /ota/implantacoes` · `POST /ota/reverter`

Atualização remota de firmware com grupo canário (só no modo `camadas`).
Detalhes de cada campo no `API.md`.

```jsonc
// POST /ota/implantacoes   body: { "versao": "3.0.0" }   → 201 (mesmo corpo do GET)
// POST /ota/reverter       → 200 (409 se não houver implantação em andamento)
// GET /ota
{
  "modo": "camadas",
  "catalogo": [ { "versao": "2.5.0", "descricao": "..." } ],   // 2.4.1, 2.5.0, 3.0.0 (defeito de energia), 3.0.1 (falha no autoteste)
  "versoesEmCampo": { "2.4.1": 231, "3.0.0": 13, "desconhecida": 4 },
  "criterios": { "ondas": [5, 25, 50, 100], "janelaS": 120, "limiarFalhaInstalacaoPct": 5,
                 "limiarRazaoConsumo": 1.5, "minReportePct": 60, "maxExtensoes": 2 },
  "implantacao": {                          // null se nenhuma foi iniciada
    "versao": "3.0.0", "versaoAnterior": "2.4.1",
    "status": "REVERTIDA",                  // EM_ANDAMENTO | CONCLUIDA | REVERTIDA
    "iniciadaEm": "2026-10-18T18:43:21.000Z", "encerradaEm": "2026-10-18T18:45:26.000Z",
    "ondas": [5, 25, 50, 100], "ondaAtual": 0, "ondaAtualPct": 5,
    "proximaAvaliacaoEm": null,
    "aparelhos": { "elegiveis": 241, "enviados": 13, "instalados": 13, "falhas": 0, "pendentes": 0, "revertidos": 13 },
    "grupos": { "canario": ["P-012", "..."], "controle": ["P-069", "..."] },
    "metricas": {                           // null até o 1º portão
      "canario":  { "aparelhos": 13, "reportaram": 13, "consumoNormalizadoMedio": 0.1814, "consumoAltoPct": 100 },
      "controle": { "aparelhos": 13, "reportaram": 13, "consumoNormalizadoMedio": 0.0999, "consumoAltoPct": 0 },
      "referenciaConsumo": 0.0999, "razaoConsumo": 1.82
    },
    "falhas": [],                           // { codigo, motivo }, até 20
    "decisoes": [                           // um por portão
      { "em": "2026-10-18T18:45:26.000Z", "ondaPct": 5, "decisao": "REVERTER",   // AVANCAR | ESTENDER | CONCLUIR | REVERTER
        "motivo": "consumo do canário 1,82× o do grupo de controle (limite 1,50×)", "razaoConsumo": 1.82 }
    ]
  }
}
```

---

## WebSocket — `ws://localhost:3000/tempo-real`

Socket.IO, namespace `/tempo-real`. Sem autenticação. As atualizações ao vivo
vêm da camada fog (ou do simulador embutido, no modo `SIMULADOR_MODO=interno`),
sempre no mesmo formato; com `SIMULADOR_ENABLED=false` o gateway ainda entrega o
estado inicial e as mudanças manuais de status.

### Cliente → servidor (todos respondem com ack `{ ok: boolean }`)

| Evento | Payload | Efeito |
|---|---|---|
| `assinar:mapa` | — | entra na sala do mapa; dispara `mapa:estado` |
| `desassinar:mapa` | — | sai da sala |
| `assinar:poste` | `{ "posteId": "<uuid>" }` | entra na sala do poste; dispara `poste:estado` |
| `desassinar:poste` | `{ "posteId": "<uuid>" }` | sai da sala |

`assinar:mapa` responde `{ "ok": true, "total": 248 }`. `posteId` inválido/
inexistente → ack `{ "ok": false }` + evento `erro`.

### Servidor → cliente

```jsonc
// mapa:estado — ao assinar o mapa (lista completa, com coordenadas)
{
  "postes": [
    {
      "id": "3c7d24df-aec4-4565-b81c-7410b2c7e512",
      "codigo": "P-001",
      "endereco": "Avenida Goiás, 100",
      "bairro": "Centro",
      "latitude": -15.954802,
      "longitude": -49.590696,
      "status": "NORMAL",
      "luminosidadeAtual": 50,
      "consumoInstantaneoKw": 0.0524,
      "ultimaLeituraEm": "2026-09-10T15:53:39.047Z"
    }
    // ... 248 itens
  ],
  "em": "2026-09-10T15:53:39.642Z"
}
```

```jsonc
// postes:atualizados — sala `mapa`, a cada tick ou mudança (só os que mudaram)
{
  "origem": "sensores",   // "sensores" | "telemetria" | "status"
  "postes": [
    {
      "posteId": "6915ebde-6b2b-474d-a47c-cd8aebcbb320",
      "codigo": "P-002",
      "status": "NORMAL",
      "luminosidadeAtual": 100,
      "consumoInstantaneoKw": 0.0484,
      "ultimaLeituraEm": "2026-09-10T15:53:39.047Z"
    }
  ],
  "em": "2026-09-10T15:53:39.100Z"
}
```

```jsonc
// poste:estado — ao assinar um poste
{
  "poste": {
    "id": "3c7d24df-aec4-4565-b81c-7410b2c7e512",
    "codigo": "P-001",
    "endereco": "Avenida Goiás, 100",
    "bairro": "Centro",
    "latitude": -15.954802,
    "longitude": -49.590696,
    "status": "NORMAL",
    "luminosidadeAtual": 50,
    "consumoInstantaneoKw": 0.0524,
    "ultimaLeituraEm": "2026-09-10T15:53:39.047Z"
  },
  "em": "2026-09-10T15:53:39.642Z"
}
```

```jsonc
// poste:atualizado — sala `poste:<id>`, quando aquele poste muda
{
  "posteId": "3c7d24df-aec4-4565-b81c-7410b2c7e512",
  "codigo": "P-001",
  "status": "NORMAL",
  "luminosidadeAtual": 50,
  "consumoInstantaneoKw": 0.0539,
  "ultimaLeituraEm": "2026-09-10T15:53:44.049Z",
  "origem": "telemetria",
  "em": "2026-09-10T15:53:44.164Z"
}
```

```jsonc
// erro
{ "evento": "assinar:poste", "mensagem": "posteId inválido." }
```
