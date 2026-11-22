import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { getFirebaseApp } from './firebase';

// Settings we can change without shipping a new extension build. Defaults are
// used when Remote Config can't be reached (for example offline).
export const defaults = {
  prompt_version: 'v1',
  cloud_model: 'gemini-3.5-flash-lite',
  on_device_enabled: true, // kill switch for the on-device read
  max_page_chars: 6000,
  reminder_days_before: 2,
  cloud_cooldown_seconds: 6, // space out cloud calls to stay inside the free quota
};

export type Settings = typeof defaults;
let cached: Settings | undefined;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const s = { ...defaults };
  try {
    const rc = getRemoteConfig(getFirebaseApp());
    rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
    rc.defaultConfig = { ...defaults };
    await fetchAndActivate(rc);
    s.prompt_version = getValue(rc, 'prompt_version').asString();
    s.cloud_model = getValue(rc, 'cloud_model').asString();
    s.on_device_enabled = getValue(rc, 'on_device_enabled').asBoolean();
    s.max_page_chars = getValue(rc, 'max_page_chars').asNumber() || defaults.max_page_chars;
    s.reminder_days_before = getValue(rc, 'reminder_days_before').asNumber() || defaults.reminder_days_before;
    s.cloud_cooldown_seconds = getValue(rc, 'cloud_cooldown_seconds').asNumber();
  } catch (e) {
    console.warn('Remote Config not reachable, using defaults', e);
  }
  cached = s;
  return s;
}
