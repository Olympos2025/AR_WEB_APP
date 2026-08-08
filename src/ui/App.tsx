import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AccountService,
  AccountUser,
  SavedLayerMeta,
  createAccountService,
} from '../account';
import { ARSettings, ARTelemetry, DEFAULT_AR_SETTINGS } from '../ar/arEngine';
import ARView from '../ar/ARView';
import { ACCEPTED_EXTENSIONS, parseFiles } from '../geo/loaders';
import { parseKmlString } from '../geo/kmlLoader';
import { LatLon } from '../geo/geoUtils';
import {
  CorrectionTarget,
  deltaToPosition,
  findNearestVertex,
  translateCollection,
} from '../geo/transform';
import en from '../i18n/en.json';
import el from '../i18n/el.json';
import {
  LayerData,
  LayerStyle,
  defaultStyle,
  newLayerId,
} from '../state/layerTypes';
import { baseMaps, BaseMapKey } from '../map/baseMaps';
import { applyLayersToMap, computeCollectionBounds, computeLayersBounds } from '../map/geoLayers';
import AccountPanel from './AccountPanel';
import LayerPanel from './LayerPanel';
import sample from '../../examples/sample.kml?raw';

const translations = { en, el } as const;
type Lang = keyof typeof translations;

const secure = typeof window !== 'undefined' ? window.isSecureContext : false;

