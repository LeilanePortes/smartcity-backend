import { Prisma } from '@prisma/client';
import { MsgAlerta, MsgEventoNuvem, MsgResumo } from '../common/topicos-mqtt';

/// Tradução das mensagens do fog em registros do banco (sem I/O, testável).

export interface AtualizacaoPoste {
  posteId: string;
  data: Prisma.PosteUpdateInput;
}

export interface PlanoResumo {
  /// Uma leitura por poste que reportou na janela (média da janela).
  leituras: Prisma.LeituraTelemetriaCreateManyInput[];
  /// Campos "atuais" de cada poste ao fim da janela.
  atualizacoes: AtualizacaoPoste[];
}

/**
 * Resumo de um bairro → leituras + campos atuais. O fog já agregou: a nuvem
 * guarda uma leitura média por poste por janela (os KPIs usam potência média ×
 * horas, então o total de energia não depende da frequência das leituras).
 */
export function planejarResumo(msg: MsgResumo): PlanoResumo {
  const timestamp = new Date(msg.fim);
  const leituras: PlanoResumo['leituras'] = [];
  const atualizacoes: AtualizacaoPoste[] = [];

  for (const p of msg.postes) {
    const data: Prisma.PosteUpdateInput = { status: p.status };

    if (
      p.leituras > 0 &&
      p.consumoMedioKw !== null &&
      p.luminosidadeMediaPct !== null
    ) {
      leituras.push({
        posteId: p.posteId,
        timestamp,
        consumoKw: p.consumoMedioKw,
        luminosidadePct: p.luminosidadeMediaPct,
      });
    }
    if (p.consumoAtualKw !== null) data.consumoInstantaneoKw = p.consumoAtualKw;
    if (p.luminosidadeAtual !== null) {
      data.luminosidadeAtual = p.luminosidadeAtual;
    }
    if (p.ultimaLeituraEm) data.ultimaLeituraEm = new Date(p.ultimaLeituraEm);

    atualizacoes.push({ posteId: p.posteId, data });
  }

  return { leituras, atualizacoes };
}

/** Evento do sensor → linha do log + luminosidade atual do poste. */
export function planejarEvento(msg: MsgEventoNuvem): {
  evento: Prisma.EventoSensorCreateManyInput;
  atualizacao: AtualizacaoPoste;
} {
  return {
    evento: {
      posteId: msg.posteId,
      timestamp: new Date(msg.em),
      tipo: msg.tipo,
      sentido: msg.sentido,
      luminosidadeResultante: msg.luminosidadeResultante,
    },
    atualizacao: {
      posteId: msg.posteId,
      data: { luminosidadeAtual: msg.luminosidadeResultante },
    },
  };
}

/** Alerta do fog → novo status do poste. */
export function planejarAlerta(msg: MsgAlerta): AtualizacaoPoste {
  return { posteId: msg.posteId, data: { status: msg.status } };
}
