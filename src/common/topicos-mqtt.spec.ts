import {
  assinaturaTodosPostes,
  parseTopicoPoste,
  slugBairro,
  topicoPoste,
} from './topicos-mqtt';

describe('tópicos MQTT', () => {
  it('normaliza o bairro: sem acento, minúsculo, hífen no lugar de espaço', () => {
    expect(slugBairro('Centro')).toBe('centro');
    expect(slugBairro('Jardim Primavera')).toBe('jardim-primavera');
    expect(slugBairro('Setor Industrial')).toBe('setor-industrial');
    expect(slugBairro('  São José / Norte ')).toBe('sao-jose-norte');
  });

  it('monta o tópico no padrão organização/área/dispositivo/grandeza', () => {
    expect(topicoPoste('Vila Nova', 'P-042', 'telemetria')).toBe(
      'itaguari/iluminacao/vila-nova/P-042/telemetria',
    );
    expect(assinaturaTodosPostes('comando')).toBe(
      'itaguari/iluminacao/+/+/comando',
    );
  });

  it('desmonta o tópico de volta', () => {
    expect(
      parseTopicoPoste(
        topicoPoste('Residencial Bela Vista', 'P-200', 'evento'),
      ),
    ).toEqual({
      bairroSlug: 'residencial-bela-vista',
      codigo: 'P-200',
      grandeza: 'evento',
    });
  });

  it('rejeita tópicos que não são de poste', () => {
    expect(parseTopicoPoste('itaguari/iluminacao/_edge/estado')).toBeNull();
    expect(parseTopicoPoste('outra/raiz/centro/P-1/telemetria')).toBeNull();
    expect(parseTopicoPoste('itaguari/iluminacao/centro/P-1/xyz')).toBeNull();
  });
});
