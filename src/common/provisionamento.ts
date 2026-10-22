import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PosteAtual } from '../simulador/simulador.engine';
import { PREFIXO_API } from './constants';
import type { Pagina } from './paginacao';
import { TAMANHO_MAXIMO } from './paginacao';

/// Poste como recebido no provisionamento (`GET /postes` da nuvem).
export interface PosteProvisionado extends PosteAtual {
  bairro: string;
  /// "Rua, número" — a rua vira a área do poste no contrato.
  endereco?: string;
  latitude?: number;
  longitude?: number;
}

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Provisionamento das camadas edge e fog: perguntam à nuvem quais postes
 * existem (`GET /api/v1/postes`, paginado). Repete até a API responder (no compose, ela pode ainda estar
 * populando o banco).
 */
/**
 * Lista de postes da nuvem. Com `cache`, a última lista boa fica num arquivo e
 * é usada quando a API não responde — o nó de borda sobe mesmo sem a central.
 */
export async function provisionar(
  apiUrl: string,
  log: (msg: string) => void,
  cache?: string,
): Promise<PosteProvisionado[]> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const postes: Array<
        Omit<PosteProvisionado, 'ultimaLeituraEm'> & {
          ultimaLeituraEm: string | null;
        }
      > = [];
      // Listagem paginada da API: busca página a página até trazer todos.
      for (let pagina = 1; ; pagina++) {
        const resp = await fetch(
          `${apiUrl}/${PREFIXO_API}/postes?pagina=${pagina}&tamanho=${TAMANHO_MAXIMO}`,
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const corpo = (await resp.json()) as Pagina<(typeof postes)[number]>;
        postes.push(...corpo.itens);
        if (pagina >= corpo.totalPaginas) break;
      }
      if (cache) {
        mkdirSync(dirname(cache), { recursive: true });
        writeFileSync(cache, JSON.stringify(postes));
      }
      return converter(postes);
    } catch (erro) {
      if (cache && existsSync(cache)) {
        log(
          `provisionamento: API indisponível; usando a lista guardada em ${cache}`,
        );
        return converter(
          JSON.parse(readFileSync(cache, 'utf8')) as PosteJson[],
        );
      }
      log(
        `provisionamento: API indisponível em ${apiUrl} (${(erro as Error).message}), ` +
          `nova tentativa em 5 s [${tentativa}]`,
      );
      await esperar(5_000);
    }
  }
}

type PosteJson = Omit<PosteProvisionado, 'ultimaLeituraEm'> & {
  ultimaLeituraEm: string | null;
};

const converter = (postes: PosteJson[]): PosteProvisionado[] =>
  postes.map((p) => ({
    ...p,
    ultimaLeituraEm: p.ultimaLeituraEm ? new Date(p.ultimaLeituraEm) : null,
  }));
