import { Acao, Disparo, erroAcoes, executarAcao, Portas } from './acoes';
import { comparar, erroCondicao, JanelaCondicao } from './condicoes';

const disparo = (): Disparo => ({
  regra: { id: 'r1', nome: 'Temperatura do silo' },
  severidade: 'CRITICO',
  dispositivo: {
    id: 'd1',
    codigo: 'silo-02',
    inquilino: 'itaguari',
    site: 'centro',
    dominio: 'armazenagem',
  },
  titulo: 'temperatura > 30',
  detalhe: 'temperatura = 31.5 Cel',
  grandeza: 'temperatura',
  valor: 31.5,
  ocorridoEm: new Date('2026-10-22T10:00:00Z'),
});

/** Portas falsas que registram tudo o que a ação fez. */
function portasFalsas(respostasHttp: number[] = [200]) {
  const chamadas = {
    alarmes: [] as Disparo[],
    emails: [] as { para: string; assunto: string; texto: string }[],
    mqtt: [] as { topico: string; payload: Record<string, unknown> }[],
    http: [] as { url: string; corpo: object }[],
    esperas: [] as number[],
  };
  const portas: Portas = {
    abrirAlarme: async (d) => {
      chamadas.alarmes.push(d);
      return { id: 'alarme-1', novo: true };
    },
    enviarEmail: async (para, assunto, texto) => {
      chamadas.emails.push({ para, assunto, texto });
    },
    publicarMqtt: (topico, payload) => {
      chamadas.mqtt.push({
        topico,
        payload: payload as Record<string, unknown>,
      });
      return true;
    },
    postar: async (url, corpo) => {
      chamadas.http.push({ url, corpo });
      return { status: respostasHttp.shift() ?? 200 };
    },
    dormir: async (ms) => {
      chamadas.esperas.push(ms);
    },
  };
  return { portas, chamadas };
}

describe('ações das regras (RF-PRO-03)', () => {
  it('alarme: abre o alarme e guarda o id no disparo', async () => {
    const { portas, chamadas } = portasFalsas();
    const d = disparo();
    const r = await executarAcao({ tipo: 'alarme' }, d, portas);
    expect(r).toMatchObject({ status: 'ok', alarmeId: 'alarme-1' });
    expect(chamadas.alarmes).toHaveLength(1);
    expect(d.alarmeId).toBe('alarme-1');
  });

  it('notificar: envia e-mail com severidade, título e dispositivo', async () => {
    const { portas, chamadas } = portasFalsas();
    const r = await executarAcao(
      { tipo: 'notificar', email: 'operador@itaguari.local' },
      disparo(),
      portas,
    );
    expect(r.status).toBe('ok');
    expect(chamadas.emails[0].para).toBe('operador@itaguari.local');
    expect(chamadas.emails[0].assunto).toBe('[CRITICO] temperatura > 30');
    expect(chamadas.emails[0].texto).toContain('silo-02');
  });

  it('comando: publica comando canônico no tópico do dispositivo', async () => {
    const { portas, chamadas } = portasFalsas();
    const acao: Acao = {
      tipo: 'comando',
      nome: 'ligar_ventilacao',
      parametros: { nivel: 2 },
    };
    const r = await executarAcao(acao, disparo(), portas);
    expect(r).toMatchObject({
      status: 'ok',
      destino: 'itaguari/centro/armazenagem/silo-02/comando',
    });
    expect(chamadas.mqtt[0].payload).toMatchObject({
      versao: '1.0',
      tipo: 'comando',
      dispositivo: 'silo-02',
      comando: { nome: 'ligar_ventilacao', parametros: { nivel: 2 } },
    });
  });

  it('webhook: tenta de novo quando o destino falha, com espera crescente', async () => {
    const { portas, chamadas } = portasFalsas([503, 500, 200]);
    const r = await executarAcao(
      { tipo: 'webhook', url: 'http://rotas.local/alarmes' },
      disparo(),
      portas,
    );
    expect(r).toMatchObject({ status: 'ok', tentativas: 3 });
    expect(chamadas.http).toHaveLength(3);
    expect(chamadas.esperas).toEqual([1000, 2000]);
  });

  it('webhook: registra a falha depois de esgotar as tentativas', async () => {
    const { portas } = portasFalsas([500, 500]);
    const r = await executarAcao(
      { tipo: 'webhook', url: 'http://rotas.local/alarmes', tentativas: 2 },
      disparo(),
      portas,
    );
    expect(r).toMatchObject({
      status: 'falha',
      tentativas: 2,
      erro: 'HTTP 500',
    });
  });

  it('publicar: manda o resumo do disparo para o tópico configurado', async () => {
    const { portas, chamadas } = portasFalsas();
    const r = await executarAcao(
      { tipo: 'publicar', topico: 'itaguari/alarmes/criticos' },
      disparo(),
      portas,
    );
    expect(r.status).toBe('ok');
    expect(chamadas.mqtt[0]).toMatchObject({
      topico: 'itaguari/alarmes/criticos',
      payload: { severidade: 'CRITICO', dispositivo: 'silo-02', valor: 31.5 },
    });
  });

  it('valida a configuração das ações', () => {
    expect(
      erroAcoes([
        { tipo: 'alarme' },
        { tipo: 'webhook', url: 'https://x.y/z' },
      ]),
    ).toBeNull();
    expect(erroAcoes([])).toMatch(/pelo menos/);
    expect(erroAcoes([{ tipo: 'sms' }])).toMatch(/tipo/);
    expect(erroAcoes([{ tipo: 'notificar', email: 'x' }])).toMatch(/email/);
    expect(erroAcoes([{ tipo: 'webhook', url: 'ftp://x' }])).toMatch(/http/);
    expect(erroAcoes([{ tipo: 'publicar', topico: 'a/#' }])).toMatch(/curinga/);
  });
});

