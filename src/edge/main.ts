import { connect, MqttClient } from 'mqtt';
import {
  assinaturaTodosPostes,
  MsgEdgeEstado,
  TOPICO_EDGE_ESTADO,
} from '../common/topicos-mqtt';
import { provisionar } from '../common/provisionamento';
import { CampoEdge, Publicacao } from './campo';
import { EdgeConfig, lerEdgeConfig } from './edge.config';

/**
 * Simulador de campo (camada edge): sobe os 248 postes como dispositivos MQTT.
 *
 *   bun run dist/edge/main.js      (no container `edge` do docker-compose)
 *
 * Os dispositivos são multiplexados numa única conexão com o broker; cada um
 * publica nos próprios tópicos (itaguari/iluminacao/<bairro>/<poste>/...).
 */

const log = (msg: string): void => console.log(`[edge] ${msg}`);

type Grandeza = 'telemetria' | 'evento' | 'saude' | 'ota';

/// Contagem de mensagens por janela, para o relatório de banda.
class Contador {
  private msgs: Record<Grandeza, number> = {
    telemetria: 0,
    evento: 0,
    saude: 0,
    ota: 0,
  };
  private bytes = 0;
  private descartadas = 0;

  registrar(grandeza: Grandeza, bytes: number): void {
    this.msgs[grandeza]++;
    this.bytes += bytes;
  }

  descartar(n: number): void {
    this.descartadas += n;
  }

  fecharJanela(): string {
    const total =
      this.msgs.telemetria + this.msgs.evento + this.msgs.saude + this.msgs.ota;
    const resumo =
      `${total} msgs (${(this.bytes / 1024).toFixed(1)} KB) · ` +
      `telemetria ${this.msgs.telemetria} · eventos ${this.msgs.evento} · ` +
      `saúde ${this.msgs.saude}` +
      (this.msgs.ota ? ` · OTA ${this.msgs.ota}` : '') +
      (this.descartadas
        ? ` · ${this.descartadas} descartadas (sem broker)`
        : '');
    this.msgs = { telemetria: 0, evento: 0, saude: 0, ota: 0 };
    this.bytes = 0;
    this.descartadas = 0;
    return resumo;
  }
}

function estadoEdge(online: boolean, postes: number): string {
  return JSON.stringify({
    online,
    postes,
    em: new Date().toISOString(),
  } satisfies MsgEdgeEstado);
}

function iniciar(config: EdgeConfig, campo: CampoEdge): void {
  const contador = new Contador();

  const cliente: MqttClient = connect(config.mqttUrl, {
    clientId: 'itaguari-edge-campo',
    reconnectPeriod: 2_000,
    // Last Will: se o campo cair sem se despedir, o broker avisa os assinantes.
    will: {
      topic: TOPICO_EDGE_ESTADO,
      payload: Buffer.from(estadoEdge(false, campo.total)),
      qos: 1,
      retain: true,
    },
  });

  cliente.on('connect', () => {
    log(`conectado ao broker ${config.mqttUrl}`);
    cliente.publish(TOPICO_EDGE_ESTADO, estadoEdge(true, campo.total), {
      qos: 1,
      retain: true,
    });
    cliente.subscribe(
      [assinaturaTodosPostes('comando'), assinaturaTodosPostes('ota')],
      { qos: 1 },
    );
  });
  cliente.on('reconnect', () => log('reconectando ao broker...'));
  cliente.on('error', (erro) => log(`erro MQTT: ${erro.message}`));

  cliente.on('message', (topico, payload) => {
    const texto = payload.toString();
    if (topico.endsWith('/ota')) {
      const codigo = campo.aplicarOta(topico, texto);
      if (codigo) log(`OTA recebida em ${codigo}: ${texto} — reiniciando`);
      return;
    }
    const codigo = campo.aplicarComando(topico, texto);
    if (codigo) log(`comando aplicado em ${codigo}: ${texto}`);
  });

  const publicar = (grandeza: Grandeza, lote: Publicacao[]): void => {
    if (!lote.length) return;
    if (!cliente.connected) {
      contador.descartar(lote.length);
      return;
    }
    for (const p of lote) {
      cliente.publish(p.topico, p.payload, { qos: p.qos });
      contador.registrar(grandeza, p.payload.length);
    }
  };

  const agendar = (nome: string, ms: number, fn: () => void): void => {
    setInterval(() => {
      try {
        fn();
      } catch (erro) {
        log(`falha no tick ${nome}: ${(erro as Error).message}`);
      }
    }, ms);
  };

  agendar('sensores', config.intervaloSensoresMs, () => {
    publicar('evento', campo.tickSensores());
    const resultados = campo.tickOta();
    for (const r of resultados) {
      const msg = JSON.parse(r.payload) as {
        codigo: string;
        versaoAtual: string;
        sucesso: boolean;
      };
      log(
        `OTA ${msg.codigo}: ${msg.sucesso ? 'instalada' : 'ROLLBACK'} → rodando ${msg.versaoAtual}`,
      );
    }
    publicar('ota', resultados);
  });
  agendar('telemetria', config.intervaloTelemetriaMs, () =>
    publicar('telemetria', campo.tickTelemetria()),
  );
  agendar('saude', config.intervaloSaudeMs, () =>
    publicar('saude', campo.tickSaude()),
  );
  agendar('falhas', config.intervaloFalhasMs, () => {
    const mudados = campo.tickFalhas();
    if (mudados.length) {
      log(
        `falhas físicas — ${mudados.map((m) => `${m.codigo}: ${m.condicao}`).join(' | ')}`,
      );
    }
  });
  agendar('relatorio', config.intervaloRelatorioMs, () =>
    log(
      `último ${config.intervaloRelatorioMs / 1000}s: ${contador.fecharJanela()} · ` +
        `${campo.online}/${campo.total} postes no ar`,
    ),
  );

  const encerrar = (sinal: string): void => {
    log(`${sinal} recebido, desligando o campo`);
    // Sem broker o publish não confirma; não segura o container por isso.
    setTimeout(() => process.exit(0), 2_000).unref();
    cliente.publish(
      TOPICO_EDGE_ESTADO,
      estadoEdge(false, campo.total),
      { qos: 1, retain: true },
      () => cliente.end(false, () => process.exit(0)),
    );
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

async function main(): Promise<void> {
  const config = lerEdgeConfig();
  log(`provisionando postes a partir de ${config.apiUrl}...`);
  const postes = await provisionar(config.apiUrl, log);
  const campo = new CampoEdge(
    postes,
    config.versaoFirmware,
    config.intervaloSensoresMs,
    Date.now(),
    config.duracaoOtaMs,
  );
  log(
    `${campo.total} postes provisionados (firmware ${config.versaoFirmware}) | ` +
      `sensores ${config.intervaloSensoresMs}ms · telemetria ${config.intervaloTelemetriaMs}ms · ` +
      `saúde ${config.intervaloSaudeMs}ms`,
  );
  iniciar(config, campo);
}

void main();
