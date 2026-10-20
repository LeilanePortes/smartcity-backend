import { StatusPoste } from '@prisma/client';
import type { PosteProvisionado } from '../common/provisionamento';
import {
  MsgAlerta,
  MsgEvento,
  MsgEventoNuvem,
  MsgResumo,
  MsgSaude,
  MsgTelemetria,
  ResumoPoste,
} from '../common/topicos-mqtt';
import { DOMINIO_ILUMINACAO, topicoDispositivo } from '../common/contrato';

/// Regras do gateway (subconjunto de `FogConfig`).
export interface RegrasFog {
  limiarConsumoAlto: number;
  limiarRetornoNormal: number;
  timeoutOfflineMs: number;
}

/// Leituras recentes usadas para suavizar o consumo normalizado.
const JANELA_SUAVIZACAO = 3;

interface PosteFog {
  id: string;
  codigo: string;
  status: StatusPoste;
  /// Última telemetria recebida (epoch ms); começa no boot do gateway.
  ultimaTelemetriaMs: number;
  ultimaLeituraEm: string | null;
  consumoAtualKw: number | null;
  luminosidadeAtual: number | null;
  /// kW por 100% de luminosidade, nas últimas leituras (independe de pico/piso).
  normalizados: number[];
  versaoFirmware: string | null;
  janela: { leituras: number; somaConsumo: number; somaLuminosidade: number };
}

const arred = (n: number, casas = 4): number => Number(n.toFixed(casas));

const media = (xs: number[]): number =>
  xs.reduce((s, x) => s + x, 0) / xs.length;

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const ord = [...xs].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
}

const janelaVazia = () => ({
  leituras: 0,
  somaConsumo: 0,
  somaLuminosidade: 0,
});

/**
 * Gateway fog de um bairro.
 *
 * Recebe tudo o que os postes do bairro publicam e aplica as regras de borda:
 *
 * - **CONSUMO_ALTO**: consumo normalizado pela luminosidade (kW a 100% de brilho)
 *   acima de `limiarConsumoAlto` × a mediana do bairro. Normalizar evita marcar
 *   como defeituoso um poste que só está no pico porque passou um carro; a
 *   mediana evita que os próprios defeituosos puxem a referência para cima.
 * - **FALHA_OFFLINE**: nenhuma telemetria por `timeoutOfflineMs`.
 * - **MANUTENCAO**: só muda por comando do técnico (o fog não sobrescreve).
 *
 * Para a nuvem sobem: eventos e alertas na hora; telemetria só como resumo
 * agregado por janela.
 */
export class GatewayBairro {
  private readonly postes = new Map<string, PosteFog>();
  private inicioJanelaMs: number;

  constructor(
    readonly bairro: string,
    postes: PosteProvisionado[],
    private readonly regras: RegrasFog,
    agoraMs = Date.now(),
  ) {
    this.inicioJanelaMs = agoraMs;
    for (const p of postes) {
      this.postes.set(p.codigo, {
        id: p.id,
        codigo: p.codigo,
        status: p.status,
        ultimaTelemetriaMs: agoraMs,
        ultimaLeituraEm: p.ultimaLeituraEm?.toISOString() ?? null,
        consumoAtualKw: null,
        luminosidadeAtual: null,
        normalizados: [],
        versaoFirmware: null,
        janela: janelaVazia(),
      });
    }
  }

  get total(): number {
    return this.postes.size;
  }

  get online(): number {
    let n = 0;
    for (const p of this.postes.values()) {
      if (p.status !== StatusPoste.FALHA_OFFLINE) n++;
    }
    return n;
  }

  /** Leitura de consumo: acumula na janela e reavalia o diagnóstico. */
  receberTelemetria(msg: MsgTelemetria, agoraMs = Date.now()): MsgAlerta[] {
    const p = this.postes.get(msg.codigo);
    if (!p) return [];

    p.ultimaTelemetriaMs = agoraMs;
    p.ultimaLeituraEm = msg.em;
    p.consumoAtualKw = msg.consumoKw;
    p.luminosidadeAtual = msg.luminosidadePct;
    p.janela.leituras++;
    p.janela.somaConsumo += msg.consumoKw;
    p.janela.somaLuminosidade += msg.luminosidadePct;

    if (msg.luminosidadePct > 0) {
      p.normalizados.push(msg.consumoKw / (msg.luminosidadePct / 100));
      if (p.normalizados.length > JANELA_SUAVIZACAO) p.normalizados.shift();
    }

    if (p.status === StatusPoste.MANUTENCAO) return [];

    const alertas: MsgAlerta[] = [];
    if (p.status === StatusPoste.FALHA_OFFLINE) {
      alertas.push(
        this.mudar(p, StatusPoste.NORMAL, 'telemetria retomada', msg.em),
      );
    }
    const consumo = this.avaliarConsumo(p, msg.em);
    if (consumo) alertas.push(consumo);
    return alertas;
  }

  /** Saúde do dispositivo: o fog guarda só a versão de firmware para o resumo. */
  receberSaude(msg: MsgSaude): void {
    const p = this.postes.get(msg.codigo);
    if (p) p.versaoFirmware = msg.versaoFirmware;
  }

  /** Evento do sensor: sobe para a nuvem na hora, com o bairro. */
  receberEvento(msg: MsgEvento): MsgEventoNuvem | null {
    if (!this.postes.has(msg.codigo)) return null;
    return { ...msg, bairro: this.bairro };
  }

