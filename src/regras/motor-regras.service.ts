import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { Prisma, Regra, SeveridadeAlarme, StatusPoste } from '@prisma/client';
import type { MsgAlerta } from '../common/topicos-mqtt';
import { EVENTO_NUVEM_ALERTA } from '../ingestao/ingestao.events';
import { IngestaoMqttService } from '../pipeline/ingestao-mqtt.service';
import { EVENTO_PIPELINE_MENSAGEM } from '../pipeline/pipeline.service';
import type { MensagemPublicada } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { Acao, Disparo, executarAcao, Portas } from './acoes';
import { AlarmesService } from './alarmes.service';
import {
  comparar,
  Condicao,
  CondicaoAusencia,
  JanelaCondicao,
} from './condicoes';
import { NotificadorService } from './notificador.service';

/// Intervalo da verificação de ausência de dados.
const VERIFICACAO_AUSENCIA_MS = 15_000;

interface Alvo {
  inquilinoId: string;
  dispositivoId: string;
  dominioId: string;
  siteId: string;
  areaId: string | null;
  perfilId: string;
}

const DISPOSITIVO_DISPARO = {
  id: true,
  codigo: true,
  inquilinoId: true,
  inquilino: { select: { slug: true } },
  site: { select: { slug: true } },
  dominio: { select: { slug: true } },
} satisfies Prisma.DispositivoSelect;

/**
 * Motor de regras (RF-PRO-02 e 03), no padrão Observer: escuta cada mensagem
 * aceita pelo pipeline e avalia as regras ativas do escopo, na hora — bem
 * abaixo dos 3 s do critério. Ausência de dados é verificada a cada 15 s.
 *
 * Mensagem atrasada (RF-ING-04) entra no histórico, mas não dispara regra de
 * limite como se fosse atual. Os diagnósticos do fog (falha/offline e consumo
 * alto) viram alarmes de origem "borda", com a hora em que aconteceram.
 */
@Injectable()
export class MotorRegrasService {
  private readonly logger = new Logger(MotorRegrasService.name);
  private regras: Regra[] | null = null;
  private readonly janela = new JanelaCondicao();
  /// Regra|dispositivo já disparados por ausência (até o dado voltar).
  private readonly ausentes = new Set<string>();