function App() {
  const [lang, setLang] = useState<Lang>('el');
  const t = useMemo(() => translations[lang] as Record<string, string>, [lang]);

  const [layers, setLayers] = useState<LayerData[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [arEnabled, setArEnabled] = useState(false);
  const [arSettings, setArSettings] = useState<ARSettings>(DEFAULT_AR_SETTINGS);
  const [telemetry, setTelemetry] = useState<ARTelemetry | null>(null);
  const [basemap, setBasemap] = useState<BaseMapKey>('standard');

  const [account, setAccount] = useState<AccountService | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [savedLayers, setSavedLayers] = useState<SavedLayerMeta[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const mapRef = useRef<Map | null>(null);
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // ---- Account bootstrap -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const service = await createAccountService();
      if (cancelled) return;
      setAccount(service);
      const existing = await service.currentUser();
      if (cancelled) return;
      setUser(existing);
      if (existing) {
        service.listLayers().then((list) => !cancelled && setSavedLayers(list)).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSavedLayers = useCallback(
    async (service: AccountService | null = account) => {
      if (!service) return;
      try {
        setSavedLayers(await service.listLayers());
      } catch {
        setSavedLayers([]);
      }
    },
    [account]
  );

  const accountErrorText = useCallback(
    (code: string) => t[`accountError_${code}`] ?? t.accountError_GENERIC,
    [t]
  );

  async function handleAuth(action: 'login' | 'register', email: string, password: string) {
    if (!account) return;
    setAccountBusy(true);
    setAccountError(null);
    try {
      const authed = action === 'login'
        ? await account.login(email, password)
        : await account.register(email, password);
      setUser(authed);
      await refreshSavedLayers();
    } catch (error) {
      setAccountError(accountErrorText((error as Error).message));
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleLogout() {
    if (!account) return;
    await account.logout();
    setUser(null);
    setSavedLayers([]);
  }

  async function handleLoadSaved(id: string) {
    if (!account) return;
    setAccountBusy(true);
    try {
      const record = await account.loadLayer(id);
      addLayers([
        {
          id: newLayerId(),
          name: record.name,
          sourceFormat: record.sourceFormat,
          geojson: record.geojson,
          style: { ...defaultStyle(layersRef.current.length), ...record.style },
          visible: true,
          remoteId: record.id,
        },
      ]);
    } catch (error) {
      setAccountError(accountErrorText((error as Error).message));
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleDeleteSaved(id: string) {
    if (!account) return;
    setAccountBusy(true);
    try {
      await account.deleteLayer(id);
      await refreshSavedLayers();
    } catch (error) {
      setAccountError(accountErrorText((error as Error).message));
    } finally {
      setAccountBusy(false);
    }
  }

  // ---- Layer handling ----------------------------------------------------
  const addLayers = useCallback((newLayers: LayerData[]) => {
    setLayers((prev) => [...prev, ...newLayers]);
  }, []);

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setLoadError(null);
    try {
      const parsed = await parseFiles(files);
      const created: LayerData[] = parsed.map((p, i) => ({
        id: newLayerId(),
        name: p.name,
        sourceFormat: p.sourceFormat,
        geojson: p.geojson,
        style: defaultStyle(layersRef.current.length + i),
        visible: true,
      }));
      addLayers(created);

      // Signed-in users get every upload stored in their account automatically.
      if (account && user) {
        for (const layer of created) {
          try {
            const meta = await account.saveLayer({
              name: layer.name,
              sourceFormat: layer.sourceFormat,
              style: layer.style,
              geojson: layer.geojson,
            });
            setLayers((prev) =>
              prev.map((l) => (l.id === layer.id ? { ...l, remoteId: meta.id } : l))
            );
          } catch {
            // Saving is best-effort; the layer still works locally.
          }
        }
        await refreshSavedLayers();
      }
    } catch (error) {
      const code = (error as Error).message ?? '';
      if (code.startsWith('UNSUPPORTED_FORMAT')) {
        setLoadError(`${t.errUnsupportedFormat} (${code.split(':')[1] ?? ''})`);
      } else if (code === 'UNKNOWN_CRS') {
        setLoadError(t.errUnknownCrs);
      } else if (code === 'SHAPEFILE_MISSING_SHP') {
        setLoadError(t.errShapefileMissing);
      } else {
        setLoadError(t.errParseFailed);
      }
    }
  }

  async function loadSample() {
    const geojson = await parseKmlString(sample);
    addLayers([
      {
        id: newLayerId(),
        name: 'sample.kml',
        sourceFormat: 'kml',
        geojson,
        style: defaultStyle(layersRef.current.length),
        visible: true,
      },
    ]);
  }

  const updateLayer = useCallback((id: string, patch: Partial<LayerData>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const updateLayerStyle = useCallback((id: string, patch: Partial<LayerStyle>) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, style: { ...l.style, ...patch } } : l))
    );
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // ---- Real-coordinate corrections (data shifts) -------------------------
  interface ShiftEntry {
    layerId: string;
    featureIndex: number | null;
    dEast: number;
    dNorth: number;
  }
  const undoStack = useRef<ShiftEntry[][]>([]);

  const persistLayer = useCallback(
    (layer: LayerData) => {
      if (!account || !user || !layer.remoteId) return;
      account
        .updateLayer(layer.remoteId, {
          name: layer.name,
          sourceFormat: layer.sourceFormat,
          style: layer.style,
          geojson: layer.geojson,
        })
        .catch(() => undefined);
    },
    [account, user]
  );

  const applyShiftEntries = useCallback(
    (entries: ShiftEntry[], recordUndo: boolean) => {
      if (!entries.length) return;
      const affected = new Set(entries.map((e) => e.layerId));
      const next = layersRef.current.map((layer) => {
        if (!affected.has(layer.id)) return layer;
        let geojson = layer.geojson;
        entries
          .filter((e) => e.layerId === layer.id)
          .forEach((e) => {
            geojson = translateCollection(geojson, e.dEast, e.dNorth, e.featureIndex);
          });
        return { ...layer, geojson };
      });
      setLayers(next);
      if (recordUndo) {
        undoStack.current.push(entries);
        if (undoStack.current.length > 50) undoStack.current.shift();
      }
      next.filter((l) => affected.has(l.id)).forEach(persistLayer);
    },
    [persistLayer]
  );

  const resolveTargets = useCallback(
    (target: CorrectionTarget, position: LatLon | null): ShiftEntry[] | null => {
      const current = layersRef.current;
      const candidates =
        target.layerId === 'all'
          ? current.filter((l) => l.visible)
          : current.filter((l) => l.id === target.layerId);
      if (!candidates.length) return null;
      if (target.nearestFeatureOnly) {
        if (!position) return null;
        const hit = findNearestVertex(
          candidates.map((l) => ({ id: l.id, collection: l.geojson })),
          position
        );
        if (!hit) return null;
        return [{ layerId: hit.layerId, featureIndex: hit.featureIndex, dEast: 0, dNorth: 0 }];
      }
      return candidates.map((l) => ({ layerId: l.id, featureIndex: null, dEast: 0, dNorth: 0 }));
    },
    []
  );

  /** Move the target's real coordinates by meters (arrows in the AR view). */
  const shiftData = useCallback(
    (target: CorrectionTarget, dEast: number, dNorth: number, position: LatLon | null): boolean => {
      const targets = resolveTargets(target, position);
      if (!targets) return false;
      applyShiftEntries(
        targets.map((t) => ({ ...t, dEast, dNorth })),
        true
      );
      return true;
    },
    [applyShiftEntries, resolveTargets]
  );

  /** Snap: translate the target so its nearest vertex lands exactly on the user's position. */
  const snapDataToPosition = useCallback(
    (target: CorrectionTarget, position: LatLon): { moved: number } | null => {
      const current = layersRef.current;
      const candidates =
        target.layerId === 'all'
          ? current.filter((l) => l.visible)
          : current.filter((l) => l.id === target.layerId);
      const hit = findNearestVertex(
        candidates.map((l) => ({ id: l.id, collection: l.geojson })),
        position
      );
      if (!hit) return null;
      const { dEast, dNorth } = deltaToPosition(hit.vertex, position);
      const entries: ShiftEntry[] = target.nearestFeatureOnly
        ? [{ layerId: hit.layerId, featureIndex: hit.featureIndex, dEast, dNorth }]
        : candidates.map((l) => ({ layerId: l.id, featureIndex: null, dEast, dNorth }));
      applyShiftEntries(entries, true);
      return { moved: Math.hypot(dEast, dNorth) };
    },
    [applyShiftEntries]
  );

  const undoDataShift = useCallback((): boolean => {
    const entries = undoStack.current.pop();
    if (!entries) return false;
    applyShiftEntries(
      entries.map((e) => ({ ...e, dEast: -e.dEast, dNorth: -e.dNorth })),
      false
    );
    return true;
  }, [applyShiftEntries]);

  const zoomToLayer = useCallback((id: string) => {
    const layer = layersRef.current.find((l) => l.id === id);
    if (!layer || !mapRef.current) return;
    const bounds = computeCollectionBounds(layer.geojson);
    if (bounds) mapRef.current.fitBounds(bounds, { padding: 40, maxZoom: 18 });
  }, []);

  // ---- Map ---------------------------------------------------------------
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: baseMaps.standard.style,
      center: [23.7162, 37.9792],
      zoom: 11,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(baseMaps[basemap].style);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = () => applyLayersToMap(map, layers);
    if (map.isStyleLoaded()) sync();
    map.on('style.load', sync);
    return () => {
      map.off('style.load', sync);
    };
  }, [layers, basemap]);

  const previousLayerCount = useRef(0);
  useEffect(() => {
    // Fit once when the first layers arrive or new files are added.
    if (layers.length > previousLayerCount.current && mapRef.current) {
      const bounds = computeLayersBounds(layers);
      if (bounds) mapRef.current.fitBounds(bounds, { padding: 40, maxZoom: 17 });
    }
    previousLayerCount.current = layers.length;
  }, [layers]);

  const totalFeatures = layers.reduce((acc, l) => acc + l.geojson.features.length, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="flex flex-col gap-3 px-4 py-3 border-b border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}assets/logo.svg`}
            alt="FieldAR"
            className="w-10 h-10"
          />
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
            onClick={() => setArEnabled(true)}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded shadow text-sm"
          >
            {t.startAR}
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
          <div className="flex gap-2 flex-wrap items-center">
            <label className="inline-flex items-center gap-2 text-sm bg-cyan-700/40 border border-cyan-700 px-3 py-2 rounded cursor-pointer hover:bg-cyan-700/60">
              <input
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                className="hidden"
                onChange={onFiles}
              />
              <span>{t.loadFile}</span>
            </label>
            <button
              onClick={loadSample}
              className="bg-slate-900 border border-slate-800 px-3 py-2 rounded text-sm hover:border-slate-700"
            >
              {t.loadSample}
            </button>
            <span className="text-xs text-slate-500">{t.supportedFormats}</span>
          </div>
          {loadError && (
            <p className="text-sm text-rose-300 bg-rose-950/40 border border-rose-900 rounded px-3 py-2">
              {loadError}
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h2 className="text-lg font-semibold">{t.mapTitle}</h2>
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
              className="h-[45vh] min-h-[280px] rounded-xl border border-slate-800 overflow-hidden"
            />
          </div>

          <LayerPanel
            layers={layers}
            onChange={updateLayer}
            onStyleChange={updateLayerStyle}
            onRemove={removeLayer}
            onZoom={zoomToLayer}
            t={t}
          />

          <p className="text-xs text-slate-500">{t.accuracyDisclaimer}</p>
        </section>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <AccountPanel
            mode={account?.mode ?? null}
            user={user}
            savedLayers={savedLayers}
            busy={accountBusy}
            error={accountError}
            onLogin={(email, password) => handleAuth('login', email, password)}
            onRegister={(email, password) => handleAuth('register', email, password)}
            onLogout={handleLogout}
            onLoadLayer={handleLoadSaved}
            onDeleteLayer={handleDeleteSaved}
            t={t}
          />

          <div className="bg-slate-900 border border-slate-800 p-3 rounded space-y-1">
            <h3 className="font-semibold mb-1">{t.arStatus}</h3>
            <p className="text-sm">{arEnabled ? t.arActive : t.arInactive}</p>
            <p className="text-sm">
              {t.accuracy}: {telemetry?.accuracy ? `±${telemetry.accuracy.toFixed(1)}m` : 'N/A'}
            </p>
            <p className="text-sm">
              {t.heading}:{' '}
              {telemetry?.heading !== null && telemetry?.heading !== undefined
                ? `${telemetry.heading.toFixed(0)}°`
                : 'N/A'}
            </p>
            <p className="text-sm">
              {t.featureList}: {totalFeatures}
            </p>
          </div>

          <button
            onClick={() => setArEnabled(true)}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-3 rounded-lg shadow text-sm font-medium"
          >
            {t.startAR}
          </button>
        </aside>
      </main>

      <ARView
        layers={layers}
        active={arEnabled}
        settings={arSettings}
        onSettingsChange={setArSettings}
        onStop={() => setArEnabled(false)}
        onTelemetry={setTelemetry}
        onShiftData={shiftData}
        onSnapData={snapDataToPosition}
        onUndoShift={undoDataShift}
        t={t}
      />
    </div>
  );
}

export default App;
