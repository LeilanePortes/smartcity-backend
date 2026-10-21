# Contrato da API — Iluminação Pública Inteligente

Referência de payloads para o time mobile (Flutter). Todos os exemplos abaixo
foram capturados da API rodando com o seed + `db:backfill` padrão.

- **Base URL:** `http://localhost:3000/api/v1` (API versionada; os caminhos abaixo são relativos a ela; sem autenticação por enquanto)
- **Listagens:** `?pagina=&tamanho=&ordenar=` e envelope `{ itens, pagina, tamanho, total, totalPaginas }` (ver Paginação)
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
| Catálogo/dispositivo inexistente | `404` | `{ "message": "Dispositivo \"p-999\" não encontrado.", ... }` |
| Slug ou código repetido | `409` | `{ "message": "Já existe o domínio \"energia\".", "error": "Conflict", "statusCode": 409 }` |
| Token de dispositivo inválido/revogado | `401` | `{ "message": "Credencial ausente, inválida ou revogada.", "error": "Unauthorized", "statusCode": 401 }` |

Enums:

- `StatusPoste`: `NORMAL` · `CONSUMO_ALTO` · `FALHA_OFFLINE` · `MANUTENCAO`
- `TipoEventoSensor`: `VEICULO_DETECTADO` · `RETORNO_AO_PISO`
- `SentidoVeiculo`: `APROXIMANDO` · `AFASTANDO`

---

## Paginação

Toda listagem aceita `pagina` (≥ 1, padrão 1), `tamanho` (1–500, padrão 50; ranking: 5)
e `ordenar` (campo do endpoint, `-` na frente = decrescente) e responde:

```jsonc
{ "itens": [ /* … */ ], "pagina": 1, "tamanho": 50, "total": 248, "totalPaginas": 5 }
```

Campo de `ordenar` fora da lista do endpoint → `400` com os campos aceitos.

---

## Postes

### `GET /postes`

Lista para o mapa, paginada (o mapa inteiro: `?tamanho=500`). Query (todos opcionais):

| Param | Valores | Efeito |
|---|---|---|
| `status` | um `StatusPoste` | filtra por status |
| `busca` | texto (≤120) | casa rua **ou** bairro, sem distinção de acento/caixa |
| `pagina` · `tamanho` | números | paginação |
| `ordenar` | `codigo` (padrão) · `bairro` · `endereco` · `status` · `luminosidadeAtual` · `consumoInstantaneoKw` · `ultimaLeituraEm` | `-` = decrescente |

```jsonc
// GET /postes?status=CONSUMO_ALTO&tamanho=500
{
  "itens": [
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
  ],
  "pagina": 1,
  "tamanho": 500,
  "total": 9,
  "totalPaginas": 1
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

### `GET /postes/:id/eventos?pagina=&tamanho=&ordenar=`

Log do sensor 360°, paginado; padrão: mais recentes primeiro (`ordenar=-timestamp`;
também `timestamp` e `tipo`). `sentido` pode ser `null`.

```jsonc
// GET /postes/4d1fc7c5-.../eventos?tamanho=2
{
  "itens": [
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
  ],
  "pagina": 1,
  "tamanho": 2,
  "total": 106,
  "totalPaginas": 53
}
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

### `GET /kpis/maior-consumo?periodo=&pagina=&tamanho=&ordenar=`

Ranking dos postes de maior consumo no período, paginado (padrão: top 5;
`ordenar=-consumoKwh` ou `consumoKwh`). `posicao` é absoluta, também nas páginas seguintes.

```jsonc
// GET /kpis/maior-consumo?periodo=semana
{
  "periodo": "semana",
  "inicio": "2026-09-03T00:00:00.000Z",
  "fim": "2026-09-10T00:00:00.000Z",
  "itens": [
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
  ],
  "pagina": 1,
  "tamanho": 5,
  "total": 248,
  "totalPaginas": 50
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
      "controle": { "aparelhos": 13, "reportaram": 13, "consumoNormalizadoMedio": 0.0999, "consumoAltoPct": 0 },   // null na onda de 100%
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

## Catálogo e dispositivos

Hierarquia **inquilino → local (site) → área → dispositivo**, com domínios e
perfis configuráveis.

- **Montagem na subida:** a API monta sozinha o domínio `iluminacao`, o perfil
  `luminaria-led`, os 9 bairros (com polígono), as ruas com postes (com traçado)
  e **um dispositivo por poste** (`p-001`…`p-248`).
- **Referências:** `:ref` aceita o `id` (uuid) ou o slug. Nos dispositivos, o
  slug é o `codigo`.
- **Listagens:** todas são paginadas (envelope padrão). Detalhes de cada campo
  no `API.md`.

```jsonc
// GET /catalogo/dominios · POST /catalogo/dominios  body: { "slug": "energia", "nome": "Energia", "descricao"?: "..." }
{ "id": "…", "slug": "iluminacao", "nome": "Iluminação pública", "descricao": "…", "criadoEm": "…", "atualizadoEm": "…", "dispositivos": 248 }

