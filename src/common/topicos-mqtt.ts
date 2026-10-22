import { SentidoVeiculo, StatusPoste, TipoEventoSensor } from '@prisma/client';

import { INQUILINO, slug } from './contrato';

/// Tópicos dos dispositivos (campo): ver `contrato.ts`, no padrão do documento
/// de requisitos `{inquilino}/{site}/{dominio}/{dispositivo}/{tipo}`.
/// Aqui ficam os tipos internos já decodificados e os tópicos fog → nuvem.

/// Tópico de presença do simulador de campo (Last Will do MQTT).
export const TOPICO_EDGE_ESTADO = `${INQUILINO}/_edge/estado`;

/** "Jardim Primavera" → "jardim-primavera". */
export const slugBairro = slug;

// --- Mensagens internas (já decodificadas da mensagem canônica) -------------
// Datas trafegam como string ISO 8601.

/// Leitura de consumo do poste, a cada intervalo de telemetria.
export interface MsgTelemetria {
  posteId: string;
  codigo: string;
  consumoKw: number;
  luminosidadePct: number;
  em: string;
}

/// Evento do sensor 360°, publicado no instante em que acontece.
export interface MsgEvento {
  posteId: string;
  codigo: string;
  tipo: TipoEventoSensor;
  sentido: SentidoVeiculo;
  luminosidadeResultante: number;
  em: string;
}

/// Saúde do dispositivo (base para OTA / grupo canário).
export interface MsgSaude {
  posteId: string;
  codigo: string;
  versaoFirmware: string;
  uptimeS: number;
  reinicios24h: number;
  rssiDbm: number;
  memoriaLivreKb: number;
  em: string;
}

/// Comando enviado ao poste (manutenção pelo técnico).
export interface MsgComando {
  status: typeof StatusPoste.MANUTENCAO | typeof StatusPoste.NORMAL;
  em: string;
}

/// Presença do simulador de campo (retida no broker).
export interface MsgEdgeEstado {
  online: boolean;
  postes: number;
  em: string;
}

// --- Fog → nuvem ------------------------------------------------------------
// O fog fala com a nuvem num broker separado (uplink), por bairro:
// itaguari/nuvem/<bairro>/resumo · evento · alerta · comando.

export const RAIZ_NUVEM = 'itaguari/nuvem';

export type GrandezaNuvem =
  'resumo' | 'evento' | 'alerta' | 'comando' | 'ota' | 'ota-resultado';

/// Tópico de presença dos gateways fog (Last Will do MQTT).
export const TOPICO_FOG_ESTADO = `${RAIZ_NUVEM}/_fog/estado`;

export const topicoNuvem = (bairro: string, grandeza: GrandezaNuvem): string =>
  `${RAIZ_NUVEM}/${slugBairro(bairro)}/${grandeza}`;

/// Assina uma grandeza de todos os gateways (todos os bairros).
export const assinaturaNuvem = (grandeza: GrandezaNuvem): string =>
  `${RAIZ_NUVEM}/+/${grandeza}`;

const GRANDEZAS_NUVEM: ReadonlySet<string> = new Set<GrandezaNuvem>([
  'resumo',
  'evento',
  'alerta',
  'comando',
  'ota',
  'ota-resultado',
]);

/** Inverso de `topicoNuvem`; null se o tópico não for de um gateway. */
export function parseTopicoNuvem(
  topico: string,
): { bairroSlug: string; grandeza: GrandezaNuvem } | null {
  const prefixo = `${RAIZ_NUVEM}/`;
  if (!topico.startsWith(prefixo)) return null;
  const partes = topico.slice(prefixo.length).split('/');
  if (partes.length !== 2) return null;
  const [bairroSlug, grandeza] = partes;
  if (!bairroSlug || bairroSlug.startsWith('_')) return null;
  if (!GRANDEZAS_NUVEM.has(grandeza)) return null;
  return { bairroSlug, grandeza: grandeza as GrandezaNuvem };
}

/// Recorte de um poste dentro do resumo de uma janela.
export interface ResumoPoste {
  posteId: string;
  codigo: string;
  /// Status diagnosticado pelo fog ao fim da janela.
  status: StatusPoste;
  /// Leituras recebidas na janela (0 = poste não reportou).
  leituras: number;
  consumoMedioKw: number | null;
  luminosidadeMediaPct: number | null;
  energiaKwh: number;
  consumoAtualKw: number | null;
  luminosidadeAtual: number | null;
  ultimaLeituraEm: string | null;
  versaoFirmware: string | null;
}

/// Resumo de um bairro por janela (substitui as leituras brutas na subida).
export interface MsgResumo {
  bairro: string;
  inicio: string;
  fim: string;
  postes: ResumoPoste[];
  totais: {
    postes: number;
    online: number;
    energiaKwh: number;
    leiturasRecebidas: number;
  };
}

/// Evento do sensor repassado pelo fog na hora (o mapa continua ao vivo).
export interface MsgEventoNuvem extends MsgEvento {
  bairro: string;
  /// id_mensagem do evento canônico do poste (rastro edge → fog → nuvem).
  correlacao?: string;
}

/// Mudança de status diagnosticada pelo fog (sobe na hora).
export interface MsgAlerta {
  posteId: string;
  codigo: string;
  bairro: string;
  statusAnterior: StatusPoste;
  status: StatusPoste;
  motivo: string;
  em: string;
}

/// Comando da nuvem para um poste; o fog repassa ao edge.
export interface MsgComandoNuvem extends MsgComando {
  codigo: string;
}

/// Presença dos gateways fog (retida no broker da nuvem).
export interface MsgFogEstado {
  online: boolean;
  gateways: number;
  buffer: number;
  em: string;
}

/// Relatório de banda dos gateways, publicado a cada janela (retido).
export const TOPICO_FOG_TRAFEGO = `${RAIZ_NUVEM}/_fog/trafego`;

/// Tráfego de uma janela: o que entrou do campo × o que subiu para a nuvem.
export interface MsgFogTrafego {
  janelaS: number;
  entrada: { msgs: number; bytes: number };
  saida: { msgs: number; bytes: number };
  /// Redução percentual (0–100) de mensagens e de bytes na subida.
  reducaoMsgsPct: number | null;
  reducaoBytesPct: number | null;
  buffer: number;
  postes: { total: number; online: number };
  gateways: Array<{ bairro: string; postes: number; online: number }>;
  /// Presença do simulador de campo, vista pelo fog (null = ainda não informou).
  edgeOnline: boolean | null;
  em: string;
}

// --- OTA (atualização remota de firmware) ---------------------------------
// nuvem → fog: itaguari/nuvem/<bairro>/ota                       { codigo, versao }
// fog → edge:  itaguari/<bairro>/iluminacao/<poste>/comando      comando "atualizar_firmware"
// edge → fog:  itaguari/<bairro>/iluminacao/<poste>/evento       evento "ota_resultado"
// fog → nuvem: itaguari/nuvem/<bairro>/ota-resultado             MsgOtaResultado

/// Ordem de atualização para um poste.
export interface MsgOta {
  versao: string;
  em: string;
}

/// Ordem de atualização enviada pela nuvem; o fog repassa ao poste.
export interface MsgOtaNuvem extends MsgOta {
  codigo: string;
}

/// Resultado da instalação, informado pelo poste após reiniciar.
export interface MsgOtaResultado {
  posteId: string;
  codigo: string;
  versaoAlvo: string;
  /// Versão que ficou rodando (a anterior, se houve rollback).
  versaoAtual: string;
  sucesso: boolean;
  motivo: string;
  em: string;
}
