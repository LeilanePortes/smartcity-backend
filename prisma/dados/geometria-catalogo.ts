/**
 * Geometrias GeoJSON do catálogo (sem I/O, testável): o polígono de cada bairro
 * e o traçado de cada rua dentro dele. Seguem a mesma divisão que o seed usa
 * para pôr os postes (`bairroPorPosicao`): um círculo no centro e oito setores
 * de 45° em volta, até o raio do núcleo urbano. Coordenadas em [lon, lat].
 */
import {
  bairroPorPosicao,
  Coordenada,
  metros,
  OpcoesPosicionamento,
  RuaOsm,
} from './posicionar-postes';

type Opcoes = Omit<OpcoesPosicionamento, 'total'>;

// `type` (e não `interface`) para caber num campo Json do Prisma.
export type Poligono = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type MultiLinha = {
  type: 'MultiLineString';
  coordinates: number[][][];
};

export interface AreaRua {
  bairro: string;
  rua: string;
  geometria: MultiLinha;
}

const M_POR_GRAU = 111_195;
const arred = (n: number) => Number(n.toFixed(6));

/** Ponto a `raio` metros do centro, no ângulo dado (0° = leste, anti-horário). */
function pontoPolar(centro: Coordenada, raio: number, graus: number): number[] {
  const rad = (graus * Math.PI) / 180;
  const lat = centro.lat + (raio * Math.sin(rad)) / M_POR_GRAU;
  const lon =
    centro.lon +
    (raio * Math.cos(rad)) /
      (M_POR_GRAU * Math.cos((centro.lat * Math.PI) / 180));
  return [arred(lon), arred(lat)];
}

/** Arco de `de` até `ate` graus (inclusive), com um vértice a cada `passo`. */
function arco(
  centro: Coordenada,
  raio: number,
  de: number,
  ate: number,
  passo = 5,
): number[][] {
  const n = Math.max(1, Math.round(Math.abs(ate - de) / passo));
  return Array.from({ length: n + 1 }, (_, i) =>
    pontoPolar(centro, raio, de + ((ate - de) * i) / n),
  );
}

/**
 * Polígono do bairro: o central é um círculo; os demais, um setor de anel
 * entre o raio central e `raioExternoM` (anel externo no sentido anti-horário,
 * como pede o GeoJSON).
 */
export function poligonoBairro(
  bairro: string,
  o: Opcoes,
  raioExternoM: number,
): Poligono {
  if (bairro === o.bairroCentral) {
    const anel = arco(o.centro, o.raioCentroM, 0, 360, 10);
    anel[anel.length - 1] = anel[0]; // fecha exatamente no primeiro vértice
    return { type: 'Polygon', coordinates: [anel] };
  }
  const i = o.bairrosPorDirecao.indexOf(bairro);
  if (i < 0) throw new Error(`Bairro desconhecido: ${bairro}`);
  const de = i * 45 - 22.5;
  const ate = de + 45;
  const anel = [
    ...arco(o.centro, raioExternoM, de, ate),
    ...arco(o.centro, o.raioCentroM, ate, de),
  ];
  anel.push(anel[0]);
  return { type: 'Polygon', coordinates: [anel] };
}

/**
 * Traçado de cada rua dentro de cada bairro (até `raioExternoM`). Cada trecho
 * do OpenStreetMap vai para o bairro do seu ponto médio; trechos seguidos do
 * mesmo bairro viram uma linha só.
 */
export function areasDasRuas(
  ruas: RuaOsm[],
  o: Opcoes,
  raioExternoM: number,
): AreaRua[] {
  const grupos = new Map<string, AreaRua>();
  for (const rua of ruas) {
    let linhaAtual: number[][] | null = null;
    let chaveAtual = '';
    for (let i = 0; i < rua.pontos.length - 1; i++) {
      const [lat1, lon1] = rua.pontos.at(i)!;
      const [lat2, lon2] = rua.pontos.at(i + 1)!;
      const meio = { lat: (lat1 + lat2) / 2, lon: (lon1 + lon2) / 2 };
      if (metros(meio, o.centro) > raioExternoM) {
        linhaAtual = null;
        continue;
      }
      const bairro = bairroPorPosicao(meio, { ...o, total: 0 });
      const chave = `${bairro}|${rua.nome}`;
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = {
          bairro,
          rua: rua.nome,
          geometria: { type: 'MultiLineString', coordinates: [] },
        };
        grupos.set(chave, grupo);
      }
      if (!linhaAtual || chave !== chaveAtual) {
        linhaAtual = [[arred(lon1), arred(lat1)]];
        grupo.geometria.coordinates.push(linhaAtual);
        chaveAtual = chave;
      }
      linhaAtual.push([arred(lon2), arred(lat2)]);
    }
  }
  return [...grupos.values()];
}

/** Rua de um endereço "Rua X, 123" → "Rua X". */
export const ruaDoEndereco = (endereco: string): string =>
  endereco.split(',')[0].trim();

/**
 * Traçado de uma rua perto de um conjunto de postes. Serve aos postes que
 * ficam na divisa de dois bairros: o trecho da rua deles caiu no bairro
 * vizinho, mas a área precisa existir no bairro do poste.
 */
export function trechosPerto(
  rua: RuaOsm,
  postes: readonly Coordenada[],
  raioM: number,
): MultiLinha {
  const coordinates: number[][][] = [];
  let linha: number[][] | null = null;
  for (let i = 0; i < rua.pontos.length - 1; i++) {
    const [lat1, lon1] = rua.pontos.at(i)!;
    const [lat2, lon2] = rua.pontos.at(i + 1)!;
    const trecho = [
      { lat: lat1, lon: lon1 },
      { lat: (lat1 + lat2) / 2, lon: (lon1 + lon2) / 2 },
      { lat: lat2, lon: lon2 },
    ];
    if (!postes.some((p) => trecho.some((t) => metros(p, t) <= raioM))) {
      linha = null;
      continue;
    }
    if (!linha) {
      linha = [[arred(lon1), arred(lat1)]];
      coordinates.push(linha);
    }
    linha.push([arred(lon2), arred(lat2)]);
  }
  return { type: 'MultiLineString', coordinates };
}
