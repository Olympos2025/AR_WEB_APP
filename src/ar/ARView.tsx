import React, { useEffect, useRef, useState } from 'react';
import { LatLon } from '../geo/geoUtils';
import { CorrectionTarget } from '../geo/transform';
import { LayerData } from '../state/layerTypes';
import { AREngine, ARSettings, ARTelemetry } from './arEngine';
import { BasemapKey } from './basemapGround';

interface Props {
  layers: LayerData[];
  active: boolean;
  settings: ARSettings;
  onSettingsChange: (settings: ARSettings) => void;
  onStop: () => void;
  onTelemetry?: (telemetry: ARTelemetry) => void;
  /** Move the target's REAL coordinates by meters east/north. */
  onShiftData: (
    target: CorrectionTarget,
    dEast: number,
    dNorth: number,
    position: LatLon | null
  ) => boolean;
  /** Snap the target so its nearest vertex lands on the user's position. */
  onSnapData: (target: CorrectionTarget, position: LatLon) => { moved: number } | null;
  onUndoShift: () => boolean;
  t: Record<string, string>;
}

const BASEMAP_KEYS: BasemapKey[] = ['none', 'streets', 'topo', 'imagery'];

export default function ARView({
  layers,
  active,
  settings,
  onSettingsChange,
  onStop,
  onTelemetry,
  onShiftData,
  onSnapData,
  onUndoShift,
  t,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<AREngine | null>(null);
  const [telemetry, setTelemetry] = useState<ARTelemetry | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [nudgeStep, setNudgeStep] = useState(1);
  const [targetLayerId, setTargetLayerId] = useState<string>('all');
  const [nearestFeatureOnly, setNearestFeatureOnly] = useState(false);
  const [correctionStatus, setCorrectionStatus] = useState<string | null>(null);

  // Keep the latest props in refs so the engine effect only reruns on `active`.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const telemetryCallback = useRef(onTelemetry);
  telemetryCallback.current = onTelemetry;

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const engine = new AREngine(containerRef.current);
    engineRef.current = engine;
    engine.onTelemetry = (data) => {
      setTelemetry(data);
      telemetryCallback.current?.(data);
    };
    engine.start(layersRef.current, settingsRef.current);
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    engineRef.current?.setLayers(layers);
  }, [layers]);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  // Reset the target selector if the selected layer disappears.
  useEffect(() => {
    if (targetLayerId !== 'all' && !layers.some((l) => l.id === targetLayerId)) {
      setTargetLayerId('all');
    }
  }, [layers, targetLayerId]);

  if (!active) return null;

  const update = (patch: Partial<ARSettings>) => onSettingsChange({ ...settings, ...patch });
  const target: CorrectionTarget = { layerId: targetLayerId, nearestFeatureOnly };
  const position = telemetry?.position ?? null;

  // Shift the data relative to the direction the user is facing:
  // viewRight > 0 pushes it right in view, viewForward > 0 pushes it away.
  const nudge = (viewRight: number, viewForward: number) => {
    const headingRad = (((telemetry?.heading ?? 0) + 360) % 360) * (Math.PI / 180);
    const forwardE = Math.sin(headingRad);
    const forwardN = Math.cos(headingRad);
    const rightE = Math.cos(headingRad);
    const rightN = -Math.sin(headingRad);
    const dEast = (viewRight * rightE + viewForward * forwardE) * nudgeStep;
    const dNorth = (viewRight * rightN + viewForward * forwardN) * nudgeStep;
    const ok = onShiftData(target, dEast, dNorth, position);
    setCorrectionStatus(ok ? `${t.movedBy} ${nudgeStep} m` : t.correctionFailed);
  };

  const snap = () => {
    if (!position) {
      setCorrectionStatus(t.waitingGps);
      return;
    }
    const result = onSnapData(target, position);
    setCorrectionStatus(
      result ? `${t.snapDone} (${t.movedBy} ${result.moved.toFixed(1)} m)` : t.correctionFailed
    );
  };

  const undo = () => {
    setCorrectionStatus(onUndoShift() ? t.undoDone : t.nothingToUndo);
  };

  return (
    <div className="fixed inset-0 bg-black z-50">
      <div ref={containerRef} className="absolute inset-0 overflow-hidden" />

      <div className="absolute top-3 left-3 bg-slate-900/80 text-white px-3 py-2 rounded-lg shadow max-w-[46vw]">
        <div className="text-xs font-semibold mb-1">{t.arStatus}</div>
        <div
          className={`text-xs ${
            telemetry?.estimatedAccuracy == null
              ? ''
              : telemetry.estimatedAccuracy <= 4
                ? 'text-emerald-300'
                : telemetry.estimatedAccuracy <= 10
                  ? 'text-amber-300'
                  : 'text-rose-300'
          }`}
        >
          GPS: {telemetry?.accuracy ? `±${telemetry.accuracy.toFixed(1)}m` : '…'}
          {telemetry?.estimatedAccuracy != null &&
            ` → ${t.estimate} ±${telemetry.estimatedAccuracy.toFixed(1)}m`}
        </div>
        {telemetry?.estimatedAccuracy != null && telemetry.estimatedAccuracy > 6 && (
          <div className="text-[11px] text-slate-300">{t.gpsAutoHint}</div>
        )}
        <div className="text-xs">
          {t.heading}:{' '}
          {telemetry?.heading !== null && telemetry?.heading !== undefined
            ? `${telemetry.heading.toFixed(0)}°`
            : '…'}
        </div>
        <div className="text-xs">
          {t.featureList}: {telemetry?.trackedFeatures ?? 0}
        </div>
        {settings.drapeToTerrain && (
          <div
            className={`text-xs ${
              telemetry?.terrain === 'active'
                ? 'text-emerald-300'
                : telemetry?.terrain === 'unavailable'
                  ? 'text-rose-300'
                  : 'text-slate-300'
            }`}
          >
            {t.terrain}:{' '}
            {telemetry?.terrain === 'active'
              ? `${t.terrainActive}${
                  telemetry.originElevation !== null
                    ? ` (${telemetry.originElevation.toFixed(0)} m)`
                    : ''
                }`
              : telemetry?.terrain === 'unavailable'
                ? t.terrainUnavailable
                : t.terrainLoading}
          </div>
        )}
        {telemetry && !telemetry.originSet && (
          <div className="text-[11px] text-amber-300 mt-1">{t.waitingGps}</div>
        )}
        {telemetry && telemetry.cameraState === 'error' && (
          <div className="text-[11px] text-rose-300 mt-1">{t.cameraError}</div>
        )}
        {telemetry && !telemetry.orientationSeen && (
          <div className="text-[11px] text-amber-300 mt-1">{t.orientationHint}</div>
        )}
      </div>

      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <button
          onClick={onStop}
          className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg shadow text-sm"
        >
          {t.stopAR}
        </button>
        <button
          onClick={() => setShowControls((v) => !v)}
          className="bg-slate-900/80 text-white px-4 py-2 rounded-lg shadow text-sm border border-slate-700"
        >
          {showControls ? t.hideControls : t.showControls}
        </button>
      </div>

      {showControls && (
        <div className="absolute bottom-0 inset-x-0 bg-slate-950/85 backdrop-blur text-white p-4 space-y-3 max-h-[60vh] overflow-y-auto rounded-t-2xl">
          <div className="border border-cyan-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t.dataCorrection}</span>
              {correctionStatus && (
                <span className="text-xs text-cyan-300">{correctionStatus}</span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">{t.dataCorrectionHint}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <label className="space-y-1">
                <span className="text-slate-300">{t.correctionTarget}</span>
                <select
                  value={targetLayerId}
                  onChange={(e) => setTargetLayerId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1"
                >
                  <option value="all">{t.allLayers}</option>
                  {layers
                    .filter((l) => l.visible)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-1">
                <input
                  type="checkbox"
                  checked={nearestFeatureOnly}
                  onChange={(e) => setNearestFeatureOnly(e.target.checked)}
                />
                <span className="text-slate-300">{t.onlyNearestFeature}</span>
              </label>
            </div>

            <button
              onClick={snap}
              disabled={!position}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-3 py-2.5 rounded-lg text-sm font-medium"
            >
              📍 {t.snapToMe}
            </button>

            <div className="flex items-center gap-4">
              <div className="grid grid-cols-3 gap-1.5 w-40 shrink-0">
                <div />
                <button
                  onClick={() => nudge(0, 1)}
                  className="bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-lg active:bg-cyan-700"
                  aria-label={t.nudgeAway}
                >
                  ↑
                </button>
                <div />
                <button
                  onClick={() => nudge(-1, 0)}
                  className="bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-lg active:bg-cyan-700"
                  aria-label={t.nudgeLeft}
                >
                  ←
                </button>
                <button
                  onClick={undo}
                  className="bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-[11px] active:bg-rose-700"
                >
                  {t.undoMove}
                </button>
                <button
                  onClick={() => nudge(1, 0)}
                  className="bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-lg active:bg-cyan-700"
                  aria-label={t.nudgeRight}
                >
                  →
                </button>
                <div />
                <button
                  onClick={() => nudge(0, -1)}
                  className="bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-lg active:bg-cyan-700"
                  aria-label={t.nudgeCloser}
                >
                  ↓
                </button>
                <div />
              </div>
              <div className="text-sm space-y-1 flex-1">
                <span className="block text-slate-300">{t.nudgeStep}</span>
                <div className="flex flex-wrap gap-1.5">
                  {[0.1, 0.5, 1, 2, 5].map((step) => (
                    <button
                      key={step}
                      onClick={() => setNudgeStep(step)}
                      className={`px-2.5 py-1.5 rounded border text-xs ${
                        nudgeStep === step
                          ? 'bg-cyan-700 border-cyan-500'
                          : 'bg-slate-800 border-slate-600'
                      }`}
                    >
                      {step} m
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">{t.nudgeHint}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="space-y-1">
              <span>
                {t.headingCalibration}: {settings.headingOffset.toFixed(0)}°
              </span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={settings.headingOffset}
                onChange={(e) => update({ headingOffset: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span>
                {t.heightOffset}: {settings.heightOffset.toFixed(1)}m
              </span>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={settings.heightOffset}
                onChange={(e) => update({ heightOffset: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <span>
                {t.cameraFov}: {settings.fov.toFixed(0)}°
              </span>
              <input
                type="range"
                min={40}
                max={90}
                step={1}
                value={settings.fov}
                onChange={(e) => update({ fov: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.drapeToTerrain}
                onChange={(e) => update({ drapeToTerrain: e.target.checked })}
              />
              <span>{t.drapeToTerrain}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.useAltitudes}
                onChange={(e) => update({ useAltitudes: e.target.checked })}
              />
              <span>{t.useAltitudes}</span>
            </label>
            <label className="space-y-1">
              <span>{t.arBasemap}</span>
              <select
                value={settings.basemap}
                onChange={(e) => update({ basemap: e.target.value as BasemapKey })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1"
              >
                {BASEMAP_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t[`basemap_${key}`] ?? key}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>
                {t.basemapOpacity}: {(settings.basemapOpacity * 100).toFixed(0)}%
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={settings.basemapOpacity}
                onChange={(e) => update({ basemapOpacity: Number(e.target.value) })}
                className="w-full"
              />
            </label>
          </div>
          <p className="text-[11px] text-slate-400">{t.arBasemapAttribution}</p>
        </div>
      )}
    </div>
  );
}
