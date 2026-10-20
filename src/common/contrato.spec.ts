import { StatusPoste } from '@prisma/client';
import {
  comandoDefinirStatus,
  lerComando,
  lerTelemetria,
  telemetriaCanonica,
} from './codec-iluminacao';
import {
  assinaturaDominio,
  criarMensagem,
  parseTopicoDispositivo,
  topicoDispositivo,
  validarMensagem,
} from './contrato';

const base = {
  dispositivo: 'P-001',
  timestamp: '2026-10-20T12:00:00Z',
};

describe('contrato canônico v1.0', () => {
  describe('tópicos {inquilino}/{site}/{dominio}/{dispositivo}/{tipo}', () => {
    it('monta o tópico no padrão do documento de requisitos', () => {
      expect(
        topicoDispositivo(
          'Jardim Primavera',
          'iluminacao',
          'P-042',
          'telemetria',
        ),
      ).toBe('itaguari/jardim-primavera/iluminacao/P-042/telemetria');
      expect(assinaturaDominio('iluminacao', 'comando')).toBe(
        'itaguari/+/iluminacao/+/comando',
      );
    });

    it('desmonta o tópico de volta e rejeita o que não é de dispositivo', () => {
      expect(
        parseTopicoDispositivo('itaguari/centro/energia/Q-01/estado'),
      ).toEqual({
        inquilino: 'itaguari',
        site: 'centro',
        dominio: 'energia',
        dispositivo: 'Q-01',
        tipo: 'estado',
      });
      expect(parseTopicoDispositivo('itaguari/_edge/estado')).toBeNull();
      expect(
        parseTopicoDispositivo('itaguari/centro/iluminacao/P-1/xyz'),
      ).toBeNull();
    });
  });

  describe('validação contra o JSON Schema publicado', () => {
    it('aceita a telemetria do exemplo, com medidas em UCUM e local GeoJSON', () => {
      const m = criarMensagem({
        ...base,
        tipo: 'telemetria',
        via: 'fog-centro',
        local: {
          site: 'centro',
          area: 'avenida-goias',
          geo: { type: 'Point', coordinates: [-49.6061, -15.9208] },
        },
        medidas: [{ grandeza: 'potencia', valor: 0.05, unidade: 'kW' }],
      });

      expect(validarMensagem(JSON.stringify(m))).toEqual({
        valida: true,
        mensagem: m,
      });
    });

    it('recusa mensagens fora do contrato, dizendo o motivo', () => {
      const casos: Array<[unknown, string]> = [
        ['{ quebrado', 'JSON'],
        [
          { ...criarMensagem({ ...base, tipo: 'telemetria', medidas: [] }) },
          'medidas',
        ],
        [{ ...criarMensagem({ ...base, tipo: 'evento' }) }, 'evento'],
        [
          {
            ...criarMensagem({
              ...base,
              tipo: 'comando',
              comando: { nome: 'x' },
            }),
            versao: '2.0',
          },
          'versao',
        ],
        [
          {
            ...criarMensagem({ ...base, tipo: 'estado', estado: { a: 1 } }),
            id_mensagem: '123',
          },
          'id_mensagem',
        ],
        [
          {
            ...criarMensagem({ ...base, tipo: 'estado', estado: { a: 1 } }),
            extra: true,
          },
          'additional',
        ],
      ];
      for (const [payload, motivo] of casos) {
        const r = validarMensagem(payload);
        expect(r.valida).toBe(false);
        if (!r.valida)
          expect(r.erros.join(' ')).toMatch(new RegExp(motivo, 'i'));
      }
    });
  });

  describe('codec do domínio iluminação', () => {
    it('converte telemetria e comando nos dois sentidos', () => {
      const m = telemetriaCanonica(
        {
          posteId: 'id-1',
          codigo: 'P-001',
          consumoKw: 0.051,
          luminosidadePct: 100,
          em: '2026-10-20T12:00:00.000Z',
        },
        { site: 'centro' },
      );
      expect(validarMensagem(m).valida).toBe(true);
      expect(lerTelemetria(m)).toEqual({
        codigo: 'P-001',
        consumoKw: 0.051,
        luminosidadePct: 100,
        em: '2026-10-20T12:00:00.000Z',
      });

      const c = comandoDefinirStatus(
        'P-001',
        StatusPoste.NORMAL,
        base.timestamp,
        'fog-centro',
      );
      expect(validarMensagem(c).valida).toBe(true);
      expect(c.via).toBe('fog-centro');
      expect(lerComando(c)).toEqual({
        nome: 'definir_status',
        status: 'NORMAL',
      });
    });

    it('não lê como poste uma telemetria de outro domínio', () => {
      const m = criarMensagem({
        ...base,
        tipo: 'telemetria',
        medidas: [{ grandeza: 'tensao', valor: 220, unidade: 'V' }],
      });
      expect(validarMensagem(m).valida).toBe(true);
      expect(lerTelemetria(m)).toBeNull();
    });
  });
});
