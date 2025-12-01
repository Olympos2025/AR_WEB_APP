import maplibregl, { Map } from 'maplibre-gl';
import type { Geometry } from 'geojson';
import { OverlayOptions } from '../ar/arScene';

function extendBoundsFromGeometry(bounds: maplibregl.LngLatBounds, geometry: Geometry) {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates as [number, number];
      bounds.extend([lon, lat]);
      break;
    }
    case 'LineString':
      (geometry.coordinates as [number, number][]).forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'Polygon':
      (geometry.coordinates as [number, number][][]).flat().forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'MultiPoint':
      (geometry.coordinates as [number, number][]).forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'MultiLineString':
      (geometry.coordinates as [number, number][][])
        .flat()
        .forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'MultiPolygon':
      (geometry.coordinates as [number, number][][][])
        .flat(2)
        .forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g) => extendBoundsFromGeometry(bounds, g));
      break;
  }
}

export function computeFeatureBounds(collection: GeoJSON.FeatureCollection) {
  const bounds = new maplibregl.LngLatBounds();

  collection.features.forEach((feature) => {
    if (!feature.geometry) return;
    extendBoundsFromGeometry(bounds, feature.geometry as Geometry);
  });

  return bounds.isEmpty() ? null : bounds;
}

function ensureLayer(map: Map, id: string, layer: maplibregl.LayerSpecification) {
  if (!map.getLayer(id)) {
    map.addLayer(layer);
  }
}

function ensureSource(map: Map, data: GeoJSON.FeatureCollection) {
  const geojsonSource = map.getSource('kml') as maplibregl.GeoJSONSource | undefined;

  if (geojsonSource) {
    geojsonSource.setData(data as any);
  } else {
    map.addSource('kml', { type: 'geojson', data: data as any });
  }
}

export function applyKmlLayers(map: Map, data: GeoJSON.FeatureCollection, options: OverlayOptions) {
  ensureSource(map, data);

  ensureLayer(map, 'kml-fill', {
    id: 'kml-fill',
    type: 'fill',
    source: 'kml',
    paint: {
      'fill-color': options.polygonFill,
      'fill-opacity': options.polygonOpacity,
    },
  });

  ensureLayer(map, 'kml-lines', {
    id: 'kml-lines',
    type: 'line',
    source: 'kml',
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
    paint: {
      'line-color': options.lineColor,
      'line-width': options.lineWidth,
    },
  });

  ensureLayer(map, 'kml-polygon-outline', {
    id: 'kml-polygon-outline',
    type: 'line',
    source: 'kml',
    filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
    paint: {
      'line-color': options.polygonStroke,
      'line-width': options.polygonWidth,
    },
  });

  ensureLayer(map, 'kml-point', {
    id: 'kml-point',
    type: 'circle',
    source: 'kml',
    filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
    paint: {
      'circle-color': options.pointColor,
      'circle-radius': 6,
    },
  });

  map.setPaintProperty('kml-fill', 'fill-color', options.polygonFill);
  map.setPaintProperty('kml-fill', 'fill-opacity', options.polygonOpacity);
  map.setPaintProperty('kml-lines', 'line-color', options.lineColor);
  map.setPaintProperty('kml-lines', 'line-width', options.lineWidth);
  map.setPaintProperty('kml-polygon-outline', 'line-color', options.polygonStroke);
  map.setPaintProperty('kml-polygon-outline', 'line-width', options.polygonWidth);
  map.setPaintProperty('kml-point', 'circle-color', options.pointColor);
}
