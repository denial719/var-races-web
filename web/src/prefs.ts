import type { CameraMode } from './render/camera';

// Settings remembered in this browser. Storage can be unavailable (private windows, blocked
// site data), so every read falls back to a default and every write may silently fail.

const KEY = 'var-races';

interface Prefs {
  /** the garage car number (1..15) */
  car: number;
  /** presentation preference, never sent to the server */
  cameraMode: CameraMode;
  muted: boolean;
  ghost: boolean;
  /** sound levels, 0..1: everything, the music, and the effects (engine, crashes, clicks) */
  volume: number;
  music: number;
  effects: number;
}

const defaults: Prefs = { car: 4, cameraMode: 'thirdPerson', muted: false, ghost: true, volume: 1, music: 1, effects: 1 };
const level = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback);
let cache: Prefs | null = null;

function load(): Prefs {
  if (cache) return cache;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    const cameraMode: CameraMode = stored.cameraMode === 'firstPerson' || stored.cameraMode === 'thirdPerson'
      ? stored.cameraMode : stored.firstPerson === true ? 'firstPerson' : 'thirdPerson';
    cache = {
      ghost: stored.ghost !== false, car: stored.car ?? defaults.car, muted: stored.muted ?? defaults.muted, cameraMode,
      volume: level(stored.volume, defaults.volume), music: level(stored.music, defaults.music), effects: level(stored.effects, defaults.effects),
    };
  } catch {
    cache = { ...defaults };
  }
  return cache!;
}

export function pref<K extends keyof Prefs>(key: K): Prefs[K] {
  return load()[key];
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  load()[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // not remembered this time
  }
}
