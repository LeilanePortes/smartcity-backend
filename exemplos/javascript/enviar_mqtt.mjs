// Integração por MQTT em JavaScript (Node 18+), com a biblioteca genérica
// mqtt.js (RF-INT-02). Publica uma leitura canônica v1.0 no tópico
// {inquilino}/{site}/{dominio}/{dispositivo}/telemetria do broker da nuvem.
// Uso:  npm install mqtt   (já vem no repositório)
//       node enviar_mqtt.mjs [potencia_kW] [tensao_V]
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';

const BROKER = process.env.MQTT_URL ?? 'mqtt://localhost:1884';
const DISPOSITIVO = process.env.DISPOSITIVO ?? 'medidor-centro';
const TOPICO = `itaguari/centro/energia/${DISPOSITIVO}/telemetria`;

const [potencia = 12.4, tensao = 221] = process.argv.slice(2).map(Number);
const mensagem = {
  versao: '1.0',
  id_mensagem: randomUUID(),
  dispositivo: DISPOSITIVO,
  tipo: 'telemetria',
  timestamp: new Date().toISOString(),
  medidas: [
    { grandeza: 'potencia', valor: potencia, unidade: 'kW' },
    { grandeza: 'tensao', valor: tensao, unidade: 'V' },
  ],
};

const cliente = mqtt.connect(BROKER);
cliente.on('connect', () => {
  cliente.publish(TOPICO, JSON.stringify(mensagem), { qos: 1 }, (erro) => {
    console.log(erro ? `erro: ${erro.message}` : `publicado em ${TOPICO}: ${mensagem.id_mensagem}`);
    cliente.end();
  });
});
cliente.on('error', (e) => {
  console.error(`erro MQTT: ${e.message}`);
  process.exit(1);
});
