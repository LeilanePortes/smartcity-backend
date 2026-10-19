import { StatusPoste } from '@prisma/client';
import {
  AmostraPoste,
  alvoDaOnda,
  CriteriosOta,
  decidir,
  metricasGrupo,
  selecionarRepresentativo,
} from './ota.regras';

const CRITERIOS: CriteriosOta = {
  limiarFalhaInstalacaoPct: 5,
  limiarRazaoConsumo: 1.5,
  minReportePct: 60,
  maxExtensoes: 2,
};

const canarioSaudavel = {
  aparelhos: 13,
  reportaram: 13,
  consumoNormalizadoMedio: 0.1,
  consumoAltoPct: 0,
};

describe('OTA com grupo canário', () => {
  it('calcula o alvo acumulado de cada onda (mínimo 1, máximo a frota)', () => {
    expect(alvoDaOnda(5, 240)).toBe(12);
    expect(alvoDaOnda(5, 10)).toBe(1);
    expect(alvoDaOnda(100, 240)).toBe(240);
  });

  it('escolhe um grupo espalhado entre os bairros', () => {
    const candidatos = ['A', 'B', 'C'].flatMap((bairro) =>
      Array.from({ length: 10 }, (_, i) => ({
        codigo: `${bairro}-${i}`,
        bairro,
      })),
    );

    const grupo = selecionarRepresentativo(candidatos, 6);

    expect(grupo).toHaveLength(6);
    const porBairro = (b: string) => grupo.filter((p) => p.bairro === b).length;
    expect([porBairro('A'), porBairro('B'), porBairro('C')]).toEqual([2, 2, 2]);
  });

  it('mede o grupo só com resumos posteriores à instalação', () => {
    const amostra = (normalizado: number, inicioMs: number): AmostraPoste => ({
      normalizado,
      status: StatusPoste.NORMAL,
      versao: '3.0.0',
      inicioMs,
      fimMs: inicioMs + 60_000,
    });
    const amostras = new Map([
      ['P-1', amostra(0.18, 100_000)],
      ['P-2', amostra(0.2, 100_000)],
      ['P-3', amostra(0.1, 10_000)], // resumo de antes da instalação
    ]);

    const m = metricasGrupo(['P-1', 'P-2', 'P-3'], amostras, () => 50_000);

    expect(m).toEqual({
      aparelhos: 3,
      reportaram: 2,
      consumoNormalizadoMedio: 0.19,
      consumoAltoPct: 0,
    });
  });

  it('reverte quando a instalação falha acima do limite', () => {
    const r = decidir(
      {
        tentativas: 13,
        falhas: 13,
        canario: canarioSaudavel,
        referenciaConsumo: 0.1,
        extensoes: 0,
        ultimaOnda: false,
      },
      CRITERIOS,
    );
    expect(r.decisao).toBe('REVERTER');
    expect(r.motivo).toContain('falha de instalação em 100,0%');
  });

  it('reverte quando o canário gasta muito mais que o controle (defeito de energia)', () => {
    const r = decidir(
      {
        tentativas: 13,
        falhas: 0,
        canario: { ...canarioSaudavel, consumoNormalizadoMedio: 0.18 },
        referenciaConsumo: 0.1,
        extensoes: 0,
        ultimaOnda: false,
      },
      CRITERIOS,
    );
    expect(r).toMatchObject({ decisao: 'REVERTER', razaoConsumo: 1.8 });
    expect(r.motivo).toContain('1,80× o do grupo de controle');
  });

  it('estende a observação com poucos dados e reverte se continuar sem dados', () => {
    const entrada = {
      tentativas: 13,
      falhas: 0,
      canario: { ...canarioSaudavel, reportaram: 3 },
      referenciaConsumo: 0.1,
      extensoes: 0,
      ultimaOnda: false,
    };
    expect(decidir(entrada, CRITERIOS).decisao).toBe('ESTENDER');
    expect(decidir({ ...entrada, extensoes: 2 }, CRITERIOS).decisao).toBe(
      'REVERTER',
    );
  });

  it('avança quando tudo está normal e conclui na última onda', () => {
    const entrada = {
      tentativas: 13,
      falhas: 0,
      canario: { ...canarioSaudavel, consumoNormalizadoMedio: 0.102 },
      referenciaConsumo: 0.1,
      extensoes: 0,
      ultimaOnda: false,
    };
    expect(decidir(entrada, CRITERIOS)).toMatchObject({
      decisao: 'AVANCAR',
      razaoConsumo: 1.02,
    });
    expect(decidir({ ...entrada, ultimaOnda: true }, CRITERIOS).decisao).toBe(
      'CONCLUIR',
    );
  });
});
