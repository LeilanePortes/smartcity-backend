import { StatusPoste } from '@prisma/client';

/// Regras do OTA com grupo canário (sem I/O, testáveis). Seguem o material
/// "Grupo Canário: atualizações seguras em frotas IoT" (Semana 11).

/// Critérios de decisão — escritos antes de começar (seção 4.3 do material).
export interface CriteriosOta {
  /// Falha de instalação acima deste % dos que tentaram → reverter.
  limiarFalhaInstalacaoPct: number;
  /// Consumo do canário ≥ N × o do controle → reverter.
  limiarRazaoConsumo: number;
  /// % mínimo do canário que precisa ter reportado para decidir.
  minReportePct: number;
  /// Quantas vezes a observação pode ser estendida por falta de dados.
  maxExtensoes: number;
}

export interface PosteElegivel {
  codigo: string;
  bairro: string;
}

/// Último resumo do fog de um poste, como a nuvem o enxerga.
export interface AmostraPoste {
  /// kW por 100% de luminosidade (independe de pico/piso); null sem leitura.
  normalizado: number | null;
  status: StatusPoste;
  versao: string | null;
  inicioMs: number;
  fimMs: number;
}

export interface MetricasGrupo {
  aparelhos: number;
  reportaram: number;
  /// Média do consumo normalizado de quem reportou (kW a 100% de brilho).
  consumoNormalizadoMedio: number | null;
  /// % de quem reportou que o fog diagnosticou como CONSUMO_ALTO.
  consumoAltoPct: number;
}

export type DecisaoOta = 'AVANCAR' | 'ESTENDER' | 'REVERTER' | 'CONCLUIR';

const arred = (n: number, casas: number): number => Number(n.toFixed(casas));

/** Quantos aparelhos a onda deve ter alcançado (acumulado), no mínimo 1. */
export function alvoDaOnda(percentual: number, totalElegiveis: number): number {
  return Math.min(
    totalElegiveis,
    Math.max(1, Math.ceil((percentual / 100) * totalElegiveis)),
  );
}

/**
 * Escolhe `quantidade` postes espalhados entre os bairros (rodízio), para o
 * grupo ser representativo da frota (seção 5.1): um pouco de cada bairro, e
 * não um bairro inteiro.
 */
export function selecionarRepresentativo<T extends PosteElegivel>(
  candidatos: T[],
  quantidade: number,
  aleatorio: () => number = Math.random,
): T[] {
  const porBairro = new Map<string, T[]>();
  for (const c of candidatos) {
    const lista = porBairro.get(c.bairro) ?? [];
    lista.push(c);
    porBairro.set(c.bairro, lista);
  }
  // Embaralha dentro de cada bairro e a ordem dos bairros.
  const filas = [...porBairro.values()].map((lista) =>
    lista
      .map((item) => ({ item, chave: aleatorio() }))
      .sort((a, b) => a.chave - b.chave)
      .map((x) => x.item),
  );
  filas.sort(() => aleatorio() - 0.5);

  const escolhidos: T[] = [];
  while (escolhidos.length < quantidade && filas.some((f) => f.length)) {
    for (const fila of filas) {
      const proximo = fila.shift();
      if (proximo) escolhidos.push(proximo);
      if (escolhidos.length >= quantidade) break;
    }
  }
  return escolhidos;
}

/**
 * Métricas de um grupo a partir dos resumos do fog. Só conta a amostra que
 * começou depois de `desdeMs` (para o canário: depois da instalação).
 */
export function metricasGrupo(
  codigos: Iterable<string>,
  amostras: ReadonlyMap<string, AmostraPoste>,
  desdeMs: (codigo: string) => number,
): MetricasGrupo {
  let aparelhos = 0;
  let reportaram = 0;
  let somaNormalizado = 0;
  let comNormalizado = 0;
  let consumoAlto = 0;

  for (const codigo of codigos) {
    aparelhos++;
    const a = amostras.get(codigo);
    if (!a || a.inicioMs < desdeMs(codigo)) continue;
    reportaram++;
    if (a.status === StatusPoste.CONSUMO_ALTO) consumoAlto++;
    if (a.normalizado !== null) {
      somaNormalizado += a.normalizado;
      comNormalizado++;
    }
  }

  return {
    aparelhos,
    reportaram,
    consumoNormalizadoMedio: comNormalizado
      ? arred(somaNormalizado / comNormalizado, 4)
      : null,
    consumoAltoPct: reportaram
      ? Math.round((consumoAlto / reportaram) * 100)
      : 0,
  };
}

export interface EntradaDecisao {
  tentativas: number;
  falhas: number;
  canario: MetricasGrupo;
  /// Consumo normalizado de referência: o do controle ou, sem controle (onda
  /// de 100%), a linha de base medida no início da implantação.
  referenciaConsumo: number | null;
  extensoes: number;
  ultimaOnda: boolean;
}

export interface ResultadoDecisao {
  decisao: DecisaoOta;
  motivo: string;
  razaoConsumo: number | null;
}

const pct = (n: number): string => `${n.toFixed(1).replace('.', ',')}%`;
const vezes = (n: number): string => `${n.toFixed(2).replace('.', ',')}×`;

/** O "portão" entre uma onda e a próxima (seções 3.3 e 4.3). */
export function decidir(
  e: EntradaDecisao,
  criterios: CriteriosOta,
): ResultadoDecisao {
  const falhaPct = e.tentativas ? (e.falhas / e.tentativas) * 100 : 0;
  if (falhaPct > criterios.limiarFalhaInstalacaoPct) {
    return {
      decisao: 'REVERTER',
      motivo: `falha de instalação em ${pct(falhaPct)} dos aparelhos (limite ${pct(criterios.limiarFalhaInstalacaoPct)})`,
      razaoConsumo: null,
    };
  }

  const minimo = Math.ceil(
    (criterios.minReportePct / 100) * e.canario.aparelhos,
  );
  const poucosDados =
    e.canario.reportaram < minimo ||
    e.canario.consumoNormalizadoMedio === null ||
    e.referenciaConsumo === null;
  if (poucosDados) {
    if (e.extensoes < criterios.maxExtensoes) {
      return {
        decisao: 'ESTENDER',
        motivo: `poucos dados: ${e.canario.reportaram} de ${e.canario.aparelhos} aparelhos do canário reportaram após a instalação`,
        razaoConsumo: null,
      };
    }
    return {
      decisao: 'REVERTER',
      motivo:
        'o canário não reportou dados suficientes mesmo após estender a observação',
      razaoConsumo: null,
    };
  }

  const razao = arred(
    e.canario.consumoNormalizadoMedio! / e.referenciaConsumo!,
    2,
  );
  if (razao >= criterios.limiarRazaoConsumo) {
    return {
      decisao: 'REVERTER',
      motivo: `consumo do canário ${vezes(razao)} o do grupo de controle (limite ${vezes(criterios.limiarRazaoConsumo)})`,
      razaoConsumo: razao,
    };
  }

  return {
    decisao: e.ultimaOnda ? 'CONCLUIR' : 'AVANCAR',
    motivo: `métricas do canário próximas às do controle (consumo ${vezes(razao)})`,
    razaoConsumo: razao,
  };
}
