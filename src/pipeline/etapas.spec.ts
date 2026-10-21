import { estaAtrasada, ordenarPorMedicao, validar } from './etapas';
import { intervaloAutomatico, resolverJanela } from './janela-serie';

const agora = new Date('2026-10-21T20:00:00Z');
const msg = (extra: Record<string, unknown> = {}) => ({
  versao: '1.0',
  id_mensagem: '0b5c3a2e-6f0d-4a8e-9a57-2d1f1b6c9e41',
  dispositivo: 'medidor-centro',
  tipo: 'telemetria',
  timestamp: '2026-10-21T19:59:00Z',
  medidas: [{ grandeza: 'potencia', valor: 12.4, unidade: 'kW' }],
  ...extra,
});

describe('pipeline · validar (RF-ING-06)', () => {
  it('aceita a mensagem canônica válida', () => {
    expect(validar(msg(), agora)).toHaveProperty('mensagem');
  });

  it('recusa fora do schema com a lista de erros', () => {
    const r = validar(msg({ medidas: undefined, extra: 1 }), agora);
    expect(r).toHaveProperty('recusa');
    if ('recusa' in r) {
      expect(r.recusa.etapa).toBe('validar');
      expect(r.recusa.erros.length).toBeGreaterThan(0);
    }
  });

  it('recusa versão desconhecida, comando vindo do dispositivo e timestamp no futuro', () => {
    const motivo = (p: unknown) => {
      const r = validar(p, agora);
      return 'recusa' in r ? r.recusa.motivo : null;
    };
    expect(motivo(msg({ versao: '9.0' }))).toMatch(/não suportada/);
    expect(
      motivo(
        msg({ tipo: 'comando', medidas: undefined, comando: { nome: 'x' } }),
      ),
    ).toMatch(/comando/);
    expect(motivo(msg({ timestamp: '2026-10-21T20:30:00Z' }))).toMatch(
      /futuro/,
    );
    expect(motivo('{nao é json')).toMatch(/JSON/);
  });
});

describe('pipeline · ordenar e atraso (RF-ING-04)', () => {
  it('ordena pela hora da medição, não pela chegada', () => {
    const itens = ['20:00', '18:00', '19:00'].map((h, i) => ({
      i,
      mensagem: msg({ timestamp: `2026-10-21T${h}:00Z` }) as never,
    }));
    expect(ordenarPorMedicao(itens).map((x) => x.i)).toEqual([1, 2, 0]);
  });

  it('medição de 48 h atrás é atrasada; a de 1 min, não', () => {
    const h48 = new Date(agora.getTime() - 48 * 3_600_000);
    expect(estaAtrasada(h48, agora, 300)).toBe(true);
    expect(estaAtrasada(new Date(agora.getTime() - 60_000), agora, 300)).toBe(
      false,
    );
  });
});

describe('séries · janela e agregação (RF-DAD-01)', () => {
  it('padrão: últimas 24 h, agregadas de 5 em 5 min', () => {
    const j = resolverJanela({}, agora);
    expect(j.fim).toEqual(agora);
    expect(agora.getTime() - j.inicio.getTime()).toBe(24 * 3_600_000);
    expect(j).toMatchObject({ intervalo: '5m', balde: '5 minutes' });
  });

  it('auto escolhe pelo tamanho do período; bruto não agrega', () => {
    expect(intervaloAutomatico(3_600_000)).toBe('bruto');
    expect(intervaloAutomatico(10 * 24 * 3_600_000)).toBe('1h');
    expect(intervaloAutomatico(90 * 24 * 3_600_000)).toBe('1d');
    expect(resolverJanela({ intervalo: 'bruto' }, agora).balde).toBeNull();
  });

  it('recusa período invertido ou maior que 400 dias', () => {
    expect(() =>
      resolverJanela(
        { inicio: '2026-10-21T21:00:00Z', fim: '2026-10-21T20:00:00Z' },
        agora,
      ),
    ).toThrow(/antes/);
    expect(() =>
      resolverJanela({ inicio: '2024-01-01T00:00:00Z' }, agora),
    ).toThrow(/400 dias/);
  });
});
