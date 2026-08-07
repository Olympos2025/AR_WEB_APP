import type { StyleSpecification } from 'maplibre-gl';

// Glyphs are required for symbol (label) layers on top of these raster styles.
const GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

function rasterStyle(id: string, tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      [id]: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution,
      },
    },
    layers: [
      {
        id,
        type: 'raster',
        source: id,
      },
    ],
  };
}

export const baseMaps = {
  standard: {
    label: 'OSM Standard',
    style: rasterStyle(
      'osm',
      ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      '© OpenStreetMap contributors'
    ),
  },
  topo: {
    label: 'OpenTopoMap',
    style: rasterStyle(
      'topo',
      [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)'
    ),
  },
  dark: {
    label: 'Dark Matter',
    style: rasterStyle(
      'dark',
      [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      '© OpenStreetMap, © CartoDB'
    ),
  },
  imagery: {
    label: 'Imagery',
    style: rasterStyle(
      'imagery',
      [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      '© Esri & contributors'
    ),
  },
} as const;

export type BaseMapKey = keyof typeof baseMaps;
