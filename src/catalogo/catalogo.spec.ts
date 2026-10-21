import {
  gerarCredencial,
  hashToken,
  prefixoDoToken,
  tokenConfere,
} from './credenciais';
import { estadoConexao } from './conexao';
import { avaliarMedidas } from './grandezas';
import { converter } from './unidades';

describe('credencial por dispositivo (RF-DIS-02)', () => {
  it('gera um token único, com prefixo público, e guarda só o hash', () => {
    const a = gerarCredencial();
    const b = gerarCredencial();
    expect(a.token).not.toBe(b.token);
    expect(prefixoDoToken(a.token)).toBe(a.prefixo);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it('confere o token pelo hash e recusa um token diferente', () => {
    const { token, hash } = gerarCredencial();
    expect(tokenConfere(token, hash)).toBe(true);
    expect(tokenConfere(gerarCredencial().token, hash)).toBe(false);
  });

  it('recusa tokens fora do formato', () => {
    expect(prefixoDoToken('abc')).toBeNull();
    expect(prefixoDoToken('dsp_123_xyz')).toBeNull();
  });
});

describe('online/offline pelo intervalo do perfil (RF-DIS-06)', () => {
  const agora = new Date('2026-10-21T12:00:00Z');
  const atras = (min: number) => new Date(agora.getTime() - min * 60_000);

  it('sensor que envia de hora em hora não aparece offline após 5 min sem dados', () => {
    expect(estadoConexao(atras(5), 3600, agora).online).toBe(true);
    expect(estadoConexao(atras(181), 3600, agora).online).toBe(false);
  });

  it('luminária (60 s) fica offline depois de 3 min sem dados', () => {
    expect(estadoConexao(atras(2), 60, agora)).toMatchObject({
      online: true,
      limiteOfflineS: 180,
    });
    expect(estadoConexao(atras(4), 60, agora).online).toBe(false);
  });

  it('dispositivo que nunca enviou nada está offline', () => {
    expect(estadoConexao(null, 60, agora).online).toBe(false);
  });
});

describe('faixa válida do perfil (RF-CEN-02)', () => {
  const perfil = [
    { grandeza: 'nivel', unidade: 'm', minimo: 0, maximo: 10 },
    { grandeza: 'temperatura', unidade: 'Cel' },
  ];

  it('marca como suspeita a medida fora da faixa, sem descartá-la', () => {
    const [ok, alta, baixa] = avaliarMedidas(perfil, [
      { grandeza: 'nivel', valor: 4.2, unidade: 'm' },
      { grandeza: 'nivel', valor: 12, unidade: 'm' },
      { grandeza: 'nivel', valor: -1 },
    ]);
    expect(ok.suspeita).toBe(false);
    expect(alta).toMatchObject({ valor: 12, suspeita: true });
    expect(alta.motivo).toMatch(/máximo/);
    expect(baixa.motivo).toMatch(/mínimo/);
  });

  it('marca grandeza não prevista e unidade incompatível; sem faixa, aceita', () => {
    const [nova, unidade, livre] = avaliarMedidas(perfil, [
      { grandeza: 'vazao', valor: 1 },
      { grandeza: 'nivel', valor: 3, unidade: 'V' },
      { grandeza: 'temperatura', valor: 80, unidade: 'Cel' },
    ]);
    expect(nova.motivo).toMatch(/não prevista/);
    expect(unidade.motivo).toMatch(/unidade/);
    expect(livre.suspeita).toBe(false);
  });

  it('normaliza para a unidade do perfil antes de conferir a faixa (RF-PRO-01)', () => {
    const [cm, f] = avaliarMedidas(perfil, [
      { grandeza: 'nivel', valor: 1250, unidade: 'cm' },
      { grandeza: 'temperatura', valor: 212, unidade: '[degF]' },
    ]);
    expect(cm).toMatchObject({
      valor: 12.5,
      unidade: 'm',
      convertidaDe: 'cm',
      suspeita: true,
    });
    expect(f.valor).toBeCloseTo(100, 6);
    expect(f.unidade).toBe('Cel');
  });
});

describe('conversão de unidades UCUM', () => {
  it('converte dentro da mesma grandeza e recusa grandezas diferentes', () => {
    expect(converter(1500, 'W', 'kW')).toBe(1.5);
    expect(converter(2, 'kW.h', 'W.h')).toBe(2000);
    expect(converter(0, 'Cel', 'K')).toBeCloseTo(273.15, 6);
    expect(converter(1, 'V', 'kW')).toBeNull();
    expect(converter(1, 'xyz', 'm')).toBeNull();
  });
});
