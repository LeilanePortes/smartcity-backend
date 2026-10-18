/// Configuração do simulador de campo (camada edge), lida de variáveis de
/// ambiente. Roda fora do Nest, então lê `process.env` diretamente.
export interface EdgeConfig {
  mqttUrl: string;
  /// Base da API da nuvem, usada só no provisionamento (lista de postes).
  apiUrl: string;
  versaoFirmware: string;
  intervaloSensoresMs: number;
  intervaloTelemetriaMs: number;
  intervaloSaudeMs: number;
  intervaloFalhasMs: number;
  intervaloRelatorioMs: number;
}

function numero(raw: string | undefined, padrao: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

export function lerEdgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): EdgeConfig {
  return {
    mqttUrl: env.MQTT_URL ?? 'mqtt://localhost:1883',
    apiUrl: env.EDGE_API_URL ?? 'http://localhost:3000',
    versaoFirmware: env.EDGE_VERSAO_FIRMWARE ?? '2.4.1',
    intervaloSensoresMs: numero(env.EDGE_INTERVALO_SENSORES_MS, 5_000),
    intervaloTelemetriaMs: numero(env.EDGE_INTERVALO_TELEMETRIA_MS, 10_000),
    intervaloSaudeMs: numero(env.EDGE_INTERVALO_SAUDE_MS, 30_000),
    intervaloFalhasMs: numero(env.EDGE_INTERVALO_FALHAS_MS, 30_000),
    intervaloRelatorioMs: numero(env.EDGE_INTERVALO_RELATORIO_MS, 60_000),
  };
}
