/// Validação mínima de geometria GeoJSON (RFC 7946) para locais e áreas:
/// tipo conhecido e coordenadas [lon, lat] dentro dos limites.

type Profundidade = 0 | 1 | 2 | 3;

/// Quantos níveis de lista existem acima de cada posição [lon, lat].
const NIVEIS: Record<string, Profundidade> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

export const TIPOS_GEOMETRIA = Object.keys(NIVEIS);

function posicaoValida(p: unknown): boolean {
  if (!Array.isArray(p) || p.length < 2 || p.length > 3) return false;
  const [lon, lat] = p as unknown[];
  return (
    typeof lon === 'number' &&
    typeof lat === 'number' &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
  );
}

function coordenadasValidas(c: unknown, nivel: number): boolean {
  if (nivel === 0) return posicaoValida(c);
  return (
    Array.isArray(c) &&
    c.length > 0 &&
    c.every((x) => coordenadasValidas(x, nivel - 1))
  );
}

/** Motivo da recusa, ou null se a geometria é válida. */
export function erroGeometria(g: Record<string, unknown>): string | null {
  const tipo = g.type;
  if (typeof tipo !== 'string' || !(tipo in NIVEIS)) {
    return `geometria.type deve ser um de: ${TIPOS_GEOMETRIA.join(', ')}`;
  }
  if (!coordenadasValidas(g.coordinates, NIVEIS[tipo])) {
    return `geometria.coordinates inválidas para ${tipo} (use [lon, lat])`;
  }
  return null;
}
