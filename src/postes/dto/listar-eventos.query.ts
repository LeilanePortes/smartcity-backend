import { PaginacaoQuery } from '../../common/paginacao';

/// Campos aceitos em `ordenar` no log do sensor (padrão: mais recentes primeiro).
export const ORDENACAO_EVENTOS = ['timestamp', 'tipo'] as const;

export class ListarEventosQuery extends PaginacaoQuery {}
