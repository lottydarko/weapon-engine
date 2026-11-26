/**
 * STANDALONE FPS PLAYER KIT MODULE
 *
 * Self-contained first-person player controller, weapon viewmodel suite, articulated hands rig,
 * dynamic flashlight, organic handheld camera realism, and canonical sound-event bus.
 * Zero dependencies on the test room, ground pickups, enemies, audio synthesis, or React UI.
 *
 * Exposes:
 *  - `PlayerKit` / `createPlayerKit(options)` — attach to any `THREE.Scene` + `THREE.PerspectiveCamera` + DOM element
 *  - `DEFAULT_PLAYER_CONFIG`, `mergePlayerConfig`, `PlayerKitConfig` — single tuning object (speeds, slide, raw 1:1 mouse & stick sensitivities, deadzones, keybinds)
 *  - `PLAYER_KIT_SOUND_EVENTS` — canonical sound hook list (no baked audio)
 *  - `CinematicPostProcessor` — optional 60fps Gaussian directional motion blur & bloom halation pipeline
 *  - Methods: `update(dt)`, `getState()`, `getConfig()`, `setBounds(bounds)`, `setShootableMeshes(meshes)`,
 *    `requestPointerLock()`, `switchWeapon(id?)`, `fireShot()`, `triggerReload()`, `triggerInteract()`,
 *    `toggleFlashlight()`, `triggerQuickMelee()`, `onSoundEvent(cb)`, `offSoundEvent(cb)`,
 *    `onInteract(cb)`, `offInteract(cb)`, `dispose()`
 *
 * Sound Events Fired (identical across Keyboard/Mouse and Xbox Controller):
 *  `fire`, `pump`, `reload_start`, `reload_end`, `dry_fire`, `swing`, `blade_hit`,
 *  `ads_in`, `ads_out`, `weapon_raise`, `weapon_lower`, `weapon_switch`,
 *  `footstep`, `jump`, `land`, `slide`, `flashlight_on`, `flashlight_off`
 */

import * as THREE from 'three';
import {
  buildPlainFlashlight,
  createSoftFlashlightCookieTexture,
  type PlainFlashlightRig,
} from './flashlight';
import {
  buildFuturisticGun,
  type FuturisticShotgunRig,
} from './futuristicGun';
import {
  buildRealisticHands,
  type HandStance,
  type RealisticHandsRig,
} from './hands';
import { buildPistol, type PistolRig } from './pistol';
import {
  DEFAULT_PLAYER_CONFIG,
  mergePlayerConfig,
  type PlayerKitConfig,
} from './playerConfig';
import {
  buildRetroSovietSmg,
  buildRusticRussianShotgun,
  buildRusticRussianSmg,
  type RetroWeaponRig,
} from './russianWeapons';
import {
  PLAYER_KIT_SOUND_EVENTS,
  type PlayerInputSource,
  type PlayerSoundEventListener,
  type PlayerSoundEventName,
  type PlayerSoundEventPayload,
} from './soundEvents';
import { buildTacticalSword, type TacticalSwordRig } from './sword';
import type { SkinToneId } from './textures';

export {
  DEFAULT_PLAYER_CONFIG,
  mergePlayerConfig,
  PLAYER_KIT_SOUND_EVENTS,
  type PlayerKitConfig,
  type PlayerInputSource,
  type PlayerSoundEventListener,
  type PlayerSoundEventName,
  type PlayerSoundEventPayload,
};
export { CinematicPostProcessor, type CameraPostFrameParams } from './postProcess';

export type PlayerWeaponId =
  | 'pistol9mm'
  | 'futuristic'
  | 'rustSmg'
  | 'retroSmg'
  | 'rustShotgun'
  | 'sword'
  | 'flashlight'
  | 'unarmed';

export interface PlayerKitBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlayerKitState {
  weaponId: PlayerWeaponId;
  ammo: number;
  maxAmmo: number;
  isAds: boolean;
  adsBlend: number;
  isReloading: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isGrounded: boolean;
  isPointerLocked: boolean;
  flashlightOn: boolean;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** Instantaneous optical motion-blur & muzzle-flash readout for optional post-processing */
  cameraMotionX: number;
  cameraMotionY: number;
  speedBlur: number;
  flashIntensity: number;
}

export interface PlayerKitOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  maxAnisotropy?: number;
  skinTone?: SkinToneId;
  config?: Parameters<typeof mergePlayerConfig>[0];
  initialPosition?: THREE.Vector3;
  initialWeapon?: PlayerWeaponId;
  bounds?: PlayerKitBounds | null;
  shootableMeshes?: THREE.Object3D[];
  onSoundEvent?: PlayerSoundEventListener;
  onInteract?: (source: PlayerInputSource) => void;
  onStateChange?: (state: PlayerKitState) => void;
}

type WeaponHolsterZone = 'back' | 'hip' | 'chest' | 'none';

const WEAPON_ORDER: PlayerWeaponId[] = [
  'pistol9mm',
  'futuristic',
  'rustSmg',
  'retroSmg',
  'rustShotgun',
  'sword',
  'flashlight',
  'unarmed',
];

const WEAPON_MAX_AMMO: Record<PlayerWeaponId, number> = {
  pistol9mm: 15,
  futuristic: 8,
  rustSmg: 71,
  retroSmg: 30,
  rustShotgun: 6,
  sword: 0,
  flashlight: 0,
  unarmed: 0,
};

function getWeaponHolsterZone(id: PlayerWeaponId): WeaponHolsterZone {
  if (
    id === 'futuristic' ||
    id === 'rustShotgun' ||
    id === 'rustSmg' ||
    id === 'retroSmg' ||
    id === 'sword'
  ) {
    return 'back';
  }
  if (id === 'pistol9mm') return 'hip';
  if (id === 'flashlight') return 'chest';
  return 'none';
}

// Pre-allocated scratch helpers — zero GC in per-frame update
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _eulerA = new THREE.Euler(0, 0, 0, 'YXZ');

export class PlayerKit {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;
  private config: PlayerKitConfig;
  private bounds: PlayerKitBounds | null;
  private shootableMeshes: THREE.Object3D[];

  private soundListeners = new Set<PlayerSoundEventListener>();
  private interactListeners = new Set<(source: PlayerInputSource) => void>();
  private onStateChange?: (state: PlayerKitState) => void;
  private lastInputSource: PlayerInputSource = 'kbm';

  private weaponPivot: THREE.Group;
  private vmKeyLight: THREE.PointLight;
  private vmRimLight: THREE.PointLight;

  private pistol9mm: PistolRig;
  private futuristicGun: FuturisticShotgunRig;
  private rustSmg: RetroWeaponRig;
  private retroSmg: RetroWeaponRig;
  private rustShotgun: RetroWeaponRig;
  private sword: TacticalSwordRig;
  private plainFlashlight: PlainFlashlightRig;
  private hands: RealisticHandsRig;

  private flashlightSpot: THREE.SpotLight;
  private flashlightTarget: THREE.Object3D;
  private flashlightCookie: THREE.Texture;
  private flashlightOn = false;
  private flashlightClickTimer = 0;

  private activeWeaponId: PlayerWeaponId;
  private pendingWeaponId: PlayerWeaponId | null = null;
  private swapFromWeaponId: PlayerWeaponId;
  private swapTimer = 0;
  private swapDuration = 0.62;
  private swapCamRoll = 0;
  private swapCamPitch = 0;

  private ammoByWeapon: Record<PlayerWeaponId, number> = { ...WEAPON_MAX_AMMO };
  private fireCooldown = 0;
  private triggerPull = 0;
  private slidePos = 0;
  private slideHoldTimer = 0;
  private flashTimer = 0;
  private activeFlashIntensity = 0;
  private fireHeat = 0;
  private shotgunPumpTimer = -1;
  private shotgunPumpAudioPlayed = false;

  private yaw = 0;
  private pitch = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private playerPos = new THREE.Vector3(0, 1.62, 0);
  private playerEyeHeight = 1.62;
  private verticalOffset = 0;
  private verticalVel = 0;
  private isGrounded = true;
  private landDipY = 0;
  private moveVel = new THREE.Vector3();
  private walkPhase = 0;
  private footstepAccum = 0;

  private isCrouching = false;
  private isSliding = false;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideDir = new THREE.Vector3(0, 0, -1);
  private slideSpeed = 0;
  private slideBlend = 0;
  private slideLeanSign = -1;
  private sprintBlend = 0;
  private dynamicFovBonus = 0;
  private shotFovKick = 0;
  private strafeCamRoll = 0;
  private blurVelX = 0;
  private blurVelY = 0;

  private keys = new Set<string>();
  private isPointerLocked = false;
  private prevCrouchHeld = false;
  private prevJumpHeld = false;
  private lmbHeld = false;
  private rtHeld = false;
  private adsHeld = false;
  private gpAdsHeld = false;
  private adsToggled = false;
  private adsBlend = 0;
  private prevWantsAds = false;

  private gpMoveFwd = 0;
  private gpMoveRight = 0;
  private gpSprint = false;
  private gpCrouch = false;
  private gpJump = false;
  private prevRtPressed = false;
  private prevXPressed = false;
  private prevYPressed = false;
  private prevLbPressed = false;
  private prevDpadPressed = false;

  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private swayX = 0;
  private swayY = 0;

