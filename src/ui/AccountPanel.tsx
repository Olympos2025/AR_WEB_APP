import React, { useState } from 'react';
import { AccountMode, AccountUser, SavedLayerMeta } from '../account';

interface Props {
  mode: AccountMode | null; // null while probing the API
  user: AccountUser | null;
  savedLayers: SavedLayerMeta[];
  busy: boolean;
  error: string | null;
  onRegister: (email: string, password: string) => void;
  onLogin: (email: string, password: string) => void;
  onLogout: () => void;
  onLoadLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  t: Record<string, string>;
}

const AccountPanel: React.FC<Props> = ({
  mode,
  user,
  savedLayers,
  busy,
  error,
  onRegister,
  onLogin,
  onLogout,
  onLoadLayer,
  onDeleteLayer,
  t,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="bg-slate-900 border border-slate-800 p-3 rounded space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t.account}</h3>
        {mode && (
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full border ${
              mode === 'remote'
                ? 'border-emerald-700 text-emerald-300'
                : 'border-amber-700 text-amber-300'
            }`}
          >
            {mode === 'remote' ? t.accountModeRemote : t.accountModeLocal}
          </span>
        )}
      </div>

      {mode === 'local' && !user && (
        <p className="text-xs text-slate-400">{t.accountLocalHint}</p>
      )}

      {!user ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(email, password);
          }}
        >
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            placeholder={t.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || mode === null}
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white px-3 py-2 rounded text-sm"
            >
              {t.login}
            </button>
            <button
              type="button"
              disabled={busy || mode === null}
              onClick={() => onRegister(email, password)}
              className="flex-1 bg-slate-800 border border-slate-700 disabled:opacity-50 px-3 py-2 rounded text-sm"
            >
              {t.register}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm truncate">{user.email}</p>
            <button
              onClick={onLogout}
              className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              {t.logout}
            </button>
          </div>
          <p className="text-xs text-slate-400">{t.autoSaveHint}</p>
          <div>
            <h4 className="text-sm font-medium mb-1">{t.savedLayers}</h4>
            {savedLayers.length === 0 ? (
              <p className="text-xs text-slate-500">{t.noSavedLayers}</p>
            ) : (
              <ul className="divide-y divide-slate-800 text-sm max-h-56 overflow-y-auto">
                {savedLayers.map((layer) => (
                  <li key={layer.id} className="py-1.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{layer.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {layer.sourceFormat} • {layer.featureCount} {t.features} •{' '}
                        {new Date(layer.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => onLoadLayer(layer.id)}
                      disabled={busy}
                      className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1"
                    >
                      {t.loadSaved}
                    </button>
                    <button
                      onClick={() => onDeleteLayer(layer.id)}
                      disabled={busy}
                      className="text-xs bg-rose-900/60 border border-rose-800 rounded px-2 py-1"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};

export default AccountPanel;
