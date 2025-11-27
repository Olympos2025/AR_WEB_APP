import React from 'react';
import { OverlayOptions } from '../ar/arScene';

interface Props {
  options: OverlayOptions;
  onChange: (opts: OverlayOptions) => void;
  t: Record<string, string>;
}

const LayerControls: React.FC<Props> = ({ options, onChange, t }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 p-3 rounded space-y-2">
      <h3 className="font-semibold">{t.styling}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="text-slate-300">{t.fillColor}</span>
          <input
            type="color"
            value={options.polygonFill}
            onChange={(e) => onChange({ ...options, polygonFill: e.target.value })}
            className="w-full h-10 bg-slate-800 border border-slate-700 rounded"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.strokeColor}</span>
          <input
            type="color"
            value={options.polygonStroke}
            onChange={(e) => onChange({ ...options, polygonStroke: e.target.value })}
            className="w-full h-10 bg-slate-800 border border-slate-700 rounded"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.fillOpacity}: {options.polygonOpacity.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={options.polygonOpacity}
            onChange={(e) => onChange({ ...options, polygonOpacity: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.strokeWidth}: {options.polygonWidth}px</span>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={options.polygonWidth}
            onChange={(e) => onChange({ ...options, polygonWidth: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.lines} {options.lineWidth}px</span>
          <input
            type="color"
            value={options.lineColor}
            onChange={(e) => onChange({ ...options, lineColor: e.target.value })}
            className="w-full h-10 bg-slate-800 border border-slate-700 rounded"
          />
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={options.lineWidth}
            onChange={(e) => onChange({ ...options, lineWidth: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.points}</span>
          <input
            type="color"
            value={options.pointColor}
            onChange={(e) => onChange({ ...options, pointColor: e.target.value })}
            className="w-full h-10 bg-slate-800 border border-slate-700 rounded"
          />
        </label>
        <label className="space-y-1">
          <span className="text-slate-300">{t.pointSymbol}</span>
          <select
            value={options.pointSymbol}
            onChange={(e) => onChange({ ...options, pointSymbol: e.target.value as OverlayOptions['pointSymbol'] })}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-2"
          >
            <option value="sphere">{t.symbolSphere}</option>
            <option value="box">{t.symbolBox}</option>
            <option value="cone">{t.symbolCone}</option>
          </select>
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-slate-300">{t.transparency}: {(options.transparency * 100).toFixed(0)}%</span>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={options.transparency}
            onChange={(e) => onChange({ ...options, transparency: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-slate-300">{t.simplify}: {options.simplifyTolerance.toFixed(1)}m</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={options.simplifyTolerance}
            onChange={(e) => onChange({ ...options, simplifyTolerance: Number(e.target.value) })}
            className="w-full"
          />
        </label>
      </div>
    </div>
  );
};

export default LayerControls;
