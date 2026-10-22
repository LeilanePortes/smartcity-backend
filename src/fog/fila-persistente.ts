import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/// Fila persistente e cifrada do nó de borda (RF-EDG-01, RF-SEG-05): cada item
/// vira uma linha cifrada com AES-256-GCM num arquivo do volume do fog. Ela
/// sobrevive a queda da nuvem e a reinício do contêiner; só sai do disco
/// depois que a central confirma. Prioridade menor sai antes (alarmes antes da
/// telemetria rotineira, RF-EDG-05).

export interface ItemFila<T> {
  id: string;
  prioridade: number;
  dados: T;
}

/** Chave de 32 bytes derivada da senha da fila (FOG_CHAVE_FILA). */
export const derivarChave = (senha: string): Buffer =>
  scryptSync(senha, 'smartcity-fog-fila', 32);

export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64');
}

export function decifrar(linha: string, chave: Buffer): string {
  const b = Buffer.from(linha, 'base64');
  const d = createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

export class FilaPersistente<T> {
  private itens: ItemFila<T>[] = [];
  private seq = 0;
  descartadas = 0;
  ilegiveis = 0;

  constructor(
    private readonly arquivo: string,
    private readonly chave: Buffer,
    private readonly max: number,
  ) {
    mkdirSync(dirname(arquivo), { recursive: true });
    if (existsSync(arquivo)) this.carregar();
  }

  get pendentes(): number {
    return this.itens.length;
  }

  adicionar(dados: T, prioridade = 1): void {
    const item = { id: `${Date.now()}-${this.seq++}`, prioridade, dados };
    this.itens.push(item);
    appendFileSync(
      this.arquivo,
      cifrar(JSON.stringify(item), this.chave) + '\n',
    );
    if (this.itens.length > this.max) {
      // Cheia: descarta o item menos prioritário mais antigo.
      const pior = this.itens.reduce(
        (p, x, i, l) => (x.prioridade > l[p].prioridade ? i : p),
        0,
      );
      this.itens.splice(pior, 1);
      this.descartadas++;
      this.regravar();
    }
  }

  /** Próximos itens por prioridade (estável na ordem de chegada), sem tirar da fila. */
  proximos(n: number): ItemFila<T>[] {
    return this.itens
      .map((item, i) => ({ item, i }))
      .sort((a, b) => a.item.prioridade - b.item.prioridade || a.i - b.i)
      .slice(0, n)
      .map(({ item }) => item);
  }

  /** Tira da fila (e do disco) os itens que a central confirmou. */
  confirmar(ids: Iterable<string>): void {
    const fora = new Set(ids);
    if (!fora.size) return;
    this.itens = this.itens.filter((x) => !fora.has(x.id));
    this.regravar();
  }

  private carregar(): void {
    for (const linha of readFileSync(this.arquivo, 'utf8').split('\n')) {
      if (!linha) continue;
      try {
        this.itens.push(JSON.parse(decifrar(linha, this.chave)) as ItemFila<T>);
      } catch {
        this.ilegiveis++; // chave errada ou linha corrompida
      }
    }
  }

  /** Reescreve o arquivo de forma atômica (arquivo temporário + rename). */
  private regravar(): void {
    const tmp = `${this.arquivo}.tmp`;
    writeFileSync(
      tmp,
      this.itens
        .map((x) => cifrar(JSON.stringify(x), this.chave) + '\n')
        .join(''),
    );
    renameSync(tmp, this.arquivo);
  }
}
