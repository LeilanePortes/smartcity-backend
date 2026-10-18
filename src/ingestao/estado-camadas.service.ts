import { Injectable } from '@nestjs/common';
import { MsgAlerta, MsgFogEstado, MsgFogTrafego } from '../common/topicos-mqtt';
import { AlertasRecentes } from './alertas-recentes';

/**
 * Último estado conhecido das camadas edge e fog, visto pela nuvem. Fica só em
 * memória: é um painel do "agora", não histórico.
 */
@Injectable()
export class EstadoCamadasService {
  brokerConectado = false;
  fog: MsgFogEstado | null = null;
  trafego: MsgFogTrafego | null = null;
  private readonly alertas = new AlertasRecentes();

  registrarAlerta(alerta: MsgAlerta): void {
    this.alertas.registrar(alerta);
  }

  /** Mais recentes primeiro. */
  get alertasRecentes(): MsgAlerta[] {
    return this.alertas.listar();
  }
}
