import {
  ALVO_STATUS,
  FATOR_CONSUMO_ALTO_MAX,
  FATOR_CONSUMO_ALTO_MIN,
  LUMINOSIDADE_PICO_PCT,
  LUMINOSIDADE_PISO_PCT,
  POTENCIA_NOMINAL_KW,
} from '../common/constants';
import { SentidoVeiculo, StatusPoste, TipoEventoSensor } from '@prisma/client';

/// Estado vivo de um poste, mantido em memória pelo simulador.
export interface EstadoPoste {
  id: string;
  codigo: string;
  status: StatusPoste;
  luminosidadePct: number;
  veiculoPresente: boolean;
  /// Momento (epoch ms) até o qual o poste permanece no pico; null quando no piso.
  picoAteMs: number | null;
  /// Sentido do veículo atualmente presente (para o evento de retorno ao piso).
  sentidoVeiculo: SentidoVeiculo | null;
  /// Multiplicador de consumo enquanto em CONSUMO_ALTO (1 fora dele).
  fatorConsumoAlto: number;
  consumoKw: number;
  ultimaLeituraEm: Date | null;
}

export interface EventoGerado {
  posteId: string;
  tipo: TipoEventoSensor;
  sentido: SentidoVeiculo;
  luminosidadeResultante: number;
  timestamp: Date;
}

export interface LeituraGerada {
  posteId: string;
  consumoKw: number;
  luminosidadePct: number;
  timestamp: Date;
}

// --- Parâmetros de comportamento ------------------------------------------

/// Fluxo médio de veículos por poste (rua de baixo movimento na madrugada).
/// A probabilidade de detecção por tick é derivada disto e do intervalo.
export const TAXA_DETECCAO_POR_MIN = 0.4;
/// Duração da presença de um veículo (poste no pico), em ms.
const PICO_MIN_MS = 8_000;
const PICO_MAX_MS = 22_000;

/// A cada tick de status, chance de haver alguma transição em cada categoria.
const PROB_TRANSICAO_STATUS = 0.35;
/// Estando já no alvo, chance de forçar um rodízio (um poste sara agora e outro
/// entra no próximo tick) — mantém a rede "viva" sem fugir da distribuição.
const PROB_RODIZIO_NO_ALVO = 0.25;

// --- Helpers -------------------------------------------------------------

const entre = (min: number, max: number): number =>
  min + Math.random() * (max - min);
const sorteiaSentido = (): SentidoVeiculo =>
  Math.random() < 0.5 ? SentidoVeiculo.APROXIMANDO : SentidoVeiculo.AFASTANDO;
const oposto = (s: SentidoVeiculo): SentidoVeiculo =>
  s === SentidoVeiculo.APROXIMANDO
    ? SentidoVeiculo.AFASTANDO
    : SentidoVeiculo.APROXIMANDO;
const sorteiaUm = <T>(itens: T[]): T | undefined =>
  itens.length ? itens[Math.floor(Math.random() * itens.length)] : undefined;
const conta = (estados: EstadoPoste[], status: StatusPoste): number =>
  estados.reduce((n, e) => (e.status === status ? n + 1 : n), 0);

/// Um poste só "enxerga" veículos quando está operando (piso ou pico).
const operante = (e: EstadoPoste): boolean =>
  e.status === StatusPoste.NORMAL || e.status === StatusPoste.CONSUMO_ALTO;

/// Converte a taxa de veículos/min na probabilidade de detecção por tick.
export const probDeteccaoPorTick = (intervaloMs: number): number =>
  Math.min(1, TAXA_DETECCAO_POR_MIN * (intervaloMs / 60_000));

// --- Estado inicial e mudança manual ------------------------------------

/// Campos "atuais" de um poste, como vêm do banco ou de `GET /postes`.
export interface PosteAtual {
  id: string;
  codigo: string;
  status: StatusPoste;
  luminosidadeAtual: number;
  consumoInstantaneoKw: number;
  ultimaLeituraEm: Date | null;
}

