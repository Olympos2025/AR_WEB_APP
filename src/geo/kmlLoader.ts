import JSZip from 'jszip';

type TogeojsonModule = { kml: (dom: Document) => unknown };

let togeojsonPromise: Promise<TogeojsonModule> | null = null;

async function loadTogeojson(): Promise<TogeojsonModule> {
  if (!togeojsonPromise) {
    // Use CDN import to avoid local npm installation issues while keeping the
    // library version explicit and cacheable by the browser.
    togeojsonPromise = import(
      /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@tmcw/togeojson@5.0.1/dist/togeojson.es.js'
    ) as Promise<TogeojsonModule>;
  }
  return togeojsonPromise;
}

export async function parseKmlString(text: string): Promise<GeoJSON.FeatureCollection> {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const parsed = await tryParseWithTogeojson(dom);
  if (parsed) return parsed;
  return fallbackParseKml(dom);
}

export async function parseKmlOrKmz(file: File): Promise<GeoJSON.FeatureCollection> {
  const extension = file.name.toLowerCase();
  if (extension.endsWith('.kmz')) {
    return parseKmz(file);
  }
  const text = await file.text();
  return parseKmlString(text);
}

async function parseKmz(file: File): Promise<GeoJSON.FeatureCollection> {
  const data = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const kmlFile = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.kml'));
  if (!kmlFile) {
    throw new Error('No KML found inside KMZ');
  }
  const content = await zip.files[kmlFile].async('text');
  return parseKmlString(content);
}

async function tryParseWithTogeojson(dom: Document): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const { kml } = await loadTogeojson();
    const result = normalizeFeatureCollection(kml(dom));
    if (result.features.length > 0) {
      return result;
    }
  } catch (error) {
    console.warn('Failed to parse KML with togeojson; using fallback parser.', error);
  }
  return null;
}

function normalizeFeatureCollection(input: unknown): GeoJSON.FeatureCollection {
  if (typeof input === 'object' && input && 'features' in (input as any)) {
    const collection = input as GeoJSON.FeatureCollection;
    const features = Array.isArray(collection.features)
      ? collection.features.filter((f) => Boolean(f && (f as GeoJSON.Feature).geometry))
      : [];
    return { type: 'FeatureCollection', features };
  }

  return { type: 'FeatureCollection', features: [] };
}

function fallbackParseKml(dom: Document): GeoJSON.FeatureCollection {
  const placemarks = Array.from(dom.getElementsByTagName('Placemark'));
  const features: GeoJSON.Feature[] = placemarks
    .map((placemark, index) => parsePlacemark(placemark, index))
    .filter(Boolean) as GeoJSON.Feature[];

  return { type: 'FeatureCollection', features };
}

function parsePlacemark(placemark: Element, index: number): GeoJSON.Feature | null {
  const name = placemark.getElementsByTagName('name')[0]?.textContent ?? `Feature ${index + 1}`;
  const coordinatesText = placemark.getElementsByTagName('coordinates')[0]?.textContent ?? '';
  const coordinates = parseCoordinates(coordinatesText);

  if (!coordinates.length) return null;

  if (placemark.getElementsByTagName('Point').length) {
    const [lon, lat, alt] = coordinates[0];
    return buildFeature({ name, geometry: { type: 'Point', coordinates: [lon, lat, alt] } });
  }

  if (placemark.getElementsByTagName('LineString').length) {
    return buildFeature({ name, geometry: { type: 'LineString', coordinates } });
  }

  if (placemark.getElementsByTagName('Polygon').length) {
    return buildFeature({ name, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  }

  return null;
}

function parseCoordinates(input: string): [number, number, number?][] {
  return input
    .trim()
    .split(/\s+/)
    .map((row) => row.split(',').map((value) => Number(value.trim())) as [number, number, number?])
    .filter((coords) => coords.length >= 2 && coords.every((value) => !Number.isNaN(value)));
}

function buildFeature({
  name,
  geometry,
}: {
  name: string;
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;
}): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry,
    properties: { name },
  } as GeoJSON.Feature;
}

export function listFeatures(collection: GeoJSON.FeatureCollection) {
  return collection.features.map((feature, index) => {
    const props = feature.properties || {};
    return {
      id: props['id'] || index.toString(),
      name: props['name'] || `Feature ${index + 1}`,
      type: feature.geometry?.type || 'Unknown',
    };
  });
}
