import { RegistroMetricas } from './metricas';

/// Métricas da instância central (API). Os rótulos `modulo` separam pipeline,
/// nuvem (resumos do fog), regras e HTTP.
export const metricasApi = new RegistroMetricas();

export const M = {
  mensagens: metricasApi.contador(
    'plataforma_mensagens_total',
    'Mensagens processadas, por módulo, canal e resultado (aceita, duplicada, recusada...).',
  ),
  latencia: metricasApi.histograma(
    'plataforma_latencia_segundos',
    'Tempo de processamento por módulo (recebimento até a persistência).',
  ),
  erros: metricasApi.contador(
    'plataforma_erros_total',
    'Erros por módulo e etapa (inclui mensagens recusadas pelo pipeline).',
  ),
  alarmes: metricasApi.contador(
    'plataforma_alarmes_total',
    'Alarmes abertos, por origem e severidade.',
  ),
  acoes: metricasApi.contador(
    'plataforma_acoes_total',
    'Ações das regras, por tipo e resultado.',
  ),
  http: metricasApi.contador(
    'http_requisicoes_total',
    'Requisições HTTP por método, rota e status.',
  ),
  httpLatencia: metricasApi.histograma(
    'http_latencia_segundos',
    'Latência das requisições HTTP por rota.',
  ),
};
