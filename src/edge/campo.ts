import { StatusPoste } from '@prisma/client';
import { perfilFirmware } from '../common/firmware';
import {
  COMANDO_ATUALIZAR_FIRMWARE,
  eventoCanonico,
  lerComando,
  LocalPoste,
  otaResultadoCanonico,
  saudeCanonica,
  telemetriaCanonica,
} from '../common/codec-iluminacao';
import {
  DOMINIO_ILUMINACAO,
  MensagemCanonica,
  parseTopicoDispositivo,
  slug,
  TipoMensagem,
  topicoDispositivo,
  validarMensagem,
} from '../common/contrato';
import type { PosteProvisionado } from '../common/provisionamento';
import type {
  MsgEvento,
  MsgOtaResultado,
  MsgSaude,
  MsgTelemetria,
} from '../common/topicos-mqtt';
import {
  aplicarStatusManual,
  EstadoPoste,
  estadoInicial,
  gerarLeitura,
  passoSensor,
  passoStatus,
  probDeteccaoPorTick,
} from '../simulador/simulador.engine';

export type { PosteProvisionado };

/// Mensagem pronta para o broker.
export interface Publicacao {
  topico: string;
  payload: string;
  qos: 0 | 1;
}

interface Dispositivo {
  estado: EstadoPoste;
  bairro: string;
  local: LocalPoste;
  ligadoEmMs: number;
  versaoFirmware: string;
  reinicios: number;
  /// OTA em andamento: o aparelho está reiniciando e não publica nada.
  instalacao: { versaoAlvo: string; ateMs: number } | null;
}

/// Tempo que o aparelho leva para gravar a versão nova e reiniciar.
export const DURACAO_OTA_PADRAO_MS = 8_000;

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
 *
 * Tudo sai no contrato canônico (`contrato.ts`): tópico
 * `itaguari/<bairro>/iluminacao/<poste>/<tipo>` e a mensagem com `id_mensagem`,
 * `medidas` em UCUM e o local (bairro, rua e coordenadas GeoJSON).
 *
 * OTA: cada poste roda uma versão de firmware. Ao receber uma ordem de
 * atualização ele grava a versão nova, reinicia (fica mudo alguns segundos) e
 * faz o autoteste; se falhar, volta sozinho para a anterior (partições A/B).
 * O perfil da versão (ex.: gastar mais energia) passa a valer na operação.
 */
export class CampoEdge {
  private readonly dispositivos = new Map<string, Dispositivo>();
  private readonly porCodigo = new Map<string, Dispositivo>();
  private readonly probDeteccao: number;

  constructor(
    postes: PosteProvisionado[],
    versaoFirmware: string,
    intervaloSensoresMs: number,
    agoraMs = Date.now(),
    private readonly duracaoOtaMs = DURACAO_OTA_PADRAO_MS,
  ) {
    this.probDeteccao = probDeteccaoPorTick(intervaloSensoresMs);
    for (const p of postes) {
      const d: Dispositivo = {
        estado: estadoInicial(p),
        bairro: p.bairro,
        local: {
          site: slug(p.bairro),
          ...(p.endereco ? { area: slug(p.endereco.split(',')[0]) } : {}),
          ...(p.latitude !== undefined && p.longitude !== undefined
            ? { latitude: p.latitude, longitude: p.longitude }
            : {}),
        },
        ligadoEmMs: agoraMs,
        versaoFirmware,
        reinicios: 0,
        instalacao: null,
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
      if (d.instalacao) continue; // reiniciando
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
      saida.push(this.publicacao(d, 'evento', eventoCanonico(msg, d.local), 1));
    }
    return saida;
  }

  /** Leitura de consumo de cada poste que está no ar. */
  tickTelemetria(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    for (const d of this.dispositivos.values()) {
      if (d.instalacao) continue; // reiniciando
      const leitura = gerarLeitura(d.estado, agora);
      if (!leitura) continue; // poste em falha não publica
      // O firmware também pesa no consumo (ex.: rádio ligado por mais tempo).
      const consumoKw = Number(
        (
          leitura.consumoKw * perfilFirmware(d.versaoFirmware).fatorConsumo
        ).toFixed(4),
      );
      d.estado.consumoKw = consumoKw;
      const msg: MsgTelemetria = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        consumoKw,
        luminosidadePct: leitura.luminosidadePct,
        em: agora.toISOString(),
      };
      saida.push(
        this.publicacao(d, 'telemetria', telemetriaCanonica(msg, d.local), 0),
      );
    }
    return saida;
  }

