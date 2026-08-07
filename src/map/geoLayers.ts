import maplibregl, { Map } from 'maplibre-gl';
import type { Geometry } from 'geojson';
import { LayerData } from '../state/layerTypes';

const PREFIX = 'fieldar';

function ids(layerId: string) {
  return {
    source: `${PREFIX}-src-${layerId}`,
    fill: `${PREFIX}-fill-${layerId}`,
    outline: `${PREFIX}-outline-${layerId}`,
    line: `${PREFIX}-line-${layerId}`,
    circle: `${PREFIX}-circle-${layerId}`,
    label: `${PREFIX}-label-${layerId}`,
  };
}

/** Sync all app layers (sources, styling, labels) onto the MapLibre map. */
export function applyLayersToMap(map: Map, layers: LayerData[]) {
  const wanted = new Set(layers.map((l) => l.id));

  // Remove map layers belonging to app layers that no longer exist.
  map.getStyle().layers?.forEach((mapLayer) => {
    const match = new RegExp(`^${PREFIX}-(?:fill|outline|line|circle|label)-(.+)$`).exec(mapLayer.id);
    if (match && !wanted.has(match[1])) {
      map.removeLayer(mapLayer.id);
    }
  });
  Object.keys(map.getStyle().sources ?? {}).forEach((sourceId) => {
    const match = new RegExp(`^${PREFIX}-src-(.+)$`).exec(sourceId);
    if (match && !wanted.has(match[1])) {
      map.removeSource(sourceId);
    }
  });

  layers.forEach((layer) => {
    const id = ids(layer.id);
    const source = map.getSource(id.source) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(layer.geojson as GeoJSON.GeoJSON);
    } else {
      map.addSource(id.source, { type: 'geojson', data: layer.geojson as GeoJSON.GeoJSON });
    }

    const style = layer.style;
    const visibility = layer.visible ? 'visible' : 'none';

    ensureLayer(map, {
      id: id.fill,
      type: 'fill',
      source: id.source,
      filter: polyFilter(),
      paint: {},
    });
    map.setPaintProperty(id.fill, 'fill-color', style.polygonFill);
    map.setPaintProperty(id.fill, 'fill-opacity', style.polygonOpacity * style.opacity);
    map.setLayoutProperty(id.fill, 'visibility', visibility);

    ensureLayer(map, {
      id: id.outline,
      type: 'line',
      source: id.source,
      filter: polyFilter(),
      paint: {},
    });
    map.setPaintProperty(id.outline, 'line-color', style.polygonStroke);
    map.setPaintProperty(id.outline, 'line-width', style.polygonWidth / 2);
    map.setPaintProperty(id.outline, 'line-opacity', style.opacity);
    map.setLayoutProperty(id.outline, 'visibility', visibility);

    ensureLayer(map, {
      id: id.line,
      type: 'line',
      source: id.source,
      filter: [
        'any',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['geometry-type'], 'MultiLineString'],
      ],
      paint: {},
    });
    map.setPaintProperty(id.line, 'line-color', style.lineColor);
    map.setPaintProperty(id.line, 'line-width', style.lineWidth);
    map.setPaintProperty(id.line, 'line-opacity', style.opacity);
    map.setLayoutProperty(id.line, 'visibility', visibility);

    ensureLayer(map, {
      id: id.circle,
      type: 'circle',
      source: id.source,
      filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
      paint: {},
    });
    map.setPaintProperty(id.circle, 'circle-color', style.pointColor);
    map.setPaintProperty(id.circle, 'circle-radius', 5 * style.pointSize);
    map.setPaintProperty(id.circle, 'circle-opacity', style.opacity);
    map.setLayoutProperty(id.circle, 'visibility', visibility);

    ensureLayer(map, {
      id: id.label,
      type: 'symbol',
      source: id.source,
      layout: {
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: {},
    });
    const labelExpression: maplibregl.ExpressionSpecification = style.labelField
      ? ['to-string', ['coalesce', ['get', style.labelField], '']]
      : ['to-string', ['coalesce', ['get', 'name'], ['get', 'Name'], ['get', 'NAME'], '']];
    map.setLayoutProperty(id.label, 'text-field', labelExpression);
    map.setLayoutProperty(id.label, 'text-size', 12 * style.labelSize);
    map.setPaintProperty(id.label, 'text-color', style.labelColor);
    map.setPaintProperty(id.label, 'text-halo-color', 'rgba(15,23,42,0.85)');
    map.setPaintProperty(id.label, 'text-halo-width', 1.4);
    map.setLayoutProperty(
      id.label,
      'visibility',
      layer.visible && style.showLabels ? 'visible' : 'none'
    );
  });
}

function polyFilter(): maplibregl.ExpressionSpecification {
  return ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
}

function ensureLayer(map: Map, layer: maplibregl.LayerSpecification) {
  if (!map.getLayer(layer.id)) {
    map.addLayer(layer);
  }
}

export function computeLayersBounds(layers: LayerData[]): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds();
  layers.forEach((layer) => {
    layer.geojson.features.forEach((feature) => {
      if (feature.geometry) extendBoundsFromGeometry(bounds, feature.geometry as Geometry);
    });
  });
  return bounds.isEmpty() ? null : bounds;
}

export function computeCollectionBounds(
  collection: GeoJSON.FeatureCollection
): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds();
  collection.features.forEach((feature) => {
    if (feature.geometry) extendBoundsFromGeometry(bounds, feature.geometry as Geometry);
  });
  return bounds.isEmpty() ? null : bounds;
}

function extendBoundsFromGeometry(bounds: maplibregl.LngLatBounds, geometry: Geometry) {
  switch (geometry.type) {
    case 'Point':
      bounds.extend(geometry.coordinates as [number, number]);
      break;
    case 'MultiPoint':
    case 'LineString':
      (geometry.coordinates as [number, number][]).forEach((c) => bounds.extend(c));
      break;
    case 'MultiLineString':
    case 'Polygon':
      (geometry.coordinates as [number, number][][]).flat().forEach((c) => bounds.extend(c));
      break;
    case 'MultiPolygon':
      (geometry.coordinates as [number, number][][][]).flat(2).forEach((c) => bounds.extend(c));
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g) => extendBoundsFromGeometry(bounds, g));
      break;
  }
}
