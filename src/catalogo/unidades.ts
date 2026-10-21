/// Conversão entre unidades UCUM de uma mesma grandeza física, para normalizar
/// a medida na unidade do perfil (RF-PRO-01). Cobre os prefixos usados pelos
/// domínios da plataforma; o que não estiver aqui não é convertido.

type Familia =
  | 'potencia'
  | 'energia'
  | 'tensao'
  | 'corrente'
  | 'comprimento'
  | 'massa'
  | 'volume'
  | 'tempo'
  | 'fracao';

const FATORES: Record<string, [Familia, number]> = {
  W: ['potencia', 1],
  kW: ['potencia', 1e3],
  MW: ['potencia', 1e6],
  'W.h': ['energia', 1],
  'kW.h': ['energia', 1e3],
  'MW.h': ['energia', 1e6],
  mV: ['tensao', 1e-3],
  V: ['tensao', 1],
  kV: ['tensao', 1e3],
  mA: ['corrente', 1e-3],
  A: ['corrente', 1],
  mm: ['comprimento', 1e-3],
  cm: ['comprimento', 1e-2],
  m: ['comprimento', 1],
  km: ['comprimento', 1e3],
  g: ['massa', 1e-3],
  kg: ['massa', 1],
  t: ['massa', 1e3],
  mL: ['volume', 1e-3],
  L: ['volume', 1],
  m3: ['volume', 1e3],
  s: ['tempo', 1],
  min: ['tempo', 60],
  h: ['tempo', 3600],
  '%': ['fracao', 1e-2],
  '1': ['fracao', 1],
};

/// Temperatura tem deslocamento, não só fator.
const PARA_KELVIN: Record<string, (v: number) => number> = {
  K: (v) => v,
  Cel: (v) => v + 273.15,
  '[degF]': (v) => ((v - 32) * 5) / 9 + 273.15,
};
const DE_KELVIN: Record<string, (k: number) => number> = {
  K: (k) => k,
  Cel: (k) => k - 273.15,
  '[degF]': (k) => ((k - 273.15) * 9) / 5 + 32,
};

/** Valor convertido de `de` para `para`; null se as unidades não são da mesma grandeza. */
export function converter(
  valor: number,
  de: string,
  para: string,
): number | null {
  if (de === para) return valor;
  if (de in PARA_KELVIN && para in DE_KELVIN) {
    return DE_KELVIN[para](PARA_KELVIN[de](valor));
  }
  const a = FATORES[de];
  const b = FATORES[para];
  if (!a || !b || a[0] !== b[0]) return null;
  return Number(((valor * a[1]) / b[1]).toPrecision(12));
}
