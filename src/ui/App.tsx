import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import type { Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { parseKmlOrKmz, listFeatures, parseKmlString } from '../geo/kmlLoader';
import { OverlayOptions } from '../ar/arScene';
import { useARRenderer } from '../ar/arRenderer';
import en from '../i18n/en.json';
import el from '../i18n/el.json';
import { LatLon } from '../geo/geoUtils';
import LayerControls from './LayerControls';
import CalibrationPanel from './CalibrationPanel';
import FeatureList from './FeatureList';
import sample from '../../examples/sample.kml?raw';

const translations = { en, el } as const;
type Lang = keyof typeof translations;

const baseMaps = {
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
    },
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
    },
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
    },
  },
} as const;

type BaseMapKey = keyof typeof baseMaps;

const defaultOptions: OverlayOptions = {
  polygonFill: '#22d3ee',
  polygonOpacity: 0.25,
  polygonStroke: '#22d3ee',
  polygonWidth: 4,
  lineColor: '#22c55e',
  lineWidth: 3,
  pointColor: '#eab308',
  showLabels: true,
  heightOffset: 0,
  simplifyTolerance: 1,
  transparency: 0,
};

const secure = typeof window !== 'undefined' ? window.isSecureContext : false;

function extendBoundsFromGeometry(bounds: maplibregl.LngLatBounds, geometry: Geometry) {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates as [number, number];
      bounds.extend([lon, lat]);
      break;
    }
    case 'LineString':
      (geometry.coordinates as [number, number][]).forEach(([lon, lat]) =>
        bounds.extend([lon, lat])
      );
      break;
    case 'Polygon':
      (geometry.coordinates as [number, number][][]).flat().forEach(([lon, lat]) =>
        bounds.extend([lon, lat])
      );
      break;
    case 'MultiPoint':
      (geometry.coordinates as [number, number][]).forEach(([lon, lat]) =>
        bounds.extend([lon, lat])
      );
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

function computeFeatureBounds(collection: GeoJSON.FeatureCollection) {
  const bounds = new maplibregl.LngLatBounds();

  collection.features.forEach((f) => {
    if (!f.geometry) return;
    extendBoundsFromGeometry(bounds, f.geometry as Geometry);
  });

  return bounds.isEmpty() ? null : bounds;
}

function applyKmlLayers(
  map: Map,
  data: GeoJSON.FeatureCollection,
  options: OverlayOptions
) {
  const geojsonSource = map.getSource('kml') as maplibregl.GeoJSONSource | undefined;

  if (geojsonSource) {
    geojsonSource.setData(data as any);
  } else {
    map.addSource('kml', { type: 'geojson', data: data as any });
  }

  if (!map.getLayer('kml-fill')) {
    map.addLayer({
      id: 'kml-fill',
      type: 'fill',
      source: 'kml',
      paint: {
        'fill-color': options.polygonFill,
        'fill-opacity': options.polygonOpacity,
      },
    });
  }

  if (!map.getLayer('kml-line')) {
    map.addLayer({
      id: 'kml-line',
      type: 'line',
      source: 'kml',
      paint: {
        'line-color': options.lineColor,
        'line-width': options.lineWidth,
      },
    });
  }

  if (!map.getLayer('kml-point')) {
    map.addLayer({
      id: 'kml-point',
      type: 'circle',
      source: 'kml',
      paint: {
        'circle-color': options.pointColor,
        'circle-radius': 6,
      },
    });
  }

  map.setPaintProperty('kml-fill', 'fill-color', options.polygonFill);
  map.setPaintProperty('kml-fill', 'fill-opacity', options.polygonOpacity);
  map.setPaintProperty('kml-line', 'line-color', options.lineColor);
  map.setPaintProperty('kml-line', 'line-width', options.lineWidth);
  map.setPaintProperty('kml-point', 'circle-color', options.pointColor);
}