  /** Saúde do dispositivo: versão de firmware, uptime, sinal e memória. */
  tickSaude(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    for (const d of this.dispositivos.values()) {
      if (d.estado.status === StatusPoste.FALHA_OFFLINE || d.instalacao) {
        continue;
      }
      const msg: MsgSaude = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        versaoFirmware: d.versaoFirmware,
        uptimeS: Math.floor((agora.getTime() - d.ligadoEmMs) / 1000),
        reinicios24h: d.reinicios,
        rssiDbm: Math.round(entre(-85, -60)),
        memoriaLivreKb: Math.round(entre(170, 190)),
        em: agora.toISOString(),
      };
      saida.push(this.publicacao(d, 'estado', saudeCanonica(msg, d.local), 0));
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
   * Comando recebido do fog (mensagem canônica no tópico `.../comando`): o
   * técnico colocou o poste em manutenção ou a nuvem mandou atualizar o
   * firmware. Devolve o poste e o que foi feito, ou null se a mensagem foi
   * ignorada (fora do contrato, poste desconhecido, fora do ar ou já instalando).
   */
  receberComando(
    topico: string,
    payload: string,
    agoraMs = Date.now(),
  ): { codigo: string; acao: 'status' | 'ota'; valor: string } | null {
    const alvo = parseTopicoDispositivo(topico);
    if (!alvo || alvo.tipo !== 'comando') return null;
    if (alvo.dominio !== DOMINIO_ILUMINACAO) return null;
    const d = this.porCodigo.get(alvo.dispositivo);
    if (!d) return null;

    const validacao = validarMensagem(payload);
    if (!validacao.valida) return null;
    const comando = lerComando(validacao.mensagem);
    if (!comando) return null;

    if (comando.nome === COMANDO_ATUALIZAR_FIRMWARE) {
      if (d.instalacao || d.estado.status === StatusPoste.FALHA_OFFLINE) {
        return null;
      }
      d.instalacao = {
        versaoAlvo: comando.versao,
        ateMs: agoraMs + this.duracaoOtaMs,
      };
      return { codigo: d.estado.codigo, acao: 'ota', valor: comando.versao };
    }

    aplicarStatusManual(d.estado, comando.status);
    return { codigo: d.estado.codigo, acao: 'status', valor: comando.status };
  }

  /** Conclui as instalações cujo reinício terminou e publica o resultado. */
  tickOta(agora = new Date()): Publicacao[] {
    const saida: Publicacao[] = [];
    const agoraMs = agora.getTime();
    for (const d of this.dispositivos.values()) {
      if (!d.instalacao || agoraMs < d.instalacao.ateMs) continue;

      const { versaoAlvo } = d.instalacao;
      const anterior = d.versaoFirmware;
      const falhou = perfilFirmware(versaoAlvo).falhaAutoteste;
      d.instalacao = null;
      d.ligadoEmMs = agoraMs;
      // Com rollback o aparelho reinicia duas vezes: na nova e de volta na anterior.
      d.reinicios += falhou ? 2 : 1;
      if (!falhou) d.versaoFirmware = versaoAlvo;

      const msg: MsgOtaResultado = {
        posteId: d.estado.id,
        codigo: d.estado.codigo,
        versaoAlvo,
        versaoAtual: d.versaoFirmware,
        sucesso: !falhou,
        motivo: falhou
          ? `autoteste falhou após o reinício — rollback automático para ${anterior} (partição A/B)`
          : 'instalada e confirmada no autoteste',
        em: agora.toISOString(),
      };
      saida.push(
        this.publicacao(d, 'evento', otaResultadoCanonico(msg, d.local), 1),
      );
    }
    return saida;
  }

  private publicacao(
    d: Dispositivo,
    tipo: TipoMensagem,
    msg: MensagemCanonica,
    qos: 0 | 1,
  ): Publicacao {
    return {
      topico: topicoDispositivo(
        d.bairro,
        DOMINIO_ILUMINACAO,
        d.estado.codigo,
        tipo,
      ),
      payload: JSON.stringify(msg),
      qos,
    };
  }
}
