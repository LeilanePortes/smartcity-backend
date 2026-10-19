/**
 * Distribui os postes da rede sobre as ruas reais (sem I/O, testável).
 *
 * Percorre cada rua amostrando um ponto a cada `espacamentoM` metros, fica com
 * os pontos mais próximos do centro (o núcleo urbano iluminado), descarta os
 * que caem colados num poste já escolhido (cruzamentos) e define o bairro pela
 * posição: um raio em volta do centro e, fora dele, oito setores por direção.
 */

export interface Coordenada {
  lat: number;
  lon: number;
}

export interface RuaOsm {
  nome: string;
  /// [lat, lon] na ordem do traçado.
  pontos: number[][];
}

export interface PostePosicionado {
  codigo: string;
  endereco: string;
  bairro: string;
  latitude: number;
  longitude: number;
}

export interface OpcoesPosicionamento {
  centro: Coordenada;
  total: number;
  /// Distância entre postes ao longo da rua.
  espacamentoM: number;
  /// Distância mínima entre dois postes quaisquer (evita duplicar cruzamentos).
  distanciaMinimaM: number;
  /// Raio do bairro central.
  raioCentroM: number;
  bairroCentral: string;
  /// Oito bairros em volta do centro, a partir do leste, no sentido anti-horário
  /// (leste, nordeste, norte, noroeste, oeste, sudoeste, sul, sudeste).
  bairrosPorDirecao: readonly string[];
}

/** Distância aproximada em metros (equiretangular; precisa o bastante numa cidade). */
export function metros(a: Coordenada, b: Coordenada): number {
  const lat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dy = ((b.lat - a.lat) * Math.PI) / 180;
  const dx = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos(lat);
  return 6_371_000 * Math.hypot(dx, dy);
}

interface Candidato extends Coordenada {
  rua: string;
  /// Metros desde o início do traçado (vira o número do endereço).
  marco: number;
  distanciaCentro: number;
}

/** Pontos a cada `espacamento` metros ao longo de uma rua (o 1º a meio passo). */
function amostrarRua(
  rua: RuaOsm,
  espacamento: number,
  centro: Coordenada,
): Candidato[] {
  const saida: Candidato[] = [];
  const pts = rua.pontos.map(([lat, lon]) => ({ lat, lon }));
  let percorrido = 0;
  let proximo = espacamento / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts.at(i)!;
    const b = pts.at(i + 1)!;
    const trecho = metros(a, b);
    while (trecho > 0 && proximo <= percorrido + trecho) {
      const f = (proximo - percorrido) / trecho;
      const p = {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
      };
      saida.push({
        ...p,
        rua: rua.nome,
        marco: Math.round(proximo),
        distanciaCentro: metros(p, centro),
      });
      proximo += espacamento;
    }
    percorrido += trecho;
  }
  return saida;
}

/** Bairro pela posição: raio central ou setor de 45° por direção. */
export function bairroPorPosicao(
  p: Coordenada,
  o: OpcoesPosicionamento,
): string {
  if (metros(p, o.centro) <= o.raioCentroM) return o.bairroCentral;
  const dy = p.lat - o.centro.lat;
  const dx = (p.lon - o.centro.lon) * Math.cos((o.centro.lat * Math.PI) / 180);
  const graus = ((Math.atan2(dy, dx) * 180) / Math.PI + 360 + 22.5) % 360;
  return o.bairrosPorDirecao.at(Math.floor(graus / 45))!;
}

export function posicionarPostes(
  ruas: RuaOsm[],
  o: OpcoesPosicionamento,
): PostePosicionado[] {
  const candidatos = ruas
    .flatMap((r) => amostrarRua(r, o.espacamentoM, o.centro))
    .sort(
      (a, b) =>
        a.distanciaCentro - b.distanciaCentro ||
        a.rua.localeCompare(b.rua) ||
        a.marco - b.marco,
    );

  const escolhidos: Candidato[] = [];
  for (const c of candidatos) {
    if (escolhidos.length === o.total) break;
    if (escolhidos.every((e) => metros(e, c) >= o.distanciaMinimaM)) {
      escolhidos.push(c);
    }
  }
  if (escolhidos.length < o.total) {
    throw new Error(
      `Só cabem ${escolhidos.length} postes nas ruas do arquivo; esperado ${o.total}.`,
    );
  }

  // Códigos em ordem de bairro e, dentro dele, do centro para fora.
  const ordemBairro = [o.bairroCentral, ...o.bairrosPorDirecao];
  return escolhidos
    .map((c) => ({ c, bairro: bairroPorPosicao(c, o) }))
    .sort(
      (a, b) =>
        ordemBairro.indexOf(a.bairro) - ordemBairro.indexOf(b.bairro) ||
        a.c.distanciaCentro - b.c.distanciaCentro,
    )
    .map(({ c, bairro }, i) => ({
      codigo: `P-${String(i + 1).padStart(3, '0')}`,
      endereco: `${c.rua}, ${c.marco}`,
      bairro,
      latitude: Number(c.lat.toFixed(6)),
      longitude: Number(c.lon.toFixed(6)),
    }));
}