function App() {
  const [lang, setLang] = useState<Lang>('el');
  const t = useMemo(() => translations[lang], [lang]);
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [options, setOptions] = useState<OverlayOptions>(defaultOptions);
  const [arEnabled, setArEnabled] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [basemap, setBasemap] = useState<BaseMapKey>('standard');
  const mapRef = useRef<Map | null>(null);
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const [featureBounds, setFeatureBounds] = useState<maplibregl.LngLatBounds | null>(null);

  const { gpsAccuracy, heading, permission } = useARRenderer({
    data: collection,
    origin,
    options,
    active: arEnabled,
  });

  useEffect(() => {
    if (!navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setOrigin({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          alt: pos.coords.altitude ?? 0,
        });

        if (mapRef.current) {
          mapRef.current.setCenter([pos.coords.longitude, pos.coords.latitude]);
        }
      },
      (err) => {
        // Μην μπλοκάρεις το AR αν αποτύχει το GPS· απλώς γράψε στο console.
        console.warn('Geolocation watchPosition error', err);
        // setPermissionError(true);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: baseMaps[basemap].style,
      center: [23.7162, 37.9792],
      zoom: 12,
    });
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(baseMaps[basemap].style);
  }, [basemap]);

  useEffect(() => {
    if (!collection) {
      setFeatureBounds(null);
      return;
    }

    const bounds = computeFeatureBounds(collection);
    setFeatureBounds(bounds);
  }, [collection]);

  useEffect(() => {
    if (!mapRef.current || !collection) return;

    const map = mapRef.current;

    if (map.isStyleLoaded()) {
      applyKmlLayers(map, collection, options);
      if (featureBounds) {
        map.fitBounds(featureBounds, { padding: 32 });
      }
    }
  }, [collection, options, featureBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleStyleLoad = () => {
      if (collection) {
        applyKmlLayers(map, collection, options);
        if (featureBounds) {
          map.fitBounds(featureBounds, { padding: 32 });
        }
      }
    };

    map.on('style.load', handleStyleLoad);

    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [collection, options, featureBounds]);

  // Δεν ανάβουμε πια permissionError για "denied".
  // Αν θες ξανά αυστηρό fallback, ξε-σχόλιασε:
  //
  // useEffect(() => {
  //   if (permission === 'denied') {
  //     setPermissionError(true);
  //   }
  // }, [permission]);

  const features = useMemo(
    () => (collection ? listFeatures(collection) : []),
    [collection]
  );

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = await parseKmlOrKmz(file);
    setCollection(parsed);
  }

  async function loadSample() {
    const geojson = await parseKmlString(sample);
    setCollection(geojson);
  }

  function toggleAR() {
    if (!secure) {
      // Ενημέρωση χρήστη, αλλά μην μπλοκάρεις το toggle.
      setPermissionError(true);
    }
    setArEnabled((prev) => !prev);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <img src="/AR_WEB_APP/assets/logo.svg" alt="FieldAR" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-semibold">{t.appTitle}</h1>
            <p className="text-xs text-slate-400">{t.permissionsWarning}</p>
          </div>
        </div>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
        >
          <option value="el">Ελληνικά</option>
          <option value="en">English</option>
        </select>
      </header>

      {!secure && (
        <div className="bg-amber-500/10 border border-amber-500 text-amber-100 px-4 py-3 m-4 rounded">
          {t.httpsWarning}
        </div>
      )}

      <main className="p-4 grid gap-4 lg:grid-cols-[2fr,1fr]">
        <section className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 text-sm bg-slate-900 border border-slate-800 px-3 py-2 rounded cursor-pointer">
              <input
                type="file"
                accept=".kml,.kmz"
                className="hidden"
                onChange={onFile}
              />
              <span>{t.loadFile}</span>
            </label>
            <button
              onClick={loadSample}
              className="bg-slate-900 border border-slate-800 px-3 py-2 rounded text-sm hover:border-slate-700"
            >
              {t.loadSample}
            </button>
            <button
              onClick={toggleAR}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded shadow"
            >
              {arEnabled ? 'Stop AR' : t.startAR}
            </button>
            <button
              onClick={() => setArEnabled(false)}
              className="bg-slate-800 px-3 py-2 rounded text-sm border border-slate-700"
            >
              {t.startMap}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <h2 className="text-lg font-semibold">Mini-map</h2>
                <label className="text-sm text-slate-300 inline-flex items-center gap-2">
                  <span>{t.basemap}</span>
                  <select
                    value={basemap}
                    onChange={(e) => setBasemap(e.target.value as BaseMapKey)}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1"
                  >
                    {Object.entries(baseMaps).map(([key, map]) => (
                      <option key={key} value={key}>
                        {map.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div
                ref={mapContainer}
                className="h-64 rounded border border-slate-800 overflow-hidden"
              />
              {permissionError && !arEnabled && (
                <p className="text-sm text-amber-200 mt-2">{t.fallback}</p>
              )}
            </div>
            <LayerControls options={options} onChange={setOptions} t={t} />
          </div>

          <CalibrationPanel
            options={options}
            onChange={setOptions}
            heading={heading}
            accuracy={gpsAccuracy}
            t={t}
          />

          <FeatureList features={features} title={t.featureList} />

          <p className="text-xs text-slate-500">{t.accuracyDisclaimer}</p>
        </section>

        <aside className="space-y-3">
          <div className="bg-slate-900 border border-slate-800 p-3 rounded">
            <h3 className="font-semibold mb-2">AR Status</h3>
            <p className="text-sm">{arEnabled ? 'Active' : 'Inactive'}</p>
            <p className="text-sm">
              {t.accuracy}:{' '}
              {gpsAccuracy ? `±${gpsAccuracy.toFixed(1)}m` : 'N/A'}
            </p>
            <p className="text-sm">
              Heading: {heading ? `${heading.toFixed(0)}°` : 'N/A'}
            </p>
            <p className="text-sm">Permission: {permission}</p>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
