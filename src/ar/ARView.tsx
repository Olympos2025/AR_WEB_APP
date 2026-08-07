import React, { useEffect, useRef, useState } from 'react';
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
  t: Record<string, string>;
}

const BASEMAP_KEYS: BasemapKey[] = ['none', 'streets', 'topo', 'imagery'];

export default function ARView({ layers, active, settings, onSettingsChange, onStop, onTelemetry, t }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<AREngine | null>(null);
  const [telemetry, setTelemetry] = useState<ARTelemetry | null>(null);
  const [showControls, setShowControls] = useState(false);

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

  if (!active) return null;

  const update = (patch: Partial<ARSettings>) => onSettingsChange({ ...settings, ...patch });

  return (
    <div className="fixed inset-0 bg-black z-50">
      <div ref={containerRef} className="absolute inset-0 overflow-hidden" />

      <div className="absolute top-3 left-3 bg-slate-900/80 text-white px-3 py-2 rounded-lg shadow max-w-[46vw]">
        <div className="text-xs font-semibold mb-1">{t.arStatus}</div>
        <div className="text-xs">
          GPS: {telemetry?.accuracy ? `±${telemetry.accuracy.toFixed(1)}m` : '…'}
        </div>
        <div className="text-xs">
          {t.heading}: {telemetry?.heading !== null && telemetry?.heading !== undefined ? `${telemetry.heading.toFixed(0)}°` : '…'}
        </div>
        <div className="text-xs">
          {t.featureList}: {telemetry?.trackedFeatures ?? 0}
        </div>
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
        <div className="absolute bottom-0 inset-x-0 bg-slate-950/85 backdrop-blur text-white p-4 space-y-3 max-h-[55vh] overflow-y-auto rounded-t-2xl">
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
                min={-10}
                max={10}
                step={0.5}
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