/** Monta o estado vivo de um poste a partir dos seus campos atuais. */
export function estadoInicial(p: PosteAtual): EstadoPoste {
  const noPico = p.luminosidadeAtual >= LUMINOSIDADE_PICO_PCT;
  return {
    id: p.id,
    codigo: p.codigo,
    status: p.status,
    luminosidadePct: p.luminosidadeAtual,
    veiculoPresente: noPico,
    sentidoVeiculo: null,
    picoAteMs: noPico ? Date.now() + 5_000 : null,
    fatorConsumoAlto:
      p.status === StatusPoste.CONSUMO_ALTO
        ? entre(FATOR_CONSUMO_ALTO_MIN, FATOR_CONSUMO_ALTO_MAX)
        : 1,
    consumoKw: p.consumoInstantaneoKw,
    ultimaLeituraEm: p.ultimaLeituraEm,
  };
}

/**
 * Aplica uma mudança de status feita pelo técnico (PATCH /postes/:id/status
 * ou comando MQTT): MANUTENCAO desliga o poste, NORMAL o devolve ao piso.
 */
export function aplicarStatusManual(
  estado: EstadoPoste,
  status: StatusPoste,
): void {
  estado.status = status;
  if (status === StatusPoste.MANUTENCAO) {
    estado.luminosidadePct = 0;
    estado.consumoKw = 0;
    estado.veiculoPresente = false;
    estado.sentidoVeiculo = null;
    estado.picoAteMs = null;
  } else if (status === StatusPoste.NORMAL) {
    estado.luminosidadePct = LUMINOSIDADE_PISO_PCT;
    estado.fatorConsumoAlto = 1;
  }
}

// --- Passo do sensor 360° ----------------------------------------------

/**
 * Evolui a luminosidade de um poste (piso 50% ↔ pico 100%) conforme a
 * detecção/perda de veículo. Muta `estado` e devolve o evento a persistir,
 * ou null se nada mudou neste tick.
 */
export function passoSensor(
  estado: EstadoPoste,
  agora: Date,
  probDeteccao: number,
): EventoGerado | null {
  if (!operante(estado)) return null;

  const agoraMs = agora.getTime();

  // No piso: pode detectar um veículo.
  if (estado.luminosidadePct === LUMINOSIDADE_PISO_PCT) {
    if (Math.random() >= probDeteccao) return null;
    const sentido = sorteiaSentido();
    estado.luminosidadePct = LUMINOSIDADE_PICO_PCT;
    estado.veiculoPresente = true;
    estado.sentidoVeiculo = sentido;
    estado.picoAteMs = agoraMs + entre(PICO_MIN_MS, PICO_MAX_MS);
    return {
      posteId: estado.id,
      tipo: TipoEventoSensor.VEICULO_DETECTADO,
      sentido,
      luminosidadeResultante: LUMINOSIDADE_PICO_PCT,
      timestamp: agora,
    };
  }

  // No pico: retorna ao piso quando o veículo se afasta.
  if (estado.picoAteMs !== null && agoraMs >= estado.picoAteMs) {
    const sentido = oposto(estado.sentidoVeiculo ?? SentidoVeiculo.APROXIMANDO);
    estado.luminosidadePct = LUMINOSIDADE_PISO_PCT;
    estado.veiculoPresente = false;
    estado.sentidoVeiculo = null;
    estado.picoAteMs = null;
    return {
      posteId: estado.id,
      tipo: TipoEventoSensor.RETORNO_AO_PISO,
      sentido,
      luminosidadeResultante: LUMINOSIDADE_PISO_PCT,
      timestamp: agora,
    };
  }

  return null;
}

// --- Geração de leitura de consumo -----------------------------------

/**
 * Consumo instantâneo coerente com o estado de luminosidade e o status.
 * Devolve null para postes offline (é a ausência de leitura que os define).
 */
