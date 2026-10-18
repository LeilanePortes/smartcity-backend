import { StatusPoste } from '@prisma/client';
import { connect, MqttClient } from 'mqtt';
import { provisionar } from '../common/provisionamento';
import {
  assinaturaNuvem,
  assinaturaTodosPostes,
  MsgAlerta,
  MsgComandoNuvem,
  MsgEvento,
  MsgFogEstado,
  MsgSaude,
  MsgTelemetria,
  parseTopicoNuvem,
  parseTopicoPoste,
  slugBairro,
  TOPICO_FOG_ESTADO,
  topicoNuvem,
} from '../common/topicos-mqtt';
import { FogConfig, lerFogConfig } from './fog.config';
import { GatewayBairro } from './gateway';

/**
 * Camada fog: um gateway por bairro, entre o campo (edge) e a nuvem (API).
 *
 *   bun run dist/fog/main.js      (no container `fog` do docker-compose)
 *
 * Fala com dois brokers: o local, onde os postes publicam, e o da nuvem
 * (uplink). Se o uplink cair, o que iria para a nuvem fica num buffer e é
 * enviado em ordem quando a conexão volta (store-and-forward).
 */

const log = (msg: string): void => console.log(`[fog] ${msg}`);

interface Publicacao {
  topico: string;
  payload: string;
}

/// Tráfego de uma janela: o que entrou do campo × o que subiu para a nuvem.
class Trafego {
  entradaMsgs = 0;
  entradaBytes = 0;
  saidaMsgs = 0;
  saidaBytes = 0;

  fecharJanela(buffer: number): string {
    const pct = (saida: number, entrada: number): string =>
      entrada ? `-${Math.round((1 - saida / entrada) * 100)}%` : '—';
    const kb = (b: number): string => `${(b / 1024).toFixed(1)} KB`;
    const texto =
      `campo → fog: ${this.entradaMsgs} msgs (${kb(this.entradaBytes)}) | ` +
      `fog → nuvem: ${this.saidaMsgs} msgs (${kb(this.saidaBytes)}) | ` +
      `redução ${pct(this.saidaMsgs, this.entradaMsgs)} msgs, ` +
      `${pct(this.saidaBytes, this.entradaBytes)} bytes · buffer ${buffer}`;
    this.entradaMsgs = this.entradaBytes = this.saidaMsgs = this.saidaBytes = 0;
    return texto;
  }
}

/// Uplink com buffer: publica se a nuvem está no ar, senão guarda.
class Uplink {
  private readonly fila: Publicacao[] = [];
  private descartadas = 0;

  constructor(
    private readonly cliente: MqttClient,
    private readonly max: number,
    private readonly trafego: Trafego,
  ) {}

  get pendentes(): number {
    return this.fila.length;
  }

  enviar(p: Publicacao): void {
    if (this.cliente.connected) {
      this.publicar(p);
      return;
    }
    this.fila.push(p);
    if (this.fila.length > this.max) {
      this.fila.shift();
      this.descartadas++;
    }
  }

  /** Esvazia o buffer em ordem (chamado quando o uplink reconecta). */
  drenar(): void {
    if (!this.fila.length) return;
    const total = this.fila.length;
    while (this.fila.length && this.cliente.connected) {
      this.publicar(this.fila.shift()!);
    }
    log(
      `uplink restabelecido: ${total} mensagens do buffer enviadas à nuvem` +
        (this.descartadas
          ? ` (${this.descartadas} descartadas por buffer cheio)`
          : ''),
    );
    this.descartadas = 0;
  }

  private publicar(p: Publicacao): void {
    this.cliente.publish(p.topico, p.payload, { qos: 1 });
    this.trafego.saidaMsgs++;
    this.trafego.saidaBytes += p.payload.length;
  }
}

function estadoFog(online: boolean, gateways: number, buffer: number): string {
  return JSON.stringify({
    online,
    gateways,
    buffer,
    em: new Date().toISOString(),
  } satisfies MsgFogEstado);
}

function lerJson<T>(payload: Buffer): T | null {
  try {
    return JSON.parse(payload.toString()) as T;
  } catch {
    return null;
  }
}

