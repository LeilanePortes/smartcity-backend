import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Prisma } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { EVENTO_POSTE_STATUS_ALTERADO } from '../postes/postes.events';
import type { PosteStatusAlteradoEvent } from '../postes/postes.events';
import { EVENTO_ALARME_ALTERADO } from '../regras/regras.events';
import { PrismaService } from '../prisma/prisma.service';
import { EVENTO_SIM_POSTES_ATUALIZADOS } from '../simulador/simulador.events';
import type { PostesAtualizadosEvent } from '../simulador/simulador.events';

const SALA_MAPA = 'mapa';
const salaPoste = (id: string) => `poste:${id}`;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Recorte do poste enviado no estado inicial do mapa / da tela de detalhe.
const CAMPOS_MAPA = {
  id: true,
  codigo: true,
  endereco: true,
  bairro: true,
  latitude: true,
  longitude: true,
  status: true,
  luminosidadeAtual: true,
  consumoInstantaneoKw: true,
  ultimaLeituraEm: true,
} satisfies Prisma.PosteSelect;

/**
 * Gateway WebSocket (Socket.IO, namespace `/tempo-real`) — roadmap Fase 5.
 *
 * Salas:
 *  - `mapa`      → atualização ao vivo de vários postes (tela do mapa/KPIs);
 *  - `poste:<id>`→ consumo e luminosidade ao vivo de um poste (tela de detalhe).
 *
 * Cliente → servidor: `assinar:mapa`, `desassinar:mapa`,
 *                     `assinar:poste` {posteId}, `desassinar:poste` {posteId}.
 * Servidor → cliente: `mapa:estado`, `postes:atualizados`,
 *                     `poste:estado`, `poste:atualizado`, `erro` e
 *                     `alarme:atualizado` (para todos os conectados).
 *
 * As atualizações são alimentadas pelo simulador (Fase 2); com
 * `SIMULADOR_ENABLED=false` o gateway ainda serve o estado inicial e as
 * mudanças manuais de status.
 */
@WebSocketGateway({ namespace: '/tempo-real', cors: { origin: '*' } })
export class TempoRealGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TempoRealGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket): void {
    this.logger.debug(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Cliente desconectado: ${client.id}`);
  }

  // --- Assinaturas ------------------------------------------------------

  @SubscribeMessage('assinar:mapa')
  async assinarMapa(@ConnectedSocket() client: Socket) {
    await client.join(SALA_MAPA);
    const postes = await this.prisma.poste.findMany({
      select: CAMPOS_MAPA,
      orderBy: { codigo: 'asc' },
    });
    client.emit('mapa:estado', { postes, em: new Date() });
    return { ok: true, total: postes.length };
  }

  @SubscribeMessage('desassinar:mapa')
  async desassinarMapa(@ConnectedSocket() client: Socket) {
    await client.leave(SALA_MAPA);
    return { ok: true };
  }

  @SubscribeMessage('assinar:poste')
  async assinarPoste(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { posteId?: string },
  ) {
    const posteId = body?.posteId;
    if (!posteId || !UUID_RE.test(posteId)) {
      client.emit('erro', {
        evento: 'assinar:poste',
        mensagem: 'posteId inválido.',
      });
      return { ok: false };
    }

    const poste = await this.prisma.poste.findUnique({
      where: { id: posteId },
      select: CAMPOS_MAPA,
    });
    if (!poste) {
      client.emit('erro', {
        evento: 'assinar:poste',
        mensagem: `Poste ${posteId} não encontrado.`,
      });
      return { ok: false };
    }

    await client.join(salaPoste(posteId));
    client.emit('poste:estado', { poste, em: new Date() });
    return { ok: true };
  }

  @SubscribeMessage('desassinar:poste')
  async desassinarPoste(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { posteId?: string },
  ) {
    if (body?.posteId) await client.leave(salaPoste(body.posteId));
    return { ok: true };
  }

  // --- Difusão a partir dos eventos internos ---------------------------

  @OnEvent(EVENTO_SIM_POSTES_ATUALIZADOS)
  aoAtualizarPostes(evento: PostesAtualizadosEvent): void {
    if (!this.server) return;
    this.server.to(SALA_MAPA).emit('postes:atualizados', {
      origem: evento.origem,
      postes: evento.postes,
      em: evento.em,
    });
    for (const poste of evento.postes) {
      this.server.to(salaPoste(poste.posteId)).emit('poste:atualizado', {
        ...poste,
        origem: evento.origem,
        em: evento.em,
      });
    }
  }

  @OnEvent(EVENTO_POSTE_STATUS_ALTERADO)
  async aoAlterarStatusManual({
    posteId,
  }: PosteStatusAlteradoEvent): Promise<void> {
    if (!this.server) return;
    const poste = await this.prisma.poste.findUnique({
      where: { id: posteId },
      select: {
        id: true,
        codigo: true,
        status: true,
        luminosidadeAtual: true,
        consumoInstantaneoKw: true,
        ultimaLeituraEm: true,
      },
    });
    if (!poste) return;

    const snapshot = {
      posteId: poste.id,
      codigo: poste.codigo,
      status: poste.status,
      luminosidadeAtual: poste.luminosidadeAtual,
      consumoInstantaneoKw: poste.consumoInstantaneoKw,
      ultimaLeituraEm: poste.ultimaLeituraEm,
    };
    const em = new Date();
    this.server
      .to(SALA_MAPA)
      .emit('postes:atualizados', { origem: 'status', postes: [snapshot], em });
    this.server
      .to(salaPoste(posteId))
      .emit('poste:atualizado', { ...snapshot, origem: 'status', em });
  }

  /** Alarme aberto, reconhecido ou resolvido: vai para todos os conectados. */
  @OnEvent(EVENTO_ALARME_ALTERADO)
  aoAlterarAlarme(alarme: object): void {
    this.server?.emit('alarme:atualizado', alarme);
  }
}
