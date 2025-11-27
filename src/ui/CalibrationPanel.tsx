import React from 'react';
import { OverlayOptions } from '../ar/arScene';

interface Props {
  options: OverlayOptions;
  onChange: (opts: OverlayOptions) => void;
  heading: number | null;
  accuracy: number | null;
  t: Record<string, string>;
}

const CalibrationPanel: React.FC<Props> = ({ options, onChange, heading, accuracy, t }) => {
  return (
    <div className="bg-slate-900 border border-slate-800 p-3 rounded space-y-2">
      <h3 className="font-semibold">{t.align}</h3>
      <p className="text-sm text-slate-300">{t.accuracy}: {accuracy ? `±${accuracy.toFixed(1)}m` : t.notAvailable}</p>
      <p className="text-sm text-slate-300">{t.heading}: {heading ? `${heading.toFixed(0)}°` : t.notAvailable}</p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span>{t.heightOffset}: {options.heightOffset.toFixed(1)}m</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={options.heightOffset}
            onChange={(e) => onChange({ ...options, heightOffset: Number(e.target.value) })}
            className="w-full"
          />
        </label>
        <label className="space-y-1">
          <span>{t.nudge}: {options.simplifyTolerance.toFixed(1)}m</span>
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

export default CalibrationPanel;
