import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derivarChave, FilaPersistente } from './fila-persistente';

const chave = derivarChave('senha-de-teste');
const arquivo = () => join(mkdtempSync(join(tmpdir(), 'fila-')), 'fila.enc');

describe('fila persistente e cifrada do nó de borda (RF-EDG-01, RF-SEG-05)', () => {
  it('sobrevive a reinício: outro processo lê o que ficou pendente', () => {
    const a = arquivo();
    const f1 = new FilaPersistente<{ n: number }>(a, chave, 100);
    f1.adicionar({ n: 1 });
    f1.adicionar({ n: 2 });
    f1.confirmar([f1.proximos(1)[0].id]);
    const f2 = new FilaPersistente<{ n: number }>(a, chave, 100);
    expect(f2.proximos(10).map((x) => x.dados.n)).toEqual([2]);
  });

  it('grava cifrado: o conteúdo não aparece no arquivo e outra chave não lê', () => {
    const a = arquivo();
    new FilaPersistente<{ segredo: string }>(a, chave, 100).adicionar({
      segredo: 'P-042',
    });
    expect(readFileSync(a, 'utf8')).not.toContain('P-042');
    const outra = new FilaPersistente(a, derivarChave('outra'), 100);
    expect(outra.pendentes).toBe(0);
    expect(outra.ilegiveis).toBe(1);
  });

  it('alarmes saem antes da telemetria; cheia, descarta a menos prioritária', () => {
    const f = new FilaPersistente<string>(arquivo(), chave, 3);
    f.adicionar('resumo-1', 2);
    f.adicionar('resumo-2', 2);
    f.adicionar('alerta', 0);
    f.adicionar('evento', 1);
    expect(f.proximos(10).map((x) => x.dados)).toEqual([
      'alerta',
      'evento',
      'resumo-2',
    ]);
    expect(f.descartadas).toBe(1);
  });
});
