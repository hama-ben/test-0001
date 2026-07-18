/**
 * useNotificationSound
 *
 * Manages notification sound preferences for both drivers and consumers.
 * Preferences are saved to localStorage. Supports 5 built-in synthesized
 * tones (Web Audio API) + a custom uploaded audio file (stored as base64).
 *
 * Module-level _activeAudio tracks the currently-playing HTMLAudioElement so
 * stopNotificationSound() can always reach it, regardless of which call site
 * originally created it.
 */

export type SoundPresetId = 'default' | 'double' | 'bell' | 'chime' | 'alert' | 'silent';

export interface SoundPreset {
  id: SoundPresetId;
  label: string;
  description: string;
}

export const SOUND_PRESETS: SoundPreset[] = [
  { id: 'default', label: 'افتراضي',   description: 'نبضة قصيرة' },
  { id: 'double',  label: 'مزدوج',     description: 'نبضتان متتاليتان' },
  { id: 'bell',    label: 'جرس',       description: 'صوت جرس رنين' },
  { id: 'chime',   label: 'رنين',      description: 'ثلاث نغمات' },
  { id: 'alert',   label: 'تنبيه',     description: 'صوت إنذار سريع' },
  { id: 'silent',  label: 'صامت',      description: 'بدون صوت' },
];

// ── Module-level audio handle ─────────────────────────────────────────────────
// Kept at module scope so stopNotificationSound() can always reach the active
// HTMLAudioElement, even when the original call site no longer holds a reference.
let _activeAudio: HTMLAudioElement | null = null;

/**
 * Stop, reset, and release the currently-playing custom audio element (if any).
 * Safe to call when no audio is playing.
 */
export function stopNotificationSound(): void {
  if (_activeAudio) {
    try {
      _activeAudio.pause();
      _activeAudio.currentTime = 0;
      _activeAudio.src = '';
      _activeAudio.load(); // force browser to release the media resource
    } catch {
      // ignore — element may already be in a detached state
    }
    _activeAudio = null;
  }
}

// ── Web Audio API helpers (built-in presets) ──────────────────────────────────
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

function beep(ctx: AudioContext, freq: number, start: number, dur: number, vol = 0.5, type: OscillatorType = 'sine') {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.start(start);
  osc.stop(start + dur);
}

export function playPreset(id: SoundPresetId): void {
  if (id === 'silent') return;
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    switch (id) {
      case 'default':
        beep(ctx, 880, t, 0.28);
        break;
      case 'double':
        beep(ctx, 880, t,        0.15);
        beep(ctx, 880, t + 0.22, 0.15);
        break;
      case 'bell':
        beep(ctx, 1047, t, 0.06, 0.55, 'sine');
        beep(ctx,  880, t + 0.06, 0.45, 0.35, 'sine');
        break;
      case 'chime':
        beep(ctx, 523, t,        0.18);
        beep(ctx, 659, t + 0.20, 0.18);
        beep(ctx, 784, t + 0.40, 0.22);
        break;
      case 'alert':
        beep(ctx, 1200, t,        0.09, 0.6, 'square');
        beep(ctx,  900, t + 0.12, 0.09, 0.6, 'square');
        beep(ctx, 1200, t + 0.24, 0.09, 0.6, 'square');
        break;
    }
  } catch (e) {
    console.warn('[NotificationSound] playPreset failed:', e);
  }
}

export function playCustomSound(dataUrl: string): void {
  // Always stop any previous custom audio before starting a new one.
  stopNotificationSound();
  try {
    const audio = new Audio(dataUrl);
    audio.volume = 0.8;
    _activeAudio = audio;
    audio.play().catch(() => {});
  } catch (e) {
    console.warn('[NotificationSound] playCustom failed:', e);
    _activeAudio = null;
  }
}

export function playNotificationSound(storageKey: string): void {
  try {
    const custom = localStorage.getItem(`${storageKey}_custom`);
    if (custom) { playCustomSound(custom); return; }
    const preset = (localStorage.getItem(storageKey) ?? 'default') as SoundPresetId;
    playPreset(preset);
  } catch (e) {
    console.warn('[NotificationSound] play failed:', e);
  }
}

export const DRIVER_ORDER_SOUND_KEY     = 'mizu_driver_order_sound';
export const CONSUMER_ARRIVAL_SOUND_KEY = 'mizu_consumer_arrival_sound';
