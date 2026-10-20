import { BadRequestException } from '@nestjs/common';
import {
  janelaPagina,
  lerOrdenacao,
  montarPagina,
  PaginacaoQuery,
} from './paginacao';

const query = (pagina: number, tamanho: number): PaginacaoQuery =>
  Object.assign(new PaginacaoQuery(), { pagina, tamanho });

describe('paginação padronizada (RF-APP-07)', () => {
  it('usa página 1 e 50 itens por padrão', () => {
    const q = new PaginacaoQuery();
    expect(q).toMatchObject({ pagina: 1, tamanho: 50 });
    expect(janelaPagina(q)).toEqual({ skip: 0, take: 50 });
  });

  it('calcula a janela e o envelope da página pedida', () => {
    const q = query(3, 20);
    expect(janelaPagina(q)).toEqual({ skip: 40, take: 20 });
    expect(montarPagina(['a', 'b'], 42, q)).toEqual({
      itens: ['a', 'b'],
      pagina: 3,
      tamanho: 20,
      total: 42,
      totalPaginas: 3,
    });
  });

  it('lê a ordenação com "-" para decrescente e aplica o padrão', () => {
    expect(lerOrdenacao(undefined, ['codigo'], 'codigo')).toEqual({
      campo: 'codigo',
      direcao: 'asc',
    });
    expect(lerOrdenacao('-timestamp', ['timestamp'], 'timestamp')).toEqual({
      campo: 'timestamp',
      direcao: 'desc',
    });
  });

  it('recusa campo de ordenação não permitido, listando os aceitos', () => {
    expect(() => lerOrdenacao('senha', ['codigo', 'bairro'], 'codigo')).toThrow(
      BadRequestException,
    );
    expect(() => lerOrdenacao('senha', ['codigo', 'bairro'], 'codigo')).toThrow(
      /codigo, bairro/,
    );
  });
});
