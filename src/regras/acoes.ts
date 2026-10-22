import { criarMensagem, topicoDispositivo } from '../common/contrato';

/// Ações das regras (RF-PRO-03): gerar alarme, notificar por e-mail, enviar
/// comando ao dispositivo, chamar webhook (com novas tentativas) e publicar em
/// tópico. As dependências externas entram por `Portas`, então cada ação é
/// testável sem banco, broker ou servidor de e-mail.

export const TIPOS_ACAO = [
  'alarme',
  'notificar',
  'comando',
  'webhook',
  'publicar',
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

export type Acao =
  | { tipo: 'alarme' }
  | { tipo: 'notificar'; email: string }
  | { tipo: 'comando'; nome: string; parametros?: Record<string, unknown> }
  | { tipo: 'webhook'; url: string; tentativas?: number }
  | { tipo: 'publicar'; topico: string };

export interface Disparo {
  regra: { id: string | null; nome: string };
  severidade: 'INFO' | 'AVISO' | 'CRITICO';
  dispositivo: {
    id: string;
    codigo: string;
    inquilino: string;
    site: string;
    dominio: string;
  };
  titulo: string;
  detalhe: string;
  grandeza?: string;
  valor?: number;
  ocorridoEm: Date;
  alarmeId?: string;
  /// id_mensagem que disparou a regra (rastro até o alarme e as ações).
  correlacao?: string;
}

export interface Portas {
  abrirAlarme(d: Disparo): Promise<{ id: string; novo: boolean }>;
  enviarEmail(para: string, assunto: string, texto: string): Promise<void>;
  publicarMqtt(topico: string, payload: object): boolean;
  postar(url: string, corpo: object): Promise<{ status: number }>;
  dormir(ms: number): Promise<void>;
}

export interface ResultadoAcao {
  tipo: TipoAcao;
  status: 'ok' | 'falha';
  destino?: string;
  tentativas: number;
  erro?: string;
  alarmeId?: string;
}

const TENTATIVAS_WEBHOOK = 3;

/** Motivo da recusa, ou null se a lista de ações é válida. */
export function erroAcoes(acoes: unknown): string | null {
  if (!Array.isArray(acoes) || !acoes.length) {
    return 'acoes deve ser uma lista com pelo menos uma ação';
  }
  for (const [i, a] of acoes.entries()) {
    const x = (a ?? {}) as Record<string, unknown>;
    const onde = `acoes[${i}]`;
    if (!TIPOS_ACAO.includes(x.tipo as TipoAcao)) {
      return `${onde}.tipo deve ser um de: ${TIPOS_ACAO.join(', ')}`;
    }
    if (
      x.tipo === 'notificar' &&
      !/^[^@\s]+@[^@\s]+$/.test(String(x.email ?? ''))
    ) {
      return `${onde}.email inválido`;
    }
    if (
      x.tipo === 'comando' &&
      !/^[a-z][a-z0-9_]*$/.test(String(x.nome ?? ''))
    ) {
      return `${onde}.nome do comando inválido (ex.: definir_status)`;
    }
    if (x.tipo === 'webhook') {
      try {
        if (!/^https?:$/.test(new URL(String(x.url)).protocol))
          throw new Error();
      } catch {
        return `${onde}.url deve ser http(s)`;
      }
      if (
        x.tentativas !== undefined &&
        !(
          Number.isInteger(x.tentativas) &&
          (x.tentativas as number) >= 1 &&
          (x.tentativas as number) <= 10
        )
      ) {
        return `${onde}.tentativas deve ser de 1 a 10`;
      }
    }
    if (x.tipo === 'publicar' && !/^[^#+\s]+$/.test(String(x.topico ?? ''))) {
      return `${onde}.topico inválido (sem curingas # ou +)`;
    }
  }
  return null;
}

/** Corpo comum de notificação, webhook e publicação. */
export function resumoDisparo(d: Disparo) {
  return {
    regra: d.regra,
    alarmeId: d.alarmeId ?? null,
    severidade: d.severidade,
    titulo: d.titulo,
    detalhe: d.detalhe,
    dispositivo: d.dispositivo.codigo,
    site: d.dispositivo.site,
    dominio: d.dispositivo.dominio,
    grandeza: d.grandeza ?? null,
    valor: d.valor ?? null,
    ocorridoEm: d.ocorridoEm.toISOString(),
    correlacao: d.correlacao ?? null,
  };
}

export async function executarAcao(
  acao: Acao,
  d: Disparo,
  portas: Portas,
): Promise<ResultadoAcao> {
  const falha = (
    erro: unknown,
    destino?: string,
    tentativas = 1,
  ): ResultadoAcao => ({
    tipo: acao.tipo,
    status: 'falha',
    destino,
    tentativas,
    erro: erro instanceof Error ? erro.message : String(erro),
  });

  switch (acao.tipo) {
    case 'alarme': {
      try {
        const { id } = await portas.abrirAlarme(d);
        d.alarmeId = id;
        return { tipo: 'alarme', status: 'ok', tentativas: 1, alarmeId: id };
      } catch (e) {
        return falha(e);
      }
    }
    case 'notificar': {
      try {
        await portas.enviarEmail(
          acao.email,
          `[${d.severidade}] ${d.titulo}`,
          `${d.titulo}\n\n${d.detalhe}\n\nDispositivo: ${d.dispositivo.codigo} (${d.dispositivo.site})\n` +
            `Regra: ${d.regra.nome}\nOcorrido em: ${d.ocorridoEm.toISOString()}`,
        );
        return {
          tipo: 'notificar',
          status: 'ok',
          destino: acao.email,
          tentativas: 1,
        };
      } catch (e) {
        return falha(e, acao.email);
      }
    }
    case 'comando': {
      const topico = topicoDispositivo(
        d.dispositivo.site,
        d.dispositivo.dominio,
        d.dispositivo.codigo,
        'comando',
        d.dispositivo.inquilino,
      );
      const msg = criarMensagem({
        dispositivo: d.dispositivo.codigo,
        tipo: 'comando',
        timestamp: new Date().toISOString(),
        via: 'motor-de-regras',
        comando: {
          nome: acao.nome,
          ...(acao.parametros ? { parametros: acao.parametros } : {}),
        },
      });
      return portas.publicarMqtt(topico, msg)
        ? { tipo: 'comando', status: 'ok', destino: topico, tentativas: 1 }
        : falha('broker MQTT indisponível', topico);
    }
    case 'publicar':
      return portas.publicarMqtt(acao.topico, resumoDisparo(d))
        ? {
            tipo: 'publicar',
            status: 'ok',
            destino: acao.topico,
            tentativas: 1,
          }
        : falha('broker MQTT indisponível', acao.topico);
    case 'webhook': {
      const maximo = acao.tentativas ?? TENTATIVAS_WEBHOOK;
      let erro: unknown = null;
      for (let n = 1; n <= maximo; n++) {
        try {
          const { status } = await portas.postar(acao.url, resumoDisparo(d));
          if (status >= 200 && status < 300) {
            return {
              tipo: 'webhook',
              status: 'ok',
              destino: acao.url,
              tentativas: n,
            };
          }
          erro = `HTTP ${status}`;
        } catch (e) {
          erro = e;
        }
        // Espera crescente entre as tentativas: 1 s, 2 s, 4 s...
        if (n < maximo) await portas.dormir(1000 * 2 ** (n - 1));
      }
      return falha(erro, acao.url, maximo);
    }
  }
}
