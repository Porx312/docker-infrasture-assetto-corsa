import type { HudProfile } from './hudTypes.js';

export function isProfileInvalidated(profile: HudProfile | null | undefined): boolean {
  return profile?.isInvalidated === true;
}