// GET /catalogo/perfis · POST /catalogo/perfis
{ "id": "…", "slug": "luminaria-led", "nome": "Luminária LED com sensor 360°", "descricao": "…",
  "grandezas": [ { "grandeza": "potencia", "unidade": "kW", "minimo": 0, "maximo": 0.25 },
                 { "grandeza": "luminosidade", "unidade": "%", "minimo": 0, "maximo": 100 } ],
  "intervaloEnvioS": 60, "limiteOfflineS": 180, "dispositivos": 248, "criadoEm": "…", "atualizadoEm": "…" }

// GET /sites · POST /sites · GET /sites/:ref       (geometria GeoJSON, [lon, lat])
{ "id": "…", "slug": "centro", "nome": "Centro", "tipo": "bairro",
  "geometria": { "type": "Polygon", "coordinates": [[[-49.604582, -15.920801], "…"]] },
  "areas": 12, "dispositivos": 53, "criadoEm": "…", "atualizadoEm": "…" }

// GET /sites/:ref/areas · POST /sites/:ref/areas
{ "id": "…", "slug": "avenida-goias", "nome": "Avenida Goiás", "tipo": "rua",
  "geometria": { "type": "MultiLineString", "coordinates": [[[-49.606362, -15.922239], "…"]] },
  "site": { "id": "…", "slug": "centro", "nome": "Centro" }, "dispositivos": 9, "criadoEm": "…", "atualizadoEm": "…" }

// GET /dispositivos?dominio=&perfil=&site=&area=&conexao=online|offline&busca=&ordenar=codigo|nome|firmware|criadoEm|ultimaMensagemEm
// GET /dispositivos/:ref · PATCH /dispositivos/:ref (mesmos campos do POST, menos codigo)
{ "id": "…", "codigo": "p-001", "nome": "Luminária P-001",
  "inquilino": { "id": "…", "slug": "itaguari", "nome": "Prefeitura de Itaguari" },
  "dominio": { "id": "…", "slug": "iluminacao", "nome": "Iluminação pública" },
  "perfil": { "id": "…", "slug": "luminaria-led", "nome": "Luminária LED com sensor 360°" },
  "site": { "id": "…", "slug": "centro", "nome": "Centro" },
  "area": { "id": "…", "slug": "rua-10", "nome": "Rua 10" },                 // pode ser null
  "fabricante": "Simulador SmartCity (edge)", "modelo": "LUM-LED-100W", "firmware": "2.4.1",
  "geo": { "type": "Point", "coordinates": [-49.606176, -15.920691] },      // pode ser null
  "posteId": "…",                                                          // null fora da iluminação
  "conexao": { "online": true, "ultimaMensagemEm": "2026-10-21T19:52:11.263Z", "limiteOfflineS": 180 },
  "credencial": { "ativa": true, "prefixo": "b93557b21ba7", "emitidaEm": "…" },   // ou { "ativa": false }
  "criadoEm": "…", "atualizadoEm": "…" }

// POST /dispositivos  body: { codigo, nome, dominio, perfil, site, area?, fabricante, modelo?, firmware, latitude?, longitude? }
// → 201 { "dispositivo": { … }, "credencial": { "token": "dsp_<prefixo>_<segredo>", "prefixo", "emitidaEm", "aviso" } }
//   o token aparece só aqui · 409 código repetido · 400 referência inexistente
// POST   /dispositivos/:ref/credenciais → 201 token novo (revoga o anterior)
// DELETE /dispositivos/:ref/credenciais → 200 { dispositivo, revogadas, revogadaEm } · 404 sem credencial ativa
// GET    /dispositivos/eu   header Authorization: Bearer <token> → 200 Dispositivo · 401 revogado/inválido
```

---

## Ingestão e séries

Pipeline: receber → autenticar → validar → deduplicar → ordenar → enriquecer →
publicar. Detalhes de cada campo no `API.md`.

```jsonc
// POST /ingestao   header Authorization: Bearer <token>   body: mensagem canônica v1.0
// → 202 { "status": "aceita" | "duplicada", "id_mensagem": "…", "atrasada": false }
// → 400 { "message": "fora do JSON Schema", "etapa": "validar", "erros": ["…"] }   (vai para a fila de inválidas)
// → 401 token ausente/revogado · 403 mensagem de outro dispositivo

