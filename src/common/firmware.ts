/// Catálogo de firmwares dos controladores de poste (simulado).
///
/// Serve à demonstração do OTA com grupo canário: duas versões estáveis e duas
/// com defeito proposital — uma que só aparece nas métricas (energia) e outra
/// que o próprio aparelho detecta no autoteste e desfaz (rollback A/B).

export interface PerfilFirmware {
  versao: string;
  descricao: string;
  /// Multiplicador do consumo de energia em operação (1 = normal).
  fatorConsumo: number;
  /// true = a versão não passa no autoteste após o reinício e o aparelho volta
  /// sozinho para a versão anterior (partições A/B).
  falhaAutoteste: boolean;
}

export const VERSAO_FIRMWARE_PADRAO = '2.4.1';

export const CATALOGO_FIRMWARE: readonly PerfilFirmware[] = [
  {
    versao: '2.4.1',
    descricao: 'Versão atualmente em campo (estável).',
    fatorConsumo: 1,
    falhaAutoteste: false,
  },
  {
    versao: '2.5.0',
    descricao: 'Ajustes no sensor 360° e na reconexão MQTT (estável).',
    fatorConsumo: 1,
    falhaAutoteste: false,
  },
  {
    versao: '3.0.0',
    descricao:
      'Novo agrupamento de leituras para economizar banda — DEFEITO: mantém o rádio ' +
      'ligado por mais tempo e o consumo sobe ~80%. Passa no autoteste; só as ' +
      'métricas do canário × controle revelam.',
    fatorConsumo: 1.8,
    falhaAutoteste: false,
  },
  {
    versao: '3.0.1',
    descricao:
      'Build corrompido — DEFEITO: falha no autoteste após o reinício; o aparelho ' +
      'volta sozinho para a versão anterior (rollback A/B).',
    fatorConsumo: 1,
    falhaAutoteste: true,
  },
];

/** Perfil da versão; versões fora do catálogo são tratadas como estáveis. */
export function perfilFirmware(versao: string): PerfilFirmware {
  return (
    CATALOGO_FIRMWARE.find((p) => p.versao === versao) ?? {
      versao,
      descricao: 'Versão fora do catálogo (tratada como estável).',
      fatorConsumo: 1,
      falhaAutoteste: false,
    }
  );
}
