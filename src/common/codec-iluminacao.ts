import { SentidoVeiculo, StatusPoste, TipoEventoSensor } from '@prisma/client';
import { criarMensagem, MensagemCanonica } from './contrato';
import type {
  MsgEvento,
  MsgOtaResultado,
  MsgSaude,
  MsgTelemetria,
} from './topicos-mqtt';

/// Tradução entre as mensagens do domínio "iluminacao" (postes) e a mensagem
/// canônica. O núcleo do contrato não conhece postes: grandezas, eventos e
/// comandos deste domínio são definidos aqui.

/// Grandezas da telemetria do poste (unidades UCUM).
export const GRANDEZA_POTENCIA = 'potencia'; // kW
export const GRANDEZA_LUMINOSIDADE = 'luminosidade'; // %

/// Eventos e comandos do domínio.
export const EVENTO_OTA_RESULTADO = 'ota_resultado';
export const COMANDO_DEFINIR_STATUS = 'definir_status';
export const COMANDO_ATUALIZAR_FIRMWARE = 'atualizar_firmware';

/// Onde o poste está (vai no bloco `local` da mensagem).
export interface LocalPoste {
  site: string;
  area?: string;
  latitude?: number;
  longitude?: number;
}

const local = (l: LocalPoste): MensagemCanonica['local'] => ({
  site: l.site,
  ...(l.area ? { area: l.area } : {}),
  ...(l.latitude !== undefined && l.longitude !== undefined
    ? {
        geo: { type: 'Point' as const, coordinates: [l.longitude, l.latitude] },
      }
    : {}),
});

// --- Edge → canônico --------------------------------------------------------

export function telemetriaCanonica(
  msg: MsgTelemetria,
  l: LocalPoste,
): MensagemCanonica {
  return criarMensagem({
    dispositivo: msg.codigo,
    tipo: 'telemetria',
    timestamp: msg.em,
    local: local(l),
    medidas: [
      { grandeza: GRANDEZA_POTENCIA, valor: msg.consumoKw, unidade: 'kW' },
      {
        grandeza: GRANDEZA_LUMINOSIDADE,
        valor: msg.luminosidadePct,
        unidade: '%',
      },
    ],
  });
}

export function eventoCanonico(
  msg: MsgEvento,
  l: LocalPoste,
): MensagemCanonica {
  return criarMensagem({
    dispositivo: msg.codigo,
    tipo: 'evento',
    timestamp: msg.em,
    local: local(l),
    evento: {
      nome: msg.tipo,
      dados: {
        sentido: msg.sentido,
        luminosidadeResultante: msg.luminosidadeResultante,
      },
    },
  });
}

export function saudeCanonica(msg: MsgSaude, l: LocalPoste): MensagemCanonica {
  return criarMensagem({
    dispositivo: msg.codigo,
    tipo: 'estado',
    timestamp: msg.em,
    local: local(l),
    estado: {
      versaoFirmware: msg.versaoFirmware,
      uptimeS: msg.uptimeS,
      reinicios24h: msg.reinicios24h,
      rssiDbm: msg.rssiDbm,
      memoriaLivreKb: msg.memoriaLivreKb,
    },
  });
}

export function otaResultadoCanonico(
  msg: MsgOtaResultado,
  l: LocalPoste,
): MensagemCanonica {
  return criarMensagem({
    dispositivo: msg.codigo,
    tipo: 'evento',
    timestamp: msg.em,
    local: local(l),
    evento: {
      nome: EVENTO_OTA_RESULTADO,
      dados: {
        versaoAlvo: msg.versaoAlvo,
        versaoAtual: msg.versaoAtual,
        sucesso: msg.sucesso,
        motivo: msg.motivo,
      },
    },
  });
}

// --- Fog → edge (comandos) --------------------------------------------------

export function comandoDefinirStatus(
  codigo: string,
  status: typeof StatusPoste.MANUTENCAO | typeof StatusPoste.NORMAL,
  em: string,
  via?: string,
): MensagemCanonica {
  return criarMensagem({
    dispositivo: codigo,
    tipo: 'comando',
    timestamp: em,
    ...(via ? { via } : {}),
    comando: { nome: COMANDO_DEFINIR_STATUS, parametros: { status } },
  });
}

