import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { MensagemCanonica, TopicoDispositivo } from '../common/contrato';
import { avaliarMedidas } from '../catalogo/grandezas';
import type { GrandezaPerfil, MedidaAvaliada } from '../catalogo/grandezas';
import { PrismaService } from '../prisma/prisma.service';
import {
  Canal,
  estaAtrasada,
  ordenarPorMedicao,
  recusa,
  Recusa,
  validar,
} from './etapas';

/// Emitido para cada mensagem aceita (o motor de regras escuta). Payload: `MensagemPublicada`.
export const EVENTO_PIPELINE_MENSAGEM = 'pipeline.mensagem';

export interface MensagemPublicada {
  /// Mensagem canônica enriquecida, como foi gravada.
  mensagem: Record<string, unknown>;
  dispositivoId: string;
  dominioId: string;
  siteId: string;
  areaId: string | null;
  medidas: MedidaAvaliada[];
  atrasada: boolean;
  canal: Canal;
}

/// Quem está mandando: o dispositivo dono do token (HTTP) ou o tópico (MQTT).
export interface Origem {
  canal: Canal;
  /// Slug do inquilino: o do dispositivo autenticado (HTTP) ou o do tópico (MQTT).
  inquilino: string;
  /// Código do dispositivo autenticado pelo token (HTTP e lote).
  dispositivoAutenticado?: string;
  /// Tópico canônico em que a mensagem chegou (MQTT).
  topico?: TopicoDispositivo;
  topicoTexto?: string;
}

export type StatusMensagem = 'aceita' | 'duplicada' | 'recusada';

export interface ResultadoMensagem {
  indice: number;
  id_mensagem: string | null;
  status: StatusMensagem;
  atrasada?: boolean;
  etapa?: Recusa['etapa'];
  motivo?: string;
  erros?: string[];
}

const CADASTRO = {
  id: true,
  codigo: true,
  inquilinoId: true,
  dominioId: true,
  siteId: true,
  areaId: true,
  inquilino: { select: { slug: true } },
  dominio: { select: { slug: true } },
  site: { select: { slug: true } },
  area: { select: { slug: true } },
  perfil: { select: { slug: true, grandezas: true, intervaloEnvioS: true } },
  credenciais: { where: { revogadaEm: null }, select: { id: true }, take: 1 },
} satisfies Prisma.DispositivoSelect;

type Cadastro = Prisma.DispositivoGetPayload<{ select: typeof CADASTRO }>;

interface Pronta {
  indice: number;
  mensagem: MensagemCanonica;
  cadastro: Cadastro;
}

