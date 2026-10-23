/**
 * Host/Convex timeOfDay → Assetto Corsa server_cfg.ini SUN_ANGLE + TIME_OF_DAY_MULT.
 */

export type TimeOfDayPreset = 'day' | 'night' | 'dynamic';

export type TimeOfDayIniValues = {
  sunAngle: number;
  timeOfDayMult: number;
};

const PRESETS: Record<TimeOfDayPreset, TimeOfDayIniValues> = {
  day: { sunAngle: 16, timeOfDayMult: 1 },
  night: { sunAngle: -80, timeOfDayMult: 1 },
  dynamic: { sunAngle: 16, timeOfDayMult: 5 },
};

export function normalizeTimeOfDay(raw: unknown): TimeOfDayPreset | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase();
  if (t === 'day' || t === 'night' || t === 'dynamic') return t;
  return undefined;
}

/** Returns INI values or undefined if preset unknown. */
export function resolveTimeOfDayPreset(raw: unknown): TimeOfDayIniValues | undefined {
  const key = normalizeTimeOfDay(raw);
  if (!key) return undefined;
  return PRESETS[key];
}