export function comandoAtualizarFirmware(
  codigo: string,
  versao: string,
  em: string,
  via?: string,
): MensagemCanonica {
  return criarMensagem({
    dispositivo: codigo,
    tipo: 'comando',
    timestamp: em,
    ...(via ? { via } : {}),
    comando: { nome: COMANDO_ATUALIZAR_FIRMWARE, parametros: { versao } },
  });
}

// --- Canônico → tipos internos (fog e edge) ---------------------------------
// Devolvem null quando a mensagem é válida no contrato mas não é deste domínio
// (ex.: uma grandeza que o poste não tem). `posteId` fica a cargo de quem
// conhece o cadastro.

type SemId<T> = Omit<T, 'posteId'>;

const numero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function lerTelemetria(
  m: MensagemCanonica,
): SemId<MsgTelemetria> | null {
  if (m.tipo !== 'telemetria') return null;
  const valor = (g: string) => m.medidas?.find((x) => x.grandeza === g)?.valor;
  const consumoKw = numero(valor(GRANDEZA_POTENCIA));
  const luminosidadePct = numero(valor(GRANDEZA_LUMINOSIDADE));
  if (consumoKw === null || luminosidadePct === null) return null;
  return { codigo: m.dispositivo, consumoKw, luminosidadePct, em: m.timestamp };
}

export function lerEventoSensor(m: MensagemCanonica): SemId<MsgEvento> | null {
  if (m.tipo !== 'evento' || !m.evento) return null;
  const nome = m.evento.nome as TipoEventoSensor;
  if (!Object.values(TipoEventoSensor).includes(nome)) return null;
  const dados = m.evento.dados ?? {};
  const sentido = dados.sentido as SentidoVeiculo;
  const luminosidadeResultante = numero(dados.luminosidadeResultante);
  if (!Object.values(SentidoVeiculo).includes(sentido)) return null;
  if (luminosidadeResultante === null) return null;
  return {
    codigo: m.dispositivo,
    tipo: nome,
    sentido,
    luminosidadeResultante,
    em: m.timestamp,
  };
}

export function lerSaude(m: MensagemCanonica): SemId<MsgSaude> | null {
  if (m.tipo !== 'estado' || !m.estado) return null;
  const e = m.estado;
  if (typeof e.versaoFirmware !== 'string') return null;
  return {
    codigo: m.dispositivo,
    versaoFirmware: e.versaoFirmware,
    uptimeS: numero(e.uptimeS) ?? 0,
    reinicios24h: numero(e.reinicios24h) ?? 0,
    rssiDbm: numero(e.rssiDbm) ?? 0,
    memoriaLivreKb: numero(e.memoriaLivreKb) ?? 0,
    em: m.timestamp,
  };
}

export function lerOtaResultado(
  m: MensagemCanonica,
): SemId<MsgOtaResultado> | null {
  if (m.tipo !== 'evento' || m.evento?.nome !== EVENTO_OTA_RESULTADO) {
    return null;
  }
  const d = m.evento.dados ?? {};
  if (typeof d.versaoAlvo !== 'string' || typeof d.versaoAtual !== 'string') {
    return null;
  }
  return {
    codigo: m.dispositivo,
    versaoAlvo: d.versaoAlvo,
    versaoAtual: d.versaoAtual,
    sucesso: d.sucesso === true,
    motivo: typeof d.motivo === 'string' ? d.motivo : '',
    em: m.timestamp,
  };
}

/// Comando lido pelo poste.
export type ComandoPoste =
  | {
      nome: typeof COMANDO_DEFINIR_STATUS;
      status: typeof StatusPoste.MANUTENCAO | typeof StatusPoste.NORMAL;
    }
  | { nome: typeof COMANDO_ATUALIZAR_FIRMWARE; versao: string };

export function lerComando(m: MensagemCanonica): ComandoPoste | null {
  if (m.tipo !== 'comando' || !m.comando) return null;
  const p = m.comando.parametros ?? {};
  if (m.comando.nome === COMANDO_DEFINIR_STATUS) {
    if (
      p.status === StatusPoste.MANUTENCAO ||
      p.status === StatusPoste.NORMAL
    ) {
      return { nome: COMANDO_DEFINIR_STATUS, status: p.status };
    }
    return null;
  }
  if (m.comando.nome === COMANDO_ATUALIZAR_FIRMWARE) {
    if (typeof p.versao === 'string' && p.versao) {
      return { nome: COMANDO_ATUALIZAR_FIRMWARE, versao: p.versao };
    }
  }
  return null;
}