/**
 * Pipeline de ingestão no padrão Pipes and Filters:
 * receber → autenticar → validar → deduplicar → ordenar → enriquecer → publicar.
 *
 * Os três canais (HTTP, lote e MQTT) passam pelo mesmo caminho. O que é
 * recusado vai para a fila de inválidas com a etapa e o motivo (RF-ING-06);
 * repetidas pelo `id_mensagem` são descartadas (RF-ING-08); cada medição é
 * gravada pela hora em que foi medida (RF-ING-04), já enriquecida com o
 * cadastro (RF-PRO-01), e atualiza o último valor (RF-DAD-02).
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventEmitter2,
  ) {}

  async processar(
    payloads: readonly unknown[],
    origem: Origem,
  ): Promise<ResultadoMensagem[]> {
    const agora = new Date();
    const resultados: ResultadoMensagem[] = [];
    const recusadas: { indice: number; payload: unknown; recusa: Recusa }[] =
      [];

    // Validar (JSON Schema da versão).
    const validas: { indice: number; mensagem: MensagemCanonica }[] = [];
    payloads.forEach((payload, indice) => {
      const r = validar(payload, agora);
      if ('recusa' in r) recusadas.push({ indice, payload, recusa: r.recusa });
      else validas.push({ indice, mensagem: r.mensagem });
    });

    // Autenticar: a mensagem é do dispositivo autenticado e ele está ativo.
    const cadastros = await this.carregarCadastros(
      validas.map((v) => v.mensagem.dispositivo),
      origem.inquilino,
    );
    const prontas: Pronta[] = [];
    const vistas = new Set<string>();
    for (const v of validas) {
      const problema = this.autorizar(v.mensagem, cadastros, origem);
      if (problema) {
        recusadas.push({
          indice: v.indice,
          payload: v.mensagem,
          recusa: problema,
        });
        continue;
      }
      // Deduplicar dentro do próprio lote (a primeira ocorrência fica).
      if (vistas.has(v.mensagem.id_mensagem)) {
        resultados.push({
          indice: v.indice,
          id_mensagem: v.mensagem.id_mensagem,
          status: 'duplicada',
        });
        continue;
      }
      vistas.add(v.mensagem.id_mensagem);
      prontas.push({
        ...v,
        cadastro: cadastros.get(v.mensagem.dispositivo)!,
      });
    }

    // Ordenar pela hora da medição, enriquecer, gravar e publicar.
    const gravadas = await this.gravar(
      ordenarPorMedicao(prontas),
      origem,
      agora,
    );
    for (const p of prontas) {
      const g = gravadas.get(p.mensagem.id_mensagem);
      resultados.push(
        g
          ? {
              indice: p.indice,
              id_mensagem: p.mensagem.id_mensagem,
              status: 'aceita',
              atrasada: g.atrasada,
            }
          : {
              indice: p.indice,
              id_mensagem: p.mensagem.id_mensagem,
              status: 'duplicada',
            },
      );
    }

    await this.registrarInvalidas(recusadas, origem);
    for (const r of recusadas) {
      resultados.push({
        indice: r.indice,
        id_mensagem: idDe(r.payload),
        status: 'recusada',
        etapa: r.recusa.etapa,
        motivo: r.recusa.motivo,
        erros: r.recusa.erros,
      });
    }
    return resultados.sort((a, b) => a.indice - b.indice);
  }

  private async carregarCadastros(codigos: string[], inquilino: string) {
    const unicos = [...new Set(codigos)];
    const lista = unicos.length
      ? await this.prisma.dispositivo.findMany({
          where: { codigo: { in: unicos }, inquilino: { slug: inquilino } },
          select: CADASTRO,
        })
      : [];
    return new Map(lista.map((d) => [d.codigo, d]));
  }

  private autorizar(
    m: MensagemCanonica,
    cadastros: Map<string, Cadastro>,
    origem: Origem,
  ): Recusa | null {
    const d = cadastros.get(m.dispositivo);
    if (!d) {
      return recusa(
        'autenticar',
        `dispositivo "${m.dispositivo}" não cadastrado`,
      );
    }
    if (origem.dispositivoAutenticado !== undefined) {
      return origem.dispositivoAutenticado === m.dispositivo
        ? null
        : recusa(
            'autenticar',
            `mensagem do dispositivo "${m.dispositivo}" enviada com a credencial de "${origem.dispositivoAutenticado}"`,
          );
    }
    // MQTT: dispositivo ativo e tópico de acordo com o cadastro.
    if (!d.credenciais.length) {
      return recusa(
        'autenticar',
        'dispositivo sem credencial ativa (revogada)',
      );
    }
    const t = origem.topico;
    if (
      t &&
      (t.inquilino !== d.inquilino.slug ||
        t.site !== d.site.slug ||
        t.dominio !== d.dominio.slug ||
        t.dispositivo !== d.codigo ||
        t.tipo !== m.tipo)
    ) {
      return recusa(
        'autenticar',
        `tópico não confere com o cadastro (esperado ${d.inquilino.slug}/${d.site.slug}/${d.dominio.slug}/${d.codigo}/${m.tipo})`,
      );
    }
    return null;
  }

  /**
   * Enriquecer e gravar. O `id_mensagem` único no banco garante que uma
   * mensagem reenviada (inclusive por outra requisição ao mesmo tempo) entre
   * uma vez só: só as que o banco aceitou geram medições e eventos.
   */
  private async gravar(prontas: Pronta[], origem: Origem, agora: Date) {
    const aceitas = new Map<string, { atrasada: boolean }>();
    if (!prontas.length) return aceitas;

    const enriquecidas = prontas.map((p) => enriquecer(p, origem, agora));
    const publicadas: MensagemPublicada[] = [];

    await this.prisma.$transaction(async (tx) => {
      const criadas = await tx.mensagemIngerida.createManyAndReturn({
        data: enriquecidas.map((e) => e.linha),
        skipDuplicates: true,
        select: { id: true, idMensagem: true },
      });
      const idPorMensagem = new Map(criadas.map((c) => [c.idMensagem, c.id]));

      const medicoes: Prisma.MedicaoCreateManyInput[] = [];
      for (const e of enriquecidas) {
        const mensagemId = idPorMensagem.get(e.linha.idMensagem);
        if (!mensagemId) continue; // duplicada
        aceitas.set(e.linha.idMensagem, { atrasada: e.linha.atrasada });
        publicadas.push(e.publicada);
        for (const m of e.publicada.medidas) {
          medicoes.push({
            mensagemId,
            inquilinoId: e.linha.inquilinoId,
            dispositivoId: e.linha.dispositivoId,
            dominioId: e.linha.dominioId,
            siteId: e.linha.siteId,
            areaId: e.linha.areaId,
            grandeza: m.grandeza,
            valor: m.valor,
            unidade: m.unidade,
            medidoEm: e.linha.medidoEm,
            suspeita: m.suspeita,
            motivoSuspeita: m.motivo ?? null,
          });
        }
      }
      if (medicoes.length) await tx.medicao.createMany({ data: medicoes });
    });

    await this.atualizarUltimos(publicadas);
    for (const p of publicadas) this.eventos.emit(EVENTO_PIPELINE_MENSAGEM, p);
    return aceitas;
  }

  /** Último valor por dispositivo e grandeza: dado atrasado não sobrescreve um mais novo. */
  private async atualizarUltimos(publicadas: MensagemPublicada[]) {
    const ultimos = new Map<
      string,
      { dispositivoId: string; medida: MedidaAvaliada; em: Date }
    >();
    const ultimaPorDispositivo = new Map<string, Date>();
    for (const p of publicadas) {
      const em = new Date(p.mensagem.timestamp as string);
      const atual = ultimaPorDispositivo.get(p.dispositivoId);
      if (!atual || atual < em) ultimaPorDispositivo.set(p.dispositivoId, em);
      for (const medida of p.medidas) {
        const chave = `${p.dispositivoId}|${medida.grandeza}`;
        const ja = ultimos.get(chave);
        if (!ja || ja.em <= em) {
          ultimos.set(chave, { dispositivoId: p.dispositivoId, medida, em });
        }
      }
    }

    for (const { dispositivoId, medida, em } of ultimos.values()) {
      await this.prisma.$executeRaw`
        INSERT INTO ultimos_valores
          ("dispositivoId", grandeza, valor, unidade, "medidoEm", suspeita, "atualizadoEm")
        VALUES (${dispositivoId}, ${medida.grandeza}, ${medida.valor}, ${medida.unidade},
                ${em.toISOString()}::timestamp, ${medida.suspeita}, (now() AT TIME ZONE 'utc'))
        ON CONFLICT ("dispositivoId", grandeza) DO UPDATE
          SET valor = EXCLUDED.valor, unidade = EXCLUDED.unidade,
              "medidoEm" = EXCLUDED."medidoEm", suspeita = EXCLUDED.suspeita,
              "atualizadoEm" = EXCLUDED."atualizadoEm"
        WHERE ultimos_valores."medidoEm" <= EXCLUDED."medidoEm"`;
    }
    for (const [id, em] of ultimaPorDispositivo) {
      await this.prisma.dispositivo.updateMany({
        where: {
          id,
          OR: [{ ultimaMensagemEm: null }, { ultimaMensagemEm: { lt: em } }],
        },
        data: { ultimaMensagemEm: em },
      });
    }
  }

  /** Fila de mensagens inválidas (DLQ), com a etapa e o motivo. */
  private async registrarInvalidas(
    recusadas: { payload: unknown; recusa: Recusa }[],
    origem: Origem,
  ) {
    if (!recusadas.length) return;
    await this.prisma.mensagemInvalida.createMany({
      data: recusadas.map(({ payload, recusa: r }) => ({
        canal: origem.canal,
        etapa: r.etapa,
        motivo: r.motivo,
        erros: r.erros,
        dispositivo: campoTexto(payload, 'dispositivo'),
        idMensagem: idDe(payload),
        topico: origem.topicoTexto ?? null,
        payload: comoJson(payload),
      })),
    });
    this.logger.warn(
      `${recusadas.length} mensagem(ns) recusada(s) via ${origem.canal}: ${recusadas[0].recusa.motivo}`,
    );
  }
}

