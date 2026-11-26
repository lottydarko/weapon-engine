/**
 * Single centralized configuration object for the entire Player Kit.
 * All movement speeds, slide physics, raw 1:1 camera sensitivities, controller
 * deadzones, and keybinds live here and nowhere else.
 */

export interface PlayerKitConfig {
  movement: {
    walkSpeed: number;
    sprintSpeed: number;
    crouchSpeed: number;
    adsSpeed: number;
    crouchAdsSpeed: number;
    jumpVelocity: number;
    gravity: number;
    groundAccel: number;
    groundDecel: number;
    airAccel: number;
    airDrag: number;
    standEyeHeight: number;
    crouchEyeHeight: number;
    slideEyeHeight: number;
    footstepDistanceWalk: number;
    footstepDistanceSprint: number;
  };
  slide: {
    /** Minimum horizontal speed required to trigger a slide when pressing crouch */
    minEntrySpeed: number;
    /** Speed multiplier applied on slide entry (slight physics-defying kick) */
    boostMultiplier: number;
    /** Floor for initial slide speed in m/s */
    minBoostSpeed: number;
    /** Peak slide speed cap in m/s */
    maxSpeed: number;
    /** Target glide speed during the initial low-friction surge */
    surgeHoldSpeed: number;
    /** Duration of initial low-friction surge window (seconds) */
    surgeDuration: number;
    /** Maximum slide duration (seconds) — controls slide distance */
    duration: number;
    /** Minimum time before releasing crouch exits the slide early (seconds) */
    minCommitTime: number;
    /** Smooth exponential deceleration rate after surge */
    drag: number;
    /** Speed threshold where slide finishes naturally into crouch/stand */
    minEndSpeed: number;
    /** Gentle steering turn rate while sliding (rad/s) */
    steerRate: number;
    /** Cooldown between consecutive slides (seconds) */
    cooldown: number;
    /** Fraction of slide speed carried into a slide-hop jump */
    hopSpeedRetention: number;
    /** Vertical jump velocity when hopping out of a slide */
    hopJumpVelocity: number;
    /** Extra FOV kick in degrees during a slide */
    fovBonus: number;
    /** Extra FOV kick in degrees while sprinting */
    sprintFovBonus: number;
    /** Camera bank roll angle in radians during a slide */
    cameraRoll: number;
    /** Subtle upward camera pitch tilt during a slide */
    cameraPitch: number;
  };
  camera: {
    /** Raw 1:1 mouse sensitivity (radians per pixel) — high, zero smoothing */
    mouseSensitivityHip: number;
    mouseSensitivityAds: number;
    /** Raw 1:1 right-stick angular turn speed (radians per second) — high, zero smoothing */
    gamepadLookSpeedHip: number;
    gamepadLookSpeedAds: number;
    pitchMin: number;
    pitchMax: number;
    hipFov: number;
    adsFov: number;
    swordGuardFov: number;
    flashlightFocusFov: number;
  };
  gamepad: {
    leftDeadzone: number;
    rightDeadzone: number;
    triggerThreshold: number;
    moveXAxis: number;
    moveYAxis: number;
    lookXAxis: number;
    lookYAxis: number;
    jumpButton: number; // A (0)
    crouchSlideButton: number; // B (1)
    reloadInteractButton: number; // X (2)
    switchWeaponButton: number; // Y (3)
    quickMeleeButton: number; // LB (4)
    adsTrigger: number; // LT (6)
    fireTrigger: number; // RT (7)
    sprintButton: number; // L3 (10)
    flashlightButtons: readonly number[]; // D-pad Up/Down/Left/Right (12..15)
  };
  keybinds: {
    forward: readonly string[];
    backward: readonly string[];
    left: readonly string[];
    right: readonly string[];
    sprint: readonly string[];
    crouch: readonly string[];
    jump: readonly string[];
    reload: readonly string[];
    interact: readonly string[];
    flashlight: readonly string[];
    quickMelee: readonly string[];
    adsToggle: readonly string[];
    switchWeapon: readonly string[];
    slots: {
      pistol9mm: string;
      futuristic: string;
      rustSmg: string;
      retroSmg: string;
      rustShotgun: string;
      sword: string;
      flashlight: string;
      unarmed: string;
    };
  };
}

