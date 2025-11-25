import React from 'react';

interface Props {
  features: { id: string; name: string; type: string }[];
  title: string;
}

const FeatureList: React.FC<Props> = ({ features, title }) => {
  if (!features.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-800 p-3 rounded">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-800 text-sm">
        {features.map((f) => (
          <div key={f.id} className="py-2 flex items-center justify-between">
            <div>
              <p className="font-medium">{f.name}</p>
              <p className="text-slate-400">{f.type}</p>
            </div>
            <span className="text-xs text-slate-500">#{f.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FeatureList;
