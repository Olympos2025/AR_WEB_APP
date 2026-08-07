import React, { useState } from 'react';
import { LayerData, LayerStyle, collectPropertyKeys } from '../state/layerTypes';

interface Props {
  layers: LayerData[];
  onChange: (id: string, patch: Partial<LayerData>) => void;
  onStyleChange: (id: string, patch: Partial<LayerStyle>) => void;
  onRemove: (id: string) => void;
  onZoom: (id: string) => void;
  t: Record<string, string>;
}

const LayerPanel: React.FC<Props> = ({ layers, onChange, onStyleChange, onRemove, onZoom, t }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!layers.length) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded text-sm text-slate-400">
        {t.noLayers}
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded divide-y divide-slate-800">
      <h3 className="font-semibold px-3 py-2">{t.layerPanel}</h3>
      {layers.map((layer) => {
        const isOpen = expanded === layer.id;
        const style = layer.style;
        const propertyKeys = collectPropertyKeys(layer.geojson);
        return (
          <div key={layer.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={(e) => onChange(layer.id, { visible: e.target.checked })}
                title={t.layerVisible}
              />
              <button
                className="flex-1 text-left min-w-0"
                onClick={() => setExpanded(isOpen ? null : layer.id)}
              >
                <span className="block font-medium truncate">{layer.name}</span>
                <span className="block text-xs text-slate-400">
                  {layer.sourceFormat} • {layer.geojson.features.length} {t.features}
                  {layer.remoteId ? ` • ${t.savedInAccount}` : ''}
                </span>
              </button>
              <button
                onClick={() => onZoom(layer.id)}
                className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1"
              >
                {t.zoomTo}
              </button>
              <button
                onClick={() => onRemove(layer.id)}
                className="text-xs bg-rose-900/60 border border-rose-800 rounded px-2 py-1"
              >
                ✕
              </button>
            </div>

            {isOpen && (
              <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                <label className="space-y-1">
                  <span className="text-slate-300">{t.fillColor}</span>
                  <input
                    type="color"
                    value={style.polygonFill}
                    onChange={(e) => onStyleChange(layer.id, { polygonFill: e.target.value })}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">{t.strokeColor}</span>
                  <input
                    type="color"
                    value={style.polygonStroke}
                    onChange={(e) => onStyleChange(layer.id, { polygonStroke: e.target.value })}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">{t.lineColor}</span>
                  <input
                    type="color"
                    value={style.lineColor}
                    onChange={(e) => onStyleChange(layer.id, { lineColor: e.target.value })}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">{t.points}</span>
                  <input
                    type="color"
                    value={style.pointColor}
                    onChange={(e) => onStyleChange(layer.id, { pointColor: e.target.value })}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.fillOpacity}: {style.polygonOpacity.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={style.polygonOpacity}
                    onChange={(e) => onStyleChange(layer.id, { polygonOpacity: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.layerOpacity}: {(style.opacity * 100).toFixed(0)}%
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={style.opacity}
                    onChange={(e) => onStyleChange(layer.id, { opacity: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.strokeWidth}: {style.polygonWidth}px
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={style.polygonWidth}
                    onChange={(e) => onStyleChange(layer.id, { polygonWidth: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.lineWidth}: {style.lineWidth}px
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={style.lineWidth}
                    onChange={(e) => onStyleChange(layer.id, { lineWidth: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.pointSize}: {style.pointSize.toFixed(1)}×
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={4}
                    step={0.1}
                    value={style.pointSize}
                    onChange={(e) => onStyleChange(layer.id, { pointSize: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
                <label className="flex items-center gap-2 mt-4">
                  <input
                    type="checkbox"
                    checked={style.showLabels}
                    onChange={(e) => onStyleChange(layer.id, { showLabels: e.target.checked })}
                  />
                  <span className="text-slate-300">{t.labels}</span>
                </label>
                <label className="space-y-1 col-span-2">
                  <span className="text-slate-300">{t.labelField}</span>
                  <select
                    value={style.labelField}
                    onChange={(e) => onStyleChange(layer.id, { labelField: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1"
                  >
                    <option value="">{t.labelFieldAuto}</option>
                    {propertyKeys.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">{t.labelColor}</span>
                  <input
                    type="color"
                    value={style.labelColor}
                    onChange={(e) => onStyleChange(layer.id, { labelColor: e.target.value })}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300">
                    {t.labelSize}: {style.labelSize.toFixed(1)}×
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={style.labelSize}
                    onChange={(e) => onStyleChange(layer.id, { labelSize: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LayerPanel;
