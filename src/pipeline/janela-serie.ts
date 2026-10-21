import type { Intervalo } from './dto/serie.query';

/// Janela e agregação de uma consulta de série (RF-DAD-01).

export const JANELA_PADRAO_MS = 24 * 3_600_000;
export const JANELA_MAXIMA_MS = 400 * 24 * 3_600_000;

const BALDES: Record<Exclude<Intervalo, 'auto' | 'bruto'>, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '1d': '1 day',
};

export interface JanelaResolvida {
  inicio: Date;
  fim: Date;
  intervalo: Exclude<Intervalo, 'auto'>;
  /// Intervalo do Postgres para o date_bin; null = medições brutas.
  balde: string | null;
}

/** `auto`: bruto até 2 h, 5 min até 2 dias, 1 h até 31 dias, 1 dia acima. */
export function intervaloAutomatico(ms: number): Exclude<Intervalo, 'auto'> {
  const h = ms / 3_600_000;
  if (h <= 2) return 'bruto';
  if (h <= 48) return '5m';
  if (h <= 31 * 24) return '1h';
  return '1d';
}

/** Resolve início, fim e agregação; lança Error com a mensagem para o 400. */
export function resolverJanela(
  q: { inicio?: string; fim?: string; intervalo?: Intervalo },
  agora: Date,
): JanelaResolvida {
  const fim = q.fim ? new Date(q.fim) : agora;
  const inicio = q.inicio
    ? new Date(q.inicio)
    : new Date(fim.getTime() - JANELA_PADRAO_MS);
  const ms = fim.getTime() - inicio.getTime();
  if (ms <= 0) throw new Error('inicio precisa ser antes de fim');
  if (ms > JANELA_MAXIMA_MS) {
    throw new Error('período máximo de uma consulta: 400 dias');
  }
  const intervalo =
    !q.intervalo || q.intervalo === 'auto'
      ? intervaloAutomatico(ms)
      : q.intervalo;
  return {
    inicio,
    fim,
    intervalo,
    balde: intervalo === 'bruto' ? null : BALDES[intervalo],
  };
}
