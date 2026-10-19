import { MsgAlerta, MsgResumo } from '../common/topicos-mqtt';
import { AlertasRecentes, MAX_ALERTAS_RECENTES } from './alertas-recentes';
import {
  planejarAlerta,
  planejarEvento,
  planejarResumo,
} from './ingestao.mapper';

const resumo: MsgResumo = {
  bairro: 'Centro',
  inicio: '2026-10-18T22:00:00.000Z',
  fim: '2026-10-18T22:01:00.000Z',
  postes: [
    {
      posteId: 'id-1',
      codigo: 'P-001',
      status: 'NORMAL',
      leituras: 6,
      consumoMedioKw: 0.0512,
      luminosidadeMediaPct: 58,
      energiaKwh: 0.000853,
      consumoAtualKw: 0.1,
      luminosidadeAtual: 100,
      ultimaLeituraEm: '2026-10-18T22:00:55.000Z',
      versaoFirmware: '2.4.1',
    },
    {
      posteId: 'id-2',
      codigo: 'P-002',
      status: 'FALHA_OFFLINE',
      leituras: 0,
      consumoMedioKw: null,
      luminosidadeMediaPct: null,
      energiaKwh: 0,
      consumoAtualKw: null,
      luminosidadeAtual: null,
      ultimaLeituraEm: null,
      versaoFirmware: null,
    },
  ],
  totais: { postes: 2, online: 1, energiaKwh: 0.000853, leiturasRecebidas: 6 },
};

describe('ingestão do fog', () => {
  it('resumo vira uma leitura média por poste que reportou, com o horário do fim da janela', () => {
    const { leituras } = planejarResumo(resumo);

    expect(leituras).toEqual([
      {
        posteId: 'id-1',
        timestamp: new Date('2026-10-18T22:01:00.000Z'),
        consumoKw: 0.0512,
        luminosidadePct: 58,
      },
    ]);
  });

  it('resumo atualiza os campos atuais; poste mudo só tem o status atualizado', () => {
    const { atualizacoes } = planejarResumo(resumo);

    expect(atualizacoes).toEqual([
      {
        posteId: 'id-1',
        data: {
          status: 'NORMAL',
          consumoInstantaneoKw: 0.1,
          luminosidadeAtual: 100,
          ultimaLeituraEm: new Date('2026-10-18T22:00:55.000Z'),
        },
      },
      { posteId: 'id-2', data: { status: 'FALHA_OFFLINE' } },
    ]);
  });

  it('evento vira linha do log do sensor e muda a luminosidade na hora', () => {
    const plano = planejarEvento({
      posteId: 'id-1',
      codigo: 'P-001',
      bairro: 'Centro',
      tipo: 'VEICULO_DETECTADO',
      sentido: 'APROXIMANDO',
      luminosidadeResultante: 100,
      em: '2026-10-18T22:00:30.000Z',
    });

    expect(plano.evento).toEqual({
      posteId: 'id-1',
      timestamp: new Date('2026-10-18T22:00:30.000Z'),
      tipo: 'VEICULO_DETECTADO',
      sentido: 'APROXIMANDO',
      luminosidadeResultante: 100,
    });
    expect(plano.atualizacao).toEqual({
      posteId: 'id-1',
      data: { luminosidadeAtual: 100 },
    });
  });

  it('alerta muda o status do poste', () => {
    expect(
      planejarAlerta({
        posteId: 'id-9',
        codigo: 'P-009',
        bairro: 'Centro',
        statusAnterior: 'NORMAL',
        status: 'CONSUMO_ALTO',
        motivo: 'consumo 2,10× a mediana do bairro',
        em: '2026-10-18T22:00:00.000Z',
      }),
    ).toEqual({ posteId: 'id-9', data: { status: 'CONSUMO_ALTO' } });
  });

  it('guarda só os alertas mais recentes, do mais novo para o mais antigo', () => {
    const fila = new AlertasRecentes();
    const alerta = (n: number): MsgAlerta => ({
      posteId: `id-${n}`,
      codigo: `P-${n}`,
      bairro: 'Centro',
      statusAnterior: 'NORMAL',
      status: 'FALHA_OFFLINE',
      motivo: 'sem telemetria há 31 s',
      em: '2026-10-18T22:00:00.000Z',
    });

    for (let n = 1; n <= MAX_ALERTAS_RECENTES + 5; n++) {
      fila.registrar(alerta(n));
    }

    expect(fila.listar()).toHaveLength(MAX_ALERTAS_RECENTES);
    expect(fila.listar()[0].codigo).toBe(`P-${MAX_ALERTAS_RECENTES + 5}`);
  });
});
