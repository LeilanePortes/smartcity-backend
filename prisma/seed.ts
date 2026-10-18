import { PrismaClient, Prisma, StatusPoste } from '@prisma/client';
import {
  CIDADE,
  LUMINOSIDADE_PISO_PCT,
  TOTAL_POSTES,
  UF,
} from '../src/common/constants';

const prisma = new PrismaClient();

// Centro real de Itaguari, GO.
const CENTRO_LAT = -15.920801;
const CENTRO_LON = -49.606172;

// Fator de redução aplicado aos deslocamentos de bairro (BAIRROS[].dLat/dLon)
// e ao jitter/passo das ruas, para manter os 248 postes dentro do núcleo
// urbano real da cidade (malha de ruas pequena, raio < ~1 km do centro).
const RAIO_ESCALA = 0.45;

// PRD seção 3: distribuição inicial de status.
const DISTRIBUICAO_STATUS: Array<[StatusPoste, number]> = [
  [StatusPoste.NORMAL, 231],
  [StatusPoste.CONSUMO_ALTO, 9],
  [StatusPoste.FALHA_OFFLINE, 5],
  [StatusPoste.MANUTENCAO, 3],
];

/** PRNG determinístico (mulberry32) para uma seed reproduzível. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20240909);

/** Ruas por bairro, com deslocamento aproximado do centro (em graus). */
const BAIRROS: Array<{
  nome: string;
  dLat: number;
  dLon: number;
  ruas: string[];
}> = [
  {
    nome: 'Centro',
    dLat: 0,
    dLon: 0,
    ruas: [
      'Avenida Goiás',
      'Rua Itaguari',
      'Rua 15 de Novembro',
      'Rua do Comércio',
      'Praça da Matriz',
      'Rua São José',
      'Rua Coronel Ribeiro',
      'Rua Sete de Setembro',
    ],
  },
  {
    nome: 'Setor Leste',
    dLat: 0.0035,
    dLon: 0.006,
    ruas: [
      'Rua das Palmeiras',
      'Rua dos Ipês',
      'Rua do Cerrado',
      'Rua Nova Aurora',
      'Travessa Bela Vista',
    ],
  },
  {
    nome: 'Setor Oeste',
    dLat: 0.002,
    dLon: -0.0065,
    ruas: [
      'Rua Anhanguera',
      'Rua Bandeirantes',
      'Rua das Acácias',
      'Rua Santos Dumont',
      'Rua Rio Vermelho',
    ],
  },
  {
    nome: 'Setor Norte',
    dLat: 0.0065,
    dLon: -0.001,
    ruas: [
      'Avenida Brasil',
      'Rua Tiradentes',
      'Rua Juscelino Kubitschek',
      'Rua do Horto',
      'Rua Pau Brasil',
    ],
  },
  {
    nome: 'Setor Sul',
    dLat: -0.006,
    dLon: 0.001,
    ruas: [
      'Rua Padre Cícero',
      'Rua Monte Alegre',
      'Rua das Mangueiras',
      'Rua Boa Esperança',
      'Rua Jequitibá',
    ],
  },
  {
    nome: 'Jardim Primavera',
    dLat: -0.004,
    dLon: 0.007,
    ruas: [
      'Rua das Flores',
      'Rua Primavera',
      'Rua dos Girassóis',
      'Rua Jasmim',
      'Alameda dos Buritis',
    ],
  },
  {
    nome: 'Vila Nova',
    dLat: 0.0045,
    dLon: -0.005,
    ruas: [
      'Rua Projetada A',
      'Rua Projetada B',
      'Rua União',
      'Rua Progresso',
      'Rua da Saudade',
    ],
  },
  {
    nome: 'Residencial Bela Vista',
    dLat: -0.0075,
    dLon: -0.004,
    ruas: [
      'Rua Mirante',
      'Rua do Horizonte',
      'Rua da Colina',
      'Rua Recanto Verde',
      'Rua Panorama',
    ],
  },
  {
    nome: 'Setor Industrial',
    dLat: 0.008,
    dLon: 0.008,
    ruas: [
      'Avenida Perimetral',
      'Rua das Indústrias',
      'Rua da Produção',
      'Via de Acesso GO-070',
    ],
  },
];

interface PosteSeed {
  codigo: string;
  endereco: string;
  bairro: string;
  latitude: number;
  longitude: number;
}

