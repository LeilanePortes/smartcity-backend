import { StatusPoste } from '@prisma/client';
import type { PosteProvisionado } from '../common/provisionamento';
import { MsgTelemetria } from '../common/topicos-mqtt';
import { GatewayBairro, RegrasFog } from './gateway';

const REGRAS: RegrasFog = {
  limiarConsumoAlto: 1.5,
  limiarRetornoNormal: 1.3,
  timeoutOfflineMs: 30_000,
};

const poste = (
  codigo: string,
  status: StatusPoste = StatusPoste.NORMAL,
): PosteProvisionado => ({
  id: `id-${codigo}`,
  codigo,
  bairro: 'Vila Nova',
  status,
  luminosidadeAtual: 50,
  consumoInstantaneoKw: 0.05,
  ultimaLeituraEm: null,
});

const leitura = (
  codigo: string,
  consumoKw: number,
  luminosidadePct = 50,
): MsgTelemetria => ({
  posteId: `id-${codigo}`,
  codigo,
  consumoKw,
  luminosidadePct,
  em: '2026-10-18T22:00:00.000Z',
});

/** Bairro com 5 postes saudáveis (0,05 kW a 50% = 0,1 kW a 100%). */
function bairroSaudavel(extra: PosteProvisionado[] = []): GatewayBairro {
  const codigos = ['P-1', 'P-2', 'P-3', 'P-4', 'P-5'];
  const g = new GatewayBairro(
    'Vila Nova',
    [...codigos.map((c) => poste(c)), ...extra],
    REGRAS,
    0,
  );
  for (let i = 0; i < 3; i++) {
    for (const c of codigos) g.receberTelemetria(leitura(c, 0.05), 1_000);
  }
  return g;
}

describe('GatewayBairro', () => {
  it('não acusa consumo alto só porque o poste está no pico (veículo passando)', () => {
    const g = bairroSaudavel([poste('P-9')]);

    // No pico (100%) gasta o dobro em kW, mas o normalizado é o mesmo: 0,1.
    const alertas = [
      ...g.receberTelemetria(leitura('P-9', 0.1, 100), 1_000),
      ...g.receberTelemetria(leitura('P-9', 0.1, 100), 1_000),
    ];

    expect(alertas).toEqual([]);
  });

  it('diagnostica CONSUMO_ALTO pela mediana do bairro e volta a NORMAL', () => {
    const g = bairroSaudavel([poste('P-9')]);

    g.receberTelemetria(leitura('P-9', 0.11), 1_000); // driver degradado: 2,2×
    const [alerta] = g.receberTelemetria(leitura('P-9', 0.11), 1_000);

    expect(alerta).toMatchObject({
      codigo: 'P-9',
      bairro: 'Vila Nova',
      statusAnterior: 'NORMAL',
      status: 'CONSUMO_ALTO',
    });
    expect(alerta.motivo).toContain('× a mediana do bairro');

    // Driver trocado: depois de algumas leituras normais, volta a NORMAL.
    const retorno = [0, 1, 2].flatMap(() =>
      g.receberTelemetria(leitura('P-9', 0.05), 2_000),
    );
    expect(retorno).toEqual([
      expect.objectContaining({
        statusAnterior: 'CONSUMO_ALTO',
        status: 'NORMAL',
      }),
    ]);
  });

  it('marca FALHA_OFFLINE quando o poste fica mudo e NORMAL quando volta', () => {
    const g = new GatewayBairro('Vila Nova', [poste('P-1')], REGRAS, 0);

    expect(g.verificarOffline(29_000)).toEqual([]);
    const [offline] = g.verificarOffline(31_000);
    expect(offline).toMatchObject({ status: 'FALHA_OFFLINE' });
    expect(offline.motivo).toBe('sem telemetria há 31 s');
    expect(g.verificarOffline(60_000)).toEqual([]); // não repete o alerta
    expect(g.online).toBe(0);

    const [volta] = g.receberTelemetria(leitura('P-1', 0.05), 61_000);
    expect(volta).toMatchObject({
      statusAnterior: 'FALHA_OFFLINE',
      status: 'NORMAL',
      motivo: 'telemetria retomada',
    });
  });

  it('não diagnostica poste em manutenção e repassa o comando ao campo', () => {
    const g = new GatewayBairro('Vila Nova', [poste('P-1')], REGRAS, 0);

    const destino = g.aplicarComando('P-1', StatusPoste.MANUTENCAO, 0);

    expect(destino).toBe('itaguari/iluminacao/vila-nova/P-1/comando');
    expect(g.verificarOffline(120_000)).toEqual([]);
    expect(g.aplicarComando('P-404', StatusPoste.NORMAL)).toBeNull();
  });

  it('agrega a janela num resumo do bairro com energia e versão de firmware', () => {
    const g = new GatewayBairro(
      'Vila Nova',
      [poste('P-1'), poste('P-2', StatusPoste.FALHA_OFFLINE)],
      REGRAS,
      0,
    );
    g.receberTelemetria(leitura('P-1', 0.04), 10_000);
    g.receberTelemetria(leitura('P-1', 0.06, 100), 20_000);
    g.receberSaude({
      posteId: 'id-P-1',
      codigo: 'P-1',
      versaoFirmware: '2.4.1',
      uptimeS: 60,
      reinicios24h: 0,
      rssiDbm: -70,
      memoriaLivreKb: 180,
      em: '2026-10-18T22:00:00.000Z',
    });

    const resumo = g.fecharJanela(3_600_000); // janela de 1 h

    expect(resumo.totais).toEqual({
      postes: 2,
      online: 1,
      energiaKwh: 0.05, // 0,05 kW médios × 1 h
      leiturasRecebidas: 2,
    });
    expect(resumo.postes[0]).toMatchObject({
      codigo: 'P-1',
      leituras: 2,
      consumoMedioKw: 0.05,
      luminosidadeMediaPct: 75,
      luminosidadeAtual: 100,
      versaoFirmware: '2.4.1',
    });
    expect(resumo.postes[1]).toMatchObject({
      codigo: 'P-2',
      status: 'FALHA_OFFLINE',
      leituras: 0,
      consumoMedioKw: null,
    });

    // A janela seguinte começa zerada.
    expect(g.fecharJanela(3_660_000).totais.leiturasRecebidas).toBe(0);
  });
});
