import { createServer } from 'node:http';
import { rastroAtivo, registrar } from '../observabilidade/log';
import { RegistroMetricas } from '../observabilidade/metricas';
import { StatusPoste } from '@prisma/client';
import { connect, MqttClient } from 'mqtt';
import { provisionar } from '../common/provisionamento';
import {
  assinaturaNuvem,
  MsgAlerta,
  MsgComandoNuvem,
  MsgEdgeEstado,
  MsgFogEstado,
  MsgFogTrafego,
  MsgOtaNuvem,
  parseTopicoNuvem,
  slugBairro,
  TOPICO_EDGE_ESTADO,
  TOPICO_FOG_ESTADO,
  TOPICO_FOG_TRAFEGO,
  topicoNuvem,
} from '../common/topicos-mqtt';
import {
  comandoAtualizarFirmware,
  comandoDefinirStatus,
  lerEventoSensor,
  lerOtaResultado,
  lerSaude,
  lerTelemetria,
} from '../common/codec-iluminacao';
import {
  assinaturaDominio,
  DOMINIO_ILUMINACAO,
  parseTopicoDispositivo,
  validarMensagem,
} from '../common/contrato';
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

const log = (msg: string, campos?: Record<string, unknown>): void =>
  registrar('info', 'fog', msg, campos);

/// Métricas do nó de borda (RF-OBS-01), em GET :FOG_METRICAS_PORTA/metrics.
const metricasFog = new RegistroMetricas();
const MF = {
  mensagens: metricasFog.contador(
    'fog_mensagens_total',
    'Mensagens do fog por direção: entrada (campo), saida (nuvem), invalida (fora do contrato).',
  ),
  bytes: metricasFog.contador('fog_bytes_total', 'Bytes do fog por direção.'),
  alertas: metricasFog.contador(
    'fog_alertas_total',
    'Diagnósticos enviados à nuvem, por status novo.',
  ),
  buffer: metricasFog.medidor(
    'fog_buffer_mensagens',
    'Mensagens guardadas esperando a nuvem.',
  ),
  online: metricasFog.medidor(
    'fog_postes_online',
    'Postes que reportaram na última janela.',
  ),
};

function servirMetricas(porta: number): void {
  createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
    res.end(metricasFog.texto());
  }).listen(porta, () => log(`métricas em :${porta}/metrics`));
}

