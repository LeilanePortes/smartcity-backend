import { diasFechadosRecentes, diasSemAgregado } from './recuperacao';

describe('recuperação de agregados diários', () => {
  it('lista os últimos dias já fechados, de ontem para trás', () => {
    const dias = diasFechadosRecentes(new Date('2026-10-19T15:56:00Z'), 3);

    expect(dias.map((d) => d.toISOString())).toEqual([
      '2026-10-18T00:00:00.000Z',
      '2026-10-17T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
    ]);
  });

  it('não inclui o dia de hoje, mesmo logo depois da meia-noite', () => {
    const [ontem] = diasFechadosRecentes(new Date('2026-10-19T00:01:00Z'), 1);
    expect(ontem.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('separa os dias que ficaram sem agregado (o cron não rodou)', () => {
    const dias = diasFechadosRecentes(new Date('2026-10-19T15:56:00Z'), 3);
    const consolidados = new Set([
      Date.parse('2026-10-17T00:00:00Z'),
      Date.parse('2026-10-16T00:00:00Z'),
    ]);

    expect(
      diasSemAgregado(dias, consolidados).map((d) => d.toISOString()),
    ).toEqual(['2026-10-18T00:00:00.000Z']);
  });
});
