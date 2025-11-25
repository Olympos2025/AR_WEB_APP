import JSZip from 'jszip';
import { kml as kmlToGeoJSON } from '@tmcw/togeojson';

export async function parseKmlOrKmz(file: File): Promise<GeoJSON.FeatureCollection> {
  const extension = file.name.toLowerCase();
  if (extension.endsWith('.kmz')) {
    return parseKmz(file);
  }
  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  return kmlToGeoJSON(dom) as GeoJSON.FeatureCollection;
}

async function parseKmz(file: File): Promise<GeoJSON.FeatureCollection> {
  const data = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const kmlFile = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.kml'));
  if (!kmlFile) {
    throw new Error('No KML found inside KMZ');
  }
  const content = await zip.files[kmlFile].async('text');
  const dom = new DOMParser().parseFromString(content, 'text/xml');
  return kmlToGeoJSON(dom) as GeoJSON.FeatureCollection;
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
