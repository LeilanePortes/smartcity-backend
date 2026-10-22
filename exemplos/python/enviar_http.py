"""Integração por HTTP em Python, só com a biblioteca padrão (RF-INT-02).

Envia uma leitura canônica v1.0 para POST /api/v1/ingestao.
Uso:  TOKEN=dsp_... python3 enviar_http.py [potencia_kW] [tensao_V]
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

API = os.environ.get("API_URL", "http://localhost:3000") + "/api/v1/ingestao"
TOKEN = os.environ["TOKEN"]
DISPOSITIVO = os.environ.get("DISPOSITIVO", "medidor-centro")

potencia = float(sys.argv[1]) if len(sys.argv) > 1 else 12.4
tensao = float(sys.argv[2]) if len(sys.argv) > 2 else 221.0

mensagem = {
    "versao": "1.0",
    "id_mensagem": str(uuid.uuid4()),
    "dispositivo": DISPOSITIVO,
    "tipo": "telemetria",
    "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "medidas": [
        {"grandeza": "potencia", "valor": potencia, "unidade": "kW"},
        {"grandeza": "tensao", "valor": tensao, "unidade": "V"},
    ],
}

req = urllib.request.Request(
    API,
    data=json.dumps(mensagem).encode(),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print(r.status, r.read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())
    sys.exit(1)
