import JSZip from 'jszip';

type TogeojsonModule = { kml: (dom: Document) => unknown };

const defaultStyles = {
  fill: '#22d3ee',
  fillOpacity: 0.25,
  stroke: '#22c55e',
  strokeOpacity: 1,
  strokeWidth: 2,
  markerColor: '#eab308',
};

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
  const collection = kml(dom) as GeoJSON.FeatureCollection;
  return applyDefaultStyles(collection);
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

export function applyDefaultStyles(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature) => {
    if (!feature.geometry) return feature;
    const properties = { ...(feature.properties || {}) } as Record<string, unknown>;
    const type = feature.geometry.type;

    if (type === 'Polygon' || type === 'MultiPolygon') {
      properties.fill ||= defaultStyles.fill;
      properties['fill-opacity'] ||= defaultStyles.fillOpacity;
      properties.stroke ||= defaultStyles.stroke;
      properties['stroke-width'] ||= defaultStyles.strokeWidth;
      properties['stroke-opacity'] ||= defaultStyles.strokeOpacity;
    }

    if (type === 'LineString' || type === 'MultiLineString') {
      properties.stroke ||= defaultStyles.stroke;
      properties['stroke-width'] ||= defaultStyles.strokeWidth;
      properties['stroke-opacity'] ||= defaultStyles.strokeOpacity;
    }

    if (type === 'Point' || type === 'MultiPoint') {
      properties['marker-color'] ||= defaultStyles.markerColor;
    }

    return { ...feature, properties };
  });

  return { ...collection, features };
}
