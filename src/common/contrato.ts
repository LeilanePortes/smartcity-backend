import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/// Contrato canônico da plataforma (documento de requisitos, seções 4.4 e 4.5).
/// Os arquivos públicos ficam em `contratos/v1/` (JSON Schema e AsyncAPI).

export const VERSAO_CONTRATO = '1.0';

/// Inquilino desta instância (a prefeitura) e o domínio dos postes.
export const INQUILINO = 'itaguari';
export const DOMINIO_ILUMINACAO = 'iluminacao';

export type TipoMensagem = 'telemetria' | 'evento' | 'estado' | 'comando';

export interface Medida {
  grandeza: string;
  valor: number;
  unidade: string;
}

export interface MensagemCanonica {
  versao: typeof VERSAO_CONTRATO;
  id_mensagem: string;
  dispositivo: string;
  tipo: TipoMensagem;
  timestamp: string;
  via?: string;
  local?: {
    site?: string;
    area?: string;
    geo?: { type: 'Point'; coordinates: number[] };
  };
  medidas?: Medida[];
  evento?: { nome: string; dados?: Record<string, unknown> };
  estado?: Record<string, unknown>;
  comando?: { nome: string; parametros?: Record<string, unknown> };
}

/** Monta uma mensagem canônica nova (gera o `id_mensagem`). */
export function criarMensagem(
  campos: Omit<MensagemCanonica, 'versao' | 'id_mensagem'>,
): MensagemCanonica {
  return { versao: VERSAO_CONTRATO, id_mensagem: randomUUID(), ...campos };
}

// --- Tópicos: {inquilino}/{site}/{dominio}/{dispositivo}/{tipo} -------------

const TIPOS: ReadonlySet<string> = new Set<TipoMensagem>([
  'telemetria',
  'evento',
  'estado',
  'comando',
]);

/** "Jardim Primavera" → "jardim-primavera" (tópicos não levam acento nem espaço). */
export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function topicoDispositivo(
  site: string,
  dominio: string,
  dispositivo: string,
  tipo: TipoMensagem,
  inquilino = INQUILINO,
): string {
  return `${inquilino}/${slug(site)}/${dominio}/${dispositivo}/${tipo}`;
}

/// Assina um tipo de mensagem de todos os dispositivos de um domínio.
export const assinaturaDominio = (
  dominio: string,
  tipo: TipoMensagem,
  inquilino = INQUILINO,
): string => `${inquilino}/+/${dominio}/+/${tipo}`;

export interface TopicoDispositivo {
  inquilino: string;
  site: string;
  dominio: string;
  dispositivo: string;
  tipo: TipoMensagem;
}

/** Inverso de `topicoDispositivo`; null se o tópico não for de um dispositivo. */
export function parseTopicoDispositivo(
  topico: string,
): TopicoDispositivo | null {
  const partes = topico.split('/');
  if (partes.length !== 5) return null;
  const [inquilino, site, dominio, dispositivo, tipo] = partes;
  if (!inquilino || !site || !dominio || !dispositivo) return null;
  if (site.startsWith('_') || !TIPOS.has(tipo)) return null;
  return { inquilino, site, dominio, dispositivo, tipo: tipo as TipoMensagem };
}

// --- Validação contra o JSON Schema publicado -------------------------------

/// Caminho do schema: `contratos/v1` na raiz do projeto (vale em src/ e em dist/).
export const ARQUIVO_SCHEMA = join(
  __dirname,
  '..',
  '..',
  'contratos',
  'v1',
  'mensagem.schema.json',
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validarSchema = ajv.compile<MensagemCanonica>(
  JSON.parse(readFileSync(ARQUIVO_SCHEMA, 'utf8')) as object,
);

export type ResultadoValidacao =
  | { valida: true; mensagem: MensagemCanonica }
  | { valida: false; erros: string[] };

/** Valida um payload (texto ou objeto) contra o schema da versão 1.0. */
export function validarMensagem(payload: unknown): ResultadoValidacao {
  let dado: unknown = payload;
  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    try {
      dado = JSON.parse(payload.toString());
    } catch {
      return { valida: false, erros: ['payload não é JSON válido'] };
    }
  }
  if (validarSchema(dado)) return { valida: true, mensagem: dado };
  return {
    valida: false,
    erros: (validarSchema.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? 'inválido'}`,
    ),
  };
}
