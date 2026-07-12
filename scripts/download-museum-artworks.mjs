import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('fixtures/artworks/rijks-aic');
const imagesDir = path.join(root, 'images');
// AIC recommends 1686px for larger public-domain downloads; this is close to
// the requested 1800px target and avoids requesting unnecessarily large files.
const width = 1686;

const selections = [
  // Rijksmuseum: canonical works mixed with quieter paintings, prints, and objects.
  ...[
    ['the-milkmaid', 'The Milkmaid'],
    ['the-little-street', 'View of Houses in Delft, Known as “The Little Street”'],
    ['the-night-watch', 'The Night Watch Militia Company of District II under the Command of Captain Frans Banninck Cocq'],
    ['the-jewish-bride', 'The Jewish Bride'],
    ['the-threatened-swan', 'The Threatened Swan'],
    ['the-merry-family', 'The Merry Family'],
    ['the-syndics', 'The Sampling Officials of the Amsterdam Drapers’ Guild'],
    ['windmill-at-wijk-bij-duurstede', 'Windmill at Wijk bij Duurstede'],
    ['still-life-with-flowers', 'Still Life with Flowers'],
    ['battle-of-waterloo', 'The Battle of Waterloo'],
    ['sudden-shower-at-ohashi', 'Sudden Shower over Ohashi Bridge at Atake'],
    ['breach-of-saint-anthonys-dike', 'The Breach of the Saint Anthony’s Dike near Amsterdam'],
  ].map(([id, title]) => ({ museum: 'Rijksmuseum', id, title })),
  // Art Institute of Chicago: public-domain records, with several less canonical studies and prints.
  ...[
    ['the-herring-net', 'The Herring Net'],
    ['the-childs-bath', "The Child's Bath"],
    ['the-bedroom', 'The Bedroom'],
    ['paris-street-rainy-day', 'Paris Street; Rainy Day'],
    ['la-grande-jatte', 'A Sunday on La Grande Jatte — 1884'],
    ['water-lilies', 'Water Lilies'],
    ['assumption-of-the-virgin', 'The Assumption of the Virgin'],
    ['at-the-moulin-rouge', 'At the Moulin Rouge'],
    ['roses-in-a-vase', 'Roses in a Vase'],
    ['the-zone', 'The Zone (Outside the City Walls)'],
    ['woman-at-her-toilette', 'Woman at Her Toilette'],
    ['great-wave-off-kanagawa', 'The Great Wave off Kanagawa'],
    ['the-dance', 'The Dance'],
  ].map(([id, title]) => ({ museum: 'Art Institute of Chicago', id, title })),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => (typeof value === 'string' ? value : '');
const clean = (value) => text(value).replace(/\s+/g, ' ').trim();
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function json(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function findStrings(value, predicate, results = []) {
  if (typeof value === 'string') {
    if (predicate(value)) results.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) findStrings(item, predicate, results);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findStrings(item, predicate, results);
  }
  return results;
}

function firstContent(value, patterns) {
  const values = findStrings(value, (item) => patterns.some((pattern) => pattern.test(item)));
  return values.find(Boolean) ?? '';
}

function physicalDimensionsFromRecord(record) {
  const texts = findStrings(record, (item) => /\b(?:cm|mm)\b/i.test(item) && /(?:×|x)/i.test(item));
  const sourceText = texts.find((item) => !/^framed\s*:/i.test(item)) ?? texts[0] ?? '';
  if (!sourceText) return undefined;
  const pair = sourceText.match(/(\d+(?:[.,]\d+)?)\s*(?:×|x)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/i);
  const unitScale = pair?.[3]?.toLowerCase() === 'mm' ? 0.1 : 1;
  const values = pair
    ? pair.slice(1, 3).map((value) => Number(value.replace(',', '.')) * unitScale)
    : [...sourceText.matchAll(/(\d+(?:[.,]\d+)?)\s*(cm|mm)/gi)].map((match) => Number(match[1].replace(',', '.')) * (match[2].toLowerCase() === 'mm' ? 0.1 : 1));
  if (values.length < 2) return undefined;
  const heightMatch = sourceText.match(/(?:height|hoogte)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);
  const widthMatch = sourceText.match(/(?:width|breedte)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)/i);
  const toCm = (match) => Number(match[1].replace(',', '.')) * (match[2].toLowerCase() === 'mm' ? 0.1 : 1);
  const heightCm = heightMatch ? toCm(heightMatch) : values[0];
  const widthCm = widthMatch ? toCm(widthMatch) : values[1];
  const depthMatch = sourceText.match(/(?:depth|diepte)\s*(\d+(?:[.,]\d+)?)\s*cm/i);
  return {
    heightCm,
    widthCm,
    ...(depthMatch ? { depthCm: Number(depthMatch[1].replace(',', '.')) } : {}),
    display: `${heightCm} x ${widthCm}${depthMatch ? ` x ${depthMatch[1].replace(',', '.')}` : ''} cm`,
    sourceText,
  };
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) return { heightPx: bytes.readUInt16BE(offset + 5), widthPx: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  throw new Error('Could not read JPEG dimensions');
}