  private recoilKickZ = 0;
  private recoilKickZVel = 0;
  private recoilPitch = 0;
  private recoilPitchVel = 0;
  private recoilRoll = 0;
  private recoilRollVel = 0;
  private cameraPitchKick = 0;
  private cameraPitchKickVel = 0;
  private cameraYawKick = 0;
  private cameraRollKick = 0;
  private cameraRollKickVel = 0;
  private cameraTrauma = 0;

  private isReloading = false;
  private reloadStartedEmpty = false;
  private reloadTime = 0;
  private reloadCamRoll = 0;
  private reloadCamPitch = 0;
  private leftHandRestPos = new THREE.Vector3();
  private leftHandRestQuat = new THREE.Quaternion();
  private reloadMagQuat = new THREE.Quaternion();
  private reloadOverhandQuat = new THREE.Quaternion();
  private reloadShellQuat = new THREE.Quaternion();

  private swordSwingActive = false;
  private swordSwingTime = 0;
  private swordSwingDuration = 0.46;
  private swordComboStep = 0;
  private swordComboQueued = false;
  private swordComboResetTimer = 0;
  private swordHitChecked = false;
  private swordCamRoll = 0;
  private swordCamPitch = 0;

  private quickMeleeActive = false;
  private quickMeleeTime = 0;
  private quickMeleeReturnWeapon: PlayerWeaponId = 'pistol9mm';
  private quickMeleeHitChecked = false;

  private raycaster = new THREE.Raycaster();
  private screenCenter = new THREE.Vector2(0, 0);
  private elapsed = 0;
  private stateEmitAccum = 0;
  private disposed = false;

  constructor(options: PlayerKitOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.config = mergePlayerConfig(options.config);
    this.bounds = options.bounds ?? null;
    this.shootableMeshes = options.shootableMeshes ?? [];
    this.onStateChange = options.onStateChange;

    if (options.onSoundEvent) this.soundListeners.add(options.onSoundEvent);
    if (options.onInteract) this.interactListeners.add(options.onInteract);

    this.playerEyeHeight = this.config.movement.standEyeHeight;
    if (options.initialPosition) {
      this.playerPos.copy(options.initialPosition);
    } else {
      this.playerPos.set(0, this.playerEyeHeight, 0);
    }

    this.camera.rotation.order = 'YXZ';
    this.camera.fov = this.config.camera.hipFov;
    this.camera.updateProjectionMatrix();
    if (!this.camera.parent) {
      this.scene.add(this.camera);
    }

    const maxAniso = options.maxAnisotropy ?? 4;
    const tone = options.skinTone ?? 'medium';

    this.flashlightCookie = createSoftFlashlightCookieTexture();
    this.flashlightSpot = new THREE.SpotLight(0xfff6e8, 0, 30, 0.78, 0.92, 1.15);
    this.flashlightSpot.map = this.flashlightCookie;
    this.flashlightSpot.castShadow = false;
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlightSpot);
    this.scene.add(this.flashlightTarget);
    this.flashlightSpot.target = this.flashlightTarget;

    this.weaponPivot = new THREE.Group();
    this.weaponPivot.name = 'PlayerKitWeaponPivot';
    this.camera.add(this.weaponPivot);

    this.vmKeyLight = new THREE.PointLight(0xfff4e4, 0.62, 1.25, 2);
    this.vmKeyLight.position.set(-0.26, 0.24, -0.06);
    this.camera.add(this.vmKeyLight);

    this.vmRimLight = new THREE.PointLight(0xcbe0ff, 0.48, 1.25, 2);
    this.vmRimLight.position.set(0.30, 0.16, -0.34);
    this.camera.add(this.vmRimLight);

    this.pistol9mm = buildPistol(maxAniso);
    this.futuristicGun = buildFuturisticGun(maxAniso);
    this.rustSmg = buildRusticRussianSmg(maxAniso);
    this.retroSmg = buildRetroSovietSmg(maxAniso);
    this.rustShotgun = buildRusticRussianShotgun(maxAniso);
    this.sword = buildTacticalSword(maxAniso);
    this.plainFlashlight = buildPlainFlashlight(maxAniso);
    this.hands = buildRealisticHands(tone, maxAniso);

    this.weaponPivot.add(
      this.pistol9mm.root,
      this.futuristicGun.root,
      this.rustSmg.root,
      this.retroSmg.root,
      this.rustShotgun.root,
      this.sword.root,
      this.plainFlashlight.root,
      this.hands.root,
    );

    this.activeWeaponId = options.initialWeapon ?? 'pistol9mm';
    this.swapFromWeaponId = this.activeWeaponId;
    this.applyVisibleWeaponRig(this.activeWeaponId);
    this.hands.getReloadHandQuat('magGrip', this.reloadMagQuat);
    this.hands.getReloadHandQuat('overhandPinch', this.reloadOverhandQuat);
    this.hands.getReloadHandQuat('shellFeed', this.reloadShellQuat);

