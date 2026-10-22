/// Condições das regras (RF-PRO-02): limite com janela de tempo opcional
/// ("temperatura > 30 °C por 30 minutos") e ausência de dados. O escopo
/// (domínio, local, área geográfica, perfil, dispositivo) fica na regra.

export const OPERADORES = ['>', '>=', '<', '<=', '==', '!='] as const;
export type Operador = (typeof OPERADORES)[number];

export interface CondicaoLimite {
  tipo: 'limite';
  grandeza: string;
  operador: Operador;
  valor: number;
  /// A condição precisa valer por este tempo antes de disparar (janela).
  duracaoS?: number;
}

export interface CondicaoAusencia {
  tipo: 'ausencia';
  /// Sem nenhuma mensagem do dispositivo por este tempo.
  duracaoS: number;
}

export type Condicao = CondicaoLimite | CondicaoAusencia;

export function comparar(valor: number, op: Operador, ref: number): boolean {
  switch (op) {
    case '>':
      return valor > ref;
    case '>=':
      return valor >= ref;
    case '<':
      return valor < ref;
    case '<=':
      return valor <= ref;
    case '==':
      return valor === ref;
    case '!=':
      return valor !== ref;
  }
}

/** Motivo da recusa, ou null se a condição é válida. */
export function erroCondicao(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'condicao deve ser um objeto';
  const x = c as Record<string, unknown>;
  const duracaoOk = (d: unknown, obrigatoria: boolean) =>
    d === undefined
      ? !obrigatoria
      : Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 604_800;
  if (x.tipo === 'limite') {
    if (
      typeof x.grandeza !== 'string' ||
      !/^[a-z][a-z0-9_]*$/.test(x.grandeza)
    ) {
      return 'condicao.grandeza inválida (ex.: temperatura)';
    }
    if (!OPERADORES.includes(x.operador as Operador)) {
      return `condicao.operador deve ser um de: ${OPERADORES.join(' ')}`;
    }
    if (typeof x.valor !== 'number' || !Number.isFinite(x.valor)) {
      return 'condicao.valor deve ser um número';
    }
    if (!duracaoOk(x.duracaoS, false)) {
      return 'condicao.duracaoS deve ser um inteiro de 0 a 604800 segundos';
    }
    return null;
  }
  if (x.tipo === 'ausencia') {
    return duracaoOk(x.duracaoS, true) && (x.duracaoS as number) > 0
      ? null
      : 'condicao.duracaoS (segundos sem dados) é obrigatória e maior que zero';
  }
  return 'condicao.tipo deve ser "limite" ou "ausencia"';
}

export type ResultadoJanela = 'disparar' | 'ativa' | 'aguardando' | 'normal';

/**
 * Janela de tempo por regra e dispositivo: guarda desde quando a condição
 * vale e se o episódio já disparou (cada episódio dispara uma vez só).
 */
export class JanelaCondicao {
  private readonly estado = new Map<
    string,
    { desde: number; disparou: boolean }
  >();

  avaliar(
    chave: string,
    verdadeira: boolean,
    emMs: number,
    duracaoS = 0,
  ): ResultadoJanela {
    if (!verdadeira) {
      this.estado.delete(chave);
      return 'normal';
    }
    const e = this.estado.get(chave) ?? { desde: emMs, disparou: false };
    if (emMs < e.desde) e.desde = emMs;
    this.estado.set(chave, e);
    if (e.disparou) return 'ativa';
    if (emMs - e.desde >= duracaoS * 1000) {
      e.disparou = true;
      return 'disparar';
    }
    return 'aguardando';
  }

  esquecer(prefixo: string): void {
    for (const k of this.estado.keys()) {
      if (k.startsWith(prefixo)) this.estado.delete(k);
    }
  }
}