/** Enriquecer: cadastro (inquilino, domínio, local, área, perfil) + medidas normalizadas. */
function enriquecer(p: Pronta, origem: Origem, agora: Date) {
  const { mensagem: m, cadastro: d } = p;
  const medidoEm = new Date(m.timestamp);
  const atrasada = estaAtrasada(medidoEm, agora, d.perfil.intervaloEnvioS);
  const medidas =
    m.tipo === 'telemetria'
      ? avaliarMedidas(
          d.perfil.grandezas as unknown as GrandezaPerfil[],
          m.medidas ?? [],
        )
      : [];
  const conteudo = {
    ...m,
    local: {
      ...m.local,
      site: d.site.slug,
      ...(d.area ? { area: d.area.slug } : {}),
    },
    ...(m.tipo === 'telemetria' ? { medidas } : {}),
    cadastro: {
      inquilino: d.inquilino.slug,
      dominio: d.dominio.slug,
      site: d.site.slug,
      area: d.area?.slug ?? null,
      perfil: d.perfil.slug,
    },
    recebidoEm: agora.toISOString(),
    atrasada,
  };
  const linha = {
    idMensagem: m.id_mensagem,
    inquilinoId: d.inquilinoId,
    dispositivoId: d.id,
    dominioId: d.dominioId,
    siteId: d.siteId,
    areaId: d.areaId,
    tipo: m.tipo,
    medidoEm,
    recebidoEm: agora,
    canal: origem.canal,
    via: m.via ?? null,
    atrasada,
    conteudo: conteudo as unknown as Prisma.InputJsonValue,
  };
  const publicada: MensagemPublicada = {
    mensagem: conteudo,
    dispositivoId: d.id,
    dominioId: d.dominioId,
    siteId: d.siteId,
    areaId: d.areaId,
    medidas,
    atrasada,
    canal: origem.canal,
  };
  return { linha, publicada };
}

function objeto(payload: unknown): Record<string, unknown> | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    try {
      return objeto(JSON.parse(payload.toString()));
    } catch {
      return null;
    }
  }
  return null;
}

function campoTexto(payload: unknown, campo: string): string | null {
  const v = objeto(payload)?.[campo];
  return typeof v === 'string' ? v.slice(0, 120) : null;
}

const idDe = (payload: unknown) => campoTexto(payload, 'id_mensagem');

function comoJson(payload: unknown): Prisma.InputJsonValue {
  const o = objeto(payload);
  if (o) return o as Prisma.InputJsonValue;
  const bruto = Buffer.isBuffer(payload) ? payload.toString() : payload;
  return {
    bruto: typeof bruto === 'string' ? bruto.slice(0, 4000) : String(bruto),
  };
}
