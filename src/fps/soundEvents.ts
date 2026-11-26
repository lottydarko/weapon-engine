/**
 * Canonical sound-hook event list for the Player Kit.
 * Zero audio is generated or baked here — every player action fires one of these
 * named events identically from both keyboard/mouse and Xbox controller so real
 * SFX banks can be wired in directly.
 */

export const PLAYER_KIT_SOUND_EVENTS = [
  'fire',
  'pump',
  'reload_start',
  'reload_end',
  'dry_fire',
  'swing',
  'blade_hit',
  'ads_in',
  'ads_out',
  'weapon_raise',
  'weapon_lower',
  'weapon_switch',
  'footstep',
  'jump',
  'land',
  'slide',
  'flashlight_on',
  'flashlight_off',
] as const;

export type PlayerSoundEventName = (typeof PLAYER_KIT_SOUND_EVENTS)[number];

export type PlayerInputSource = 'kbm' | 'gamepad' | 'ui';

export interface PlayerSoundEventPayload {
  event: PlayerSoundEventName;
  weaponId: string;
  inputSource: PlayerInputSource;
  /** Optional normalized intensity (0..1), e.g. landing impact or step weight */
  intensity?: number;
  timestamp: number;
}

export type PlayerSoundEventListener = (payload: PlayerSoundEventPayload) => void;
