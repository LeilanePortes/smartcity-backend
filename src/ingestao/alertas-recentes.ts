import { MsgAlerta } from '../common/topicos-mqtt';

/// Quantos alertas recentes ficam em memória para `GET /arquitetura`.
export const MAX_ALERTAS_RECENTES = 20;

/** Fila dos últimos alertas do fog (mais recentes primeiro). */
export class AlertasRecentes {
  private readonly itens: MsgAlerta[] = [];

  constructor(private readonly max = MAX_ALERTAS_RECENTES) {}

  registrar(alerta: MsgAlerta): void {
    this.itens.unshift(alerta);
    if (this.itens.length > this.max) this.itens.pop();
  }

  listar(): MsgAlerta[] {
    return [...this.itens];
  }
}