  /** Postes que ficaram mudos além do limite viram FALHA_OFFLINE. */
  verificarOffline(agoraMs = Date.now()): MsgAlerta[] {
    const alertas: MsgAlerta[] = [];
    const em = new Date(agoraMs).toISOString();
    for (const p of this.postes.values()) {
      if (
        p.status === StatusPoste.FALHA_OFFLINE ||
        p.status === StatusPoste.MANUTENCAO
      ) {
        continue;
      }
      const mudoMs = agoraMs - p.ultimaTelemetriaMs;
      if (mudoMs > this.regras.timeoutOfflineMs) {
        p.normalizados = [];
        alertas.push(
          this.mudar(
            p,
            StatusPoste.FALHA_OFFLINE,
            `sem telemetria há ${Math.round(mudoMs / 1000)} s`,
            em,
          ),
        );
      }
    }
    return alertas;
  }

  /**
   * Comando do técnico vindo da nuvem: atualiza o status no fog e devolve o
   * tópico do poste no campo para repassar, ou null se o poste não é deste bairro.
   */
  aplicarComando(
    codigo: string,
    status: typeof StatusPoste.MANUTENCAO | typeof StatusPoste.NORMAL,
    agoraMs = Date.now(),
  ): string | null {
    const p = this.postes.get(codigo);
    if (!p) return null;
    p.status = status;
    p.normalizados = [];
    // O poste acabou de mudar de condição: dá a ele o prazo inteiro para reportar.
    p.ultimaTelemetriaMs = agoraMs;
    return topicoDispositivo(
      this.bairro,
      DOMINIO_ILUMINACAO,
      codigo,
      'comando',
    );
  }

  /** Tópico de comando de um poste deste bairro, ou null se ele não é daqui. */
  topicoComando(codigo: string): string | null {
    return this.postes.has(codigo)
      ? topicoDispositivo(this.bairro, DOMINIO_ILUMINACAO, codigo, 'comando')
      : null;
  }

  /** Id do poste no cadastro (a mensagem canônica traz só o código). */
  idDe(codigo: string): string | null {
    return this.postes.get(codigo)?.id ?? null;
  }

  /** Fecha a janela de agregação e devolve o resumo do bairro. */
  fecharJanela(agoraMs = Date.now()): MsgResumo {
    const inicio = this.inicioJanelaMs;
    const horas = (agoraMs - inicio) / 3_600_000;
    const postes: ResumoPoste[] = [];
    let energiaTotal = 0;
    let leiturasTotal = 0;

    for (const p of this.postes.values()) {
      const { leituras, somaConsumo, somaLuminosidade } = p.janela;
      const consumoMedio = leituras ? somaConsumo / leituras : null;
      // Energia da janela ≈ potência média × duração (só se o poste reportou).
      const energia = consumoMedio !== null ? consumoMedio * horas : 0;
      energiaTotal += energia;
      leiturasTotal += leituras;
      postes.push({
        posteId: p.id,
        codigo: p.codigo,
        status: p.status,
        leituras,
        consumoMedioKw: consumoMedio !== null ? arred(consumoMedio) : null,
        luminosidadeMediaPct: leituras
          ? Math.round(somaLuminosidade / leituras)
          : null,
        energiaKwh: arred(energia, 6),
        consumoAtualKw: p.consumoAtualKw,
        luminosidadeAtual: p.luminosidadeAtual,
        ultimaLeituraEm: p.ultimaLeituraEm,
        versaoFirmware: p.versaoFirmware,
      });
      p.janela = janelaVazia();
    }

    this.inicioJanelaMs = agoraMs;
    return {
      bairro: this.bairro,
      inicio: new Date(inicio).toISOString(),
      fim: new Date(agoraMs).toISOString(),
      postes,
      totais: {
        postes: this.total,
        online: this.online,
        energiaKwh: arred(energiaTotal, 6),
        leiturasRecebidas: leiturasTotal,
      },
    };
  }

  /** Compara o consumo normalizado do poste com a mediana do bairro. */
  private avaliarConsumo(p: PosteFog, em: string): MsgAlerta | null {
    if (p.normalizados.length < 2) return null; // poucos dados: não decide

    const referencia = mediana(
      [...this.postes.values()]
        .filter(
          (o) =>
            o.normalizados.length > 0 &&
            o.status !== StatusPoste.FALHA_OFFLINE &&
            o.status !== StatusPoste.MANUTENCAO,
        )
        .map((o) => media(o.normalizados)),
    );
    if (!referencia) return null;

    const razao = media(p.normalizados) / referencia;
    const motivo = `consumo ${razao.toFixed(2).replace('.', ',')}× a mediana do bairro`;

    if (
      p.status === StatusPoste.NORMAL &&
      razao > this.regras.limiarConsumoAlto
    ) {
      return this.mudar(p, StatusPoste.CONSUMO_ALTO, motivo, em);
    }
    if (
      p.status === StatusPoste.CONSUMO_ALTO &&
      razao < this.regras.limiarRetornoNormal
    ) {
      return this.mudar(p, StatusPoste.NORMAL, motivo, em);
    }
    return null;
  }

  private mudar(
    p: PosteFog,
    status: StatusPoste,
    motivo: string,
    em: string,
  ): MsgAlerta {
    const alerta: MsgAlerta = {
      posteId: p.id,
      codigo: p.codigo,
      bairro: this.bairro,
      statusAnterior: p.status,
      status,
      motivo,
      em,
    };
    p.status = status;
    return alerta;
  }
}