async function resolveAic(selection) {
  const url = new URL('https://api.artic.edu/api/v1/artworks/search');
  url.searchParams.set('q', selection.title);
  url.searchParams.set('limit', '20');
  url.searchParams.set('fields', 'id,title,artist_display,date_display,medium_display,dimensions,dimensions_detail,department_title,image_id,is_public_domain');
  const response = await json(url, { headers: { 'AIC-User-Agent': 'sightlines-artwork-corpus (local test fixture)' } });
  const exact = response.data.find((item) => item.title.toLowerCase() === selection.title.toLowerCase());
  const record = exact ?? response.data.find((item) => item.is_public_domain && item.image_id);
  if (!record) throw new Error(`No public-domain AIC record found for ${selection.title}`);
  if (!record.is_public_domain || !record.image_id) throw new Error(`AIC record is not downloadable/public domain: ${selection.title}`);
  const detail = await json(`https://api.artic.edu/api/v1/artworks/${record.id}?fields=dimensions,dimensions_detail`);
  const resolvedRecord = { ...record, ...detail.data };
  return {
    ...selection,
    objectId: String(record.id),
    title: record.title,
    artistName: clean(record.artist_display),
    year: record.date_display ?? '',
    medium: record.medium_display ?? '',
    physicalDimensions: physicalDimensionsFromRecord(resolvedRecord),
    department: record.department_title ?? '',
    source: {
      repository: 'Art Institute of Chicago',
      objectUrl: `https://www.artic.edu/artworks/${record.id}`,
      apiUrl: `https://api.artic.edu/api/v1/artworks/${record.id}`,
      imageUrl: `https://www.artic.edu/iiif/2/${record.image_id}/full/${width},/0/default.jpg`,
      license: 'CC0 / public domain designation',
    },
  };
}

