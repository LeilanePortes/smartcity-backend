import { SentidoVeiculo, StatusPoste, TipoEventoSensor } from '@prisma/client';

/// Raiz dos tópicos da rede, no padrão organização/área/dispositivo/grandeza
/// (ex.: itaguari/iluminacao/centro/P-042/telemetria).
export const RAIZ_TOPICOS = 'itaguari/iluminacao';

/// Grandezas publicadas por um poste (edge) ou enviadas a ele (comando).
export type GrandezaPoste = 'telemetria' | 'evento' | 'saude' | 'comando';

/// Assina uma grandeza de todos os postes de todos os bairros.
export const assinaturaTodosPostes = (grandeza: GrandezaPoste): string =>
  `${RAIZ_TOPICOS}/+/+/${grandeza}`;

/// Tópico de presença do simulador de campo (Last Will do MQTT).
export const TOPICO_EDGE_ESTADO = `${RAIZ_TOPICOS}/_edge/estado`;

/** "Jardim Primavera" → "jardim-primavera" (tópicos não levam acento nem espaço). */
export function slugBairro(bairro: string): string {
  return bairro
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function topicoPoste(
  bairro: string,
  codigo: string,
  grandeza: GrandezaPoste,
): string {
  return `${RAIZ_TOPICOS}/${slugBairro(bairro)}/${codigo}/${grandeza}`;
}

export interface TopicoPosteParseado {
  bairroSlug: string;
  codigo: string;
  grandeza: GrandezaPoste;
}

const GRANDEZAS: ReadonlySet<string> = new Set<GrandezaPoste>([
  'telemetria',
  'evento',
  'saude',
  'comando',
]);

/** Inverso de `topicoPoste`; null se o tópico não for de um poste. */
export function parseTopicoPoste(topico: string): TopicoPosteParseado | null {
  const prefixo = `${RAIZ_TOPICOS}/`;
  if (!topico.startsWith(prefixo)) return null;
  const partes = topico.slice(prefixo.length).split('/');
  if (partes.length !== 3) return null;
  const [bairroSlug, codigo, grandeza] = partes;
  if (!bairroSlug || !codigo || !GRANDEZAS.has(grandeza)) return null;
  return { bairroSlug, codigo, grandeza: grandeza as GrandezaPoste };
}

// --- Mensagens (payload JSON) ---------------------------------------------
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
