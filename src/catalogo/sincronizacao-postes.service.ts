import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { MsgResumo } from '../common/topicos-mqtt';
import { EVENTO_NUVEM_RESUMO } from '../ingestao/ingestao.events';
import { PrismaService } from '../prisma/prisma.service';
import { EVENTO_SIM_POSTES_ATUALIZADOS } from '../simulador/simulador.events';
import type { PostesAtualizadosEvent } from '../simulador/simulador.events';

/**
 * Mantém os dispositivos de iluminação em dia com os postes: a hora da última
 * mensagem (online/offline, RF-DIS-06) e a versão de firmware relatada pelo
 * campo (inclusive depois de um OTA). Funciona nos dois modos do simulador,
 * porque escuta os mesmos eventos internos que alimentam o tempo real.
 */
@Injectable()
export class SincronizacaoPostesService {
  private readonly logger = new Logger(SincronizacaoPostesService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(EVENTO_SIM_POSTES_ATUALIZADOS)
  async aoAtualizarPostes({ postes }: PostesAtualizadosEvent): Promise<void> {
    const comLeitura = postes.filter((p) => p.ultimaLeituraEm);
    if (!comLeitura.length) return;
    await this.prisma.$executeRaw`
      UPDATE dispositivos d
         SET "ultimaMensagemEm" = v.em::timestamp
        FROM unnest(
          ${comLeitura.map((p) => p.posteId)}::text[],
          ${comLeitura.map((p) => new Date(p.ultimaLeituraEm!).toISOString())}::text[]
        ) AS v(poste_id, em)
       WHERE d."posteId" = v.poste_id
         AND (d."ultimaMensagemEm" IS NULL OR d."ultimaMensagemEm" < v.em::timestamp)`.catch(
      (e: Error) => this.logger.warn(`Sincronização de conexão: ${e.message}`),
    );
  }

  @OnEvent(EVENTO_NUVEM_RESUMO)
  async aoResumo({ postes }: MsgResumo): Promise<void> {
    const comVersao = postes.filter((p) => p.versaoFirmware);
    if (!comVersao.length) return;
    await this.prisma.$executeRaw`
      UPDATE dispositivos d
         SET firmware = v.versao, "atualizadoEm" = (now() AT TIME ZONE 'utc')
        FROM unnest(
          ${comVersao.map((p) => p.posteId)}::text[],
          ${comVersao.map((p) => p.versaoFirmware!)}::text[]
        ) AS v(poste_id, versao)
       WHERE d."posteId" = v.poste_id AND d.firmware <> v.versao`.catch(
      (e: Error) => this.logger.warn(`Sincronização de firmware: ${e.message}`),
    );
  }
}
