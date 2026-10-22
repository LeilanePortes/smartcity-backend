import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { registrar } from './log';
import { M } from './metricas-plataforma';
import { segundosDesde } from './metricas';

/**
 * Para cada requisição: identificador de correlação (o `X-Correlation-Id`
 * recebido ou um novo, devolvido no mesmo cabeçalho) e as métricas HTTP por
 * rota. Requisições com erro (status >= 400) vão para o log.
 */
export function correlacaoEMetricasHttp(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inicio = performance.now();
  const recebido = req.header('x-correlation-id');
  const correlacao =
    recebido && /^[\w.-]{1,100}$/.test(recebido) ? recebido : randomUUID();
  res.setHeader('X-Correlation-Id', correlacao);
  res.on('finish', () => {
    const rota =
      `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}` ||
      'desconhecida';
    const status = String(res.statusCode);
    M.http.inc({ metodo: req.method, rota, status });
    M.httpLatencia.observar(segundosDesde(inicio), { rota });
    if (res.statusCode >= 400) {
      registrar(
        res.statusCode >= 500 ? 'error' : 'warn',
        'http',
        `${req.method} ${req.originalUrl} → ${status}`,
        { correlacao },
      );
    }
  });
  next();
}
