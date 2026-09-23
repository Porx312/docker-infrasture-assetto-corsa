/** Convex `carModel` must be the internal car id (e.g. ks_toyota_gt86), not display name. */
export function isCarModelId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(' ')) {
    return false;
  }
  return /^[a-z0-9_-]+$/i.test(trimmed) && trimmed.length <= 64;
}

/** Prefer a valid car id; never pass display names (car_name) to Convex. */
export function pickCarModelId(
  candidate: string | undefined,
  fallbacks: Array<string | null | undefined> = [],
): string | undefined {
  const trimmed = candidate?.trim();
  if (trimmed && isCarModelId(trimmed)) {
    return trimmed;
  }

  for (const fallback of fallbacks) {
    const value = fallback?.trim();
    if (value && isCarModelId(value)) {
      return value;
    }
  }

  return undefined;
}

export function readCarModelFromEventData(
  data: Record<string, unknown>,
  override?: string,
): string {
  const resolved = pickCarModelId(override, [
    typeof data.car_id === 'string' ? data.car_id : undefined,
    typeof data.carId === 'string' ? data.carId : undefined,
    typeof data.carModel === 'string' ? data.carModel : undefined,
  ]);
  if (resolved) {
    return resolved;
  }
  return (
    (typeof data.car_id === 'string' ? data.car_id.trim() : '') ||
    (typeof data.carId === 'string' ? data.carId.trim() : '') ||
    (typeof data.carModel === 'string' ? data.carModel.trim() : '')
  );
}
