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

  describe('OTA', () => {
    const ota = (codigo: string, versao: string) => ({
      topico: `itaguari/iluminacao/centro/${codigo}/ota`,
      payload: JSON.stringify({ versao, em: '2026-10-18T22:00:00.000Z' }),
    });

    it('instala: fica mudo enquanto reinicia e depois roda a versão nova', () => {
      const campo = new CampoEdge([poste('P-050')], '2.4.1', 5_000, 0, 8_000);
      const { topico, payload } = ota('P-050', '2.5.0');

      expect(campo.aplicarOta(topico, payload, 0)).toBe('P-050');
      expect(campo.aplicarOta(topico, payload, 1_000)).toBeNull(); // já instalando
      expect(campo.tickTelemetria(new Date(4_000))).toHaveLength(0);
      expect(campo.tickOta(new Date(4_000))).toHaveLength(0);

      const [resultado] = campo.tickOta(new Date(8_000));
      expect(resultado.topico).toBe(
        'itaguari/iluminacao/centro/P-050/ota-resultado',
      );
      expect(JSON.parse(resultado.payload)).toMatchObject({
        versaoAlvo: '2.5.0',
        versaoAtual: '2.5.0',
        sucesso: true,
      });
      const saude = JSON.parse(campo.tickSaude(new Date(9_000))[0].payload);
      expect(saude).toMatchObject({
        versaoFirmware: '2.5.0',
        reinicios24h: 1,
        uptimeS: 1,
      });
    });

    it('versão com defeito de energia passa no autoteste, mas gasta mais', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // consumo sem ruído
      const campo = new CampoEdge([poste('P-051')], '2.4.1', 5_000, 0, 8_000);
      const antes = JSON.parse(campo.tickTelemetria()[0].payload).consumoKw;

      const { topico, payload } = ota('P-051', '3.0.0');
      campo.aplicarOta(topico, payload, 0);
      const [r] = campo.tickOta(new Date(8_000));
      const depois = JSON.parse(campo.tickTelemetria()[0].payload).consumoKw;

      expect(JSON.parse(r.payload).sucesso).toBe(true);
      expect(depois / antes).toBeCloseTo(1.8, 2);
    });

    it('versão que falha no autoteste volta sozinha para a anterior (A/B)', () => {
      const campo = new CampoEdge([poste('P-052')], '2.4.1', 5_000, 0, 8_000);
      const { topico, payload } = ota('P-052', '3.0.1');
      campo.aplicarOta(topico, payload, 0);

      const msg = JSON.parse(campo.tickOta(new Date(8_000))[0].payload);

      expect(msg).toMatchObject({
        versaoAlvo: '3.0.1',
        versaoAtual: '2.4.1',
        sucesso: false,
      });
      expect(msg.motivo).toContain('rollback automático para 2.4.1');
    });

    it('ignora OTA para poste fora do ar ou sem versão', () => {
      const campo = new CampoEdge(
        [poste('P-053', StatusPoste.FALHA_OFFLINE), poste('P-054')],
        '2.4.1',
        5_000,
      );
      const a = ota('P-053', '2.5.0');
      expect(campo.aplicarOta(a.topico, a.payload)).toBeNull();
      expect(
        campo.aplicarOta('itaguari/iluminacao/centro/P-054/ota', '{}'),
      ).toBeNull();
    });
  });
});
