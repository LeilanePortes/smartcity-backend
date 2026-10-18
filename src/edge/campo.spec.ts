import { StatusPoste } from '@prisma/client';
import { MsgEvento, MsgSaude, MsgTelemetria } from '../common/topicos-mqtt';
import { CampoEdge, PosteProvisionado } from './campo';

const poste = (
  codigo: string,
  status: StatusPoste = StatusPoste.NORMAL,
  bairro = 'Centro',
): PosteProvisionado => ({
  id: `id-${codigo}`,
  codigo,
  bairro,
  status,
  luminosidadeAtual: 50,
  consumoInstantaneoKw: 0.05,
  ultimaLeituraEm: null,
});

describe('CampoEdge', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publica telemetria só dos postes que estão no ar', () => {
    const campo = new CampoEdge(
      [poste('P-001'), poste('P-002', StatusPoste.FALHA_OFFLINE)],
      '2.4.1',
      5_000,
    );

    const lote = campo.tickTelemetria(new Date('2026-10-18T22:00:00Z'));

    expect(lote).toHaveLength(1);
    expect(lote[0].topico).toBe('itaguari/iluminacao/centro/P-001/telemetria');
    expect(lote[0].qos).toBe(0);
    const msg = JSON.parse(lote[0].payload) as MsgTelemetria;
    expect(msg).toMatchObject({ codigo: 'P-001', luminosidadePct: 50 });
    expect(msg.consumoKw).toBeGreaterThan(0);
    expect(campo.online).toBe(1);
  });

  it('decide a luminosidade localmente quando o sensor detecta um veículo', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // sempre detecta
    const campo = new CampoEdge([poste('P-010')], '2.4.1', 5_000);

    const lote = campo.tickSensores();

    expect(lote).toHaveLength(1);
    expect(lote[0].topico).toBe('itaguari/iluminacao/centro/P-010/evento');
    expect(lote[0].qos).toBe(1);
    const evento = JSON.parse(lote[0].payload) as MsgEvento;
    expect(evento).toMatchObject({
      tipo: 'VEICULO_DETECTADO',
      luminosidadeResultante: 100,
    });
  });

  it('informa a versão de firmware na saúde do dispositivo', () => {
    const campo = new CampoEdge([poste('P-020')], '3.0.0', 5_000, 0);

    const [saude] = campo.tickSaude(new Date(90_000));

    const msg = JSON.parse(saude.payload) as MsgSaude;
    expect(saude.topico).toBe('itaguari/iluminacao/centro/P-020/saude');
    expect(msg).toMatchObject({ versaoFirmware: '3.0.0', uptimeS: 90 });
  });

  it('aplica o comando de manutenção: o poste apaga e passa a reportar 0 kW', () => {
    const campo = new CampoEdge(
      [poste('P-030', StatusPoste.NORMAL, 'Vila Nova')],
      '2.4.1',
      5_000,
    );

    const codigo = campo.aplicarComando(
      'itaguari/iluminacao/vila-nova/P-030/comando',
      JSON.stringify({ status: 'MANUTENCAO', em: new Date().toISOString() }),
    );

    expect(codigo).toBe('P-030');
    const msg = JSON.parse(campo.tickTelemetria()[0].payload) as MsgTelemetria;
    expect(msg).toMatchObject({ consumoKw: 0, luminosidadePct: 0 });
    expect(campo.tickSensores()).toHaveLength(0); // em manutenção não detecta
  });

  it('ignora comandos inválidos ou para postes desconhecidos', () => {
    const campo = new CampoEdge([poste('P-040')], '2.4.1', 5_000);
    const topico = 'itaguari/iluminacao/centro/P-040/comando';

    expect(campo.aplicarComando(topico, 'não é json')).toBeNull();
    expect(
      campo.aplicarComando(topico, '{"status":"FALHA_OFFLINE"}'),
    ).toBeNull();
    expect(
      campo.aplicarComando(
        'itaguari/iluminacao/centro/P-999/comando',
        '{"status":"MANUTENCAO"}',
      ),
    ).toBeNull();
  });
});
