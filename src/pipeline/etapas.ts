import {
  MensagemCanonica,
  validarMensagem,
  VERSAO_CONTRATO,
} from '../common/contrato';
import { limiteOfflineS } from '../catalogo/conexao';

/// Etapas puras do pipeline de ingestão (Pipes and Filters, figura 5.1 do
/// documento de requisitos): cada uma recebe a mensagem e devolve a mensagem
/// ou uma recusa com o motivo, que vai para a fila de inválidas.

export type Canal = 'http' | 'lote' | 'mqtt';
export type Etapa = 'autenticar' | 'validar' | 'enriquecer';

export interface Recusa {
  etapa: Etapa;
  motivo: string;
  erros: string[];
}

/// Versões do contrato que a plataforma sabe validar (uma por JSON Schema).
export const VERSOES_SUPORTADAS: readonly string[] = [VERSAO_CONTRATO];

/// Relógio do dispositivo um pouco adiantado é tolerado; mais que isso, não.
export const TOLERANCIA_FUTURO_MS = 5 * 60_000;

export const recusa = (
  etapa: Etapa,
  motivo: string,
  erros: string[] = [motivo],
): Recusa => ({ etapa, motivo, erros });

/** Validar: JSON Schema da versão da mensagem + o que o schema não expressa. */
export function validar(
  payload: unknown,
  agora: Date,
): { mensagem: MensagemCanonica } | { recusa: Recusa } {
  const versao =
    payload && typeof payload === 'object' && 'versao' in payload
      ? (payload as { versao: unknown }).versao
      : undefined;
  if (typeof versao === 'string' && !VERSOES_SUPORTADAS.includes(versao)) {
    return {
      recusa: recusa(
        'validar',
        `versão do contrato "${versao}" não suportada (aceitas: ${VERSOES_SUPORTADAS.join(', ')})`,
      ),
    };
  }

  const r = validarMensagem(payload);
  if (!r.valida) {
    return { recusa: recusa('validar', 'fora do JSON Schema', r.erros) };
  }
  const m = r.mensagem;
  if (m.tipo === 'comando') {
    return {
      recusa: recusa(
        'validar',
        'tipo "comando" só vai da plataforma para o dispositivo',
      ),
    };
  }
  if (
    new Date(m.timestamp).getTime() - agora.getTime() >
    TOLERANCIA_FUTURO_MS
  ) {
    return {
      recusa: recusa(
        'validar',
        'timestamp no futuro (confira o relógio do dispositivo)',
      ),
    };
  }
  return { mensagem: m };
}

/**
 * Atrasada: chegou depois do limite de offline do perfil (3 intervalos). Ela
 * entra no histórico pela hora da medição, mas não dispara alarme como se
 * fosse atual (RF-ING-04).
 */
export function estaAtrasada(
  medidoEm: Date,
  recebidoEm: Date,
  intervaloEnvioS: number,
): boolean {
  return (
    recebidoEm.getTime() - medidoEm.getTime() >
    limiteOfflineS(intervaloEnvioS) * 1000
  );
}

/** Ordenar: pelo horário da medição, não pela chegada (estável). */
export function ordenarPorMedicao<T extends { mensagem: MensagemCanonica }>(
  itens: readonly T[],
): T[] {
  return itens
    .map((item, i) => ({ item, i, t: Date.parse(item.mensagem.timestamp) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ item }) => item);
}
