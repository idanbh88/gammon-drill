/**
 * Play screen preferences in localStorage (`bg-trainer/play/v1`: the animation speed), and the
 * events of a match that was just started, handed from the new-match form to the game page in
 * sessionStorage so gnubg's opening move can be animated there. Every access is guarded; the
 * page works without storage.
 */
import { SPEEDS, type Speed } from "./board-animation";
import type { PlayEvent } from "./play-service";

export const PLAY_SETTINGS_KEY = "bg-trainer/play/v1";

export interface PlaySettings {
  speed: Speed;
}

export const DEFAULT_PLAY_SETTINGS: PlaySettings = { speed: "normal" };

export function loadPlaySettings(): PlaySettings {
  try {
    if (typeof window === "undefined") return DEFAULT_PLAY_SETTINGS;
    const raw = JSON.parse(window.localStorage.getItem(PLAY_SETTINGS_KEY) ?? "null") as Partial<PlaySettings> | null;
    const speed = (SPEEDS as readonly string[]).includes(raw?.speed as string) ? (raw!.speed as Speed) : DEFAULT_PLAY_SETTINGS.speed;
    return { speed };
  } catch {
    return DEFAULT_PLAY_SETTINGS;
  }
}

export function savePlaySettings(s: PlaySettings): void {
  try {
    window.localStorage.setItem(PLAY_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: the setting just won't persist
  }
}

export const startEventsKey = (matchId: number) => `bg-trainer/play-start/${matchId}`;

export function stashStartEvents(matchId: number, events: PlayEvent[]): void {
  try {
    window.sessionStorage.setItem(startEventsKey(matchId), JSON.stringify(events));
  } catch {
    // no animation of the opening then
  }
}

/** The stashed events of a match just started (left in place; see dropStartEvents). */
export function readStartEvents(matchId: number): PlayEvent[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.sessionStorage.getItem(startEventsKey(matchId));
    return raw ? (JSON.parse(raw) as PlayEvent[]) : [];
  } catch {
    return [];
  }
}

export function dropStartEvents(matchId: number): void {
  try {
    window.sessionStorage.removeItem(startEventsKey(matchId));
  } catch {
    // nothing to do
  }
}
