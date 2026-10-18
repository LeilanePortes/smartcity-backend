import { ConfigService } from '@nestjs/config';

/// De onde vêm os dados "ao vivo" da nuvem:
/// - `camadas`: do fog, pelo broker MQTT da nuvem (arquitetura edge · fog · nuvem);
/// - `interno`: do simulador embutido na API (modo original, usado como reserva).
export type ModoSimulador = 'camadas' | 'interno';

export function lerModoSimulador(config: ConfigService): ModoSimulador {
  return config.get<string>('SIMULADOR_MODO') === 'camadas'
    ? 'camadas'
    : 'interno';
}

export function lerMqttNuvemUrl(config: ConfigService): string {
  return config.get<string>('MQTT_NUVEM_URL') ?? 'mqtt://localhost:1884';
}