    this.bindEvents();
  }

  /** Optional Layer isolation helper for host renderers that render World (0) -> clearDepth -> Viewmodel (1). */
  public setViewmodelLayer(layer: number) {
    this.weaponPivot.traverse((child) => {
      if ((child as THREE.Light).isLight) {
        child.layers.enable(0);
        child.layers.enable(layer);
      } else {
        child.layers.set(layer);
      }
    });
    this.vmKeyLight.layers.enable(0);
    this.vmKeyLight.layers.enable(layer);
    this.vmRimLight.layers.enable(0);
    this.vmRimLight.layers.enable(layer);
    this.flashlightSpot.layers.enable(0);
    this.flashlightSpot.layers.enable(layer);
  }

  private get ammo(): number {
    return this.ammoByWeapon[this.activeWeaponId];
  }
  private set ammo(val: number) {
    this.ammoByWeapon[this.activeWeaponId] = val;
  }
  private get maxAmmo(): number {
    return WEAPON_MAX_AMMO[this.activeWeaponId];
  }

  private getFirearmRig(): PistolRig | null {
    switch (this.activeWeaponId) {
      case 'pistol9mm':
        return this.pistol9mm;
      case 'futuristic':
        return this.futuristicGun;
      case 'rustSmg':
        return this.rustSmg;
      case 'retroSmg':
        return this.retroSmg;
      case 'rustShotgun':
        return this.rustShotgun;
      default:
        return null;
    }
  }

  private getStanceForWeapon(id: PlayerWeaponId): HandStance {
    if (id === 'unarmed') return 'unarmed';
    if (id === 'sword') return 'sword';
    if (id === 'flashlight') return 'flashlight';
    if (id === 'futuristic' || id === 'rustShotgun') return 'shotgun';
    if (id === 'rustSmg' || id === 'retroSmg') return 'smg';
    return 'pistol';
  }

  private applyVisibleWeaponRig(id: PlayerWeaponId) {
    this.pistol9mm.root.visible = id === 'pistol9mm';
    this.futuristicGun.root.visible = id === 'futuristic';
    this.rustSmg.root.visible = id === 'rustSmg';
    this.retroSmg.root.visible = id === 'retroSmg';
    this.rustShotgun.root.visible = id === 'rustShotgun';
    this.sword.root.visible = id === 'sword';
    this.plainFlashlight.root.visible = id === 'flashlight';

    this.pistol9mm.setMuzzleFlash(0);
    this.futuristicGun.setMuzzleFlash(0);
    this.rustSmg.setMuzzleFlash(0);
    this.retroSmg.setMuzzleFlash(0);
    this.rustShotgun.setMuzzleFlash(0);
    this.pistol9mm.setFlashlightOn(this.flashlightOn && id === 'pistol9mm');
    this.futuristicGun.setFlashlightOn(this.flashlightOn && id === 'futuristic');
    this.rustSmg.setFlashlightOn(this.flashlightOn && id === 'rustSmg');
    this.retroSmg.setFlashlightOn(this.flashlightOn && id === 'retroSmg');
    this.rustShotgun.setFlashlightOn(this.flashlightOn && id === 'rustShotgun');
    this.plainFlashlight.setOn(this.flashlightOn && id === 'flashlight');

    this.hands.setStance(this.getStanceForWeapon(id));
    this.hands.getLeftHandRestPose(this.leftHandRestPos, this.leftHandRestQuat);
    this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
    this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
    this.hands.resetLeftElbowPose();
    this.hands.resetRightElbowPose();
    this.hands.setLeftHandReloadPose(0, 0);
  }

  private emitSoundEvent(
    event: PlayerSoundEventName,
    source: PlayerInputSource = this.lastInputSource,
    intensity = 1,
  ) {
    if (this.soundListeners.size === 0) return;
    const payload: PlayerSoundEventPayload = {
      event,
      weaponId: this.activeWeaponId,
      inputSource: source,
      intensity,
      timestamp: this.elapsed,
    };
    for (const cb of this.soundListeners) cb(payload);
  }

  private hasBoundKey(codes: readonly string[]): boolean {
    for (let i = 0; i < codes.length; i++) {
      if (this.keys.has(codes[i])) return true;
    }
    return false;
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  public getConfig(): PlayerKitConfig {
    return this.config;
  }

  public setBounds(bounds: PlayerKitBounds | null) {
    this.bounds = bounds;
  }

  public setShootableMeshes(meshes: THREE.Object3D[]) {
    this.shootableMeshes = meshes;
  }

  public requestPointerLock() {
    if (document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock?.();
    }
  }

  public onSoundEvent(listener: PlayerSoundEventListener) {
    this.soundListeners.add(listener);
  }

  public offSoundEvent(listener: PlayerSoundEventListener) {
    this.soundListeners.delete(listener);
  }

  public onInteract(listener: (source: PlayerInputSource) => void) {
    this.interactListeners.add(listener);
  }

  public offInteract(listener: (source: PlayerInputSource) => void) {
    this.interactListeners.delete(listener);
  }

  public getState(): PlayerKitState {
    return {
      weaponId: this.activeWeaponId,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      isAds: this.adsBlend > 0.45,
      adsBlend: this.adsBlend,
      isReloading: this.isReloading,
      isSprinting: this.sprintBlend > 0.35,
      isCrouching: this.isCrouching,
      isSliding: this.isSliding,
      isGrounded: this.isGrounded,
      isPointerLocked: this.isPointerLocked,
      flashlightOn: this.flashlightOn,
      position: this.playerPos.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      cameraMotionX: this.blurVelX,
      cameraMotionY: this.blurVelY,
      speedBlur: THREE.MathUtils.clamp(
        this.slideBlend * 0.85 + this.sprintBlend * 0.28,
        0,
        1,
      ),
      flashIntensity: this.activeFlashIntensity,
    };
  }

  public triggerInteract(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    for (const cb of this.interactListeners) cb(source);
  }

  public toggleFlashlight(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    this.flashlightOn = !this.flashlightOn;
    this.flashlightClickTimer = 0.18;
    this.pistol9mm.setFlashlightOn(
      this.flashlightOn && this.activeWeaponId === 'pistol9mm',
    );
    this.futuristicGun.setFlashlightOn(
      this.flashlightOn && this.activeWeaponId === 'futuristic',
    );
    this.rustSmg.setFlashlightOn(
      this.flashlightOn && this.activeWeaponId === 'rustSmg',
    );
    this.retroSmg.setFlashlightOn(
      this.flashlightOn && this.activeWeaponId === 'retroSmg',
    );
    this.rustShotgun.setFlashlightOn(
      this.flashlightOn && this.activeWeaponId === 'rustShotgun',
    );
    this.plainFlashlight.setOn(
      this.flashlightOn && this.activeWeaponId === 'flashlight',
    );
    this.emitSoundEvent(
      this.flashlightOn ? 'flashlight_on' : 'flashlight_off',
      source,
    );
  }

  public switchWeapon(
    target?: PlayerWeaponId,
    source: PlayerInputSource = this.lastInputSource,
  ) {
    this.lastInputSource = source;
    if (this.quickMeleeActive) return;
    const current = this.pendingWeaponId ?? this.activeWeaponId;
    const next: PlayerWeaponId =
      target ??
      WEAPON_ORDER[(WEAPON_ORDER.indexOf(current) + 1) % WEAPON_ORDER.length];
    if (next === this.activeWeaponId && !this.pendingWeaponId) return;

    this.isReloading = false;
    this.reloadTime = 0;
    this.shotgunPumpTimer = -1;
    this.swordSwingActive = false;
    this.swordComboQueued = false;
    this.adsToggled = false;
    this.lmbHeld = false;
    this.rtHeld = false;
    this.swapFromWeaponId = this.activeWeaponId;
    this.pendingWeaponId = next;
    this.swapTimer = 0.001;
    const fromBig = getWeaponHolsterZone(this.swapFromWeaponId) === 'back';
    const toBig = getWeaponHolsterZone(next) === 'back';
    this.swapDuration = fromBig || toBig ? 0.66 : 0.48;
    this.emitSoundEvent('weapon_lower', source);
  }

  public triggerQuickMelee(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.quickMeleeActive || this.pendingWeaponId) return;
    if (this.activeWeaponId === 'sword') {
      this.fireShot(source);
      return;
    }
    this.isReloading = false;
    this.reloadTime = 0;
    this.shotgunPumpTimer = -1;
    this.adsToggled = false;
    this.lmbHeld = false;
    this.quickMeleeReturnWeapon = this.activeWeaponId;
    this.quickMeleeActive = true;
    this.quickMeleeTime = 0;
    this.quickMeleeHitChecked = false;
    this.activeWeaponId = 'sword';
    this.applyVisibleWeaponRig('sword');
    this.emitSoundEvent('swing', source, 1.0);
  }

  public triggerReload(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.isReloading || this.pendingWeaponId || this.quickMeleeActive) return;
    if (this.activeWeaponId === 'unarmed') return;
    if (
      this.activeWeaponId !== 'sword' &&
      this.activeWeaponId !== 'flashlight' &&
      this.ammo >= this.maxAmmo
    ) {
      return;
    }
    this.isReloading = true;
    this.reloadStartedEmpty = this.ammo === 0;
    this.reloadTime = 0;
    this.adsToggled = false;
    this.shotgunPumpTimer = -1;
    if (this.activeWeaponId !== 'sword' && this.activeWeaponId !== 'flashlight') {
      this.emitSoundEvent('reload_start', source);
    }
  }

  public fireShot(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.pendingWeaponId || this.quickMeleeActive) return;
    if (this.activeWeaponId === 'unarmed') return;

    if (this.activeWeaponId === 'flashlight') {
      this.toggleFlashlight(source);
      return;
    }

    if (this.activeWeaponId === 'sword') {
      if (this.swordSwingActive) {
        if (this.swordSwingTime > this.swordSwingDuration * 0.34) {
          this.swordComboQueued = true;
        }
        return;
      }
      this.swordSwingActive = true;
      this.swordSwingTime = 0;
      this.swordHitChecked = false;
      this.swordComboStep = this.swordComboResetTimer > 0 ? (this.swordComboStep + 1) % 3 : 0;
      this.swordComboResetTimer = 0.85;
      this.swordSwingDuration = this.swordComboStep === 2 ? 0.50 : 0.42;
      this.emitSoundEvent('swing', source, this.swordComboStep === 2 ? 1.0 : 0.85);
      return;
    }

    if (this.isReloading || this.fireCooldown > 0) return;

    if (this.ammo <= 0) {
      this.triggerPull = 1;
      this.fireCooldown = 0.16;
      this.emitSoundEvent('dry_fire', source);
      return;
    }

    const isVx9 = this.activeWeaponId === 'futuristic';
    const isKs23 = this.activeWeaponId === 'rustShotgun';
    const isShotgun = isVx9 || isKs23;
    const isSmg =
      this.activeWeaponId === 'rustSmg' || this.activeWeaponId === 'retroSmg';
    const adsDamp = THREE.MathUtils.lerp(1.0, 0.62, this.adsBlend);

    this.ammo = Math.max(0, this.ammo - 1);
    this.triggerPull = 1;
    this.slidePos = 0.068;
    this.slideHoldTimer = isShotgun ? 0.05 : 0.03;

    if (isShotgun) {
      this.fireCooldown = isKs23 ? 0.70 : 0.62;
      this.flashTimer = isKs23 ? 0.092 : 0.082;
      this.fireHeat = Math.min(1, this.fireHeat + (isKs23 ? 0.78 : 0.72));
      this.shotgunPumpTimer = 0;
      this.shotgunPumpAudioPlayed = false;

      const kickMult = isKs23 ? 1.24 : 1.08;
      this.recoilKickZVel += 1.65 * adsDamp * kickMult;
      this.recoilPitchVel += 4.95 * adsDamp * kickMult;
      this.recoilRollVel += (Math.random() - 0.5) * 4.4 * adsDamp * kickMult;
      this.cameraPitchKickVel += (1.92 + Math.random() * 0.36) * adsDamp * kickMult;
      this.cameraYawKick += (Math.random() - 0.5) * 0.036 * adsDamp * kickMult;
      this.cameraRollKickVel +=
        (Math.random() < 0.5 ? -1 : 1) * (1.28 + Math.random() * 0.45) * adsDamp * kickMult;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.88 * kickMult);
      this.shotFovKick = Math.min(5.2, this.shotFovKick + 3.4 * kickMult);
    } else if (isSmg) {
      this.fireCooldown = this.activeWeaponId === 'rustSmg' ? 0.078 : 0.094;
      this.flashTimer = 0.056;
      this.fireHeat = Math.min(1, this.fireHeat + 0.24);
      this.recoilKickZVel += 0.82 * adsDamp;
      this.recoilPitchVel += 2.65 * adsDamp;
      this.recoilRollVel += (Math.random() - 0.5) * 3.0 * adsDamp;
      this.cameraPitchKickVel += (0.82 + Math.random() * 0.24) * adsDamp;
      this.cameraYawKick += (Math.random() - 0.5) * 0.022 * adsDamp;
      this.cameraRollKickVel += (Math.random() - 0.5) * 1.15 * adsDamp;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.46);
      this.shotFovKick = Math.min(3.8, this.shotFovKick + 1.38);
    } else {
      this.fireCooldown = 0.12;
      this.flashTimer = 0.06;
      this.recoilKickZVel += 1.08 * adsDamp;
      this.recoilPitchVel += 3.65 * adsDamp;
      this.recoilRollVel += (Math.random() - 0.5) * 3.2 * adsDamp;
      this.cameraPitchKickVel += (1.18 + Math.random() * 0.25) * adsDamp;
      this.cameraYawKick += (Math.random() - 0.5) * 0.020 * adsDamp;
      this.cameraRollKickVel +=
        (Math.random() < 0.5 ? -1 : 1) * (0.68 + Math.random() * 0.28) * adsDamp;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.54);
      this.shotFovKick = Math.min(3.6, this.shotFovKick + 1.65);
    }

    this.emitSoundEvent('fire', source, isShotgun ? 1.0 : 0.85);
  }

  // =========================================================================
  // INPUT LISTENERS (KB/M + Xbox Controller live simultaneously)
  // =========================================================================
  private onPointerLockChange = () => {
    this.isPointerLocked = document.pointerLockElement === this.domElement;
    if (!this.isPointerLocked) {
      this.adsHeld = false;
      this.lmbHeld = false;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked) return;
    this.lastInputSource = 'kbm';
    const sens = THREE.MathUtils.lerp(
      this.config.camera.mouseSensitivityHip,
      this.config.camera.mouseSensitivityAds,
      this.adsBlend,
    );
    this.yaw -= e.movementX * sens;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - e.movementY * sens,
      this.config.camera.pitchMin,
      this.config.camera.pitchMax,
    );
    this.mouseDeltaX += e.movementX;
    this.mouseDeltaY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent) => {
    this.lastInputSource = 'kbm';
    if (!this.isPointerLocked) {
      this.requestPointerLock();
      return;
    }
    if (e.button === 0) {
      this.lmbHeld = true;
      this.fireShot('kbm');
    } else if (e.button === 2) {
      this.adsHeld = true;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.lmbHeld = false;
    else if (e.button === 2) this.adsHeld = false;
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    this.lastInputSource = 'kbm';
    const kb = this.config.keybinds;
    this.keys.add(e.code);

    if (kb.reload.includes(e.code)) this.triggerReload('kbm');
    else if (kb.interact.includes(e.code)) this.triggerInteract('kbm');
    else if (kb.flashlight.includes(e.code)) this.toggleFlashlight('kbm');
    else if (kb.quickMelee.includes(e.code)) this.triggerQuickMelee('kbm');
    else if (kb.adsToggle.includes(e.code)) this.adsToggled = !this.adsToggled;
    else if (kb.switchWeapon.includes(e.code)) {
      e.preventDefault();
      this.switchWeapon(undefined, 'kbm');
    } else if (e.code === kb.slots.pistol9mm) this.switchWeapon('pistol9mm', 'kbm');
    else if (e.code === kb.slots.futuristic) this.switchWeapon('futuristic', 'kbm');
    else if (e.code === kb.slots.rustSmg) this.switchWeapon('rustSmg', 'kbm');
    else if (e.code === kb.slots.retroSmg) this.switchWeapon('retroSmg', 'kbm');
    else if (e.code === kb.slots.rustShotgun) this.switchWeapon('rustShotgun', 'kbm');
    else if (e.code === kb.slots.sword) this.switchWeapon('sword', 'kbm');
    else if (e.code === kb.slots.flashlight) this.switchWeapon('flashlight', 'kbm');
    else if (e.code === kb.slots.unarmed) this.switchWeapon('unarmed', 'kbm');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.adsHeld = false;
    this.lmbHeld = false;
  };

  private bindEvents() {
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private unbindEvents() {
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private pollGamepad(dt: number) {
    const pads = navigator.getGamepads?.();
    if (!pads) {
      this.gpAdsHeld = false;
      this.rtHeld = false;
      return;
    }
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) {
        pad = pads[i];
        break;
      }
    }
    if (!pad) {
      this.gpAdsHeld = false;
      this.rtHeld = false;
      return;
    }

    const gp = this.config.gamepad;
    const rawRx = pad.axes[gp.lookXAxis] ?? 0;
    const rawRy = pad.axes[gp.lookYAxis] ?? 0;
    const rDz = gp.rightDeadzone;
    const rx =
      Math.abs(rawRx) > rDz
        ? Math.sign(rawRx) * ((Math.abs(rawRx) - rDz) / (1 - rDz))
        : 0;
    const ry =
      Math.abs(rawRy) > rDz
        ? Math.sign(rawRy) * ((Math.abs(rawRy) - rDz) / (1 - rDz))
        : 0;

    if (rx !== 0 || ry !== 0) {
      this.lastInputSource = 'gamepad';
      const lookSpeed = THREE.MathUtils.lerp(
        this.config.camera.gamepadLookSpeedHip,
        this.config.camera.gamepadLookSpeedAds,
        this.adsBlend,
      );
      this.yaw -= rx * lookSpeed * dt;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - ry * lookSpeed * dt,
        this.config.camera.pitchMin,
        this.config.camera.pitchMax,
      );
      this.mouseDeltaX += rx * 20;
      this.mouseDeltaY += ry * 20;
    }

    const rawLx = pad.axes[gp.moveXAxis] ?? 0;
    const rawLy = pad.axes[gp.moveYAxis] ?? 0;
    const lDz = gp.leftDeadzone;
    this.gpMoveRight =
      Math.abs(rawLx) > lDz
        ? Math.sign(rawLx) * ((Math.abs(rawLx) - lDz) / (1 - lDz))
        : 0;
    this.gpMoveFwd =
      Math.abs(rawLy) > lDz
        ? -Math.sign(rawLy) * ((Math.abs(rawLy) - lDz) / (1 - lDz))
        : 0;
    this.gpSprint =
      Boolean(pad.buttons[gp.sprintButton]?.pressed) || rawLy < -0.82;

    const aPressed = Boolean(pad.buttons[gp.jumpButton]?.pressed);
    const bPressed = Boolean(pad.buttons[gp.crouchSlideButton]?.pressed);
    const xPressed = Boolean(pad.buttons[gp.reloadInteractButton]?.pressed);
    const yPressed = Boolean(pad.buttons[gp.switchWeaponButton]?.pressed);
    const lbPressed = Boolean(pad.buttons[gp.quickMeleeButton]?.pressed);
    const ltVal = pad.buttons[gp.adsTrigger]?.value ?? 0;
    const rtPressed =
      (pad.buttons[gp.fireTrigger]?.value ?? 0) > gp.triggerThreshold;

    let dpadPressed = false;
    for (let i = 0; i < gp.flashlightButtons.length; i++) {
      if (pad.buttons[gp.flashlightButtons[i]]?.pressed) {
        dpadPressed = true;
        break;
      }
    }

    this.gpJump = aPressed;
    this.gpCrouch = bPressed;
    this.gpAdsHeld = ltVal > gp.triggerThreshold;

    this.rtHeld = rtPressed;
    if (rtPressed && !this.prevRtPressed) this.fireShot('gamepad');
    this.prevRtPressed = rtPressed;

    if (dpadPressed && !this.prevDpadPressed) this.toggleFlashlight('gamepad');
    this.prevDpadPressed = dpadPressed;

    if (lbPressed && !this.prevLbPressed) this.triggerQuickMelee('gamepad');
    this.prevLbPressed = lbPressed;

    if (xPressed && !this.prevXPressed) {
      if (this.interactListeners.size > 0 && this.ammo >= this.maxAmmo) {
        this.triggerInteract('gamepad');
      } else {
        this.triggerReload('gamepad');
      }
    }
    this.prevXPressed = xPressed;

    if (yPressed && !this.prevYPressed) this.switchWeapon(undefined, 'gamepad');
    this.prevYPressed = yPressed;
  }

  private checkBladeHit(source: PlayerInputSource) {
    if (this.shootableMeshes.length === 0) return;
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    this.raycaster.far = 2.4;
    const hits = this.raycaster.intersectObjects(this.shootableMeshes, true);
    if (hits.length > 0) {
      this.emitSoundEvent('blade_hit', source, 1.0);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.25);
    }
    this.raycaster.far = Infinity;
  }

  // =========================================================================
  // MAIN PER-FRAME UPDATE (call from your game loop with delta seconds)
  // =========================================================================
  public update(rawDt: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.elapsed += dt;

    const mv = this.config.movement;
    const sl = this.config.slide;
    const kb = this.config.keybinds;

    this.gpMoveFwd = 0;
    this.gpMoveRight = 0;
    this.gpSprint = false;
    this.gpCrouch = false;
    this.gpJump = false;
    this.pollGamepad(dt);

    let moveFwd = this.gpMoveFwd;
    let moveRight = this.gpMoveRight;
    if (this.hasBoundKey(kb.forward)) moveFwd += 1;
    if (this.hasBoundKey(kb.backward)) moveFwd -= 1;
    if (this.hasBoundKey(kb.right)) moveRight += 1;
    if (this.hasBoundKey(kb.left)) moveRight -= 1;
    moveFwd = THREE.MathUtils.clamp(moveFwd, -1, 1);
    moveRight = THREE.MathUtils.clamp(moveRight, -1, 1);

    const crouchHeld = this.hasBoundKey(kb.crouch) || this.gpCrouch;
    const crouchJustPressed = crouchHeld && !this.prevCrouchHeld;
    this.prevCrouchHeld = crouchHeld;

    const jumpHeld = this.hasBoundKey(kb.jump) || this.gpJump;
    const jumpJustPressed = jumpHeld && !this.prevJumpHeld;
    this.prevJumpHeld = jumpHeld;

    const moveSource: PlayerInputSource =
      this.gpCrouch ||
      this.gpJump ||
      this.gpSprint ||
      Math.abs(this.gpMoveFwd) > 0.01 ||
      Math.abs(this.gpMoveRight) > 0.01
        ? 'gamepad'
        : 'kbm';

    if (this.slideCooldown > 0) {
      this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    }

    _vecA.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _vecB.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const horizSpeed = Math.hypot(this.moveVel.x, this.moveVel.z);
    const shiftHeld = this.hasBoundKey(kb.sprint) || this.gpSprint;
    const isSprinting =
      shiftHeld &&
      this.adsBlend < 0.25 &&
      moveFwd > 0.1 &&
      !this.isCrouching &&
      !this.isSliding;

    const startSlide = (entrySpeed: number, src: PlayerInputSource) => {
      this.isSliding = true;
      this.isCrouching = true;
      this.slideTimer = 0;
      if (entrySpeed > 0.4) {
        this.slideDir.set(this.moveVel.x / entrySpeed, 0, this.moveVel.z / entrySpeed);
        this.slideDir.addScaledVector(_vecA, 0.26).normalize();
      } else {
        this.slideDir.copy(_vecA);
      }
      this.slideSpeed = THREE.MathUtils.clamp(
        Math.max(entrySpeed * sl.boostMultiplier, sl.minBoostSpeed),
        sl.minBoostSpeed * 0.88,
        sl.maxSpeed,
      );
      this.slideLeanSign = moveRight > 0.15 ? 1 : moveRight < -0.15 ? -1 : -1;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
      this.recoilRollVel += this.slideLeanSign * 1.4;
      this.emitSoundEvent('slide', src, 1.0);
    };

    if (
      crouchJustPressed &&
      this.isGrounded &&
      !this.isSliding &&
      this.slideCooldown <= 0 &&
      (shiftHeld || horizSpeed >= mv.walkSpeed * 1.06) &&
      horizSpeed >= sl.minEntrySpeed
    ) {
      startSlide(horizSpeed, this.gpCrouch ? 'gamepad' : 'kbm');
    }

    if (jumpJustPressed && this.isGrounded) {
      const fromSlide = this.isSliding;
      const jumpSrc: PlayerInputSource = this.gpJump ? 'gamepad' : 'kbm';
      if (fromSlide) {
        this.isSliding = false;
        this.isCrouching = false;
        this.slideCooldown = sl.cooldown;
        const hopSpeed = THREE.MathUtils.clamp(
          this.slideSpeed * sl.hopSpeedRetention + 0.35,
          mv.sprintSpeed * 1.1,
          sl.maxSpeed * 0.96,
        );
        this.moveVel.x = this.slideDir.x * hopSpeed;
        this.moveVel.z = this.slideDir.z * hopSpeed;
      }
      this.isGrounded = false;
      this.verticalVel = fromSlide ? sl.hopJumpVelocity : mv.jumpVelocity;
      this.cameraPitchKick -= fromSlide ? 0.014 : 0.008;
      this.emitSoundEvent('jump', jumpSrc, fromSlide ? 1.0 : 0.75);
    }

    if (this.isSliding) {
      this.slideTimer += dt;
      _vecC.copy(_vecA).multiplyScalar(0.85).addScaledVector(_vecB, moveRight * 0.55);
      if (_vecC.lengthSq() > 0.001) {
        _vecC.normalize();
        this.slideDir.lerp(_vecC, 1 - Math.exp(-sl.steerRate * dt)).normalize();
      }
      if (this.slideTimer < sl.surgeDuration) {
        this.slideSpeed = THREE.MathUtils.damp(this.slideSpeed, sl.surgeHoldSpeed, 5.5, dt);
      } else {
        this.slideSpeed = THREE.MathUtils.damp(this.slideSpeed, 1.45, sl.drag, dt);
      }
      this.moveVel.x = this.slideDir.x * this.slideSpeed;
      this.moveVel.z = this.slideDir.z * this.slideSpeed;
      const releasedEarly = !crouchHeld && this.slideTimer >= sl.minCommitTime;
      if (
        this.slideTimer >= sl.duration ||
        this.slideSpeed <= sl.minEndSpeed ||
        releasedEarly
      ) {
        this.isSliding = false;
        this.slideCooldown = sl.cooldown;
        this.isCrouching = crouchHeld;
      }
    } else {
      if (this.isGrounded) this.isCrouching = crouchHeld;
      const maxSpeed = this.isCrouching
        ? THREE.MathUtils.lerp(mv.crouchSpeed, mv.crouchAdsSpeed, this.adsBlend)
        : isSprinting
          ? mv.sprintSpeed
          : THREE.MathUtils.lerp(mv.walkSpeed, mv.adsSpeed, this.adsBlend);
      _vecC.set(0, 0, 0);
      const hasInput = Math.abs(moveFwd) > 0.01 || Math.abs(moveRight) > 0.01;
      if (hasInput) {
        _vecC.addScaledVector(_vecA, moveFwd).addScaledVector(_vecB, moveRight);
        if (_vecC.lengthSq() > 1) _vecC.normalize();
        _vecC.multiplyScalar(maxSpeed);
      }
      const accel = this.isGrounded
        ? hasInput
          ? mv.groundAccel
          : mv.groundDecel
        : hasInput
          ? mv.airAccel
          : mv.airDrag;
      this.moveVel.x = THREE.MathUtils.damp(this.moveVel.x, _vecC.x, accel, dt);
      this.moveVel.z = THREE.MathUtils.damp(this.moveVel.z, _vecC.z, accel, dt);
    }

    const prevX = this.playerPos.x;
    const prevZ = this.playerPos.z;
    let nextX = this.playerPos.x + this.moveVel.x * dt;
    let nextZ = this.playerPos.z + this.moveVel.z * dt;
    if (this.bounds) {
      nextX = THREE.MathUtils.clamp(nextX, this.bounds.minX, this.bounds.maxX);
      nextZ = THREE.MathUtils.clamp(nextZ, this.bounds.minZ, this.bounds.maxZ);
    }
    this.playerPos.x = nextX;
    this.playerPos.z = nextZ;

    const frameDist = Math.hypot(nextX - prevX, nextZ - prevZ);
    if (this.isGrounded && !this.isSliding && frameDist > 0.001) {
      const stride = isSprinting ? mv.footstepDistanceSprint : mv.footstepDistanceWalk;
      this.footstepAccum += frameDist;
      if (this.footstepAccum >= stride) {
        this.footstepAccum -= stride;
        this.emitSoundEvent(
          'footstep',
          moveSource,
          isSprinting ? 1.0 : this.isCrouching ? 0.35 : 0.68,
        );
      }
    } else if (!this.isGrounded || this.isSliding) {
      this.footstepAccum = 0;
    }

    if (!this.isGrounded) {
      this.verticalVel -= mv.gravity * dt;
      this.verticalOffset += this.verticalVel * dt;
      if (this.verticalOffset <= 0) {
        const impact = Math.min(1, Math.abs(this.verticalVel) / 6.2);
        this.verticalOffset = 0;
        this.verticalVel = 0;
        this.isGrounded = true;
        this.landDipY = -0.095 * impact;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.30 * impact);
        this.recoilPitchVel -= 1.15 * impact;
        this.emitSoundEvent('land', moveSource, impact);
        const landSpeed = Math.hypot(this.moveVel.x, this.moveVel.z);
        if (crouchHeld && landSpeed >= mv.walkSpeed * 1.06 && this.slideCooldown <= 0) {
          startSlide(landSpeed, this.gpCrouch ? 'gamepad' : 'kbm');
        }
      }
    }

    const targetEyeHeight = this.isSliding
      ? mv.slideEyeHeight
      : this.isCrouching
        ? mv.crouchEyeHeight
        : mv.standEyeHeight;
    this.playerEyeHeight = THREE.MathUtils.damp(
      this.playerEyeHeight,
      targetEyeHeight,
      this.isSliding ? 15.5 : 10.5,
      dt,
    );
    this.landDipY = THREE.MathUtils.damp(this.landDipY, 0, 12.5, dt);
    this.playerPos.y = this.playerEyeHeight + this.verticalOffset;

    this.slideBlend = THREE.MathUtils.damp(
      this.slideBlend,
      this.isSliding ? 1 : 0,
      this.isSliding ? 14.0 : 8.5,
      dt,
    );
    this.sprintBlend = THREE.MathUtils.damp(
      this.sprintBlend,
      isSprinting && this.isGrounded && horizSpeed > mv.walkSpeed * 1.02 ? 1 : 0,
      8.0,
      dt,
    );

    const speedRatio = Math.min(
      1.35,
      Math.hypot(this.moveVel.x, this.moveVel.z) / mv.walkSpeed,
    );
    if (this.isGrounded && !this.isSliding && speedRatio > 0.04) {
      this.walkPhase += dt * (6.4 + speedRatio * 3.2);
    }

    // Full-auto firing for PP-41 & AK-74M
    if (
      (this.lmbHeld || this.rtHeld) &&
      (this.activeWeaponId === 'rustSmg' || this.activeWeaponId === 'retroSmg') &&
      this.fireCooldown <= 0 &&
      !this.isReloading &&
      !this.quickMeleeActive &&
      !this.pendingWeaponId &&
      this.ammo > 0
    ) {
      this.fireShot(this.rtHeld ? 'gamepad' : 'kbm');
    }

    const isSword = this.activeWeaponId === 'sword';
    const isFlashlight = this.activeWeaponId === 'flashlight';
    const isUnarmed = this.activeWeaponId === 'unarmed';
    const isPistol = this.activeWeaponId === 'pistol9mm';
    const isVx9 = this.activeWeaponId === 'futuristic';
    const isKs23 = this.activeWeaponId === 'rustShotgun';
    const isShotgun = isVx9 || isKs23;
    const gunRig = this.getFirearmRig();

    const wantsAds =
      !isUnarmed &&
      !this.isReloading &&
      !this.pendingWeaponId &&
      !this.swordSwingActive &&
      !this.quickMeleeActive &&
      (this.adsHeld || this.gpAdsHeld || this.adsToggled);
    if (wantsAds !== this.prevWantsAds) {
      this.prevWantsAds = wantsAds;
      this.emitSoundEvent(
        wantsAds ? 'ads_in' : 'ads_out',
        this.gpAdsHeld ? 'gamepad' : 'kbm',
      );
    }
    this.adsBlend = THREE.MathUtils.damp(
      this.adsBlend,
      wantsAds ? 1 : 0,
      wantsAds ? 16.5 : 13.0,
      dt,
    );

    const zoomedFov = isSword
      ? this.config.camera.swordGuardFov
      : isFlashlight
        ? this.config.camera.flashlightFocusFov
        : this.config.camera.adsFov;
    const targetFovBonus =
      (this.slideBlend * sl.fovBonus + this.sprintBlend * sl.sprintFovBonus) *
      (1 - this.adsBlend * 0.78);
    this.dynamicFovBonus = THREE.MathUtils.damp(
      this.dynamicFovBonus,
      targetFovBonus,
      10,
      dt,
    );
    this.shotFovKick = THREE.MathUtils.damp(this.shotFovKick, 0, 26, dt);
    const targetFov =
      THREE.MathUtils.lerp(this.config.camera.hipFov, zoomedFov, this.adsBlend) +
      this.dynamicFovBonus +
      this.shotFovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    // Camera realism: spring-weighted recoil kick + trauma + handheld drift + strafe roll
    this.cameraPitchKickVel +=
      (-this.cameraPitchKick * 165 - this.cameraPitchKickVel * 22) * dt;
    this.cameraPitchKick = THREE.MathUtils.clamp(
      this.cameraPitchKick + this.cameraPitchKickVel * dt,
      -0.06,
      0.16,
    );
    this.cameraRollKickVel +=
      (-this.cameraRollKick * 175 - this.cameraRollKickVel * 23) * dt;
    this.cameraRollKick = THREE.MathUtils.clamp(
      this.cameraRollKick + this.cameraRollKickVel * dt,
      -0.11,
      0.11,
    );
    this.cameraYawKick = THREE.MathUtils.damp(this.cameraYawKick, 0, 13, dt);
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 4.4);
    const shakeMag = this.cameraTrauma * this.cameraTrauma;
    const traumaPitch =
      shakeMag * 0.026 * Math.sin(this.elapsed * 71.0) * (1 - this.adsBlend * 0.42);
    const traumaYaw =
      shakeMag * 0.018 * Math.cos(this.elapsed * 63.0) * (1 - this.adsBlend * 0.48);
    const traumaRoll = shakeMag * 0.040 * Math.sin(this.elapsed * 54.0 + 1.1);

    const camSwayMask = (1 - this.adsBlend * 0.72) * (1 - this.slideBlend * 0.4);
    const handheldPitch =
      (Math.sin(this.elapsed * 1.45) * 0.0024 +
        Math.sin(this.elapsed * 2.95 + 1.2) * 0.0011) *
      camSwayMask;
    const handheldYaw =
      (Math.cos(this.elapsed * 1.12 + 0.5) * 0.0020 +
        Math.sin(this.elapsed * 2.35) * 0.0009) *
      camSwayMask;
    const handheldRoll =
      (Math.sin(this.elapsed * 0.92 + 0.8) * 0.0048 +
        Math.cos(this.elapsed * 2.15) * 0.0018) *
      camSwayMask;

    const lateralSpeed = this.moveVel.x * _vecB.x + this.moveVel.z * _vecB.z;
    this.strafeCamRoll = THREE.MathUtils.damp(
      this.strafeCamRoll,
      THREE.MathUtils.clamp(-lateralSpeed * 0.0068, -0.024, 0.024) *
        (1 - this.adsBlend * 0.68) *
        (1 - this.slideBlend),
      11,
      dt,
    );

    const groundBobMask = (this.isGrounded ? 1 : 0) * (1 - this.slideBlend);
    const walkBobY =
      Math.sin(this.walkPhase * 2) *
      0.019 *
      speedRatio *
      groundBobMask *
      (1 - this.adsBlend * 0.68);
    const walkBobX =
      Math.cos(this.walkPhase) *
      0.011 *
      speedRatio *
      groundBobMask *
      (1 - this.adsBlend * 0.72);
    const walkBobRoll =
      Math.cos(this.walkPhase) *
      0.0065 *
      speedRatio *
      groundBobMask *
      (1 - this.adsBlend * 0.75);

    const dYaw = this.yaw - this.prevYaw;
    const dPitch = this.pitch - this.prevPitch;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.blurVelX = THREE.MathUtils.damp(
      this.blurVelX,
      THREE.MathUtils.clamp(
        (dYaw / Math.max(0.006, dt)) * 0.00125 + lateralSpeed * 0.00035,
        -0.0115,
        0.0115,
      ),
      26,
      dt,
    );
    this.blurVelY = THREE.MathUtils.damp(
      this.blurVelY,
      THREE.MathUtils.clamp(
        (-dPitch / Math.max(0.006, dt)) * 0.00115 + this.recoilPitchVel * 0.00055,
        -0.0105,
        0.0105,
      ),
      26,
      dt,
    );

    const camRightOff = walkBobX + Math.cos(this.elapsed * 0.85) * 0.0022 * camSwayMask;
    this.camera.position.set(
      this.playerPos.x + _vecB.x * camRightOff,
      this.playerPos.y +
        walkBobY +
        this.slideBlend * Math.sin(this.elapsed * 46) * 0.0032 +
        this.landDipY +
        Math.sin(this.elapsed * 1.6) * 0.0036 * (1 - this.adsBlend * 0.55),
      this.playerPos.z + _vecB.z * camRightOff,
    );
    this.camera.rotation.set(
      this.pitch +
        this.cameraPitchKick +
        traumaPitch +
        handheldPitch +
        this.reloadCamPitch +
        this.swapCamPitch +
        this.swordCamPitch +
        this.slideBlend * sl.cameraPitch * (1 - this.adsBlend * 0.7),
      this.yaw + this.cameraYawKick + traumaYaw + handheldYaw,
      -this.swayX * 0.11 +
        this.strafeCamRoll +
        walkBobRoll +
        handheldRoll +
        this.cameraRollKick +
        traumaRoll +
        this.reloadCamRoll +
        this.swapCamRoll +
        this.swordCamRoll +
        this.slideBlend * this.slideLeanSign * sl.cameraRoll * (1 - this.adsBlend * 0.65),
    );

    // Weapon look-lag sway & spring recoil
    const rawTurnActivity = Math.min(
      1,
      (Math.abs(this.mouseDeltaX) + Math.abs(this.mouseDeltaY)) * 0.018,
    );
    const targetSwayX = THREE.MathUtils.clamp(-this.mouseDeltaX * 0.0012, -0.042, 0.042);
    const targetSwayY = THREE.MathUtils.clamp(this.mouseDeltaY * 0.0012, -0.036, 0.036);
    this.mouseDeltaX = THREE.MathUtils.damp(this.mouseDeltaX, 0, 22, dt);
    this.mouseDeltaY = THREE.MathUtils.damp(this.mouseDeltaY, 0, 22, dt);

    const swayMult = THREE.MathUtils.lerp(1.0, 0.24, this.adsBlend);
    this.swayX = THREE.MathUtils.damp(this.swayX, targetSwayX * swayMult, 9.5, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, targetSwayY * swayMult, 9.5, dt);

    this.recoilKickZVel += (-310 * this.recoilKickZ - 26 * this.recoilKickZVel) * dt;
    this.recoilKickZ += this.recoilKickZVel * dt;
    this.recoilPitchVel += (-275 * this.recoilPitch - 22 * this.recoilPitchVel) * dt;
    this.recoilPitch += this.recoilPitchVel * dt;
    this.recoilRollVel += (-250 * this.recoilRoll - 20 * this.recoilRollVel) * dt;
    this.recoilRoll += this.recoilRollVel * dt;

    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.triggerPull = THREE.MathUtils.damp(this.triggerPull, 0, 18, dt);
    if (gunRig) gunRig.setTriggerPull(this.triggerPull);
    this.hands.setTriggerFingerCurl(gunRig ? this.triggerPull : 0);

    if (this.flashlightClickTimer > 0) {
      this.flashlightClickTimer = Math.max(0, this.flashlightClickTimer - dt);
      const clickBell = Math.sin((this.flashlightClickTimer / 0.18) * Math.PI);
      this.plainFlashlight.setSwitchPress(clickBell);
      this.hands.setFlashlightThumbPress(clickBell);
    } else {
      this.plainFlashlight.setSwitchPress(0);
      this.hands.setFlashlightThumbPress(0);
    }

    this.fireHeat = THREE.MathUtils.damp(this.fireHeat, 0, 1.5, dt);
    if (isVx9) this.futuristicGun.setFireGlow(this.fireHeat);
    else if (isKs23) this.rustShotgun.setFireGlow(this.fireHeat);
    else if (this.activeWeaponId === 'rustSmg') this.rustSmg.setFireGlow(this.fireHeat);
    else if (this.activeWeaponId === 'retroSmg') this.retroSmg.setFireGlow(this.fireHeat);

    // Two-phase weapon switching (stow -> over-back / hip / chest draw)
    let swapPosX = 0;
    let swapPosY = 0;
    let swapPosZ = 0;
    let swapRotX = 0;
    let swapRotY = 0;
    let swapRotZ = 0;
    let targetSwapCamRoll = 0;
    let targetSwapCamPitch = 0;

    if (this.pendingWeaponId || this.swapTimer > 0) {
      const prevT = this.swapTimer;
      this.swapTimer += dt;
      const split = this.swapDuration * 0.48;
      if (this.pendingWeaponId && prevT < split && this.swapTimer >= split) {
        this.activeWeaponId = this.pendingWeaponId;
        this.pendingWeaponId = null;
        this.applyVisibleWeaponRig(this.activeWeaponId);
        this.slidePos =
          this.activeWeaponId === 'pistol9mm' && this.ammo === 0 ? 0.068 : 0;
        this.emitSoundEvent('weapon_switch', this.lastInputSource);
        this.emitSoundEvent('weapon_raise', this.lastInputSource);
        if (getWeaponHolsterZone(this.activeWeaponId) === 'back') {
          this.recoilPitchVel -= 1.35;
          this.recoilRollVel += 1.25;
        }
      }

      if (this.swapTimer < split) {
        const u = Math.min(1, this.swapTimer / split);
        const e = u * u * (3 - 2 * u);
        const zone = getWeaponHolsterZone(this.swapFromWeaponId);
        if (zone === 'back') {
          swapPosX = e * 0.22;
          swapPosY = -e * 0.38;
          swapPosZ = e * 0.08;
          swapRotX = -e * 0.56;
          swapRotY = -e * 0.32;
          swapRotZ = -e * 0.36;
          targetSwapCamRoll = -e * 0.022;
          targetSwapCamPitch = -e * 0.014;
        } else if (zone === 'hip') {
          swapPosX = e * 0.22;
          swapPosY = -e * 0.36;
          swapPosZ = e * 0.10;
          swapRotX = -e * 0.72;
          swapRotY = -e * 0.22;
          swapRotZ = -e * 0.36;
          targetSwapCamRoll = -e * 0.016;
          targetSwapCamPitch = -e * 0.012;
        } else if (zone === 'chest') {
          swapPosX = e * 0.14;
          swapPosY = -e * 0.34;
          swapPosZ = e * 0.10;
          swapRotX = -e * 0.52;
          swapRotY = -e * 0.24;
          swapRotZ = -e * 0.28;
          targetSwapCamRoll = -e * 0.012;
        } else {
          swapPosY = -e * 0.22;
        }
      } else {
        const u = Math.min(1, (this.swapTimer - split) / (this.swapDuration - split));
        const inv = 1 - (1 - Math.pow(1 - u, 3));
        const zone = getWeaponHolsterZone(this.activeWeaponId);
        if (zone === 'back') {
          swapPosX = inv * 0.22;
          swapPosY = -inv * 0.38;
          swapPosZ = inv * 0.08;
          swapRotX = -inv * 0.56;
          swapRotY = -inv * 0.32;
          swapRotZ = -inv * 0.36;
          targetSwapCamRoll = -inv * 0.022;
          targetSwapCamPitch = -inv * 0.014;
        } else if (zone === 'hip') {
          swapPosX = inv * 0.22;
          swapPosY = -inv * 0.36;
          swapPosZ = inv * 0.10;
          swapRotX = -inv * 0.72;
          swapRotY = -inv * 0.22;
          swapRotZ = -inv * 0.36;
          targetSwapCamRoll = -inv * 0.016;
        } else if (zone === 'chest') {
          swapPosX = inv * 0.14;
          swapPosY = -inv * 0.34;
          swapPosZ = inv * 0.10;
          swapRotX = -inv * 0.52;
          swapRotY = -inv * 0.24;
          swapRotZ = -inv * 0.28;
          targetSwapCamRoll = -inv * 0.012;
        } else {
          swapPosY = -inv * 0.22;
        }
      }

      if (this.swapTimer >= this.swapDuration) {
        this.swapTimer = 0;
        this.pendingWeaponId = null;
      }
    }
    this.swapCamRoll = THREE.MathUtils.damp(this.swapCamRoll, targetSwapCamRoll, 13, dt);
    this.swapCamPitch = THREE.MathUtils.damp(this.swapCamPitch, targetSwapCamPitch, 13, dt);

    // Slide blowback & volumetric muzzle flash
    if (gunRig) {
      if (this.slideHoldTimer > 0) {
        this.slideHoldTimer = Math.max(0, this.slideHoldTimer - dt);
      } else if (!this.isReloading) {
        const slideRest = isPistol && this.ammo === 0 ? 0.068 : 0;
        this.slidePos = THREE.MathUtils.damp(this.slidePos, slideRest, 19, dt);
      }
      gunRig.setSlideOffset(this.slidePos);
    }

    if (this.flashTimer > 0 && gunRig) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const denom = isShotgun ? 0.082 : 0.056;
      const intensity = Math.min(1, this.flashTimer / denom);
      this.activeFlashIntensity = intensity;
      gunRig.setMuzzleFlash(intensity);
    } else {
      this.activeFlashIntensity = 0;
      this.pistol9mm.setMuzzleFlash(0);
      this.futuristicGun.setMuzzleFlash(0);
      this.rustSmg.setMuzzleFlash(0);
      this.retroSmg.setMuzzleFlash(0);
      this.rustShotgun.setMuzzleFlash(0);
    }

    // Shotgun pump cycle
    if (isShotgun && this.shotgunPumpTimer >= 0 && !this.isReloading) {
      this.shotgunPumpTimer += dt;
      let pumpAmt = 0;
      if (this.shotgunPumpTimer >= 0.14 && this.shotgunPumpTimer < 0.30) {
        pumpAmt = (this.shotgunPumpTimer - 0.14) / 0.16;
        if (!this.shotgunPumpAudioPlayed) {
          this.shotgunPumpAudioPlayed = true;
          this.emitSoundEvent('pump', this.lastInputSource, 1.0);
        }
      } else if (this.shotgunPumpTimer >= 0.30 && this.shotgunPumpTimer < 0.48) {
        pumpAmt = 1 - (this.shotgunPumpTimer - 0.30) / 0.18;
      } else if (this.shotgunPumpTimer >= 0.48) {
        this.shotgunPumpTimer = -1;
        pumpAmt = 0;
      }
      if (isVx9) this.futuristicGun.setPumpOffset(pumpAmt);
      else this.rustShotgun.setPumpOffset?.(pumpAmt);
      this.hands.leftHandGroup.position
        .copy(this.leftHandRestPos)
        .add(_vecB.set(0, 0, pumpAmt * 0.095));
      this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
    }

    // Reload & sword / quick-melee timers
    let reloadPosY = 0;
    let reloadRotX = 0;
    let reloadRotZ = 0;
    let targetReloadCamRoll = 0;
    let targetReloadCamPitch = 0;

    if (this.isReloading) {
      this.reloadTime += dt;
      const reloadDur = isShotgun ? 1.55 : isPistol ? 1.25 : 1.45;
      const p = Math.min(1, this.reloadTime / reloadDur);
      const bell = Math.sin(p * Math.PI);
      reloadPosY = -bell * 0.04;
      reloadRotX = bell * 0.24;
      reloadRotZ = -bell * 0.36;
      targetReloadCamRoll = -bell * 0.025;
      targetReloadCamPitch = bell * 0.018;

      if (p < 0.65) {
        this.hands.leftHandGroup.position
          .copy(this.leftHandRestPos)
          .add(_vecB.set(-0.02, -0.08 * bell, 0.04));
        this.hands.leftHandGroup.quaternion
          .copy(this.leftHandRestQuat)
          .slerp(this.reloadMagQuat, Math.min(1, bell * 1.4));
        this.hands.setLeftHandReloadPose(Math.min(1, bell * 1.2), 0);
      } else {
        const rack = Math.sin(((p - 0.65) / 0.35) * Math.PI);
        this.slidePos = rack * 0.068;
        this.hands.leftHandGroup.position
          .copy(this.leftHandRestPos)
          .add(_vecB.set(-0.01, 0.045 * rack, 0.05 * rack));
        this.hands.leftHandGroup.quaternion
          .copy(this.leftHandRestQuat)
          .slerp(this.reloadOverhandQuat, rack);
        this.hands.setLeftHandReloadPose(0.25, rack);
      }

      if (this.reloadTime >= reloadDur) {
        this.isReloading = false;
        this.reloadTime = 0;
        this.ammo = this.maxAmmo;
        this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
        this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
        this.hands.setLeftHandReloadPose(0, 0);
        if (!isSword && !isFlashlight && !isUnarmed) {
          this.emitSoundEvent('reload_end', this.lastInputSource);
        }
      }
    }
    this.reloadCamRoll = THREE.MathUtils.damp(this.reloadCamRoll, targetReloadCamRoll, 11, dt);
    this.reloadCamPitch = THREE.MathUtils.damp(this.reloadCamPitch, targetReloadCamPitch, 11, dt);

    // Sword & quick-melee arcs (low-arm framing — zero visible elbows!)
    let swordPosX = 0;
    let swordPosY = 0;
    let swordPosZ = 0;
    let swordRotX = 0;
    let swordRotY = 0;
    let swordRotZ = 0;
    let targetSwordCamRoll = 0;
    let targetSwordCamPitch = 0;

    if (this.swordComboResetTimer > 0 && !this.swordSwingActive) {
      this.swordComboResetTimer = Math.max(0, this.swordComboResetTimer - dt);
    }

    if (this.quickMeleeActive) {
      this.quickMeleeTime += dt;
      const p = Math.min(1, this.quickMeleeTime / 0.54);
      const slash = Math.sin(p * Math.PI);
      swordPosX = THREE.MathUtils.lerp(0.24, -0.26, p);
      swordPosY = -0.02 - slash * 0.04;
      swordPosZ = -slash * 0.18;
      swordRotX = -slash * 0.72;
      swordRotY = THREE.MathUtils.lerp(-0.45, 0.92, p);
      swordRotZ = slash * 0.85;
      targetSwordCamRoll = -slash * 0.055;
      targetSwordCamPitch = -slash * 0.035;
      if (!this.quickMeleeHitChecked && p >= 0.42) {
        this.quickMeleeHitChecked = true;
        this.checkBladeHit(this.lastInputSource);
      }
      if (p >= 1) {
        this.quickMeleeActive = false;
        this.activeWeaponId = this.quickMeleeReturnWeapon;
        this.applyVisibleWeaponRig(this.activeWeaponId);
      }
    } else if (this.swordSwingActive) {
      this.swordSwingTime += dt;
      const p = Math.min(1, this.swordSwingTime / this.swordSwingDuration);
      const slash = Math.sin(p * Math.PI);
      const dir = this.swordComboStep === 1 ? -1 : 1;
      swordPosX = dir * THREE.MathUtils.lerp(0.18, -0.22, p);
      swordPosY = -0.01 - slash * 0.05;
      swordPosZ = -slash * 0.16;
      swordRotX = -slash * 0.68;
      swordRotY = dir * THREE.MathUtils.lerp(-0.35, 0.82, p);
      swordRotZ = dir * slash * 0.78;
      targetSwordCamRoll = -dir * slash * 0.048;
      targetSwordCamPitch = -slash * 0.028;
      if (!this.swordHitChecked && p >= 0.42) {
        this.swordHitChecked = true;
        this.checkBladeHit(this.lastInputSource);
      }
      if (p >= 1) {
        this.swordSwingActive = false;
        if (this.swordComboQueued) {
          this.swordComboQueued = false;
          this.fireShot(this.lastInputSource);
        }
      }
    }
    this.swordCamRoll = THREE.MathUtils.damp(this.swordCamRoll, targetSwordCamRoll, 16, dt);
    this.swordCamPitch = THREE.MathUtils.damp(this.swordCamPitch, targetSwordCamPitch, 16, dt);

    // Update live Green -> Yellow -> Red & Arcade Neon Reload Swirl LEDs
    if (isVx9) {
      this.futuristicGun.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (this.activeWeaponId === 'rustSmg') {
      this.rustSmg.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (this.activeWeaponId === 'retroSmg') {
      this.retroSmg.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (isKs23) {
      this.rustShotgun.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (isPistol) {
      this.pistol9mm.updateLeds?.(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    }

    // Idle micro-fidgets & organic finger motion
    const busy =
      this.isReloading ||
      this.pendingWeaponId !== null ||
      this.swordSwingActive ||
      this.quickMeleeActive ||
      this.shotgunPumpTimer >= 0;
    this.hands.updateAliveMotion(
      dt,
      this.elapsed,
      Math.min(1, Math.abs(this.recoilKickZ) * 14),
      this.adsBlend,
      busy,
      this.triggerPull,
      Math.min(1, speedRatio + rawTurnActivity + this.slideBlend),
    );

    // Weapon pivot placement (low-arm framing for sword so elbows never clip frame!)
    const adsSmooth =
      this.adsBlend * this.adsBlend * (3 - 2 * this.adsBlend);
    const hipX = isSword ? 0.145 : isFlashlight ? 0.132 : isUnarmed ? 0 : 0.112;
    const hipY = isSword ? -0.264 : isFlashlight ? -0.096 : isUnarmed ? -0.18 : -0.102;
    const hipZ = isSword ? -0.28 : isFlashlight ? -0.312 : isShotgun ? -0.34 : isPistol ? -0.275 : -0.31;
    const adsX = 0;
    const adsY = isSword
      ? -0.185
      : isFlashlight
        ? -0.055
        : gunRig
          ? -gunRig.sightLineY
          : -0.05;
    const adsZ = isPistol ? -0.22 : isShotgun ? -0.25 : -0.24;

    this.weaponPivot.position.set(
      THREE.MathUtils.lerp(hipX, adsX, adsSmooth) + this.swayX + swapPosX + swordPosX,
      THREE.MathUtils.lerp(hipY, adsY, adsSmooth) +
        this.swayY +
        reloadPosY +
        swapPosY +
        swordPosY +
        Math.sin(this.elapsed * 1.8) * 0.0024 * (1 - adsSmooth * 0.72),
      THREE.MathUtils.lerp(hipZ, adsZ, adsSmooth) +
        this.recoilKickZ +
        swapPosZ +
        swordPosZ,
    );

    this.weaponPivot.rotation.order = 'YXZ';
    this.weaponPivot.rotation.set(
      this.recoilPitch + this.swayY * 1.3 + reloadRotX + swapRotX + swordRotX,
      -this.swayX * 1.6 + swapRotY + swordRotY,
      this.recoilRoll - this.swayX * 2.4 + reloadRotZ + swapRotZ + swordRotZ,
    );

    // Sync dynamic flashlight SpotLight
    this.camera.updateMatrixWorld(true);
    const activeLens = isFlashlight
      ? this.plainFlashlight.lensAnchor
      : gunRig?.flashlightLens ?? null;
    if (this.flashlightOn && activeLens && !isSword && !isUnarmed && !this.quickMeleeActive) {
      activeLens.getWorldPosition(_vecA);
      activeLens.getWorldQuaternion(_quatB);
      _vecB.set(0, 0, -1).applyQuaternion(_quatB).normalize();
      this.flashlightSpot.position.copy(_vecA);
      this.flashlightTarget.position.copy(_vecA).addScaledVector(_vecB, 8.0);
      this.flashlightTarget.updateMatrixWorld();
      this.flashlightSpot.intensity = isFlashlight ? 16.5 : 12.8;
      this.flashlightSpot.penumbra = isFlashlight ? 0.94 : 0.88;
      this.flashlightSpot.angle = isFlashlight
        ? THREE.MathUtils.lerp(0.78, 0.52, adsSmooth)
        : 0.66;
    } else {
      this.flashlightSpot.intensity = 0;
    }

    if (this.onStateChange) {
      this.stateEmitAccum += dt;
      if (this.stateEmitAccum >= 0.05) {
        this.stateEmitAccum = 0;
        this.onStateChange(this.getState());
      }
    }

    // Keep scratch euler referenced cleanly
    _eulerA.set(0, 0, 0);
  }

  public dispose() {
    this.disposed = true;
    this.unbindEvents();
    this.camera.remove(this.weaponPivot, this.vmKeyLight, this.vmRimLight);
    this.scene.remove(this.flashlightSpot, this.flashlightTarget);
    this.flashlightCookie.dispose();
    this.pistol9mm.dispose();
    this.futuristicGun.dispose();
    this.rustSmg.dispose();
    this.retroSmg.dispose();
    this.rustShotgun.dispose();
    this.sword.dispose();
    this.plainFlashlight.dispose();
    this.hands.dispose();
    this.soundListeners.clear();
    this.interactListeners.clear();
  }
}

export function createPlayerKit(options: PlayerKitOptions): PlayerKit {
  return new PlayerKit(options);
}
