import type { StyleSpecification } from 'maplibre-gl';

export const baseMaps = {
  standard: {
    label: 'OSM Standard',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
        },
      ],
    } satisfies StyleSpecification,
  },
  dark: {
    label: 'Dark Matter',
    style: {
      version: 8,
      sources: {
        dark: {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap, © CartoDB',
        },
      },
      layers: [
        {
          id: 'dark',
          type: 'raster',
          source: 'dark',
        },
      ],
    } satisfies StyleSpecification,
  },
  imagery: {
    label: 'Imagery',
    style: {
      version: 8,
      sources: {
        imagery: {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri & contributors',
        },
      },
      layers: [
        {
          id: 'imagery',
          type: 'raster',
          source: 'imagery',
        },
      ],
    } satisfies StyleSpecification,
  },
} as const;

export type BaseMapKey = keyof typeof baseMaps;
