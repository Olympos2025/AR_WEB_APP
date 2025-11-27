import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { parseKmlOrKmz, listFeatures, parseKmlString } from '../geo/kmlLoader';
import { OverlayOptions } from '../ar/arScene';
import ARView from '../ar/ARView';
import { PermissionState } from '../ar/sensors';
import en from '../i18n/en.json';
import el from '../i18n/el.json';
import { LatLon } from '../geo/geoUtils';
import LayerControls from './LayerControls';
import CalibrationPanel from './CalibrationPanel';
import FeatureList from './FeatureList';
import sample from '../../examples/sample.kml?raw';

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
  showLabels: true,
  heightOffset: 0,
  simplifyTolerance: 1,
  transparency: 0,
};

const secure = typeof window !== 'undefined' ? window.isSecureContext : false;

function App() {
  const [lang, setLang] = useState<Lang>('el');
  const t = useMemo(() => translations[lang], [lang]);
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [options, setOptions] = useState<OverlayOptions>(defaultOptions);
  const [arEnabled, setArEnabled] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('idle');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [overlayCount, setOverlayCount] = useState(0);
  const mapRef = useRef<Map | null>(null);
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const arContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsAccuracy(pos.coords.accuracy ?? null);
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

    const geojsonSource = mapRef.current.getSource('kml') as maplibregl.GeoJSONSource;

    if (geojsonSource) {
      geojsonSource.setData(collection as any);
    } else {
      mapRef.current.addSource('kml', { type: 'geojson', data: collection as any });

      mapRef.current.addLayer({
        id: 'kml-fill',
        type: 'fill',
        source: 'kml',
        paint: {
          'fill-color': options.polygonFill,
          'fill-opacity': options.polygonOpacity,
        },
      });

      mapRef.current.addLayer({
        id: 'kml-line',
        type: 'line',
        source: 'kml',
        paint: {
          'line-color': options.lineColor,
          'line-width': options.lineWidth,
        },
      });

      mapRef.current.addLayer({
        id: 'kml-point',
        type: 'circle',
        source: 'kml',
        paint: {
          'circle-color': options.pointColor,
          'circle-radius': 6,
        },
      });
    }

    const bounds = new maplibregl.LngLatBounds();

    collection.features.forEach((f) => {
      if (!f.geometry) return;

      if (f.geometry.type === 'Point') {
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
        bounds.extend([lon, lat]);
      } else if (f.geometry.type === 'LineString') {
        (f.geometry as GeoJSON.LineString).coordinates.forEach(([lon, lat]) =>
          bounds.extend([lon, lat])
        );
      } else if (f.geometry.type === 'Polygon') {
        (f.geometry as GeoJSON.Polygon).coordinates[0].forEach(([lon, lat]) =>
          bounds.extend([lon, lat])
        );
      }
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { padding: 32 });
    }
  }, [collection, options]);

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

  useEffect(() => {
    if (permission === 'denied') {
      setPermissionError(t.permissionDenied);
      setArEnabled(false);
    } else if (permission === 'granted') {
      setPermissionError(null);
    }
  }, [permission, t.permissionDenied]);

  function startAR() {
    if (!secure) {
      setPermissionError(t.httpsWarning);
    }
    setArEnabled(true);
  }

  function stopAR() {
    setArEnabled(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="flex flex-col gap-3 px-4 py-3 border-b border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <img src="/AR_WEB_APP/assets/logo.svg" alt="FieldAR" className="w-10 h-10" />
          <div>
            <h1 className="text-xl font-semibold">{t.appTitle}</h1>
            <p className="text-xs text-slate-400">{t.permissionsWarning}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
          >
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
          <button
            onClick={startAR}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded shadow text-sm"
          >
            {t.startAR}
          </button>
          <button
            onClick={stopAR}
            className="bg-slate-800 px-3 py-2 rounded text-sm border border-slate-700"
          >
            {t.stopAR}
          </button>
        </div>
      </header>

      {!secure && (
        <div className="bg-amber-500/10 border border-amber-500 text-amber-100 px-4 py-3 m-4 rounded">
          {t.httpsWarning}
        </div>
      )}

      <main className="p-4 flex flex-col gap-4 lg:grid lg:grid-cols-[2fr,1fr] lg:items-start">
        <section className="space-y-4">
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
              onClick={() => setArEnabled(false)}
              className="bg-slate-800 px-3 py-2 rounded text-sm border border-slate-700"
            >
              {t.startMap}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 h-[60vh] min-h-[320px]">
            <div ref={arContainer} className="absolute inset-0" />
            {!arEnabled && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/80 backdrop-blur">
                <p className="text-lg font-semibold">{t.arInactive}</p>
                <p className="text-sm text-slate-300 text-center max-w-md">{t.arIntro}</p>
                <div className="flex gap-2">
                  <button
                    onClick={startAR}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded shadow text-sm"
                  >
                    {t.startAR}
                  </button>
                  <button
                    onClick={loadSample}
                    className="bg-slate-800 px-3 py-2 rounded text-sm border border-slate-700"
                  >
                    {t.loadSample}
                  </button>
                </div>
              </div>
            )}
          </div>
          {permissionError && (
            <p className="text-sm text-amber-200">{permissionError}</p>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Mini-map</h2>
              <div
                ref={mapContainer}
                className="h-64 rounded border border-slate-800 overflow-hidden"
              />
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

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="bg-slate-900 border border-slate-800 p-3 rounded space-y-1">
            <h3 className="font-semibold mb-1">AR Status</h3>
            <p className="text-sm">{arEnabled ? t.arActive : t.arInactive}</p>
            <p className="text-sm">
              {t.accuracy}:{' '}
              {gpsAccuracy ? `±${gpsAccuracy.toFixed(1)}m` : 'N/A'}
            </p>
            <p className="text-sm">
              Heading: {heading ? `${heading.toFixed(0)}°` : 'N/A'}
            </p>
            <p className="text-sm">Permission: {permission}</p>
            <p className="text-sm">Visible overlays: {overlayCount}</p>
          </div>
        </aside>
      </main>

      <ARView
        data={collection}
        active={arEnabled}
        onStop={() => setArEnabled(false)}
        onTelemetry={({ accuracy, heading, overlays, permission }) => {
          setGpsAccuracy((prev) => accuracy ?? prev);
          setHeading(heading);
          setOverlayCount(overlays);
          setPermission(permission);
        }}
      />
    </div>
  );
}

export default App;
