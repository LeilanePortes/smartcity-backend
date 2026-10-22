import type { OpcoesPosicionamento } from './posicionar-postes';

/// Divisão da rede simulada de Itaguari em bairros, usada pelo seed (onde ficam
/// os postes) e pelo catálogo (geometria dos locais e das áreas).

/// Centro real de Itaguari, GO.
export const CENTRO_ITAGUARI = { lat: -15.920801, lon: -49.606172 };

/// Raio do núcleo urbano iluminado: limite externo dos polígonos dos bairros e
/// do traçado das ruas no catálogo (os postes ficam a até ~450 m do centro).
export const RAIO_URBANO_M = 600;

export const OPCOES_POSICIONAMENTO: Omit<OpcoesPosicionamento, 'total'> = {
  centro: CENTRO_ITAGUARI,
  espacamentoM: 35,
  distanciaMinimaM: 20,
  raioCentroM: 170,
  bairroCentral: 'Centro',
  bairrosPorDirecao: [
    'Setor Leste',
    'Setor Industrial',
    'Setor Norte',
    'Vila Nova',
    'Setor Oeste',
    'Residencial Bela Vista',
    'Setor Sul',
    'Jardim Primavera',
  ],
};
