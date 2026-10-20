import { PosteAtual } from '../simulador/simulador.engine';

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
 * existem. Repete até a API responder (no compose, ela pode ainda estar
 * populando o banco).
 */
export async function provisionar(
  apiUrl: string,
  log: (msg: string) => void,
): Promise<PosteProvisionado[]> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const resp = await fetch(`${apiUrl}/postes`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const corpo = (await resp.json()) as {
        postes: Array<
          Omit<PosteProvisionado, 'ultimaLeituraEm'> & {
            ultimaLeituraEm: string | null;
          }
        >;
      };
      return corpo.postes.map((p) => ({
        ...p,
        ultimaLeituraEm: p.ultimaLeituraEm ? new Date(p.ultimaLeituraEm) : null,
      }));
    } catch (erro) {
      log(
        `provisionamento: API indisponível em ${apiUrl} (${(erro as Error).message}), ` +
          `nova tentativa em 5 s [${tentativa}]`,
      );
      await esperar(5_000);
    }
  }
}
