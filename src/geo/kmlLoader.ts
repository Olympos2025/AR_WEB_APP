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
  const { kml } = await loadTogeojson();
  return kml(dom) as GeoJSON.FeatureCollection;
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