export const DEFAULT_PLAYER_CONFIG: PlayerKitConfig = {
  movement: {
    walkSpeed: 3.15,
    sprintSpeed: 4.75,
    crouchSpeed: 1.9,
    adsSpeed: 1.65,
    crouchAdsSpeed: 1.32,
    jumpVelocity: 4.85,
    gravity: 14.2,
    groundAccel: 9.8,
    groundDecel: 11.8,
    airAccel: 2.75,
    airDrag: 0.65,
    standEyeHeight: 1.62,
    crouchEyeHeight: 1.04,
    slideEyeHeight: 0.86,
    footstepDistanceWalk: 1.48,
    footstepDistanceSprint: 1.92,
  },
  slide: {
    minEntrySpeed: 2.25,
    boostMultiplier: 1.48,
    minBoostSpeed: 7.65,
    maxSpeed: 8.3,
    surgeHoldSpeed: 7.9,
    surgeDuration: 0.16,
    duration: 0.92,
    minCommitTime: 0.26,
    drag: 2.2,
    minEndSpeed: 2.35,
    steerRate: 1.75,
    cooldown: 0.32,
    hopSpeedRetention: 0.94,
    hopJumpVelocity: 5.25,
    fovBonus: 10.5,
    sprintFovBonus: 3.5,
    cameraRoll: 0.082,
    cameraPitch: 0.024,
  },
  camera: {
    // High, raw, direct 1:1 turning — zero input smoothing or lag
    mouseSensitivityHip: 0.0038,
    mouseSensitivityAds: 0.0023,
    gamepadLookSpeedHip: 4.6,
    gamepadLookSpeedAds: 2.75,
    pitchMin: -1.42,
    pitchMax: 1.42,
    hipFov: 60,
    adsFov: 44,
    swordGuardFov: 55,
    flashlightFocusFov: 52,
  },
  gamepad: {
    leftDeadzone: 0.16,
    rightDeadzone: 0.10,
    triggerThreshold: 0.28,
    moveXAxis: 0,
    moveYAxis: 1,
    lookXAxis: 2,
    lookYAxis: 3,
    jumpButton: 0,
    crouchSlideButton: 1,
    reloadInteractButton: 2,
    switchWeaponButton: 3,
    quickMeleeButton: 4,
    adsTrigger: 6,
    fireTrigger: 7,
    sprintButton: 10,
    flashlightButtons: [12, 13, 14, 15],
  },
  keybinds: {
    forward: ['KeyW', 'ArrowUp'],
    backward: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
    jump: ['Space'],
    reload: ['KeyR'],
    interact: ['KeyE', 'KeyG'],
    flashlight: ['KeyF'],
    quickMelee: ['KeyV'],
    adsToggle: ['KeyQ'],
    switchWeapon: ['Tab'],
    slots: {
      pistol9mm: 'Digit1',
      futuristic: 'Digit2',
      rustSmg: 'Digit3',
      retroSmg: 'Digit4',
      rustShotgun: 'Digit5',
      sword: 'Digit6',
      flashlight: 'Digit7',
      unarmed: 'Digit8',
    },
  },
};

export function mergePlayerConfig(
  overrides?: Partial<{
    movement: Partial<PlayerKitConfig['movement']>;
    slide: Partial<PlayerKitConfig['slide']>;
    camera: Partial<PlayerKitConfig['camera']>;
    gamepad: Partial<PlayerKitConfig['gamepad']>;
    keybinds: Partial<PlayerKitConfig['keybinds']>;
  }>,
): PlayerKitConfig {
  if (!overrides) {
    return {
      movement: { ...DEFAULT_PLAYER_CONFIG.movement },
      slide: { ...DEFAULT_PLAYER_CONFIG.slide },
      camera: { ...DEFAULT_PLAYER_CONFIG.camera },
      gamepad: { ...DEFAULT_PLAYER_CONFIG.gamepad },
      keybinds: {
        ...DEFAULT_PLAYER_CONFIG.keybinds,
        slots: { ...DEFAULT_PLAYER_CONFIG.keybinds.slots },
      },
    };
  }
  return {
    movement: { ...DEFAULT_PLAYER_CONFIG.movement, ...overrides.movement },
    slide: { ...DEFAULT_PLAYER_CONFIG.slide, ...overrides.slide },
    camera: { ...DEFAULT_PLAYER_CONFIG.camera, ...overrides.camera },
    gamepad: { ...DEFAULT_PLAYER_CONFIG.gamepad, ...overrides.gamepad },
    keybinds: {
      ...DEFAULT_PLAYER_CONFIG.keybinds,
      ...overrides.keybinds,
      slots: {
        ...DEFAULT_PLAYER_CONFIG.keybinds.slots,
        ...(overrides.keybinds?.slots ?? {}),
      },
    },
  };
}
