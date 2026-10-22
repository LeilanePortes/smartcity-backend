import type { LoggerService } from '@nestjs/common';

/// Logs estruturados (RF-OBS-02): uma linha JSON por evento, com `ts`, `nivel`,
/// `modulo`, `msg` e campos extras — entre eles `correlacao`, o `id_mensagem`
/// da mensagem canônica, que permite seguir a mesma mensagem do edge ao fog e
/// à central. `LOG_FORMATO=texto` volta ao formato legível; `LOG_NIVEL=debug`
/// liga o rastro de cada mensagem.

export type Nivel = 'debug' | 'info' | 'warn' | 'error';
const ORDEM: Record<Nivel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const nivelMinimo = () => ORDEM[process.env.LOG_NIVEL as Nivel] ?? ORDEM.info;
export const rastroAtivo = () => nivelMinimo() <= ORDEM.debug;

/** Monta a linha (exportada para teste). */
export function linhaLog(
  nivel: Nivel,
  modulo: string,
  msg: string,
  campos: Record<string, unknown> = {},
  formato = process.env.LOG_FORMATO ?? 'json',
): string {
  if (formato === 'texto') {
    const extra = Object.keys(campos).length
      ? ` ${JSON.stringify(campos)}`
      : '';
    return `[${modulo}] ${msg}${extra}`;
  }
  return JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    modulo,
    msg,
    ...campos,
  });
}

export function registrar(
  nivel: Nivel,
  modulo: string,
  msg: string,
  campos?: Record<string, unknown>,
): void {
  if (ORDEM[nivel] < nivelMinimo()) return;
  const linha = linhaLog(nivel, modulo, msg, campos);
  if (nivel === 'error') console.error(linha);
  else console.log(linha);
}

/**
 * Logger do Nest em JSON. Aceita `logger.log({ msg, correlacao, ... })` para
 * mandar campos extras; o contexto (nome da classe) vira o `modulo`.
 */
export class LoggerJson implements LoggerService {
  private escrever(nivel: Nivel, mensagem: unknown, extras: unknown[]): void {
    const contexto =
      typeof extras.at(-1) === 'string' ? (extras.at(-1) as string) : 'app';
    if (
      mensagem &&
      typeof mensagem === 'object' &&
      !(mensagem instanceof Error)
    ) {
      const { msg, ...campos } = mensagem as Record<string, unknown>;
      registrar(nivel, contexto, String(msg ?? ''), campos);
      return;
    }
    const erro = mensagem instanceof Error ? { stack: mensagem.stack } : {};
    registrar(
      nivel,
      contexto,
      String(mensagem instanceof Error ? mensagem.message : mensagem),
      erro,
    );
  }
  log(m: unknown, ...e: unknown[]) {
    this.escrever('info', m, e);
  }
  warn(m: unknown, ...e: unknown[]) {
    this.escrever('warn', m, e);
  }
  error(m: unknown, ...e: unknown[]) {
    // Nest passa (mensagem, stack, contexto).
    const [stack, contexto] = e.length >= 2 ? e : [undefined, e[0]];
    const campos = typeof stack === 'string' ? { stack } : {};
    if (m && typeof m === 'object')
      this.escrever('error', { ...(m as object), ...campos }, [contexto]);
    else this.escrever('error', { msg: m, ...campos }, [contexto]);
  }
  debug(m: unknown, ...e: unknown[]) {
    this.escrever('debug', m, e);
  }
  verbose(m: unknown, ...e: unknown[]) {
    this.escrever('debug', m, e);
  }
  fatal(m: unknown, ...e: unknown[]) {
    this.escrever('error', m, e);
  }
}
