import {
  bairroPorPosicao,
  metros,
  OpcoesPosicionamento,
  posicionarPostes,
  RuaOsm,
} from './posicionar-postes';

const CENTRO = { lat: -15.92, lon: -49.6 };
// ~0,001° de latitude ≈ 111 m.
const GRAU_M = 111_195;

const opcoes = (total: number): OpcoesPosicionamento => ({
  centro: CENTRO,
  total,
  espacamentoM: 35,
  distanciaMinimaM: 20,
  raioCentroM: 100,
  bairroCentral: 'Centro',
  bairrosPorDirecao: ['L', 'NE', 'N', 'NO', 'O', 'SO', 'S', 'SE'],
});

/** Rua reta norte-sul passando pelo centro, com `km` de extensão. */
const ruaNorteSul = (nome: string, km: number, dLon = 0): RuaOsm => ({
  nome,
  pontos: [
    [CENTRO.lat - (km * 500) / GRAU_M, CENTRO.lon + dLon],
    [CENTRO.lat + (km * 500) / GRAU_M, CENTRO.lon + dLon],
  ],
});

describe('postes sobre as ruas reais', () => {
  it('põe os postes em cima da rua, a cada 35 m, a partir do centro', () => {
    const postes = posicionarPostes(
      [ruaNorteSul('Avenida Goiás', 1)],
      opcoes(5),
    );

    expect(postes).toHaveLength(5);
    for (const p of postes) expect(p.longitude).toBeCloseTo(CENTRO.lon, 6);
    const lats = postes.map((p) => p.latitude).sort((a, b) => a - b);
    for (let i = 1; i < lats.length; i++) {
      expect((lats.at(i)! - lats.at(i - 1)!) * GRAU_M).toBeCloseTo(35, 0);
    }
    // os 5 mais próximos do centro: nenhum a mais de ~90 m
    for (const p of postes) {
      expect(
        metros({ lat: p.latitude, lon: p.longitude }, CENTRO),
      ).toBeLessThan(90);
    }
  });

  it('não duplica postes onde duas ruas se cruzam', () => {
    const leste = {
      nome: 'Rua 4',
      pontos: [
        [CENTRO.lat, CENTRO.lon - 0.005],
        [CENTRO.lat, CENTRO.lon + 0.005],
      ],
    };
    const postes = posicionarPostes(
      [ruaNorteSul('Avenida Goiás', 1), leste],
      opcoes(12),
    );

    for (const a of postes) {
      for (const b of postes) {
        if (a === b) continue;
        const d = metros(
          { lat: a.latitude, lon: a.longitude },
          { lat: b.latitude, lon: b.longitude },
        );
        expect(d).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('numera os códigos por bairro e usa o nome da rua no endereço', () => {
    const postes = posicionarPostes(
      [ruaNorteSul('Avenida Goiás', 1)],
      opcoes(8),
    );

    expect(postes.at(0)).toMatchObject({ codigo: 'P-001', bairro: 'Centro' });
    expect(postes.map((p) => p.codigo)).toEqual(
      Array.from({ length: 8 }, (_, i) => `P-00${i + 1}`),
    );
    expect(postes.at(0)!.endereco).toMatch(/^Avenida Goiás, \d+$/);
  });

  it('define o bairro pela direção fora do raio central', () => {
    const o = opcoes(1);
    const a = (dLat: number, dLon: number) =>
      bairroPorPosicao({ lat: CENTRO.lat + dLat, lon: CENTRO.lon + dLon }, o);

    expect(a(0, 0)).toBe('Centro');
    expect(a(0, 0.005)).toBe('L');
    expect(a(0.005, 0)).toBe('N');
    expect(a(0, -0.005)).toBe('O');
    expect(a(-0.005, 0)).toBe('S');
    expect(a(-0.004, 0.004)).toBe('SE');
  });

  it('avisa quando as ruas não comportam a rede inteira', () => {
    expect(() =>
      posicionarPostes([ruaNorteSul('Rua curta', 0.1)], opcoes(50)),
    ).toThrow(/Só cabem/);
  });
});