  private readonly portas: Portas;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alarmes: AlarmesService,
    notificador: NotificadorService,
    mqtt: IngestaoMqttService,
  ) {
    this.portas = {
      abrirAlarme: () => Promise.reject(new Error('definido por disparo')),
      enviarEmail: (para, assunto, texto) =>
        notificador.enviar(para, assunto, texto),
      publicarMqtt: (topico, payload) => mqtt.publicar(topico, payload),
      postar: async (url, corpo) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(5_000),
        });
        return { status: r.status };
      },
      dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    };
  }

  /** Relê as regras ativas (depois de criar, mudar ou apagar uma). */
  async recarregar(regraAlterada?: string): Promise<void> {
    this.regras = await this.prisma.regra.findMany({ where: { ativa: true } });
    if (regraAlterada) {
      this.janela.esquecer(`${regraAlterada}|`);
      for (const k of this.ausentes) {
        if (k.startsWith(`${regraAlterada}|`)) this.ausentes.delete(k);
      }
    }
  }

  private async ativas(): Promise<Regra[]> {
    if (!this.regras) await this.recarregar();
    return this.regras!;
  }

  // --- Limite (a cada mensagem) --------------------------------------------

  @OnEvent(EVENTO_PIPELINE_MENSAGEM, { async: true })
  async aoMensagem(p: MensagemPublicada): Promise<void> {
    try {
      const alvo: Alvo = {
        inquilinoId: p.inquilinoId,
        dispositivoId: p.dispositivoId,
        dominioId: p.dominioId,
        siteId: p.siteId,
        areaId: p.areaId,
        perfilId: p.perfilId,
      };
      for (const r of await this.ativas()) {
        const c = r.condicao as unknown as Condicao;
        if (c.tipo !== 'limite' || !noEscopo(r, alvo)) continue;
        if (p.atrasada) continue; // histórico, não alarme atual
        const medida = p.medidas.find((m) => m.grandeza === c.grandeza);
        if (!medida) continue;
        const verdadeira = comparar(medida.valor, c.operador, c.valor);
        const em = Date.parse(p.mensagem.timestamp as string);
        const chave = `${r.id}|${p.dispositivoId}`;
        const res = this.janela.avaliar(chave, verdadeira, em, c.duracaoS ?? 0);
        if (res === 'disparar') {
          const cad = p.mensagem.cadastro as Record<string, string>;
          await this.disparar(
            r,
            {
              regra: { id: r.id, nome: r.nome },
              severidade: r.severidade,
              dispositivo: {
                id: p.dispositivoId,
                codigo: p.mensagem.dispositivo as string,
                inquilino: cad.inquilino,
                site: cad.site,
                dominio: cad.dominio,
              },
              titulo: `${r.nome}: ${c.grandeza} ${c.operador} ${c.valor} ${medida.unidade}`,
              detalhe:
                `${c.grandeza} = ${medida.valor} ${medida.unidade}` +
                (c.duracaoS ? ` por ${c.duracaoS} s seguidos` : '') +
                (medida.suspeita ? ` (medida suspeita: ${medida.motivo})` : ''),
              grandeza: c.grandeza,
              valor: medida.valor,
              ocorridoEm: new Date(em),
            },
            alvo.inquilinoId,
          );
        } else if (res === 'normal') {
          await this.alarmes.resolverAutomatico({
            regraId: r.id,
            dispositivoId: p.dispositivoId,
          });
        }
      }
    } catch (e) {
      this.logger.error(`Falha ao avaliar regras: ${(e as Error).message}`);
    }
  }

  // --- Ausência de dados (verificação periódica) ---------------------------

  @Interval(VERIFICACAO_AUSENCIA_MS)
  async verificarAusencias(): Promise<void> {
    try {
      const agora = Date.now();
      for (const r of await this.ativas()) {
        const c = r.condicao as unknown as Condicao;
        if (c.tipo !== 'ausencia') continue;
        await this.verificarRegraAusencia(r, c, agora);
      }
    } catch (e) {
      this.logger.error(
        `Falha na verificação de ausência: ${(e as Error).message}`,
      );
    }
  }

  private async verificarRegraAusencia(
    r: Regra,
    c: CondicaoAusencia,
    agora: number,
  ) {
    const limite = new Date(agora - c.duracaoS * 1000);
    const escopo: Prisma.DispositivoWhereInput = {
      inquilinoId: r.inquilinoId,
      ...(r.dominioId ? { dominioId: r.dominioId } : {}),
      ...(r.siteId ? { siteId: r.siteId } : {}),
      ...(r.areaId ? { areaId: r.areaId } : {}),
      ...(r.perfilId ? { perfilId: r.perfilId } : {}),
      ...(r.dispositivoId ? { id: r.dispositivoId } : {}),
    };

    // O dado voltou: resolve e libera para disparar de novo.
    const voltaram = await this.prisma.dispositivo.findMany({
      where: { ...escopo, ultimaMensagemEm: { gte: limite } },
      select: { id: true },
    });
    for (const { id } of voltaram) this.ausentes.delete(`${r.id}|${id}`);
    if (voltaram.length) {
      await this.alarmes.resolverAutomatico({
        regraId: r.id,
        dispositivoId: { in: voltaram.map((v) => v.id) },
      });
    }

    // Quem já mandou alguma vez e está calado há mais que a duração.
    const calados = await this.prisma.dispositivo.findMany({
      where: { ...escopo, ultimaMensagemEm: { lt: limite } },
      select: { ...DISPOSITIVO_DISPARO, ultimaMensagemEm: true },
    });
    for (const d of calados) {
      const chave = `${r.id}|${d.id}`;
      if (this.ausentes.has(chave)) continue;
      this.ausentes.add(chave);
      await this.disparar(
        r,
        {
          regra: { id: r.id, nome: r.nome },
          severidade: r.severidade,
          dispositivo: {
            id: d.id,
            codigo: d.codigo,
            inquilino: d.inquilino.slug,
            site: d.site.slug,
            dominio: d.dominio.slug,
          },
          titulo: `${r.nome}: sem dados há mais de ${c.duracaoS} s`,
          detalhe: `Última mensagem em ${d.ultimaMensagemEm!.toISOString()}.`,
          ocorridoEm: new Date(
            d.ultimaMensagemEm!.getTime() + c.duracaoS * 1000,
          ),
        },
        d.inquilinoId,
      );
    }
  }

  // --- Diagnósticos do fog → alarmes de borda --------------------------------

  @OnEvent(EVENTO_NUVEM_ALERTA, { async: true })
  async aoAlertaDaBorda(msg: MsgAlerta): Promise<void> {
    try {
      const d = await this.prisma.dispositivo.findUnique({
        where: { posteId: msg.posteId },
        select: { id: true, inquilinoId: true },
      });
      if (!d) return;
      if (
        msg.status === StatusPoste.FALHA_OFFLINE ||
        msg.status === StatusPoste.CONSUMO_ALTO
      ) {
        await this.alarmes.abrir({
          inquilinoId: d.inquilinoId,
          regraId: null,
          dispositivoId: d.id,
          origem: 'borda',
          severidade:
            msg.status === StatusPoste.FALHA_OFFLINE
              ? SeveridadeAlarme.CRITICO
              : SeveridadeAlarme.AVISO,
          titulo:
            msg.status === StatusPoste.FALHA_OFFLINE
              ? `Poste ${msg.codigo}: falha / offline`
              : `Poste ${msg.codigo}: consumo alto`,
          detalhe: `Diagnóstico do fog ${msg.bairro}: ${msg.motivo}`,
          ocorridoEm: new Date(msg.em),
        });
      } else {
        // Voltou ao normal (ou entrou em manutenção): fecha o que a borda abriu.
        await this.alarmes.resolverAutomatico({
          dispositivoId: d.id,
          origem: 'borda',
        });
      }
    } catch (e) {
      this.logger.error(`Falha no alarme de borda: ${(e as Error).message}`);
    }
  }

  // --- Ações -----------------------------------------------------------------

  /** Executa as ações da regra (o alarme primeiro, para os outros levarem o id). */
  private async disparar(
    r: Regra,
    d: Disparo,
    inquilinoId: string,
  ): Promise<void> {
    const acoes = [...(r.acoes as unknown as Acao[])].sort(
      (a, b) => Number(b.tipo === 'alarme') - Number(a.tipo === 'alarme'),
    );
    const portas: Portas = {
      ...this.portas,
      abrirAlarme: (x) =>
        this.alarmes.abrir({
          inquilinoId,
          regraId: r.id,
          dispositivoId: x.dispositivo.id,
          origem: 'regra',
          severidade: x.severidade,
          titulo: x.titulo,
          detalhe: x.detalhe,
          grandeza: x.grandeza,
          valor: x.valor,
          ocorridoEm: x.ocorridoEm,
        }),
    };
    this.logger.log(`Regra "${r.nome}" disparou para ${d.dispositivo.codigo}`);
    for (const acao of acoes) {
      const inicio = new Date();
      const res = await executarAcao(acao, d, portas);
      await this.prisma.execucaoAcao.create({
        data: {
          regraId: r.id,
          alarmeId: d.alarmeId ?? null,
          tipo: res.tipo,
          destino: res.destino ?? null,
          status: res.status,
          tentativas: res.tentativas,
          erro: res.erro ?? null,
          criadoEm: inicio,
          concluidoEm: new Date(),
        },
      });
      if (res.status === 'falha') {
        this.logger.warn(
          `Ação ${res.tipo} da regra "${r.nome}" falhou: ${res.erro}`,
        );
      }
    }
  }
}

/** A mensagem cai no escopo da regra (domínio, local, área, perfil, dispositivo)? */
export function noEscopo(r: Regra, a: Alvo): boolean {
  return (
    r.inquilinoId === a.inquilinoId &&
    (!r.dominioId || r.dominioId === a.dominioId) &&
    (!r.siteId || r.siteId === a.siteId) &&
    (!r.areaId || r.areaId === a.areaId) &&
    (!r.perfilId || r.perfilId === a.perfilId) &&
    (!r.dispositivoId || r.dispositivoId === a.dispositivoId)
  );
}