async function resolveRijks(selection) {
  const searchUrl = new URL('https://data.rijksmuseum.nl/search/collection');
  searchUrl.searchParams.set('title', selection.title);
  searchUrl.searchParams.set('imageAvailable', 'true');
  const search = await json(searchUrl);
  const idUrl = search.orderedItems?.[0]?.id;
  if (!idUrl) throw new Error(`No Rijksmuseum record found for ${selection.title}`);
  const objectId = idUrl.split('/').pop();
  const apiUrl = `https://data.rijksmuseum.nl/${objectId}?_profile=la-framed`;
  const record = await json(apiUrl);
  let imageSource = firstContent(record, [/^https:\/\/iiif\.micr\.io\/[^/]+\//]);
  // The current Linked Art response exposes the collection page as the
  // digital object; the page contains the IIIF image identifier.
  if (!imageSource) {
    const pageUrl = firstContent(record, [/^https:\/\/www\.rijksmuseum\.nl\/(?:nl\/collectie\/object|en\/collection\/object)\//]);
    if (pageUrl) {
      const page = await (await fetch(pageUrl.replace('/nl/collectie/object/', '/en/collection/object/'))).text();
      imageSource = page.match(/https:\/\/iiif\.micr\.io\/[^"'\\ ]+/)?.[0] ?? '';
    }
  }
  if (!imageSource) throw new Error(`No IIIF image found for ${selection.title}`);
  const imageId = imageSource.match(/^https:\/\/iiif\.micr\.io\/([^/]+)\//)?.[1];
  if (!imageId) throw new Error(`Could not parse Rijksmuseum image ID for ${selection.title}`);
  const rights = findStrings(record, (item) => /public domain|creative commons|cc0/i.test(item));
  return {
    ...selection,
    objectId,
    title: firstContent(record, [/The Milkmaid|The Night Watch|The Jewish Bride|The Threatened Swan|The Merry Family|Windmill|Still Life|Battle|Shower|River Landscape|Sampling Officials|Little Street/i]) || selection.title,
    artistName: firstContent(record, [/Rembrandt|Vermeer|Asselijn|Steen|Ruisdael|Ruysch|Pieneman|Hiroshige|Hals|Gogh/i]),
    year: firstContent(record, [/^c?\.?\s?\d{4}/]),
    medium: '',
    physicalDimensions: physicalDimensionsFromRecord(record),
    source: {
      repository: 'Rijksmuseum',
      objectUrl: `https://www.rijksmuseum.nl/en/collection/object/${objectId}`,
      apiUrl,
      imageUrl: `https://iiif.micr.io/${imageId}/full/${width},/0/default.jpg`,
      license: rights.length ? rights.join('; ') : 'Public domain / CC0 per Rijksmuseum open-data policy; retain object record for review',
    },
  };
}

async function download(record) {
  const filename = `${record.museum === 'Rijksmuseum' ? 'rijksmuseum' : 'aic'}-${slug(record.id)}.jpg`;
  const imagePath = path.join(imagesDir, filename);
  const response = await fetch(record.source.imageUrl, {
    headers: record.museum === 'Art Institute of Chicago'
      ? { 'AIC-User-Agent': 'sightlines-artwork-corpus (local test fixture)' }
      : {},
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${record.source.imageUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(imagePath, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { ...record, image: { path: `images/${filename}`, mimeType: 'image/jpeg', ...jpegDimensions(bytes), byteSize: bytes.length, sha256: hash } };
}

await mkdir(imagesDir, { recursive: true });
const resolved = [];
for (const selection of selections) {
  const record = selection.museum === 'Rijksmuseum' ? await resolveRijks(selection) : await resolveAic(selection);
  const downloaded = await download(record);
  resolved.push(downloaded);
  console.log(`${resolved.length}/${selections.length} ${record.museum}: ${record.title}`);
  await sleep(record.museum === 'Rijksmuseum' ? 500 : 1000);
}

await writeFile(path.join(root, 'metadata.json'), JSON.stringify({
  name: 'Rijksmuseum and Art Institute of Chicago public-domain artwork corpus',
  description: 'Starter image corpus for Sightlines testing and sample projects, resolved from official museum APIs and IIIF services.',
  downloadedAt: new Date().toISOString(),
  targetWidthPx: width,
  artworks: resolved,
}, null, 2) + '\n');

const csv = [
  ['museum', 'id', 'title', 'artistName', 'year', 'medium', 'heightCm', 'widthCm', 'depthCm', 'dimensions', 'dimensionSourceText', 'objectId', 'imagePath', 'byteSize', 'sha256', 'license', 'objectUrl', 'imageUrl'],
  ...resolved.map((item) => [item.museum, item.id, item.title, item.artistName, item.year, item.medium, item.physicalDimensions?.heightCm, item.physicalDimensions?.widthCm, item.physicalDimensions?.depthCm, item.physicalDimensions?.display, item.physicalDimensions?.sourceText, item.objectId, item.image.path, item.image.byteSize, item.image.sha256, item.source.license, item.source.objectUrl, item.source.imageUrl]),
].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
await writeFile(path.join(root, 'metadata.csv'), csv);
console.log(`Wrote ${resolved.length} records to ${root}`);
