/// Prefixo da API REST versionada (RF-APP-01). Uma versão nova seria /api/v2,
/// mantendo a v1 no ar enquanto os clientes migram (RNF-17).
export const PREFIXO_API = 'api/v1';

/// Tarifa de referência do mock: classe B4a (iluminação pública), em R$/kWh (PRD seção 6).
export const TARIFA_B4A_KWH = 0.58;

/// Piso e pico de luminosidade, em percentual (PRD seção 6).
export const LUMINOSIDADE_PISO_PCT = 50;
export const LUMINOSIDADE_PICO_PCT = 100;

/// Cidade da rede simulada.
export const CIDADE = 'Itaguari';
export const UF = 'GO';

/// Total de postes da rede simulada (PRD seção 3).
export const TOTAL_POSTES = 248;

/// Potência nominal de um poste LED a 100% de luminosidade, em kW.
/// A 50% (piso) o consumo fica em ~metade disso.
export const POTENCIA_NOMINAL_KW = 0.1;

/// Multiplicador de consumo aplicado a postes em CONSUMO_ALTO
/// (simula perda de eficiência / driver degradado).
export const FATOR_CONSUMO_ALTO_MIN = 1.8;
export const FATOR_CONSUMO_ALTO_MAX = 2.4;

/// Distribuição de status que o simulador tenta manter ao longo do tempo
/// (mesma proporção do seed inicial — PRD seção 3).
export const ALVO_STATUS = {
  CONSUMO_ALTO: 9,
  FALHA_OFFLINE: 5,
} as const;

/// Fração média da potência nominal em que um poste opera: piso de 50% na maior
/// parte do tempo, pico de 100% em ~15% das leituras.
export const FATOR_OPERACAO_MEDIO = 0.85 * 0.5 + 0.15 * 1.0;

/// Consumo diário de referência de um poste NORMAL, em kWh (operação contínua).
export const KWH_DIA_POSTE_NORMAL =
  POTENCIA_NOMINAL_KW * FATOR_OPERACAO_MEDIO * 24;