/// Identificação do gateway no campo `via` das mensagens que ele emite.
const viaFog = (bairro: string): string => `fog-${slugBairro(bairro)}`;

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
  /// Mensagens do campo descartadas por estarem fora do contrato.
  invalidas = 0;

  /** Fecha a janela: devolve os números (para a nuvem) e o texto (para o log). */
  fecharJanela(buffer: number): {
    numeros: Pick<
      MsgFogTrafego,
      'entrada' | 'saida' | 'reducaoMsgsPct' | 'reducaoBytesPct'
    >;
    texto: string;
  } {
    const reducao = (saida: number, entrada: number): number | null =>
      entrada ? Math.round((1 - saida / entrada) * 100) : null;
    const pct = (r: number | null): string => (r === null ? '—' : `-${r}%`);
    const kb = (b: number): string => `${(b / 1024).toFixed(1)} KB`;
    const numeros = {
      entrada: { msgs: this.entradaMsgs, bytes: this.entradaBytes },
      saida: { msgs: this.saidaMsgs, bytes: this.saidaBytes },
      reducaoMsgsPct: reducao(this.saidaMsgs, this.entradaMsgs),
      reducaoBytesPct: reducao(this.saidaBytes, this.entradaBytes),
    };
    const texto =
      `campo → fog: ${this.entradaMsgs} msgs (${kb(this.entradaBytes)}) | ` +
      `fog → nuvem: ${this.saidaMsgs} msgs (${kb(this.saidaBytes)}) | ` +
      `redução ${pct(numeros.reducaoMsgsPct)} msgs, ` +
      `${pct(numeros.reducaoBytesPct)} bytes · buffer ${buffer}` +
      (this.invalidas ? ` · ${this.invalidas} fora do contrato` : '');
    this.entradaMsgs = this.entradaBytes = this.saidaMsgs = this.saidaBytes = 0;
    this.invalidas = 0;
    return { numeros, texto };
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
  servirMetricas(config.metricasPorta);
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
    nuvem.subscribe([assinaturaNuvem('comando'), assinaturaNuvem('ota')], {
      qos: 1,
    });
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
        assinaturaDominio(DOMINIO_ILUMINACAO, 'telemetria'),
        assinaturaDominio(DOMINIO_ILUMINACAO, 'evento'),
        assinaturaDominio(DOMINIO_ILUMINACAO, 'estado'),
        TOPICO_EDGE_ESTADO,
      ],
      { qos: 1 },
    );
  });
  campo.on('error', (erro) => log(`erro no broker do campo: ${erro.message}`));

  const enviarAlertas = (alertas: MsgAlerta[]): void => {
    for (const a of alertas) {
      MF.alertas.inc({ status: a.status });
      log(
        `alerta ${a.bairro} · ${a.codigo}: ${a.statusAnterior} → ${a.status} (${a.motivo})`,
      );
      uplink.enviar({
        topico: topicoNuvem(a.bairro, 'alerta'),
        payload: JSON.stringify(a),
      });
    }
  };

  // Presença do simulador de campo (Last Will do edge), repassada no relatório.
  let edgeOnline: boolean | null = null;

  campo.on('message', (topico, payload) => {
    if (topico === TOPICO_EDGE_ESTADO) {
      const estado = lerJson<MsgEdgeEstado>(payload);
      if (estado && estado.online !== edgeOnline) {
        edgeOnline = estado.online;
        log(`campo (edge) ${edgeOnline ? 'no ar' : 'fora do ar'}`);
      }
      return;
    }
    const alvo = parseTopicoDispositivo(topico);
    const gateway = alvo && gateways.get(alvo.site);
    if (!alvo || !gateway || alvo.dominio !== DOMINIO_ILUMINACAO) return;
    trafego.entradaMsgs++;
    trafego.entradaBytes += payload.length;

    // Toda mensagem do campo é validada contra o contrato v1.0.
    const validacao = validarMensagem(payload);
    if (!validacao.valida) {
      trafego.invalidas++;
      log(
        `mensagem fora do contrato em ${topico}: ${validacao.erros.join('; ')}`,
      );
      return;
    }
    const m = validacao.mensagem;
    const posteId = gateway.idDe(m.dispositivo);
    if (!posteId || m.dispositivo !== alvo.dispositivo) return;

    if (m.tipo === 'telemetria') {
      const t = lerTelemetria(m);
      if (t) enviarAlertas(gateway.receberTelemetria({ ...t, posteId }));
    } else if (m.tipo === 'estado') {
      const e = lerSaude(m);
      if (e) gateway.receberSaude({ ...e, posteId });
    } else if (m.tipo === 'evento') {
      // Resultado de OTA sobe na hora: é ele que a nuvem usa para decidir as ondas.
      const ota = lerOtaResultado(m);
      if (ota) {
        uplink.enviar({
          topico: topicoNuvem(gateway.bairro, 'ota-resultado'),
          payload: JSON.stringify({ ...ota, posteId }),
        });
        return;
      }
      const sensor = lerEventoSensor(m);
      const evento = sensor && gateway.receberEvento({ ...sensor, posteId });
      if (evento) {
        uplink.enviar({
          topico: topicoNuvem(gateway.bairro, 'evento'),
          payload: JSON.stringify({ ...evento, correlacao: m.id_mensagem }),
        });
        if (rastroAtivo()) {
          registrar('debug', 'fog', 'evento repassado à nuvem', {
            correlacao: m.id_mensagem,
            dispositivo: m.dispositivo,
            bairro: gateway.bairro,
          });
        }
      }
    }
  });

  // --- Comandos da nuvem → poste -------------------------------------
  nuvem.on('message', (topico, payload) => {
    const alvo = parseTopicoNuvem(topico);
    const gateway = alvo && gateways.get(alvo.bairroSlug);
    if (!alvo || !gateway) return;

    if (alvo.grandeza === 'ota') {
      const ota = lerJson<MsgOtaNuvem>(payload);
      const destino = ota && gateway.topicoComando(ota.codigo);
      if (!ota || !destino) return;
      campo.publish(
        destino,
        JSON.stringify(
          comandoAtualizarFirmware(
            ota.codigo,
            ota.versao,
            ota.em,
            viaFog(gateway.bairro),
          ),
        ),
        { qos: 1 },
      );
      log(`OTA repassada ao campo: ${ota.codigo} → ${ota.versao}`);
      return;
    }

    const msg = lerJson<MsgComandoNuvem>(payload);
    if (alvo.grandeza !== 'comando' || !msg) return;
    if (
      msg.status !== StatusPoste.MANUTENCAO &&
      msg.status !== StatusPoste.NORMAL
    ) {
      return;
    }
    const destino = gateway.aplicarComando(msg.codigo, msg.status);
    if (!destino) return;
    campo.publish(
      destino,
      JSON.stringify(
        comandoDefinirStatus(
          msg.codigo,
          msg.status,
          msg.em,
          viaFog(gateway.bairro),
        ),
      ),
      { qos: 1 },
    );
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
    const porGateway: MsgFogTrafego['gateways'] = [];
    for (const g of gateways.values()) {
      const resumo = g.fecharJanela();
      online += resumo.totais.online;
      porGateway.push({
        bairro: g.bairro,
        postes: resumo.totais.postes,
        online: resumo.totais.online,
      });
      uplink.enviar({
        topico: topicoNuvem(g.bairro, 'resumo'),
        payload: JSON.stringify(resumo),
      });
    }
    MF.mensagens.inc({ direcao: 'invalida' }, trafego.invalidas);
    const { numeros, texto } = trafego.fecharJanela(uplink.pendentes);
    MF.mensagens.inc({ direcao: 'entrada' }, numeros.entrada.msgs);
    MF.mensagens.inc({ direcao: 'saida' }, numeros.saida.msgs);
    MF.bytes.inc({ direcao: 'entrada' }, numeros.entrada.bytes);
    MF.bytes.inc({ direcao: 'saida' }, numeros.saida.bytes);
    MF.buffer.set(uplink.pendentes);
    MF.online.set(online);
    log(
      `janela ${config.janelaResumoMs / 1000}s · ${online}/${totalPostes} postes no ar · ${texto}`,
    );

    // Relatório de banda para a nuvem: retido (quem assina recebe o último) e
    // fora do buffer, porque um relatório velho não interessa.
    if (nuvem.connected) {
      nuvem.publish(
        TOPICO_FOG_TRAFEGO,
        JSON.stringify({
          janelaS: config.janelaResumoMs / 1000,
          ...numeros,
          buffer: uplink.pendentes,
          postes: { total: totalPostes, online },
          gateways: porGateway,
          edgeOnline,
          em: new Date().toISOString(),
        } satisfies MsgFogTrafego),
        { qos: 1, retain: true },
      );
    }
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
