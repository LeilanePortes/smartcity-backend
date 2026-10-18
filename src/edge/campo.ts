import { StatusPoste } from '@prisma/client';
import {
  MsgComando,
  MsgEvento,
  MsgSaude,
  MsgTelemetria,
  parseTopicoPoste,
  topicoPoste,
} from '../common/topicos-mqtt';
import {
  aplicarStatusManual,
  EstadoPoste,
  estadoInicial,
  gerarLeitura,
  PosteAtual,
  passoSensor,
  passoStatus,
  probDeteccaoPorTick,
} from '../simulador/simulador.engine';

/// Poste como recebido no provisionamento (`GET /postes` da nuvem).
export interface PosteProvisionado extends PosteAtual {
  bairro: string;
}

/// Mensagem pronta para o broker.
export interface Publicacao {
  topico: string;
  payload: string;
  qos: 0 | 1;
}

interface Dispositivo {
  estado: EstadoPoste;
  bairro: string;
  ligadoEmMs: number;
}

const entre = (min: number, max: number): number =>
  min + Math.random() * (max - min);

/**
 * Camada edge: os 248 controladores de poste da rede, simulados.
 *
 * Cada poste decide a própria luminosidade localmente (sensor 360° → pico,
 * veículo se afasta → piso), sem depender da rede. O campo só publica o que
 * mediu; quem diagnostica o status (consumo alto, offline) é o fog.
 *
 * As "falhas físicas" reaproveitam o motor do simulador: um driver degradado
 * gasta mais (CONSUMO_ALTO) e um poste em falha simplesmente para de publicar
 * (FALHA_OFFLINE), que é como um aparelho real some da rede.
 */
export class CampoEdge {
  private readonly dispositivos = new Map<string, Dispositivo>();
  private readonly porCodigo = new Map<string, Dispositivo>();
  private readonly probDeteccao: number;

  constructor(
    postes: PosteProvisionado[],
    private readonly versaoFirmware: string,
    intervaloSensoresMs: number,
    agoraMs = Date.now(),
  ) {
    this.probDeteccao = probDeteccaoPorTick(intervaloSensoresMs);
    for (const p of postes) {
      const d: Dispositivo = {
        estado: estadoInicial(p),
        bairro: p.bairro,
        ligadoEmMs: agoraMs,
      };
      this.dispositivos.set(p.id, d);
      this.porCodigo.set(p.codigo, d);
    }
  }

  get total(): number {
    return this.dispositivos.size;
  }

  /** Quantos postes estão publicando (não estão em falha). */
  get online(): number {
    let n = 0;
    for (const d of this.dispositivos.values()) {
      if (d.estado.status !== StatusPoste.FALHA_OFFLINE) n++;
    }
    return n;
  }

  /** Sensor 360°: decisão local de luminosidade; publica só o que mudou. */
  tickSensores(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    for (const d of this.dispositivos.values()) {
      const evento = passoSensor(d.estado, agora, this.probDeteccao);
      if (!evento) continue;
      const msg: MsgEvento = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        tipo: evento.tipo,
        sentido: evento.sentido,
        luminosidadeResultante: evento.luminosidadeResultante,
        em: agora.toISOString(),
      };
      saida.push(this.publicacao(d, 'evento', msg, 1));
    }
    return saida;
  }

  /** Leitura de consumo de cada poste que está no ar. */
  tickTelemetria(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    for (const d of this.dispositivos.values()) {
      const leitura = gerarLeitura(d.estado, agora);
      if (!leitura) continue; // poste em falha não publica
      const msg: MsgTelemetria = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        consumoKw: leitura.consumoKw,
        luminosidadePct: leitura.luminosidadePct,
        em: agora.toISOString(),
      };
      saida.push(this.publicacao(d, 'telemetria', msg, 0));
    }
    return saida;
  }

  /** Saúde do dispositivo: versão de firmware, uptime, sinal e memória. */
  tickSaude(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    for (const d of this.dispositivos.values()) {
      if (d.estado.status === StatusPoste.FALHA_OFFLINE) continue;
      const msg: MsgSaude = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        versaoFirmware: this.versaoFirmware,
        uptimeS: Math.floor((agora.getTime() - d.ligadoEmMs) / 1000),
        reinicios24h: 0,
        rssiDbm: Math.round(entre(-85, -60)),
        memoriaLivreKb: Math.round(entre(170, 190)),
        em: agora.toISOString(),
      };
      saida.push(this.publicacao(d, 'saude', msg, 0));
    }
    return saida;
  }

  /**
   * Falhas físicas ao longo do tempo (driver degradado, poste que cai e volta).
   * Devolve os postes cuja condição mudou, só para log.
   */
  tickFalhas(
    agora = new Date(),
  ): Array<{ codigo: string; condicao: StatusPoste }> {
    const estados = [...this.dispositivos.values()].map((d) => d.estado);
    const mudados = passoStatus(estados, agora);
    for (const e of mudados) {
      // Poste que volta de uma falha "religa": o uptime recomeça.
      if (e.status === StatusPoste.NORMAL) {
        const d = this.dispositivos.get(e.id);
        if (d) d.ligadoEmMs = agora.getTime();
      }
    }
    return mudados.map((e) => ({ codigo: e.codigo, condicao: e.status }));
  }

  /**
   * Comando recebido do fog/nuvem (ex.: técnico colocou o poste em manutenção).
   * Devolve o código do poste afetado, ou null se a mensagem for inválida.
   */
  aplicarComando(topico: string, payload: string): string | null {
    const alvo = parseTopicoPoste(topico);
    if (!alvo || alvo.grandeza !== 'comando') return null;
    const d = this.porCodigo.get(alvo.codigo);
    if (!d) return null;

    let msg: Partial<MsgComando>;
    try {
      msg = JSON.parse(payload) as Partial<MsgComando>;
    } catch {
      return null;
    }
    if (
      msg.status !== StatusPoste.MANUTENCAO &&
      msg.status !== StatusPoste.NORMAL
    ) {
      return null;
    }
    aplicarStatusManual(d.estado, msg.status);
    return d.estado.codigo;
  }

  private publicacao(
    d: Dispositivo,
    grandeza: 'telemetria' | 'evento' | 'saude',
    msg: object,
    qos: 0 | 1,
  ): Publicacao {
    return {
      topico: topicoPoste(d.bairro, d.estado.codigo, grandeza),
      payload: JSON.stringify(msg),
      qos,
    };
  }
}