describe('condições das regras (RF-PRO-02)', () => {
  it('compara com os operadores e valida a condição', () => {
    expect(comparar(31, '>', 30)).toBe(true);
    expect(comparar(30, '>', 30)).toBe(false);
    expect(comparar(30, '>=', 30)).toBe(true);
    expect(
      erroCondicao({
        tipo: 'limite',
        grandeza: 'temperatura',
        operador: '>',
        valor: 30,
      }),
    ).toBeNull();
    expect(
      erroCondicao({
        tipo: 'limite',
        grandeza: 'temperatura',
        operador: '=>',
        valor: 30,
      }),
    ).toMatch(/operador/);
    expect(erroCondicao({ tipo: 'ausencia' })).toMatch(/duracaoS/);
    expect(erroCondicao({ tipo: 'outro' })).toMatch(/tipo/);
  });

  it('janela: "> 30 por 30 min" só dispara depois de 30 min seguidos, uma vez por episódio', () => {
    const j = new JanelaCondicao();
    const min = (m: number) => Date.UTC(2026, 9, 22, 10, m);
    expect(j.avaliar('r|d', true, min(0), 1800)).toBe('aguardando');
    expect(j.avaliar('r|d', true, min(20), 1800)).toBe('aguardando');
    expect(j.avaliar('r|d', true, min(30), 1800)).toBe('disparar');
    expect(j.avaliar('r|d', true, min(35), 1800)).toBe('ativa');
    expect(j.avaliar('r|d', false, min(40), 1800)).toBe('normal');
    // Um valor abaixo no meio reinicia a contagem.
    expect(j.avaliar('r|d', true, min(41), 1800)).toBe('aguardando');
    expect(j.avaliar('r|d', true, min(70), 1800)).toBe('aguardando');
    expect(j.avaliar('r|d', true, min(71), 1800)).toBe('disparar');
  });

  it('sem janela, dispara na primeira medição que atende', () => {
    const j = new JanelaCondicao();
    expect(j.avaliar('x', true, 0)).toBe('disparar');
  });
});
