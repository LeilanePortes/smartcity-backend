import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma, StatusPoste } from '@prisma/client';
import {
  CIDADE,
  LUMINOSIDADE_PISO_PCT,
  TOTAL_POSTES,
  UF,
} from '../src/common/constants';
import { OPCOES_POSICIONAMENTO } from './dados/bairros-itaguari';
import {
  posicionarPostes,
  PostePosicionado,
  RuaOsm,
} from './dados/posicionar-postes';

const prisma = new PrismaClient();

// Ruas reais do núcleo urbano, baixadas do OpenStreetMap por
// `prisma/dados/baixar-ruas.ts` (© colaboradores do OpenStreetMap, ODbL).
const ARQUIVO_RUAS = join(__dirname, 'dados', 'ruas-itaguari.json');

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

/**
 * Os 248 postes sobre as ruas reais: um a cada 35 m, a partir do centro, com o
 * bairro definido pela posição (o Centro num raio de 170 m; os outros oito por
 * direção, a partir do leste no sentido anti-horário).
 */
function gerarPostes(): PostePosicionado[] {
  const { ruas } = JSON.parse(readFileSync(ARQUIVO_RUAS, 'utf8')) as {
    ruas: RuaOsm[];
  };
  return posicionarPostes(ruas, {
    ...OPCOES_POSICIONAMENTO,
    total: TOTAL_POSTES,
  });
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

  // Limpa e recria a rede (seed idempotente). Os dispositivos dos postes ficam
  // (com `posteId` nulo) e `prisma/catalogo.ts` os religa pelo código.
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
