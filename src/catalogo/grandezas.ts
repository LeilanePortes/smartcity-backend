import { converter } from './unidades';

/// Grandezas de um perfil de dispositivo (RF-CEN-02): unidade UCUM e faixa
/// válida. A medida é convertida para a unidade do perfil (RF-PRO-01); fora da
/// faixa ela não é descartada: é marcada como suspeita.

export interface GrandezaPerfil {
  grandeza: string;
  unidade: string;
  minimo?: number;
  maximo?: number;
}

export interface MedidaRecebida {
  grandeza: string;
  valor: number;
  unidade?: string;
}

export interface MedidaAvaliada {
  grandeza: string;
  /// Valor na unidade do perfil (ou o recebido, se não deu para converter).
  valor: number;
  unidade: string;
  suspeita: boolean;
  motivo?: string;
  /// Unidade em que a medida chegou, quando foi convertida.
  convertidaDe?: string;
}

/** Confere cada medida contra o perfil: grandeza prevista, unidade e faixa. */
export function avaliarMedidas(
  grandezas: readonly GrandezaPerfil[],
  medidas: readonly MedidaRecebida[],
): MedidaAvaliada[] {
  const porNome = new Map(grandezas.map((g) => [g.grandeza, g]));
  return medidas.map((m): MedidaAvaliada => {
    const g = porNome.get(m.grandeza);
    const recebida = m.unidade ?? g?.unidade ?? '';
    const suspeita = (motivo: string, valor = m.valor, unidade = recebida) => ({
      grandeza: m.grandeza,
      valor,
      unidade,
      suspeita: true,
      motivo,
    });
    if (!g) return suspeita(`grandeza "${m.grandeza}" não prevista no perfil`);

    const valor = converter(m.valor, recebida, g.unidade);
    if (valor === null) {
      return suspeita(
        `unidade "${recebida}" não converte para a do perfil ("${g.unidade}")`,
      );
    }
    const convertida = recebida !== g.unidade ? { convertidaDe: recebida } : {};
    if (g.minimo !== undefined && valor < g.minimo) {
      return {
        ...suspeita(
          `abaixo do mínimo do perfil (${g.minimo} ${g.unidade})`,
          valor,
          g.unidade,
        ),
        ...convertida,
      };
    }
    if (g.maximo !== undefined && valor > g.maximo) {
      return {
        ...suspeita(
          `acima do máximo do perfil (${g.maximo} ${g.unidade})`,
          valor,
          g.unidade,
        ),
        ...convertida,
      };
    }
    return {
      grandeza: m.grandeza,
      valor,
      unidade: g.unidade,
      suspeita: false,
      ...convertida,
    };
  });
}