// POST /ingestao/lote   body: [ … ] ou { "mensagens": [ … ] }  (até 5.000)
{ "total": 5000, "aceitas": 4997, "duplicadas": 0, "recusadas": 3,
  "resultados": [ { "indice": 10, "id_mensagem": "…", "status": "recusada", "etapa": "validar", "motivo": "…", "erros": ["…"] } ] }

// MQTT (broker da nuvem, :1884): itaguari/{site}/{dominio}/{dispositivo}/{telemetria|evento|estado}

// GET /ingestao/invalidas?canal=&etapa=&dispositivo=   (paginado)
{ "id": "…", "recebidoEm": "…", "canal": "mqtt", "etapa": "autenticar", "motivo": "…", "erros": ["…"],
  "dispositivo": "…", "idMensagem": "…", "topico": "…", "payload": { } }

// GET /series?grandeza=potencia&dispositivo=&area=&site=&dominio=&inicio=&fim=&intervalo=auto|bruto|1m|5m|15m|1h|1d
{ "grandeza": "potencia", "filtros": { … }, "inicio": "…", "fim": "…", "intervalo": "1h", "unidades": ["kW"], "truncada": false,
  "pontos": [ { "inicio": "…", "media": 0.0546, "minimo": 0.0473, "maximo": 0.0901, "amostras": 463, "suspeitas": 0 } ] }
  // bruto: pontos = [ { "em": "…", "valor": 12.4, "suspeita": false, "dispositivoId": "…" } ]

// GET /dispositivos/:ref/telemetria?grandeza=&inicio=&fim=&intervalo=   → { dispositivo, inicio, fim, intervalo, series: [ { grandeza, unidades, pontos, … } ] }
// GET /dispositivos/:ref/ultimos-valores → { dispositivo, valores: [ { grandeza, valor, unidade, medidoEm, suspeita } ] }
```

---

## Regras e alarmes

```jsonc
// POST /regras · GET /regras · GET/PATCH/DELETE /regras/:id · GET /regras/:id/execucoes
{ "nome": "Temperatura do silo",
  "dominio": "armazenagem", "site": null, "area": null, "perfil": null, "dispositivo": null,     // escopo (id ou slug), opcional
  "condicao": { "tipo": "limite", "grandeza": "temperatura", "operador": ">", "valor": 30, "duracaoS": 1800 },
              // ou { "tipo": "ausencia", "duracaoS": 120 }
  "severidade": "CRITICO",                                                 // INFO | AVISO | CRITICO
  "acoes": [ { "tipo": "alarme" }, { "tipo": "notificar", "email": "…" }, { "tipo": "comando", "nome": "…", "parametros": { } },
             { "tipo": "webhook", "url": "https://…", "tentativas": 3 }, { "tipo": "publicar", "topico": "itaguari/alarmes/…" } ] }
// resposta: + id, ativa, escopo { dominio|site|area|perfil: { id, slug, nome } | null, dispositivo: { id, codigo, nome } | null }, alarmesAbertos, criadoEm, atualizadoEm

// GET /alarmes?status=ATIVO|RECONHECIDO|RESOLVIDO&severidade=&origem=regra|borda&dispositivo=&regra=   (paginado, -ocorridoEm)
{ "id": "…", "origem": "regra", "severidade": "CRITICO", "status": "ATIVO",
  "titulo": "Temperatura do silo: temperatura > 30 Cel", "detalhe": "temperatura = 32 Cel por 60 s seguidos",
  "grandeza": "temperatura", "valor": 32,
  "ocorridoEm": "…",            // quando aconteceu (medição ou diagnóstico na borda)
  "criadoEm": "…", "reconhecidoEm": null, "reconhecidoPor": null, "resolvidoEm": null, "resolvidoPor": null, "comentario": null,
  "dispositivo": { "id": "…", "codigo": "…", "nome": "…" }, "regra": { "id": "…", "nome": "…" } }   // regra null na origem borda
// GET /alarmes/:id → + execucoes: [ { tipo, destino, status: "ok"|"falha", tentativas, erro, criadoEm, concluidoEm } ]
// POST /alarmes/:id/reconhecer   body { "por"?: "…", "comentario"?: "…" } → 200 · 409 se não estiver ATIVO
// POST /alarmes/:id/resolver     body idem → 200 · 409 se já RESOLVIDO
// Socket.IO: "alarme:atualizado" (mesmo formato) para todos os conectados
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
