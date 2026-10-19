import { inicioDoDiaUtc } from '../common/periodo';

const MS_DIA = 24 * 60 * 60_000;

/// Quantos dias fechados a API confere ao subir. Cobre uma semana parada
/// (ex.: o computador desligado de um fim de semana para o outro).
export const DIAS_RECUPERACAO = 7;

/** Início (UTC) dos últimos `quantidade` dias já fechados, de ontem para trás. */
export function diasFechadosRecentes(
  agora: Date,
  quantidade = DIAS_RECUPERACAO,
): Date[] {
  const hoje = inicioDoDiaUtc(agora).getTime();
  return Array.from(
    { length: quantidade },
    (_, i) => new Date(hoje - (i + 1) * MS_DIA),
  );
}

/** Dias da lista sem agregado consolidado (`consolidados` = inícios em ms). */
export function diasSemAgregado(
  dias: Date[],
  consolidados: ReadonlySet<number>,
): Date[] {
  return dias.filter((d) => !consolidados.has(d.getTime()));
}
