#!/bin/sh
# UC-06 / RNF-08: cria o domínio "energia" só por configuração, sem mudar código.
# Domínio → perfil (grandezas, unidades, faixa, intervalo) → dispositivo (token)
# → regra. Uso: sh exemplos/configurar-energia.sh   (API em http://localhost:3000)
set -e
API="${API_URL:-http://localhost:3000}/api/v1"
J='Content-Type: application/json'

curl -sf -X POST "$API/catalogo/dominios" -H "$J" -d '{
  "slug": "energia", "nome": "Energia",
  "descricao": "Medidores dos quadros de comando que alimentam os postes de cada bairro."
}' >/dev/null && echo "domínio energia criado"

curl -sf -X POST "$API/catalogo/perfis" -H "$J" -d '{
  "slug": "medidor-quadro", "nome": "Medidor do quadro de comando",
  "grandezas": [
    { "grandeza": "potencia", "unidade": "kW", "minimo": 0, "maximo": 30 },
    { "grandeza": "tensao", "unidade": "V", "minimo": 180, "maximo": 250 }
  ],
  "intervaloEnvioS": 300
}' >/dev/null && echo "perfil medidor-quadro criado"

TOKEN=$(curl -sf -X POST "$API/dispositivos" -H "$J" -d '{
  "codigo": "medidor-centro", "nome": "Medidor do quadro — Centro",
  "dominio": "energia", "perfil": "medidor-quadro", "site": "centro",
  "fabricante": "Medidores Genéricos", "firmware": "1.0.0",
  "latitude": -15.920801, "longitude": -49.606172
}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "dispositivo medidor-centro criado"

curl -sf -X POST "$API/regras" -H "$J" -d '{
  "nome": "Tensão alta no quadro", "dominio": "energia",
  "condicao": { "tipo": "limite", "grandeza": "tensao", "operador": ">", "valor": 240 },
  "severidade": "CRITICO",
  "acoes": [ { "tipo": "alarme" }, { "tipo": "notificar", "email": "operador@itaguari.local" } ]
}' >/dev/null && echo "regra 'Tensão alta no quadro' criada"

echo
echo "Token do medidor-centro (aparece só agora, guarde):"
echo "  export TOKEN=$TOKEN"
