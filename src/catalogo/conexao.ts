/// Online/offline pelo intervalo esperado do perfil (RF-DIS-06): o dispositivo
/// só fica offline depois de passar `FATOR_TOLERANCIA_OFFLINE` intervalos sem
/// mandar nada. Um sensor que envia de hora em hora continua online 5 minutos
/// depois da última mensagem; uma luminária (60 s) cai após 3 minutos.

export const FATOR_TOLERANCIA_OFFLINE = 3;

export interface EstadoConexao {
  online: boolean;
  ultimaMensagemEm: Date | null;
  /// Tempo sem mensagens a partir do qual o dispositivo é considerado offline.
  limiteOfflineS: number;
}

export const limiteOfflineS = (intervaloEnvioS: number): number =>
  intervaloEnvioS * FATOR_TOLERANCIA_OFFLINE;

/** Instante a partir do qual a última mensagem ainda conta como online. */
export const inicioJanelaOnline = (
  intervaloEnvioS: number,
  agora: Date,
): Date => new Date(agora.getTime() - limiteOfflineS(intervaloEnvioS) * 1000);

export function estadoConexao(
  ultimaMensagemEm: Date | null,
  intervaloEnvioS: number,
  agora: Date = new Date(),
): EstadoConexao {
  return {
    online:
      ultimaMensagemEm !== null &&
      ultimaMensagemEm >= inicioJanelaOnline(intervaloEnvioS, agora),
    ultimaMensagemEm,
    limiteOfflineS: limiteOfflineS(intervaloEnvioS),
  };
}
