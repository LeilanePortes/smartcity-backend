/// Configuração dos gateways fog, lida de variáveis de ambiente. Roda fora do
/// Nest, então lê `process.env` diretamente.
export interface FogConfig {
  /// Broker local do campo (edge ↔ fog).
  mqttLocalUrl: string;
  /// Broker da nuvem (fog ↔ API): o "uplink" do gateway.
  mqttNuvemUrl: string;
  /// Base da API da nuvem, usada só no provisionamento (lista de postes).
  apiUrl: string;
  /// Consumo normalizado acima de N × a mediana do bairro → CONSUMO_ALTO.
  limiarConsumoAlto: number;
  /// Volta a NORMAL abaixo deste múltiplo (histerese, evita "pisca-pisca").
  limiarRetornoNormal: number;
  /// Sem telemetria por este tempo → FALHA_OFFLINE.
  timeoutOfflineMs: number;
  intervaloVerificacaoMs: number;
  /// Tamanho da janela de agregação (um resumo por bairro por janela).
  janelaResumoMs: number;
  /// Porta do GET /metrics (Prometheus).
  metricasPorta: number;
  /// Pasta das filas persistentes (volume do contêiner).
  dadosDir: string;
  /// Senha da cifra das filas (AES-256-GCM).
  chaveFila: string;
  /// Porta da ingestão local por HTTP.
  httpPorta: number;
  /// De quanto em quanto tempo tenta sincronizar a fila local com a central.
  intervaloSyncMs: number;
  /// Máximo de mensagens guardadas enquanto a nuvem está fora (descarta as mais antigas).
  bufferMax: number;
}

function numero(raw: string | undefined, padrao: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

export function lerFogConfig(env: NodeJS.ProcessEnv = process.env): FogConfig {
  return {
    mqttLocalUrl: env.MQTT_URL ?? 'mqtt://localhost:1883',
    mqttNuvemUrl: env.MQTT_NUVEM_URL ?? 'mqtt://localhost:1884',
    apiUrl: env.FOG_API_URL ?? 'http://localhost:3000',
    limiarConsumoAlto: numero(env.FOG_LIMIAR_CONSUMO_ALTO, 1.5),
    limiarRetornoNormal: numero(env.FOG_LIMIAR_RETORNO_NORMAL, 1.3),
    timeoutOfflineMs: numero(env.FOG_TIMEOUT_OFFLINE_MS, 30_000),
    intervaloVerificacaoMs: numero(env.FOG_INTERVALO_VERIFICACAO_MS, 5_000),
    janelaResumoMs: numero(env.FOG_JANELA_RESUMO_MS, 60_000),
    metricasPorta: numero(env.FOG_METRICAS_PORTA, 9464),
    dadosDir: env.FOG_DADOS_DIR ?? './dados-fog',
    chaveFila: env.FOG_CHAVE_FILA ?? 'troque-esta-chave-em-producao',
    httpPorta: numero(env.FOG_HTTP_PORTA, 8081),
    intervaloSyncMs: numero(env.FOG_SYNC_INTERVALO_MS, 5_000),
    bufferMax: numero(env.FOG_BUFFER_MAX, 50_000),
  };
}
