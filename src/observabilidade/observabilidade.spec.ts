import { linhaLog } from './log';
import { RegistroMetricas } from './metricas';

describe('métricas no formato Prometheus (RF-OBS-01)', () => {
  it('contador com rótulos, medidor e histograma', () => {
    const r = new RegistroMetricas();
    const msgs = r.contador('plataforma_mensagens_total', 'Mensagens.');
    const buffer = r.medidor('fog_buffer_mensagens', 'Buffer.');
    const lat = r.histograma(
      'plataforma_latencia_segundos',
      'Latência.',
      [0.1, 1],
    );
    msgs.inc({ modulo: 'pipeline', status: 'aceita' }, 3);
    msgs.inc({ modulo: 'pipeline', status: 'aceita' });
    buffer.set(12);
    lat.observar(0.05, { modulo: 'pipeline' });
    lat.observar(0.5, { modulo: 'pipeline' });
    const t = r.texto();
    expect(t).toContain('# TYPE plataforma_mensagens_total counter');
    expect(t).toContain(
      'plataforma_mensagens_total{modulo="pipeline",status="aceita"} 4',
    );
    expect(t).toContain('fog_buffer_mensagens 12');
    expect(t).toContain(
      'plataforma_latencia_segundos_bucket{modulo="pipeline",le="0.1"} 1',
    );
    expect(t).toContain(
      'plataforma_latencia_segundos_bucket{modulo="pipeline",le="+Inf"} 2',
    );
    expect(t).toContain(
      'plataforma_latencia_segundos_count{modulo="pipeline"} 2',
    );
  });
});

describe('logs estruturados (RF-OBS-02)', () => {
  it('uma linha JSON com nível, módulo e correlação', () => {
    const l = JSON.parse(
      linhaLog(
        'info',
        'pipeline',
        'mensagem aceita',
        { correlacao: 'abc' },
        'json',
      ),
    ) as Record<string, unknown>;
    expect(l).toMatchObject({
      nivel: 'info',
      modulo: 'pipeline',
      msg: 'mensagem aceita',
      correlacao: 'abc',
    });
    expect(typeof l.ts).toBe('string');
  });

  it('formato texto para leitura no terminal', () => {
    expect(linhaLog('info', 'fog', 'olá', {}, 'texto')).toBe('[fog] olá');
  });
});
