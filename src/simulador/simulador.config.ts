import { ConfigService } from '@nestjs/config';
import { lerModoSimulador } from '../ingestao/ingestao.config';

/// Configuração do simulador de telemetria, lida de variáveis de ambiente
/// com defaults pensados para um demo local (valores em milissegundos).
export interface SimuladorConfig {
  habilitado: boolean;
  /// Com SIMULADOR_MODO=camadas os dados vêm do fog: o simulador só faz a limpeza.
  somenteLimpeza: boolean;
  intervaloSensoresMs: number;
  intervaloTelemetriaMs: number;
  intervaloStatusMs: number;
  intervaloLimpezaMs: number;
  retencaoDias: number;
}

function numero(raw: string | undefined, padrao: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

export function lerSimuladorConfig(config: ConfigService): SimuladorConfig {
  return {
    habilitado: (config.get<string>('SIMULADOR_ENABLED') ?? 'true') !== 'false',
    somenteLimpeza: lerModoSimulador(config) === 'camadas',
    intervaloSensoresMs: numero(
      config.get('SIMULADOR_INTERVALO_SENSORES_MS'),
      5_000,
    ),
    intervaloTelemetriaMs: numero(
      config.get('SIMULADOR_INTERVALO_TELEMETRIA_MS'),
      10_000,
    ),
    intervaloStatusMs: numero(
      config.get('SIMULADOR_INTERVALO_STATUS_MS'),
      30_000,
    ),
    intervaloLimpezaMs: numero(
      config.get('SIMULADOR_INTERVALO_LIMPEZA_MS'),
      6 * 60 * 60_000,
    ),
    retencaoDias: numero(config.get('SIMULADOR_RETENCAO_DIAS'), 40),
  };
}
