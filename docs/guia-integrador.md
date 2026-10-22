# Guia do integrador

Como ligar um projeto existente à plataforma sem biblioteca proprietária (RF-INT-02),
com um adaptador plugável (RF-INT-03) e um domínio novo criado só por configuração (RNF-08).

## Nível 1: falar o contrato canônico

O dispositivo (ou o sistema dele) manda mensagens no
[contrato canônico v1.0](../contratos/v1/mensagem.schema.json). Ele também pode ser
baixado em `GET /api/v1/contratos/v1/mensagem.schema.json`.

| Canal | Endereço | Autenticação |
|---|---|---|
| HTTP | `POST /api/v1/ingestao` (uma mensagem) ou `/api/v1/ingestao/lote` (até 5.000) | `Authorization: Bearer <token do dispositivo>` |
| MQTT | Broker da nuvem `localhost:1884`, tópico `itaguari/{site}/{dominio}/{dispositivo}/telemetria` | Dispositivo cadastrado e com credencial ativa |

Exemplos funcionais, só com bibliotecas genéricas:

| Linguagem | Arquivo | Canal | Como rodar |
|---|---|---|---|
| Python | [`exemplos/python/enviar_http.py`](../exemplos/python/enviar_http.py) | HTTP (biblioteca padrão) | `TOKEN=dsp_... python3 exemplos/python/enviar_http.py 12.4 221` |
| JavaScript | [`exemplos/javascript/enviar_mqtt.mjs`](../exemplos/javascript/enviar_mqtt.mjs) | MQTT (`mqtt.js`) | `node exemplos/javascript/enviar_mqtt.mjs 13.1 222` |
| Go | [`exemplos/go/main.go`](../exemplos/go/main.go) | HTTP lote (biblioteca padrão) | `TOKEN=dsp_... go run exemplos/go/main.go` |

Sem Node ou Go instalados, os exemplos rodam em contêiner:

```bash
docker run --rm --network smartcity-backend_default -e MQTT_URL=mqtt://mosquitto-nuvem:1883 \
  -v "$PWD":/app -w /app/exemplos/javascript node:24-slim node enviar_mqtt.mjs
docker run --rm --network smartcity-backend_default -e API_URL=http://app:3000 -e TOKEN=$TOKEN \
  -v "$PWD/exemplos/go":/src -w /src golang:1.23-alpine go run main.go
```

## Nível 2: adaptador plugável

Para equipamentos que não falam o contrato. O
[`adaptadores/medidor-legado`](../adaptadores/medidor-legado/adaptador.py) recebe o
JSON próprio de um medidor antigo e converte para o formato canônico.

- **Entrada:** `POST :8090/leituras` com `{"id": "MQ-CENTRO", "kw": 12.4, "volts": 221, "ts": 1761091200}`.
- **Saída:** envia para `POST /api/v1/ingestao/lote` com o token do dispositivo.
- **Contêiner próprio:** Python, só com a biblioteca padrão.
- **Liga e desliga com a plataforma no ar:** não precisa recompilar nem reiniciar a
  API ou o fog.

```bash
ADAPTADOR_MAPA='{"MQ-CENTRO":{"dispositivo":"medidor-centro","token":"'$TOKEN'"}}' \
  docker compose --profile adaptadores up -d adaptador-medidor-legado
curl -X POST localhost:8090/leituras -H 'Content-Type: application/json' \
  -d '{"id":"MQ-CENTRO","kw":14.2,"volts":245,"ts":'$(date +%s)'}'
```

Um adaptador novo, em qualquer linguagem, segue o mesmo modelo: um serviço a mais
no `docker-compose.yml` que conversa com a plataforma pela API ou pelo MQTT.

## Domínio novo só por configuração (UC-06)

O domínio **energia** representa os medidores dos quadros de comando que alimentam os
postes de cada bairro. Ele é criado com a plataforma no ar, sem mudar código:

```bash
sh exemplos/configurar-energia.sh     # domínio, perfil, dispositivo (mostra o token) e regra
export TOKEN=dsp_...                  # o token que o script mostrou
python3 exemplos/python/enviar_http.py 12.4 245   # tensão > 240 V → alarme + e-mail
```

Resultado:

- o dado aparece em `GET /api/v1/dispositivos/medidor-centro/ultimos-valores` e em
  `GET /api/v1/series?grandeza=tensao&dominio=energia`;
- o alarme aparece em `GET /api/v1/alarmes`;
- o e-mail chega em http://localhost:8025.

O domínio novo já tem histórico, regras, alarmes e API, sem nenhuma alteração de
código (RNF-08).
