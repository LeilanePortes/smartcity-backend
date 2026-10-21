import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/// Credencial por dispositivo (RF-DIS-02): um token opaco
/// `dsp_<prefixo>_<segredo>`. O prefixo é público e localiza a credencial; do
/// token inteiro só o hash SHA-256 fica no banco, então ele é mostrado uma
/// única vez, na emissão.

const FORMATO_TOKEN = /^dsp_([0-9a-f]{12})_[A-Za-z0-9_-]{32}$/;

export interface CredencialGerada {
  token: string;
  prefixo: string;
  hash: string;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function gerarCredencial(): CredencialGerada {
  const prefixo = randomBytes(6).toString('hex');
  const token = `dsp_${prefixo}_${randomBytes(24).toString('base64url')}`;
  return { token, prefixo, hash: hashToken(token) };
}

/** Prefixo de um token bem formado; null se o formato não confere. */
export function prefixoDoToken(token: string): string | null {
  return FORMATO_TOKEN.exec(token)?.[1] ?? null;
}

/** Compara o token com o hash guardado em tempo constante. */
export function tokenConfere(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
