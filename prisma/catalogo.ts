/**
 * Catálogo inicial da Prefeitura de Itaguari (idempotente: roda a cada subida
 * do container, depois das migrations e do seed, e não apaga nada).
 *
 *   inquilino  itaguari
 *   domínio    iluminacao
 *   perfil     luminaria-led
 *   locais     os 9 bairros, com o polígono de cada um
 *   áreas      as ruas de cada bairro que têm postes, com o traçado
 *   dispositivos  um por poste (código p-001...), ligado pelo posteId
 *
 * O domínio "energia" (ou qualquer outro) não está aqui de propósito: ele é
 * criado pela API, sem alteração de código (RF-CEN-01) — ver docs/requests.http.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { INQUILINO, DOMINIO_ILUMINACAO, slug } from '../src/common/contrato';
import { VERSAO_FIRMWARE_PADRAO } from '../src/common/firmware';
import { OPCOES_POSICIONAMENTO, RAIO_URBANO_M } from './dados/bairros-itaguari';
import {
  areasDasRuas,
  MultiLinha,
  poligonoBairro,
  ruaDoEndereco,
  trechosPerto,
} from './dados/geometria-catalogo';
import type { RuaOsm } from './dados/posicionar-postes';

const prisma = new PrismaClient();
const ARQUIVO_RUAS = join(__dirname, 'dados', 'ruas-itaguari.json');

const PERFIL_LUMINARIA = {
  slug: 'luminaria-led',
  nome: 'Luminária LED com sensor 360°',
  descricao:
    'Controlador de poste: potência e luminosidade. A nuvem recebe a telemetria pelo resumo do fog, a cada 60 s.',
  grandezas: [
    { grandeza: 'potencia', unidade: 'kW', minimo: 0, maximo: 0.25 },
    { grandeza: 'luminosidade', unidade: '%', minimo: 0, maximo: 100 },
  ],
  intervaloEnvioS: 60,
};

async function main(): Promise<void> {
  const inquilino = await prisma.inquilino.upsert({
    where: { slug: INQUILINO },
    create: { slug: INQUILINO, nome: 'Prefeitura de Itaguari' },
    update: {},
  });
  const inquilinoId = inquilino.id;

  const dominio = await prisma.dominio.upsert({
    where: { inquilinoId_slug: { inquilinoId, slug: DOMINIO_ILUMINACAO } },
    create: {
      inquilinoId,
      slug: DOMINIO_ILUMINACAO,
      nome: 'Iluminação pública',
      descricao: 'Telegestão e dimerização das luminárias da cidade.',
    },
    update: {},
  });

  const perfil = await prisma.perfilDispositivo.upsert({
    where: { inquilinoId_slug: { inquilinoId, slug: PERFIL_LUMINARIA.slug } },
    create: { inquilinoId, ...PERFIL_LUMINARIA },
    update: {},
  });

  // Locais: os 9 bairros, com o polígono usado para posicionar os postes.
  const bairros = [
    OPCOES_POSICIONAMENTO.bairroCentral,
    ...OPCOES_POSICIONAMENTO.bairrosPorDirecao,
  ];
  const sitePorBairro = new Map<string, string>();
  for (const bairro of bairros) {
    const geometria = poligonoBairro(
      bairro,
      OPCOES_POSICIONAMENTO,
      RAIO_URBANO_M,
    );
    const site = await prisma.site.upsert({
      where: { inquilinoId_slug: { inquilinoId, slug: slug(bairro) } },
      create: { inquilinoId, slug: slug(bairro), nome: bairro, geometria },
      update: { geometria },
    });
    sitePorBairro.set(bairro, site.id);
  }

  // Áreas: as ruas que têm postes em cada bairro, com o traçado real (OSM).
  const postes = await prisma.poste.findMany({
    select: {
      id: true,
      codigo: true,
      endereco: true,
      bairro: true,
      latitude: true,
      longitude: true,
      ultimaLeituraEm: true,
    },
  });
  const chaveDe = (p: { bairro: string; endereco: string }) =>
    `${p.bairro}|${ruaDoEndereco(p.endereco)}`;
  const postesPorChave = new Map<string, typeof postes>();
  for (const p of postes) {
    const chave = chaveDe(p);
    postesPorChave.set(chave, [...(postesPorChave.get(chave) ?? []), p]);
  }
  const { ruas } = JSON.parse(readFileSync(ARQUIVO_RUAS, 'utf8')) as {
    ruas: RuaOsm[];
  };

  const geometrias = new Map<string, MultiLinha>();
  for (const a of areasDasRuas(ruas, OPCOES_POSICIONAMENTO, RAIO_URBANO_M)) {
    geometrias.set(`${a.bairro}|${a.rua}`, a.geometria);
  }
  const areaPorChave = new Map<string, string>();
  for (const [chave, doTrecho] of postesPorChave) {
    const [bairro, rua] = chave.split('|');
    // Poste na divisa: o traçado da rua dele caiu no bairro vizinho; usa o
    // trecho da rua em volta dos postes.
    const geometria = geometrias.get(chave) ?? {
      type: 'MultiLineString' as const,
      coordinates: ruas
        .filter((r) => r.nome === rua)
        .flatMap(
          (r) =>
            trechosPerto(
              r,
              doTrecho.map((p) => ({ lat: p.latitude, lon: p.longitude })),
              60,
            ).coordinates,
        ),
    };
    const siteId = sitePorBairro.get(bairro)!;
    const area = await prisma.area.upsert({
      where: { siteId_slug: { siteId, slug: slug(rua) } },
      create: {
        siteId,
        slug: slug(rua),
        nome: rua,
        tipo: 'rua',
        geometria,
      },
      update: { geometria },
    });
    areaPorChave.set(chave, area.id);
  }

  // Dispositivos: um por poste. Reaproveita o cadastro (e a credencial) se o
  // dispositivo já existe — inclusive depois de um seed forçado.
  await prisma.$transaction(
    postes.map((p) => {
      const codigo = slug(p.codigo);
      const local = {
        siteId: sitePorBairro.get(p.bairro)!,
        areaId: areaPorChave.get(chaveDe(p)) ?? null,
        latitude: p.latitude,
        longitude: p.longitude,
        posteId: p.id,
        ultimaMensagemEm: p.ultimaLeituraEm,
      };
      return prisma.dispositivo.upsert({
        where: { inquilinoId_codigo: { inquilinoId, codigo } },
        create: {
          inquilinoId,
          codigo,
          nome: `Luminária ${p.codigo}`,
          dominioId: dominio.id,
          perfilId: perfil.id,
          fabricante: 'Simulador SmartCity (edge)',
          modelo: 'LUM-LED-100W',
          firmware: VERSAO_FIRMWARE_PADRAO,
          ...local,
        },
        update: local,
      });
    }),
  );

  const [nSites, nAreas, nDisp] = await Promise.all([
    prisma.site.count({ where: { inquilinoId } }),
    prisma.area.count({ where: { site: { inquilinoId } } }),
    prisma.dispositivo.count({ where: { inquilinoId } }),
  ]);
  console.log(
    `Catálogo ${INQUILINO}: ${nSites} locais, ${nAreas} áreas, ${nDisp} dispositivos ` +
      `(${postes.length} postes ligados ao domínio ${DOMINIO_ILUMINACAO}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