export function gerarLeitura(
  estado: EstadoPoste,
  agora: Date,
): LeituraGerada | null {
  if (estado.status === StatusPoste.FALHA_OFFLINE) return null;

  let luminosidadePct = estado.luminosidadePct;
  let consumoKw: number;

  if (estado.status === StatusPoste.MANUTENCAO) {
    // Poste desligado pelo técnico: reporta, mas sem carga.
    luminosidadePct = 0;
    consumoKw = 0;
  } else {
    const base =
      POTENCIA_NOMINAL_KW * (luminosidadePct / 100) * entre(0.92, 1.08);
    consumoKw =
      estado.status === StatusPoste.CONSUMO_ALTO
        ? base * estado.fatorConsumoAlto
        : base;
  }

  consumoKw = Number(consumoKw.toFixed(4));
  estado.consumoKw = consumoKw;
  estado.luminosidadePct = luminosidadePct;
  estado.ultimaLeituraEm = agora;

  return { posteId: estado.id, consumoKw, luminosidadePct, timestamp: agora };
}

// --- Transição de status --------------------------------------------

function tornarNormal(estado: EstadoPoste, agora: Date): void {
  estado.status = StatusPoste.NORMAL;
  estado.fatorConsumoAlto = 1;
  estado.ultimaLeituraEm = agora;
}

function aplicarStatus(
  estado: EstadoPoste,
  status: StatusPoste,
  agora: Date,
): void {
  estado.status = status;
  if (status === StatusPoste.FALHA_OFFLINE) {
    estado.luminosidadePct = LUMINOSIDADE_PISO_PCT;
    estado.veiculoPresente = false;
    estado.sentidoVeiculo = null;
    estado.picoAteMs = null;
    // Marca o instante da última leitura válida; envelhece daqui pra frente.
    estado.ultimaLeituraEm = agora;
  } else if (status === StatusPoste.CONSUMO_ALTO) {
    estado.fatorConsumoAlto = entre(
      FATOR_CONSUMO_ALTO_MIN,
      FATOR_CONSUMO_ALTO_MAX,
    );
  }
}

/** Puxa a contagem de um status na direção do alvo, no máximo um poste por vez. */
function ajustarPopulacao(
  estados: EstadoPoste[],
  status: StatusPoste,
  alvo: number,
  agora: Date,
  mudados: Set<EstadoPoste>,
): void {
  const atual = conta(estados, status);
  const acimaOuIgual =
    atual > alvo || (atual === alvo && Math.random() < PROB_RODIZIO_NO_ALVO);

  if (acimaOuIgual && atual > 0) {
    const alvoPoste = sorteiaUm(
      estados.filter((e) => e.status === status && !mudados.has(e)),
    );
    if (alvoPoste) {
      tornarNormal(alvoPoste, agora);
      mudados.add(alvoPoste);
    }
  } else if (atual < alvo) {
    const candidato = sorteiaUm(
      estados.filter((e) => e.status === StatusPoste.NORMAL && !mudados.has(e)),
    );
    if (candidato) {
      aplicarStatus(candidato, status, agora);
      mudados.add(candidato);
    }
  }
}

/**
 * Faz a rede migrar entre status ao longo do tempo, mantendo a distribuição
 * próxima do alvo do PRD (231 normal / 9 consumo alto / 5 falha / 3 manutenção).
 * MANUTENCAO só é atribuída/removida manualmente (não é tocada aqui).
 * Muta os estados e devolve os que mudaram neste tick.
 */
export function passoStatus(
  estados: EstadoPoste[],
  agora: Date,
): EstadoPoste[] {
  const mudados = new Set<EstadoPoste>();

  if (Math.random() < PROB_TRANSICAO_STATUS) {
    ajustarPopulacao(
      estados,
      StatusPoste.FALHA_OFFLINE,
      ALVO_STATUS.FALHA_OFFLINE,
      agora,
      mudados,
    );
  }
  if (Math.random() < PROB_TRANSICAO_STATUS) {
    ajustarPopulacao(
      estados,
      StatusPoste.CONSUMO_ALTO,
      ALVO_STATUS.CONSUMO_ALTO,
      agora,
      mudados,
    );
  }

  return [...mudados];
}
