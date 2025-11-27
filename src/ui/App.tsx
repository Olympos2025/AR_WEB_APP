import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { applyDefaultStyles, listFeatures, parseKmlOrKmz, parseKmlString } from '../geo/kmlLoader';
import { OverlayOptions } from '../ar/arScene';
import { useARRenderer } from '../ar/arRenderer';
import en from '../i18n/en.json';
import el from '../i18n/el.json';
import { LatLon } from '../geo/geoUtils';
import LayerControls from './LayerControls';
import CalibrationPanel from './CalibrationPanel';
import FeatureList from './FeatureList';
import sampleKmlUrl from '../../examples/sample.kml?url';
import sampleGeoJsonUrl from '../../examples/sample.geojson?url';

const translations = { en, el } as const;
type Lang = keyof typeof translations;

const defaultOptions: OverlayOptions = {
  polygonFill: '#22d3ee',
  polygonOpacity: 0.25,
  polygonStroke: '#22d3ee',
  polygonWidth: 4,
  lineColor: '#22c55e',
  lineWidth: 3,
  pointColor: '#eab308',
  pointSymbol: 'sphere',
  showLabels: true,
  heightOffset: 0,
  simplifyTolerance: 1,
  transparency: 0,
};

const polygonFilter: maplibregl.ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
];

const lineFilter: maplibregl.ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
];

const pointFilter: maplibregl.ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Point', 'MultiPoint'],
  true,
  false,
];

function mapIconFromSymbol(symbol: OverlayOptions['pointSymbol']) {
  switch (symbol) {
    case 'box':
      return 'square-stroked-15';
    case 'cone':
      return 'triangle-15';
    default:
      return 'marker-15';
  }
}

function extendBounds(bounds: maplibregl.LngLatBounds, geometry: GeoJSON.Geometry) {
  switch (geometry.type) {
    case 'Point': {
      const [lon, lat] = geometry.coordinates as [number, number];
      bounds.extend([lon, lat]);
      break;
    }
    case 'MultiPoint':
      geometry.coordinates.forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'LineString':
      geometry.coordinates.forEach(([lon, lat]) => bounds.extend([lon, lat]));
      break;
    case 'MultiLineString':
      geometry.coordinates.forEach((line) => line.forEach(([lon, lat]) => bounds.extend([lon, lat])));
      break;
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach(([lon, lat]) => bounds.extend([lon, lat])));
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => bounds.extend([lon, lat]))));
      break;
    default:
      break;
  }
}

const secure = typeof window !== 'undefined' ? window.isSecureContext : false;

