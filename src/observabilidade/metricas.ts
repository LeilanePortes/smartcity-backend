/// Métricas no formato texto do Prometheus (RF-OBS-01), sem dependências:
/// contadores, medidores e histogramas com rótulos. Cada processo (API, fog)
/// tem o seu registro e expõe `GET /metrics`. "Mensagens por segundo" sai do
/// contador com `rate(plataforma_mensagens_total[1m])`.

type Rotulos = Record<string, string>;

const chave = (r: Rotulos) =>
  Object.keys(r)
    .sort()
    .map(
      (k) =>
        `${k}="${String(r[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    )
    .join(',');

const comRotulos = (nome: string, r: string) => (r ? `${nome}{${r}}` : nome);

abstract class Metrica {
  constructor(
    readonly nome: string,
    readonly ajuda: string,
    readonly tipo: 'counter' | 'gauge' | 'histogram',
  ) {}
  abstract linhas(): string[];
  texto(): string {
    return [
      `# HELP ${this.nome} ${this.ajuda}`,
      `# TYPE ${this.nome} ${this.tipo}`,
      ...this.linhas(),
    ].join('\n');
  }
}

export class Contador extends Metrica {
  private readonly valores = new Map<string, number>();
  constructor(nome: string, ajuda: string) {
    super(nome, ajuda, 'counter');
  }
  inc(rotulos: Rotulos = {}, n = 1): void {
    const k = chave(rotulos);
    this.valores.set(k, (this.valores.get(k) ?? 0) + n);
  }
  linhas(): string[] {
    return [...this.valores].map(
      ([k, v]) => `${comRotulos(this.nome, k)} ${v}`,
    );
  }
}

export class Medidor extends Metrica {
  private readonly valores = new Map<string, number>();
  constructor(nome: string, ajuda: string) {
    super(nome, ajuda, 'gauge');
  }
  set(valor: number, rotulos: Rotulos = {}): void {
    this.valores.set(chave(rotulos), valor);
  }
  linhas(): string[] {
    return [...this.valores].map(
      ([k, v]) => `${comRotulos(this.nome, k)} ${v}`,
    );
  }
}

export const BALDES_LATENCIA = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5,
];

export class Histograma extends Metrica {
  private readonly series = new Map<
    string,
    { baldes: number[]; soma: number; total: number }
  >();
  constructor(
    nome: string,
    ajuda: string,
    private readonly limites = BALDES_LATENCIA,
  ) {
    super(nome, ajuda, 'histogram');
  }
  observar(segundos: number, rotulos: Rotulos = {}): void {
    const k = chave(rotulos);
    const s = this.series.get(k) ?? {
      baldes: this.limites.map(() => 0),
      soma: 0,
      total: 0,
    };
    this.limites.forEach((l, i) => {
      if (segundos <= l) s.baldes[i]++;
    });
    s.soma += segundos;
    s.total++;
    this.series.set(k, s);
  }
  linhas(): string[] {
    const saida: string[] = [];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : '';
      this.limites.forEach((l, i) =>
        saida.push(`${this.nome}_bucket{${sep}le="${l}"} ${s.baldes[i]}`),
      );
      saida.push(`${this.nome}_bucket{${sep}le="+Inf"} ${s.total}`);
      saida.push(
        `${comRotulos(`${this.nome}_sum`, k)} ${Number(s.soma.toFixed(6))}`,
      );
      saida.push(`${comRotulos(`${this.nome}_count`, k)} ${s.total}`);
    }
    return saida;
  }
}

export class RegistroMetricas {
  private readonly metricas: Metrica[] = [];
  private registrar<T extends Metrica>(m: T): T {
    this.metricas.push(m);
    return m;
  }
  contador(nome: string, ajuda: string) {
    return this.registrar(new Contador(nome, ajuda));
  }
  medidor(nome: string, ajuda: string) {
    return this.registrar(new Medidor(nome, ajuda));
  }
  histograma(nome: string, ajuda: string, limites?: number[]) {
    return this.registrar(new Histograma(nome, ajuda, limites));
  }
  texto(): string {
    return this.metricas.map((m) => m.texto()).join('\n\n') + '\n';
  }
}

/** Segundos desde `inicio` (de `performance.now()`). */
export const segundosDesde = (inicio: number) =>
  (performance.now() - inicio) / 1000;
