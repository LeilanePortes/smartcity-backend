/// Grandezas de um perfil de dispositivo (RF-CEN-02): unidade UCUM e faixa
/// válida. Uma medida fora da faixa não é descartada: é marcada como suspeita.

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

export interface MedidaAvaliada extends MedidaRecebida {
  suspeita: boolean;
  motivo?: string;
}

/** Confere cada medida contra o perfil: grandeza prevista, unidade e faixa. */
export function avaliarMedidas(
  grandezas: readonly GrandezaPerfil[],
  medidas: readonly MedidaRecebida[],
): MedidaAvaliada[] {
  const porNome = new Map(grandezas.map((g) => [g.grandeza, g]));
  return medidas.map((m) => {
    const g = porNome.get(m.grandeza);
    let motivo: string | undefined;
    if (!g) motivo = `grandeza "${m.grandeza}" não prevista no perfil`;
    else if (m.unidade !== undefined && m.unidade !== g.unidade) {
      motivo = `unidade "${m.unidade}" diferente da do perfil ("${g.unidade}")`;
    } else if (g.minimo !== undefined && m.valor < g.minimo) {
      motivo = `abaixo do mínimo do perfil (${g.minimo} ${g.unidade})`;
    } else if (g.maximo !== undefined && m.valor > g.maximo) {
      motivo = `acima do máximo do perfil (${g.maximo} ${g.unidade})`;
    }
    return motivo
      ? { ...m, suspeita: true, motivo }
      : { ...m, suspeita: false };
  });
}
