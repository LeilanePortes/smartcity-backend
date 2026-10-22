import { StatusPoste } from '@prisma/client';
import {
  comandoAtualizarFirmware,
  comandoDefinirStatus,
  lerEventoSensor,
  lerOtaResultado,
  lerSaude,
  lerTelemetria,
} from '../common/codec-iluminacao';
import { MensagemCanonica, validarMensagem } from '../common/contrato';
import { CampoEdge, PosteProvisionado, Publicacao } from './campo';

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
  endereco: 'Avenida Goiás, 158',
  latitude: -15.9208,
  longitude: -49.6061,
});

/** Lê a publicação exigindo que ela respeite o contrato v1.0. */
function canonica(p: Publicacao): MensagemCanonica {
  const v = validarMensagem(p.payload);
  if (!v.valida) throw new Error(`fora do contrato: ${v.erros.join('; ')}`);
  return v.mensagem;
}

const topicoComando = (codigo: string, bairro = 'centro') =>
  `itaguari/${bairro}/iluminacao/${codigo}/comando`;

describe('CampoEdge', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publica telemetria canônica só dos postes que estão no ar', () => {
    const campo = new CampoEdge(
      [poste('P-001'), poste('P-002', StatusPoste.FALHA_OFFLINE)],
      '2.4.1',
      5_000,
    );

    const lote = campo.tickTelemetria(new Date('2026-10-18T22:00:00Z'));

    expect(lote).toHaveLength(1);
    expect(lote[0].topico).toBe('itaguari/centro/iluminacao/P-001/telemetria');
    expect(lote[0].qos).toBe(0);
    const m = canonica(lote[0]);
    expect(m).toMatchObject({
      versao: '1.0',
      dispositivo: 'P-001',
      tipo: 'telemetria',
      timestamp: '2026-10-18T22:00:00.000Z',
      local: {
        site: 'centro',
        area: 'avenida-goias',
        geo: { type: 'Point', coordinates: [-49.6061, -15.9208] },
      },
    });
    expect(m.medidas).toEqual([
      { grandeza: 'potencia', valor: expect.any(Number), unidade: 'kW' },
      { grandeza: 'luminosidade', valor: 50, unidade: '%' },
    ]);
    expect(lerTelemetria(m)!.consumoKw).toBeGreaterThan(0);
    expect(campo.online).toBe(1);
  });

  it('gera um id_mensagem novo para cada mensagem', () => {
    const campo = new CampoEdge([poste('P-001')], '2.4.1', 5_000);
    const a = canonica(campo.tickTelemetria()[0]);
    const b = canonica(campo.tickTelemetria()[0]);
    expect(a.id_mensagem).not.toBe(b.id_mensagem);
  });

  it('decide a luminosidade localmente quando o sensor detecta um veículo', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // sempre detecta
    const campo = new CampoEdge([poste('P-010')], '2.4.1', 5_000);

    const lote = campo.tickSensores();

    expect(lote).toHaveLength(1);
    expect(lote[0].topico).toBe('itaguari/centro/iluminacao/P-010/evento');
    expect(lote[0].qos).toBe(1);
    expect(lerEventoSensor(canonica(lote[0]))).toMatchObject({
      tipo: 'VEICULO_DETECTADO',
      luminosidadeResultante: 100,
    });
  });

  it('informa a versão de firmware no estado do dispositivo', () => {
    const campo = new CampoEdge([poste('P-020')], '3.0.0', 5_000, 0);

    const [saude] = campo.tickSaude(new Date(90_000));

    expect(saude.topico).toBe('itaguari/centro/iluminacao/P-020/estado');
    expect(lerSaude(canonica(saude))).toMatchObject({
      versaoFirmware: '3.0.0',
      uptimeS: 90,
    });
  });

  it('aplica o comando de manutenção: o poste apaga e passa a reportar 0 kW', () => {
    const campo = new CampoEdge(
      [poste('P-030', StatusPoste.NORMAL, 'Vila Nova')],
      '2.4.1',
      5_000,
    );
    const comando = comandoDefinirStatus(
      'P-030',
      StatusPoste.MANUTENCAO,
      new Date().toISOString(),
    );

    const r = campo.receberComando(
      topicoComando('P-030', 'vila-nova'),
      JSON.stringify(comando),
    );

    expect(r).toEqual({ codigo: 'P-030', acao: 'status', valor: 'MANUTENCAO' });
    const t = lerTelemetria(canonica(campo.tickTelemetria()[0]));
    expect(t).toMatchObject({ consumoKw: 0, luminosidadePct: 0 });
    expect(campo.tickSensores()).toHaveLength(0); // em manutenção não detecta
  });

  it('ignora comandos fora do contrato ou para postes desconhecidos', () => {
    const campo = new CampoEdge([poste('P-040')], '2.4.1', 5_000);
    const valido = JSON.stringify(
      comandoDefinirStatus(
        'P-040',
        StatusPoste.MANUTENCAO,
        '2026-10-18T22:00:00Z',
      ),
    );

    expect(
      campo.receberComando(topicoComando('P-040'), 'não é json'),
    ).toBeNull();
    expect(
      campo.receberComando(
        topicoComando('P-040'),
        JSON.stringify({ status: 'MANUTENCAO' }), // formato antigo
      ),
    ).toBeNull();
    expect(campo.receberComando(topicoComando('P-999'), valido)).toBeNull();
    expect(
      campo.receberComando(
        'itaguari/centro/outro-dominio/P-040/comando',
        valido,
      ),
    ).toBeNull();
  });

  describe('OTA', () => {
    const ota = (codigo: string, versao: string) =>
      JSON.stringify(
        comandoAtualizarFirmware(codigo, versao, '2026-10-18T22:00:00.000Z'),
      );

    it('instala: fica mudo enquanto reinicia e depois roda a versão nova', () => {
      const campo = new CampoEdge([poste('P-050')], '2.4.1', 5_000, 0, 8_000);

      expect(
        campo.receberComando(topicoComando('P-050'), ota('P-050', '2.5.0'), 0),
      ).toEqual({
        codigo: 'P-050',
        acao: 'ota',
        valor: '2.5.0',
      });
      // já instalando: ignora uma segunda ordem
      expect(
        campo.receberComando(
          topicoComando('P-050'),
          ota('P-050', '2.5.0'),
          1_000,
        ),
      ).toBeNull();
      expect(campo.tickTelemetria(new Date(4_000))).toHaveLength(0);
      expect(campo.tickOta(new Date(4_000))).toHaveLength(0);

      const [resultado] = campo.tickOta(new Date(8_000));
      expect(resultado.topico).toBe('itaguari/centro/iluminacao/P-050/evento');
      expect(lerOtaResultado(canonica(resultado))).toMatchObject({
        versaoAlvo: '2.5.0',
        versaoAtual: '2.5.0',
        sucesso: true,
      });
      const saude = lerSaude(canonica(campo.tickSaude(new Date(9_000))[0]));
      expect(saude).toMatchObject({
        versaoFirmware: '2.5.0',
        reinicios24h: 1,
        uptimeS: 1,
      });
    });

    it('versão com defeito de energia passa no autoteste, mas gasta mais', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // consumo sem ruído
      const campo = new CampoEdge([poste('P-051')], '2.4.1', 5_000, 0, 8_000);
      const antes = lerTelemetria(
        canonica(campo.tickTelemetria()[0]),
      )!.consumoKw;

      campo.receberComando(topicoComando('P-051'), ota('P-051', '3.0.0'), 0);
      const [r] = campo.tickOta(new Date(8_000));
      const depois = lerTelemetria(
        canonica(campo.tickTelemetria()[0]),
      )!.consumoKw;

      expect(lerOtaResultado(canonica(r))!.sucesso).toBe(true);
      expect(depois / antes).toBeCloseTo(1.8, 2);
    });

    it('versão que falha no autoteste volta sozinha para a anterior (A/B)', () => {
      const campo = new CampoEdge([poste('P-052')], '2.4.1', 5_000, 0, 8_000);
      campo.receberComando(topicoComando('P-052'), ota('P-052', '3.0.1'), 0);

      const r = lerOtaResultado(canonica(campo.tickOta(new Date(8_000))[0]))!;

      expect(r).toMatchObject({
        versaoAlvo: '3.0.1',
        versaoAtual: '2.4.1',
        sucesso: false,
      });
      expect(r.motivo).toContain('rollback automático para 2.4.1');
    });

    it('ignora OTA para poste fora do ar', () => {
      const campo = new CampoEdge(
        [poste('P-053', StatusPoste.FALHA_OFFLINE)],
        '2.4.1',
        5_000,
      );
      expect(
        campo.receberComando(topicoComando('P-053'), ota('P-053', '2.5.0')),
      ).toBeNull();
    });
  });
});
