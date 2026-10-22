import { OPCOES_POSICIONAMENTO, RAIO_URBANO_M } from './bairros-itaguari';
import {
  areasDasRuas,
  poligonoBairro,
  ruaDoEndereco,
  trechosPerto,
} from './geometria-catalogo';
import { bairroPorPosicao, metros } from './posicionar-postes';

const o = OPCOES_POSICIONAMENTO;
const { centro } = o;
const GRAU_M = 111_195;

describe('geometria GeoJSON do catálogo', () => {
  it('o Centro é um círculo fechado com o raio do bairro central', () => {
    const { type, coordinates } = poligonoBairro('Centro', o, RAIO_URBANO_M);
    const anel = coordinates[0];
    expect(type).toBe('Polygon');
    expect(anel.at(0)).toEqual(anel.at(-1));
    for (const [lon, lat] of anel) {
      expect(metros({ lat, lon }, centro)).toBeCloseTo(o.raioCentroM, -1);
    }
  });

  it('cada setor contém os pontos que o seed põe naquele bairro', () => {
    for (const [i, bairro] of o.bairrosPorDirecao.entries()) {
      const anel = poligonoBairro(bairro, o, RAIO_URBANO_M).coordinates[0];
      expect(anel.at(0)).toEqual(anel.at(-1));
      // Ponto no meio do setor, a 400 m do centro.
      const rad = (i * 45 * Math.PI) / 180;
      const p = {
        lat: centro.lat + (400 * Math.sin(rad)) / GRAU_M,
        lon:
          centro.lon +
          (400 * Math.cos(rad)) /
            (GRAU_M * Math.cos((centro.lat * Math.PI) / 180)),
      };
      expect(bairroPorPosicao(p, { ...o, total: 0 })).toBe(bairro);
      const lons = anel.map(([lon]) => lon);
      const lats = anel.map(([, lat]) => lat);
      expect(p.lon).toBeGreaterThanOrEqual(Math.min(...lons));
      expect(p.lon).toBeLessThanOrEqual(Math.max(...lons));
      expect(p.lat).toBeGreaterThanOrEqual(Math.min(...lats));
      expect(p.lat).toBeLessThanOrEqual(Math.max(...lats));
    }
  });

  it('divide a rua por bairro e corta o que passa do raio urbano', () => {
    // Rua leste-oeste passando pelo centro, de 1,6 km.
    const dLon = 800 / (GRAU_M * Math.cos((centro.lat * Math.PI) / 180));
    const pontos = Array.from({ length: 33 }, (_, i) => [
      centro.lat,
      centro.lon - dLon + (2 * dLon * i) / 32,
    ]);
    const areas = areasDasRuas(
      [{ nome: 'Avenida Teste', pontos }],
      o,
      RAIO_URBANO_M,
    );
    expect(areas.map((a) => a.bairro).sort()).toEqual([
      'Centro',
      'Setor Leste',
      'Setor Oeste',
    ]);
    for (const a of areas) {
      expect(a.geometria.type).toBe('MultiLineString');
      for (const linha of a.geometria.coordinates) {
        for (const [lon, lat] of linha) {
          expect(metros({ lat, lon }, centro)).toBeLessThanOrEqual(
            RAIO_URBANO_M + 60,
          );
        }
      }
    }
  });

  it('pega só o trecho da rua em volta dos postes (poste na divisa)', () => {
    const dLat = 100 / GRAU_M;
    const rua = {
      nome: 'Rua Divisa',
      pontos: Array.from({ length: 11 }, (_, i) => [
        centro.lat + i * dLat,
        centro.lon,
      ]),
    };
    const poste = { lat: centro.lat + 5 * dLat, lon: centro.lon };
    const { coordinates } = trechosPerto(rua, [poste], 60);
    expect(coordinates).toHaveLength(1);
    expect(coordinates[0]).toHaveLength(3); // os dois trechos que tocam o poste
  });

  it('tira a rua do endereço do poste', () => {
    expect(ruaDoEndereco('Avenida Goiás, 105')).toBe('Avenida Goiás');
  });
});
