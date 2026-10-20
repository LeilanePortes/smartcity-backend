import {
  assinaturaNuvem,
  parseTopicoNuvem,
  slugBairro,
  topicoNuvem,
} from './topicos-mqtt';

describe('tópicos fog → nuvem', () => {
  it('normaliza o bairro: sem acento, minúsculo, hífen no lugar de espaço', () => {
    expect(slugBairro('Centro')).toBe('centro');
    expect(slugBairro('Jardim Primavera')).toBe('jardim-primavera');
    expect(slugBairro('  São José / Norte ')).toBe('sao-jose-norte');
  });

  it('monta e desmonta os tópicos por bairro', () => {
    expect(topicoNuvem('Jardim Primavera', 'resumo')).toBe(
      'itaguari/nuvem/jardim-primavera/resumo',
    );
    expect(assinaturaNuvem('comando')).toBe('itaguari/nuvem/+/comando');
    expect(parseTopicoNuvem('itaguari/nuvem/centro/alerta')).toEqual({
      bairroSlug: 'centro',
      grandeza: 'alerta',
    });
    expect(parseTopicoNuvem('itaguari/nuvem/_fog/estado')).toBeNull();
    expect(parseTopicoNuvem('itaguari/nuvem/centro/xyz')).toBeNull();
  });
});
