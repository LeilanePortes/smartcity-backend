/**
 * Baixa do OpenStreetMap as ruas com nome do núcleo urbano de Itaguari, GO, e
 * grava `prisma/dados/ruas-itaguari.json`, usado pelo seed para pôr os postes
 * sobre as ruas reais. Só é preciso rodar de novo para atualizar o traçado.
 *
 *   bun run prisma/dados/baixar-ruas.ts
 *   bun run prisma/dados/baixar-ruas.ts --arquivo resposta-overpass.json   (converte uma resposta já baixada)
 *
 * Dados © colaboradores do OpenStreetMap, licença ODbL
 * (https://www.openstreetmap.org/copyright).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CENTRO = { lat: -15.920801, lon: -49.606172 };
const RAIO_M = 1500;
const TIPOS = [
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
];
const SERVIDOR = 'https://overpass-api.de/api/interpreter';
const DESTINO = join(__dirname, 'ruas-itaguari.json');

const CONSULTA =
  `[out:json][timeout:60];way["highway"~"^(${TIPOS.join('|')})$"]["name"]` +
  `(around:${RAIO_M},${CENTRO.lat},${CENTRO.lon});out geom;`;

/** Distância aproximada em metros (equiretangular; precisa o bastante numa cidade). */
function metros(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const lat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dy = ((b.lat - a.lat) * Math.PI) / 180;
  const dx = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos(lat);
  return 6_371_000 * Math.hypot(dx, dy);
}

interface Overpass {
  elements: Array<{
    id: number;
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

async function baixar(): Promise<Overpass> {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const resp = await fetch(SERVIDOR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: CONSULTA }),
    });
    if (resp.ok) return (await resp.json()) as Overpass;
    const espera = 2 ** tentativa * 5;
    console.log(
      `Overpass respondeu ${resp.status}; nova tentativa em ${espera} s`,
    );
    await new Promise((r) => setTimeout(r, espera * 1000));
  }
  throw new Error('Overpass indisponível; tente mais tarde.');
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--arquivo');
  const dados: Overpass =
    i > 0
      ? (JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as Overpass)
      : await baixar();

  const ruas = dados.elements
    .filter(
      (w) =>
        w.tags?.name &&
        TIPOS.includes(w.tags.highway ?? '') &&
        (w.geometry?.length ?? 0) >= 2 &&
        w.geometry!.some((p) => metros(p, CENTRO) <= RAIO_M),
    )
    .map((w) => ({
      osmId: w.id,
      nome: w.tags!.name,
      tipo: w.tags!.highway,
      pontos: w.geometry!.map((p) => [
        Number(p.lat.toFixed(6)),
        Number(p.lon.toFixed(6)),
      ]),
    }))
    .sort((a, b) => a.osmId - b.osmId);

  writeFileSync(
    DESTINO,
    JSON.stringify(
      {
        fonte: 'OpenStreetMap (Overpass API)',
        licenca: 'ODbL — © colaboradores do OpenStreetMap',
        centro: CENTRO,
        raioM: RAIO_M,
        baixadoEm: new Date().toISOString().slice(0, 10),
        ruas,
      },
      null,
      0,
    ) + '\n',
  );
  console.log(`${ruas.length} trechos de rua gravados em ${DESTINO}`);
}

void main();
