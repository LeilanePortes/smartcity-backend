"""Adaptador plugável (RF-INT-03, padrão Adapter): medidor legado → contrato canônico.

Um medidor antigo manda o próprio formato por HTTP:
    POST :8090/leituras   {"id": "MQ-CENTRO", "kw": 12.4, "volts": 221, "ts": 1761091200}
O adaptador converte cada leitura para a mensagem canônica v1.0 e envia para
POST /api/v1/ingestao/lote com o token do dispositivo. Roda num contêiner
separado: sobe e desce sem recompilar nem reiniciar a API ou o fog.

Configuração (variáveis de ambiente):
    API_URL               http://app:3000
    ADAPTADOR_MAPA        JSON {"<id legado>": {"dispositivo": "...", "token": "dsp_..."}}
Só biblioteca padrão do Python.
"""
import json
import os
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = os.environ.get("API_URL", "http://app:3000") + "/api/v1/ingestao/lote"
MAPA = json.loads(os.environ.get("ADAPTADOR_MAPA", "{}"))
PORTA = int(os.environ.get("ADAPTADOR_PORTA", "8090"))


def log(msg, **campos):
    print(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "modulo": "adaptador-medidor-legado", "msg": msg, **campos}), flush=True)


def para_canonica(leitura):
    """Converte uma leitura legada; devolve (dispositivo, token, mensagem)."""
    destino = MAPA.get(str(leitura.get("id")))
    if not destino:
        raise ValueError(f"medidor legado {leitura.get('id')!r} não mapeado")
    instante = datetime.fromtimestamp(float(leitura["ts"]), timezone.utc) if "ts" in leitura else datetime.now(timezone.utc)
    medidas = []
    if "kw" in leitura:
        medidas.append({"grandeza": "potencia", "valor": float(leitura["kw"]), "unidade": "kW"})
    if "volts" in leitura:
        medidas.append({"grandeza": "tensao", "valor": float(leitura["volts"]), "unidade": "V"})
    return destino["dispositivo"], destino["token"], {
        "versao": "1.0",
        # Id determinístico: o mesmo envio repetido pelo medidor vira duplicata, não dado novo.
        "id_mensagem": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{leitura.get('id')}/{leitura.get('ts')}")),
        "dispositivo": destino["dispositivo"],
        "tipo": "telemetria",
        "timestamp": instante.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "via": "adaptador-medidor-legado",
        "medidas": medidas,
    }


def enviar(token, mensagens):
    req = urllib.request.Request(
        API,
        data=json.dumps({"mensagens": mensagens}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/leituras":
            self.send_error(404)
            return
        try:
            corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            leituras = corpo if isinstance(corpo, list) else [corpo]
            por_token = {}
            for l in leituras:
                dispositivo, token, msg = para_canonica(l)
                por_token.setdefault(token, []).append(msg)
            resultados = [enviar(t, msgs) for t, msgs in por_token.items()]
            log("leituras convertidas e enviadas", total=len(leituras), resultados=[r[1] if r[0] == 200 else r for r in resultados])
            self._json(200, {"convertidas": len(leituras), "plataforma": [r[1] for r in resultados]})
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            log("leitura recusada", erro=str(e))
            self._json(400, {"erro": str(e)})

    def _json(self, status, corpo):
        dados = json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    log(f"ouvindo em :{PORTA}/leituras", medidores=list(MAPA))
    ThreadingHTTPServer(("", PORTA), Handler).serve_forever()