/** Distribui os 248 postes pelas ruas e os posiciona ao longo de cada via. */
function gerarPostes(): PosteSeed[] {
  const ruasFlat = BAIRROS.flatMap((b) =>
    b.ruas.map((rua) => ({ rua, bairro: b.nome, dLat: b.dLat, dLon: b.dLon })),
  );

  // Peso aleatório por rua para variar a quantidade de postes.
  const pesos = ruasFlat.map(() => 0.5 + rand());
  const somaPesos = pesos.reduce((a, b) => a + b, 0);

  const alvo = ruasFlat.map((_, i) =>
    Math.max(2, Math.round((pesos[i] / somaPesos) * TOTAL_POSTES)),
  );

  // Ajuste fino para fechar exatamente em TOTAL_POSTES.
  let total = alvo.reduce((a, b) => a + b, 0);
  let idx = 0;
  while (total !== TOTAL_POSTES) {
    if (total > TOTAL_POSTES && alvo[idx % alvo.length] > 2) {
      alvo[idx % alvo.length]--;
      total--;
    } else if (total < TOTAL_POSTES) {
      alvo[idx % alvo.length]++;
      total++;
    }
    idx++;
  }

  const postes: PosteSeed[] = [];
  let numero = 0;

  ruasFlat.forEach((via, i) => {
    const qtd = alvo[i];
    // Orientação da via (N-S ou L-O) e ponto inicial jitterado.
    const horizontal = rand() > 0.5;
    const baseLat =
      CENTRO_LAT + via.dLat * RAIO_ESCALA + (rand() - 0.5) * 0.0008;
    const baseLon =
      CENTRO_LON + via.dLon * RAIO_ESCALA + (rand() - 0.5) * 0.0008;
    const passo = 0.00028; // ~30 m entre postes

    for (let k = 0; k < qtd; k++) {
      numero++;
      const lat = horizontal
        ? baseLat + (rand() - 0.5) * 0.00012
        : baseLat + (k - qtd / 2) * passo;
      const lon = horizontal
        ? baseLon + (k - qtd / 2) * passo
        : baseLon + (rand() - 0.5) * 0.00012;

      postes.push({
        codigo: `P-${String(numero).padStart(3, '0')}`,
        endereco: `${via.rua}, ${100 + k * 12}`,
        bairro: via.bairro,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lon.toFixed(6)),
      });
    }
  });

  return postes;
}

/** Embaralhamento determinístico (Fisher–Yates com o mesmo PRNG). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Estado inicial de telemetria coerente com o status (o simulador assume depois). */
function estadoInicial(status: StatusPoste): {
  luminosidadeAtual: number;
  consumoInstantaneoKw: number;
  ultimaLeituraEm: Date | null;
} {
  const agora = new Date();
  switch (status) {
    case StatusPoste.NORMAL:
      return {
        luminosidadeAtual: LUMINOSIDADE_PISO_PCT,
        consumoInstantaneoKw: Number((0.048 + rand() * 0.014).toFixed(3)),
        ultimaLeituraEm: agora,
      };
    case StatusPoste.CONSUMO_ALTO:
      return {
        luminosidadeAtual: LUMINOSIDADE_PISO_PCT,
        consumoInstantaneoKw: Number((0.11 + rand() * 0.05).toFixed(3)),
        ultimaLeituraEm: agora,
      };
    case StatusPoste.FALHA_OFFLINE:
      return {
        luminosidadeAtual: LUMINOSIDADE_PISO_PCT,
        consumoInstantaneoKw: 0,
        // Última leitura válida entre 40 min e 6 h atrás.
        ultimaLeituraEm: new Date(
          agora.getTime() - (40 + rand() * 320) * 60_000,
        ),
      };
    case StatusPoste.MANUTENCAO:
      return {
        luminosidadeAtual: 0,
        consumoInstantaneoKw: 0,
        ultimaLeituraEm: new Date(agora.getTime() - (5 + rand() * 60) * 60_000),
      };
  }
}

async function main(): Promise<void> {
  const postes = gerarPostes();
  if (postes.length !== TOTAL_POSTES) {
    throw new Error(
      `Esperado ${TOTAL_POSTES} postes, gerado ${postes.length}.`,
    );
  }

  // Vetor de status conforme a distribuição do PRD, embaralhado.
  const statusPool: StatusPoste[] = [];
  for (const [status, qtd] of DISTRIBUICAO_STATUS) {
    for (let i = 0; i < qtd; i++) statusPool.push(status);
  }
  if (statusPool.length !== TOTAL_POSTES) {
    throw new Error(
      `Distribuição de status soma ${statusPool.length}, esperado ${TOTAL_POSTES}.`,
    );
  }
  const statusEmbaralhado = shuffle(statusPool);

  const data: Prisma.PosteCreateManyInput[] = postes.map((p, i) => {
    const status = statusEmbaralhado[i];
    return {
      ...p,
      cidade: CIDADE,
      uf: UF,
      status,
      ...estadoInicial(status),
    };
  });

  // Limpa e recria a rede (seed idempotente).
  await prisma.agregadoConsumo.deleteMany();
  await prisma.eventoSensor.deleteMany();
  await prisma.leituraTelemetria.deleteMany();
  await prisma.poste.deleteMany();

  await prisma.poste.createMany({ data });

  const porStatus = await prisma.poste.groupBy({
    by: ['status'],
    _count: true,
  });

  console.log(`Seed concluído: ${data.length} postes em ${CIDADE}/${UF}.`);
  for (const linha of porStatus.sort((a, b) => b._count - a._count)) {
    console.log(`  ${linha.status.padEnd(14)} ${linha._count}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
