// User settings, persisted to localStorage.
//
// Deliberately only settings that change something REAL about how this app
// behaves — evidence discovery, proof submission, how timestamps are read.
// A settings page full of decoration would be worse than none.
import { useEffect, useState } from 'react';
import { CONFIG } from './config';

export type Theme = 'dark' | 'light' | 'system';
export type TimeMode = 'utc' | 'local';

export interface Settings {
  theme: Theme;
  /** UTC keeps the UI aligned with block timestamps, which are always UTC. */
  timeMode: TimeMode;
  /**
   * Override for the Sepolia endpoint used to discover evidence.
   *
   * This is the setting that matters most. Public endpoints serve wide block
   * ranges but only retain roughly the last 10,000 blocks, so a window older
   * than about a day silently returns NOTHING — which reads as "the feed never
   * updated" rather than "we cannot see that far back". An archive key fixes it.
   */
  sepoliaRpc: string;
  /** Extra gas head-room on proof submissions, as a percentage. */
  gasMarginPct: number;
  /** Show off-chain observations that have no Creditcoin proof yet. */
  showProvisional: boolean;
  /** Seconds between automatic re-reads of chain state. 0 disables. */
  refreshSecs: number;
}

export const DEFAULTS: Settings = {
  theme: 'dark',
  timeMode: 'utc',
  sepoliaRpc: '',
  gasMarginPct: 25,
  showProvisional: true,
  refreshSecs: 0,
};

const KEY = 'attestable.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private browsing — settings just do not persist */
  }
  applyTheme(s.theme);
  window.dispatchEvent(new CustomEvent('attestable:settings', { detail: s }));
}

/** The Sepolia endpoint to actually use, honouring any override. */
export function sepoliaEndpoint(): string {
  const s = loadSettings();
  return s.sepoliaRpc.trim() || CONFIG.sepoliaRpc;
}

export function gasMargin(): number {
  return loadSettings().gasMarginPct;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

/** Format a unix timestamp according to the chosen time mode. */
export function formatTimestamp(ts: number, mode?: TimeMode): string {
  const m = mode ?? loadSettings().timeMode;
  const d = new Date(ts * 1000);
  if (m === 'local') {
    return d.toLocaleString(undefined, { hour12: false }).replace(',', '');
  }
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** React binding. Re-renders every consumer when settings change anywhere. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setState] = useState<Settings>(loadSettings);

  useEffect(() => {
    applyTheme(settings.theme);
    const onChange = (e: Event) => setState((e as CustomEvent).detail as Settings);
    window.addEventListener('attestable:settings', onChange);
    return () => window.removeEventListener('attestable:settings', onChange);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...loadSettings(), ...patch };
    setState(next);
    saveSettings(next);
  };

  return [settings, update];
}