function App() {
  const [lang, setLang] = useState<Lang>('el');
  const t = useMemo(() => translations[lang], [lang]);
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [options, setOptions] = useState<OverlayOptions>(defaultOptions);
  const [sampleFormat, setSampleFormat] = useState<'kml' | 'geojson'>('kml');
  const [arEnabled, setArEnabled] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const mapRef = useRef<Map | null>(null);
  const mapContainer = useRef<HTMLDivElement | null>(null);

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
      style: 'https://demotiles.maplibre.org/style.json',
      center: [23.7162, 37.9792],
      zoom: 12,
    });
  }, []);

  useEffect(() => {
    if (!mapRef.current || !collection) return;

    const map = mapRef.current;
    const updateLayers = () => {
      const geojsonSource = map.getSource('kml') as maplibregl.GeoJSONSource;
      if (geojsonSource) {
        geojsonSource.setData(collection as any);
      } else {
        map.addSource('kml', { type: 'geojson', data: collection as any });

        map.addLayer({
          id: 'kml-fill',
          type: 'fill',
          source: 'kml',
          filter: polygonFilter,
          paint: {
            'fill-color': options.polygonFill,
            'fill-opacity': options.polygonOpacity * (1 - options.transparency),
          },
        });

        map.addLayer({
          id: 'kml-outline',
          type: 'line',
          source: 'kml',
          filter: polygonFilter,
          paint: {
            'line-color': options.polygonStroke,
            'line-width': options.polygonWidth,
            'line-opacity': 1 - options.transparency,
          },
        });

        map.addLayer({
          id: 'kml-line',
          type: 'line',
          source: 'kml',
          filter: lineFilter,
          paint: {
            'line-color': options.lineColor,
            'line-width': options.lineWidth,
            'line-opacity': 1 - options.transparency,
          },
        });

        map.addLayer({
          id: 'kml-point-circle',
          type: 'circle',
          source: 'kml',
          filter: pointFilter,
          paint: {
            'circle-color': options.pointColor,
            'circle-radius': 7,
            'circle-stroke-color': '#0f172a',
            'circle-stroke-width': 1,
            'circle-opacity': 1 - options.transparency,
          },
          layout: {
            visibility: options.pointSymbol === 'sphere' ? 'visible' : 'none',
          },
        });

        map.addLayer({
          id: 'kml-point-symbol',
          type: 'symbol',
          source: 'kml',
          filter: pointFilter,
          layout: {
            'icon-image': mapIconFromSymbol(options.pointSymbol),
            'icon-size': 1.2,
            visibility: options.pointSymbol === 'sphere' ? 'none' : 'visible',
          },
          paint: {
            'icon-color': options.pointColor,
            'icon-opacity': 1 - options.transparency,
          },
        });
      }

      const bounds = new maplibregl.LngLatBounds();

      collection.features.forEach((f) => {
        if (!f.geometry) return;
        extendBounds(bounds, f.geometry);
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 32 });
      }
    };

    if (!map.isStyleLoaded()) {
      map.once('load', updateLayers);
    } else {
      updateLayers();
    }
  }, [collection, options]);

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

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const setPaint = (layer: string, property: string, value: any) => {
      if (map.getLayer(layer)) {
        map.setPaintProperty(layer, property as any, value as any);
      }
    };

    const setLayout = (layer: string, property: string, value: any) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, property as any, value as any);
      }
    };

    setPaint('kml-fill', 'fill-color', options.polygonFill);
    setPaint('kml-fill', 'fill-opacity', options.polygonOpacity * (1 - options.transparency));

    setPaint('kml-outline', 'line-color', options.polygonStroke);
    setPaint('kml-outline', 'line-width', options.polygonWidth);
    setPaint('kml-outline', 'line-opacity', 1 - options.transparency);

    setPaint('kml-line', 'line-color', options.lineColor);
    setPaint('kml-line', 'line-width', options.lineWidth);
    setPaint('kml-line', 'line-opacity', 1 - options.transparency);

    setPaint('kml-point-circle', 'circle-color', options.pointColor);
    setPaint('kml-point-circle', 'circle-opacity', 1 - options.transparency);

    setPaint('kml-point-symbol', 'icon-color', options.pointColor);
    setPaint('kml-point-symbol', 'icon-opacity', 1 - options.transparency);

    setLayout('kml-point-circle', 'visibility', options.pointSymbol === 'sphere' ? 'visible' : 'none');
    setLayout('kml-point-symbol', 'visibility', options.pointSymbol === 'sphere' ? 'none' : 'visible');
    setLayout('kml-point-symbol', 'icon-image', mapIconFromSymbol(options.pointSymbol));
  }, [options]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = await parseKmlOrKmz(file);
    setCollection(parsed);
  }

  async function loadSample() {
    if (sampleFormat === 'geojson') {
      const text = await fetch(sampleGeoJsonUrl).then((res) => res.text());
      const geojson = applyDefaultStyles(JSON.parse(text));
      setCollection(geojson);
      return;
    }

    const text = await fetch(sampleKmlUrl).then((res) => res.text());
    const geojson = await parseKmlString(text);
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
            <select
              value={sampleFormat}
              onChange={(e) => setSampleFormat(e.target.value as 'kml' | 'geojson')}
              className="bg-slate-900 border border-slate-800 px-2 py-2 rounded text-sm"
            >
              <option value="kml">KML</option>
              <option value="geojson">GeoJSON</option>
            </select>
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
              <h2 className="text-lg font-semibold mb-2">Mini-map</h2>
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