function iniciar(
  config: FogConfig,
  gateways: Map<string, GatewayBairro>,
): void {
  const trafego = new Trafego();
  const totalPostes = [...gateways.values()].reduce((n, g) => n + g.total, 0);

  // --- Uplink (broker da nuvem) ----------------------------------------
  const nuvem = connect(config.mqttNuvemUrl, {
    clientId: 'itaguari-fog-gateways',
    reconnectPeriod: 2_000,
    // Sessão persistente: comandos (QoS 1) enviados enquanto o fog reconecta
    // ficam guardados no broker da nuvem e são entregues quando ele volta.
    clean: false,
    will: {
      topic: TOPICO_FOG_ESTADO,
      payload: Buffer.from(estadoFog(false, gateways.size, 0)),
      qos: 1,
      retain: true,
    },
  });
  const uplink = new Uplink(nuvem, config.bufferMax, trafego);

  nuvem.on('connect', () => {
    log(`uplink conectado à nuvem ${config.mqttNuvemUrl}`);
    nuvem.publish(
      TOPICO_FOG_ESTADO,
      estadoFog(true, gateways.size, uplink.pendentes),
      { qos: 1, retain: true },
    );
    nuvem.subscribe(assinaturaNuvem('comando'), { qos: 1 });
    uplink.drenar();
  });
  nuvem.on('offline', () =>
    log('uplink com a nuvem caiu — guardando no buffer'),
  );
  nuvem.on('error', (erro) => log(`erro no uplink: ${erro.message}`));

  // --- Broker local (campo) ---------------------------------------------
  const campo = connect(config.mqttLocalUrl, {
    clientId: 'itaguari-fog-campo',
    reconnectPeriod: 2_000,
  });

  campo.on('connect', () => {
    log(`conectado ao broker do campo ${config.mqttLocalUrl}`);
    campo.subscribe(
      [
        assinaturaTodosPostes('telemetria'),
        assinaturaTodosPostes('evento'),
        assinaturaTodosPostes('saude'),
      ],
      { qos: 1 },
    );
  });
  campo.on('error', (erro) => log(`erro no broker do campo: ${erro.message}`));

  const enviarAlertas = (alertas: MsgAlerta[]): void => {
    for (const a of alertas) {
      log(
        `alerta ${a.bairro} · ${a.codigo}: ${a.statusAnterior} → ${a.status} (${a.motivo})`,
      );
      uplink.enviar({
        topico: topicoNuvem(a.bairro, 'alerta'),
        payload: JSON.stringify(a),
      });
    }
  };

  campo.on('message', (topico, payload) => {
    const alvo = parseTopicoPoste(topico);
    const gateway = alvo && gateways.get(alvo.bairroSlug);
    if (!alvo || !gateway) return;
    trafego.entradaMsgs++;
    trafego.entradaBytes += payload.length;

    if (alvo.grandeza === 'telemetria') {
      const msg = lerJson<MsgTelemetria>(payload);
      if (msg) enviarAlertas(gateway.receberTelemetria(msg));
    } else if (alvo.grandeza === 'evento') {
      const msg = lerJson<MsgEvento>(payload);
      const evento = msg && gateway.receberEvento(msg);
      if (evento) {
        uplink.enviar({
          topico: topicoNuvem(gateway.bairro, 'evento'),
          payload: JSON.stringify(evento),
        });
      }
    } else if (alvo.grandeza === 'saude') {
      const msg = lerJson<MsgSaude>(payload);
      if (msg) gateway.receberSaude(msg);
    }
  });

  // --- Comandos da nuvem → poste -------------------------------------
  nuvem.on('message', (topico, payload) => {
    const alvo = parseTopicoNuvem(topico);
    const gateway = alvo && gateways.get(alvo.bairroSlug);
    const msg = lerJson<MsgComandoNuvem>(payload);
    if (!alvo || alvo.grandeza !== 'comando' || !gateway || !msg) return;
    if (
      msg.status !== StatusPoste.MANUTENCAO &&
      msg.status !== StatusPoste.NORMAL
    ) {
      return;
    }
    const destino = gateway.aplicarComando(msg.codigo, msg.status);
    if (!destino) return;
    campo.publish(destino, JSON.stringify({ status: msg.status, em: msg.em }), {
      qos: 1,
    });
    log(`comando repassado ao campo: ${msg.codigo} → ${msg.status}`);
  });

  // --- Ticks -----------------------------------------------------------
  const agendar = (nome: string, ms: number, fn: () => void): void => {
    setInterval(() => {
      try {
        fn();
      } catch (erro) {
        log(`falha no tick ${nome}: ${(erro as Error).message}`);
      }
    }, ms);
  };

  agendar('offline', config.intervaloVerificacaoMs, () => {
    for (const g of gateways.values()) enviarAlertas(g.verificarOffline());
  });

  agendar('resumo', config.janelaResumoMs, () => {
    let online = 0;
    for (const g of gateways.values()) {
      const resumo = g.fecharJanela();
      online += resumo.totais.online;
      uplink.enviar({
        topico: topicoNuvem(g.bairro, 'resumo'),
        payload: JSON.stringify(resumo),
      });
    }
    log(
      `janela ${config.janelaResumoMs / 1000}s · ${online}/${totalPostes} postes no ar · ` +
        trafego.fecharJanela(uplink.pendentes),
    );
  });

  const encerrar = (sinal: string): void => {
    log(`${sinal} recebido, desligando os gateways`);
    setTimeout(() => process.exit(0), 2_000).unref();
    campo.end(true);
    nuvem.publish(
      TOPICO_FOG_ESTADO,
      estadoFog(false, gateways.size, uplink.pendentes),
      { qos: 1, retain: true },
      () => nuvem.end(false, () => process.exit(0)),
    );
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

async function main(): Promise<void> {
  const config = lerFogConfig();
  log(`provisionando gateways a partir de ${config.apiUrl}...`);
  const postes = await provisionar(config.apiUrl, log);

  // Um gateway por bairro, cada um só com os postes do seu bairro.
  const porBairro = new Map<string, typeof postes>();
  for (const p of postes) {
    const lista = porBairro.get(p.bairro) ?? [];
    lista.push(p);
    porBairro.set(p.bairro, lista);
  }
  const gateways = new Map<string, GatewayBairro>();
  for (const [bairro, lista] of porBairro) {
    gateways.set(slugBairro(bairro), new GatewayBairro(bairro, lista, config));
  }

  log(
    `${gateways.size} gateways (${[...gateways.values()]
      .map((g) => `${g.bairro}: ${g.total}`)
      .join(', ')})`,
  );
  log(
    `regras: consumo alto > ${config.limiarConsumoAlto}× a mediana do bairro · ` +
      `offline após ${config.timeoutOfflineMs / 1000}s sem telemetria · ` +
      `resumo a cada ${config.janelaResumoMs / 1000}s`,
  );
  iniciar(config, gateways);
}

void main();
