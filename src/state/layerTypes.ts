export interface LayerStyle {
  polygonFill: string;
  polygonOpacity: number;
  polygonStroke: string;
  polygonWidth: number;
  lineColor: string;
  lineWidth: number;
  pointColor: string;
  pointSize: number;
  opacity: number; // overall layer opacity 0..1 (1 = opaque)
  showLabels: boolean;
  labelField: string; // property name used for labels ('' = feature name)
  labelColor: string;
  labelSize: number; // relative label size multiplier
}

export interface LayerData {
  id: string;
  name: string;
  sourceFormat: string; // kml | kmz | geojson | gpx | shapefile | ...
  geojson: GeoJSON.FeatureCollection;
  style: LayerStyle;
  visible: boolean;
  /** id of the saved copy in the user's account, if stored */
  remoteId?: string;
}

const PALETTE = [
  { fill: '#22d3ee', line: '#22c55e', point: '#eab308' },
  { fill: '#f472b6', line: '#fb7185', point: '#f97316' },
  { fill: '#a78bfa', line: '#818cf8', point: '#34d399' },
  { fill: '#facc15', line: '#f59e0b', point: '#38bdf8' },
  { fill: '#4ade80', line: '#2dd4bf', point: '#f472b6' },
];

export function defaultStyle(index = 0): LayerStyle {
  const colors = PALETTE[index % PALETTE.length];
  return {
    polygonFill: colors.fill,
    polygonOpacity: 0.3,
    polygonStroke: colors.fill,
    polygonWidth: 4,
    lineColor: colors.line,
    lineWidth: 3,
    pointColor: colors.point,
    pointSize: 1,
    opacity: 1,
    showLabels: true,
    labelField: '',
    labelColor: '#ffffff',
    labelSize: 1,
  };
}

export function newLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Collect the distinct property keys of a collection (for the label-field dropdown). */
export function collectPropertyKeys(collection: GeoJSON.FeatureCollection): string[] {
  const keys = new Set<string>();
  collection.features.forEach((feature) => {
    Object.keys(feature.properties ?? {}).forEach((key) => keys.add(key));
  });
  return Array.from(keys).sort();
}

export function featureLabel(feature: GeoJSON.Feature, style: LayerStyle): string {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const raw = style.labelField ? props[style.labelField] : props['name'] ?? props['Name'] ?? props['NAME'];
  if (raw === null || raw === undefined || raw === '') return '';
  return String(raw);
}
