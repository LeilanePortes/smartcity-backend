import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { MensagemCanonica, validarMensagem } from '../common/contrato';
import { registrar } from '../observabilidade/log';
import { FilaPersistente, ItemFila } from './fila-persistente';

/// Ingestão local do nó de borda (RF-EDG-01) e sincronização com a central em
/// lotes (RF-EDG-02). Dispositivos da rede local mandam mensagens canônicas
/// para POST :8081/ingestao com o próprio token; o fog valida, guarda na fila
/// cifrada e responde na hora — com ou sem internet. Quando a central está
/// alcançável, manda em lotes por /api/v1/ingestao/lote, ordenados pela hora
/// da medição. A central descarta duplicatas pelo id_mensagem, então reenviar
/// depois de uma falha não duplica nada.

export interface MensagemLocal {
  token: string;
  mensagem: MensagemCanonica;
}

const TAMANHO_LOTE = 1_000;
const log = (msg: string, campos?: Record<string, unknown>) =>
  registrar('info', 'fog', msg, campos);

/// Eventos antes de estado, estado antes de telemetria.
const prioridadeDo = (tipo: string) =>
  tipo === 'evento' ? 0 : tipo === 'estado' ? 1 : 2;

export class IngestaoLocal {
  private sincronizando = false;

  constructor(
    private readonly fila: FilaPersistente<MensagemLocal>,
    private readonly apiUrl: string,
  ) {}

  get pendentes(): number {
    return this.fila.pendentes;
  }

  servir(porta: number): void {
    createServer((req, res) => void this.atender(req, res)).listen(porta, () =>
      log(
        `ingestão local em :${porta}/ingestao (${this.fila.pendentes} pendentes no disco)`,
      ),
    );
  }

  private async atender(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const responder = (status: number, corpo: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (req.method === 'GET' && req.url === '/fila') {
      responder(200, { pendentes: this.fila.pendentes });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/ingestao') {
      responder(404, { erro: 'use POST /ingestao' });
      return;
    }
    const token = /^Bearer\s+(\S+)$/i.exec(
      req.headers.authorization ?? '',
    )?.[1];
    if (!token) {
      responder(401, {
        erro: 'Authorization: Bearer <token do dispositivo> obrigatório',
      });
      return;
    }
    let corpo: unknown;
    try {
      let texto = '';
      for await (const parte of req) texto += parte;
      corpo = JSON.parse(texto);
    } catch {
      responder(400, { erro: 'corpo não é JSON válido' });
      return;
    }
    const lista = Array.isArray(corpo) ? corpo : [corpo];
    const recusadas: { indice: number; erros: string[] }[] = [];
    lista.forEach((m, indice) => {
      const v = validarMensagem(m);
      if (!v.valida) recusadas.push({ indice, erros: v.erros });
      else
        this.fila.adicionar(
          { token, mensagem: v.mensagem },
          prioridadeDo(v.mensagem.tipo),
        );
    });
    responder(recusadas.length === lista.length ? 400 : 202, {
      enfileiradas: lista.length - recusadas.length,
      recusadas,
      pendentes: this.fila.pendentes,
    });
  }

  /** Manda a fila para a central em lotes; o que falhar fica para a próxima. */
  async sincronizar(): Promise<void> {
    if (this.sincronizando || !this.fila.pendentes) return;
    this.sincronizando = true;
    try {
      const porToken = new Map<string, ItemFila<MensagemLocal>[]>();
      for (const item of this.fila.proximos(TAMANHO_LOTE)) {
        porToken.set(item.dados.token, [
          ...(porToken.get(item.dados.token) ?? []),
          item,
        ]);
      }
      for (const [token, itens] of porToken) {
        const ordenados = [...itens].sort(
          (a, b) =>
            a.prioridade - b.prioridade ||
            Date.parse(a.dados.mensagem.timestamp) -
              Date.parse(b.dados.mensagem.timestamp),
        );
        const r = await fetch(`${this.apiUrl}/api/v1/ingestao/lote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            mensagens: ordenados.map((x) => x.dados.mensagem),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 200) {
          const { aceitas, duplicadas, recusadas } = (await r.json()) as Record<
            string,
            number
          >;
          this.fila.confirmar(ordenados.map((x) => x.id));
          log('lote sincronizado com a central', {
            aceitas,
            duplicadas,
            recusadas,
            restantes: this.fila.pendentes,
          });
        } else if (r.status === 401 || r.status === 403) {
          // Credencial revogada: a central recusa; não adianta tentar de novo.
          this.fila.confirmar(ordenados.map((x) => x.id));
          registrar(
            'warn',
            'fog',
            'credencial recusada pela central; mensagens descartadas',
            {
              status: r.status,
              mensagens: ordenados.length,
            },
          );
        } else {
          registrar(
            'warn',
            'fog',
            `central respondeu ${r.status}; tento de novo depois`,
          );
          return;
        }
      }
    } catch (e) {
      // Central fora do ar: fica tudo na fila.
      registrar(
        'debug',
        'fog',
        `central inalcançável: ${(e as Error).message}`,
      );
    } finally {
      this.sincronizando = false;
    }
  }
}
