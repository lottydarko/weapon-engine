import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FirearmAudio } from './audio';
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
  buildGroundPickups,
  type GroundPickupItem,
  type GroundPickupManager,
} from './groundPickups';
import {
  buildRealisticHands,
  type HandStance,
  type RealisticHandsRig,
} from './hands';
import { buildPistol, type PistolRig } from './pistol';
import { buildBlankRoom, type BlankRoomResult, type LightingPreset } from './room';
import {
  buildRetroSovietSmg,
  buildRusticRussianShotgun,
  buildRusticRussianSmg,
  type RetroWeaponRig,
} from './russianWeapons';
import {
  mergePlayerConfig,
  type PlayerKitConfig,
} from './playerConfig';
import { CinematicPostProcessor } from './postProcess';
import {
  type PlayerInputSource,
  type PlayerSoundEventListener,
  type PlayerSoundEventName,
} from './soundEvents';
import { buildTacticalSword, type TacticalSwordRig } from './sword';
import {
  createBulletHoleTexture,
  createFxTextures,
  type SkinToneId,
} from './textures';

export type WeaponId =
  | 'pistol9mm'
  | 'futuristic'
  | 'rustSmg'
  | 'retroSmg'
  | 'rustShotgun'
  | 'sword'
  | 'flashlight'
  | 'unarmed';

export interface HudSnapshot {
  ammo: number;
  maxAmmo: number;
  weaponId: WeaponId;
  isAds: boolean;
  adsBlend: number;
  isReloading: boolean;
  isLocked: boolean;
  shotsFired: number;
  flashlightOn: boolean;
  pickupPrompt: string | null;
  pickupKind: 'drink' | 'item' | 'weapon' | null;
  actionLabel: string | null;
}

interface EjectedShell {
  mesh: THREE.Mesh;
  active: boolean;
  age: number;
  bounced: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
}

interface ImpactSpark {
  mesh: THREE.Mesh;
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

interface SmokePuff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  maxAge: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

// Pre-allocated scratch math helpers — zero GC in render loop
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _vecD = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _quatC = new THREE.Quaternion();
const _eulerA = new THREE.Euler(0, 0, 0, 'YXZ');
const _zAxis = new THREE.Vector3(0, 0, 1);

const WEAPON_ORDER: WeaponId[] = [
  'pistol9mm',
  'futuristic',
  'rustSmg',
  'retroSmg',
  'rustShotgun',
  'sword',
  'flashlight',
  'unarmed',
];

const WEAPON_MAX_AMMO: Record<WeaponId, number> = {
  pistol9mm: 15,
  futuristic: 8,
  rustSmg: 71,
  retroSmg: 30,
  rustShotgun: 6,
  sword: 0,
  flashlight: 0,
  unarmed: 0,
};

type WeaponHolsterZone = 'back' | 'hip' | 'chest' | 'none';

function getWeaponHolsterZone(id: WeaponId): WeaponHolsterZone {
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

const FIRE_COOLDOWN = 0.12;
const SHOTGUN_COOLDOWN = 0.62;
const RUST_SHOTGUN_COOLDOWN = 0.70;
const PP41_COOLDOWN = 0.078;
const AK74M_COOLDOWN = 0.094;

export class FpsSimulatorEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private postProcessor: CinematicPostProcessor | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private audio: FirearmAudio;
  private config: PlayerKitConfig;
  private soundListeners = new Set<PlayerSoundEventListener>();
  private interactListeners = new Set<(source: PlayerInputSource) => void>();
  private lastInputSource: PlayerInputSource = 'kbm';

  private room: BlankRoomResult;
  private groundPickups: GroundPickupManager;
  private weaponPivot: THREE.Group;

  // All 7 equippable rigs (+ unarmed empty-hand state)
  private pistol9mm: PistolRig;
  private futuristicGun: FuturisticShotgunRig;
  private rustSmg: RetroWeaponRig;
  private retroSmg: RetroWeaponRig;
  private rustShotgun: RetroWeaponRig;
  private sword: TacticalSwordRig;
  private plainFlashlight: PlainFlashlightRig;

  private activeWeaponId: WeaponId = 'pistol9mm';
  private pendingWeaponId: WeaponId | null = null;
  private swapFromWeaponId: WeaponId = 'pistol9mm';
  private swapTimer = 0;
  private swapDuration = 0.62;
  private swapCamRoll = 0;
  private swapCamPitch = 0;
  private hands: RealisticHandsRig;

  // Real dynamic SpotLight synced to active gun's under-barrel light OR plain handheld flashlight
  private flashlightSpot: THREE.SpotLight;
  private flashlightTarget: THREE.Object3D;
  private flashlightOn = false;
  private flashlightClickTimer = 0;

  // FX pools
  private shells: EjectedShell[] = [];
  private sparks: ImpactSpark[] = [];
  private smokePuffs: SmokePuff[] = [];
  private bulletDecals: THREE.Mesh[] = [];
  private nextDecalIdx = 0;
  private raycaster = new THREE.Raycaster();
  private screenCenter = new THREE.Vector2(0, 0);

  // Extra disposables
  private extraDisposables: Array<{ dispose: () => void }> = [];

  // Player & Camera state
  private yaw = 0;
  private pitch = 0;
  private playerPos = new THREE.Vector3(0, 1.62, 3.6);
  private playerEyeHeight = 1.62;
  private verticalOffset = 0;
  private verticalVel = 0;
  private isGrounded = true;
  private landDipY = 0;
  private moveVel = new THREE.Vector3();
  private keys = new Set<string>();
  private isPointerLocked = false;
  private walkPhase = 0;
  private footstepAccum = 0;

  // Crouch, Sprint & Smooth Physics-Defying Slide state
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
  private prevCrouchHeld = false;
  private prevJumpHeld = false;
  private gpMoveFwd = 0;
  private gpMoveRight = 0;
  private gpSprint = false;
  private gpCrouch = false;
  private gpJump = false;

  // Input holds (for full-auto SMGs)
  private lmbHeld = false;
  private rtHeld = false;

  // Weapon kinematics & ADS
  private adsHeld = false;
  private gpAdsHeld = false;
  private adsToggled = false;
  private adsToggleMode = false;
  private adsBlend = 0;
  private prevWantsAds = false;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private swayX = 0;
  private swayY = 0;

  // Second-order spring recoil & visceral camera trauma state
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
  private shotImpactBlur = 0;

  // Firing, blowback, heat, pump, sword & reload state
  private ammoByWeapon: Record<WeaponId, number> = {
    pistol9mm: WEAPON_MAX_AMMO.pistol9mm,
    futuristic: WEAPON_MAX_AMMO.futuristic,
    rustSmg: WEAPON_MAX_AMMO.rustSmg,
    retroSmg: WEAPON_MAX_AMMO.retroSmg,
    rustShotgun: WEAPON_MAX_AMMO.rustShotgun,
    sword: 0,
    flashlight: 0,
    unarmed: 0,
  };
  private shotsFired = 0;
  private fireCooldown = 0;
  private triggerPull = 0;
  private slidePos = 0;
  private slideHoldTimer = 0;
  private flashTimer = 0;
  private activeFlashIntensity = 0;

  // Camera realism: subtle handheld drift, strafe roll & Gaussian directional motion-blur velocity
  private prevYaw = 0;
  private prevPitch = 0;
  private strafeCamRoll = 0;
  private blurVelX = 0;
  private blurVelY = 0;

  // Per-weapon fire heat/glow & shotgun pump cycle
  private fireHeat = 0;
  private shotgunPumpTimer = -1;
  private shotgunPumpAudioPlayed = false;
  private shotgunShellEjected = false;
  private brassShellMat!: THREE.MeshStandardMaterial;
  private shotgunShellMat!: THREE.MeshStandardMaterial;

  // Tactical Katana 3-hit chained combo state
  private swordSwingActive = false;
  private swordSwingTime = 0;
  private swordSwingDuration = 0.48;
  private swordComboStep = 0;
  private swordComboQueued = false;
  private swordComboResetTimer = 0;
  private swordHitChecked = false;
  private swordCamRoll = 0;
  private swordCamPitch = 0;

  // Animated Quick-Melee Over-the-Back Sword Draw -> Swipe -> Sheathe -> Gun Returns!
  private quickMeleeActive = false;
  private quickMeleeTime = 0;
  private quickMeleeReturnWeapon: WeaponId = 'pistol9mm';
  private quickMeleeStage = 0;
  private quickMeleeHitChecked = false;

  // Animated Ground Pickup State (D⚡ Energy Drink, General Items, Floor Guns)
  private targetedPickup: GroundPickupItem | null = null;
  private pickupActive = false;
  private pickupItem: GroundPickupItem | null = null;
  private pickupTime = 0;
  private pickupDuration = 1.0;
  private pickupStage = 0;
  private pickupGrabLocalPos = new THREE.Vector3();
  private pickupGrabLocalQuat = new THREE.Quaternion();
  private drinkReachPos = new THREE.Vector3();
  private drinkReachQuat = new THREE.Quaternion();
  private drinkHoldPos = new THREE.Vector3();
  private drinkHoldQuat = new THREE.Quaternion();
  private drinkSwigPos = new THREE.Vector3();
  private drinkSwigQuat = new THREE.Quaternion();
  private drinkTossWindupPos = new THREE.Vector3();
  private drinkTossWindupQuat = new THREE.Quaternion();
  private drinkTossFlickPos = new THREE.Vector3();
  private drinkTossFlickQuat = new THREE.Quaternion();
  private pickupCamPitch = 0;
  private pickupCamYaw = 0;
  private pickupCamRoll = 0;
  private pickupCamDipY = 0;
  private drinkDofBlur = 0;

  // Reload / flourish state
  private isReloading = false;
  private reloadStartedEmpty = false;
  private reloadTime = 0;
  private reloadStageAudio = 0;
  private reloadCamRoll = 0;
  private reloadCamPitch = 0;
  private leftHandRestPos = new THREE.Vector3();
  private leftHandRestQuat = new THREE.Quaternion();
  private rightHandRestPos = new THREE.Vector3();
  private rightHandRestQuat = new THREE.Quaternion();
  private reloadMagQuat = new THREE.Quaternion();
  private reloadOverhandQuat = new THREE.Quaternion();
  private reloadShellQuat = new THREE.Quaternion();

  // Gamepad edge detection
  private prevRtPressed = false;
  private prevXPressed = false;
  private prevYPressed = false;
  private prevLbPressed = false;
  private prevDpadPressed = false;

  // Loop & lifecycle
  private frameId = 0;
  private disposed = false;
  private lastTime = 0;
  private elapsed = 0;
  private onHudUpdate: (snap: HudSnapshot) => void;
  private hudEmitTimer = 0;

  constructor(
    container: HTMLElement,
    onHudUpdate: (snap: HudSnapshot) => void,
    initialTone: SkinToneId = 'medium',
    configOverrides?: Parameters<typeof mergePlayerConfig>[0],
  ) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.audio = new FirearmAudio();
    this.config = mergePlayerConfig(configOverrides);
    this.playerEyeHeight = this.config.movement.standEyeHeight;
    this.playerPos.y = this.playerEyeHeight;

    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    if (!this.isSoftwareGl) {
      this.postProcessor = new CinematicPostProcessor(this.renderer, width, height);
    }

    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = envTarget.texture;
    this.extraDisposables.push(envTarget);
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(
      this.config.camera.hipFov,
      width / height,
      0.02,
      60,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.position.copy(this.playerPos);
    this.scene.add(this.camera);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // 1. Blank architectural room + Interactive Ground Pickups (D⚡ drinks, supplies, floor weapons)
    this.room = buildBlankRoom(this.scene, maxAniso, this.isSoftwareGl);
    this.groundPickups = buildGroundPickups(this.scene, maxAniso);

    // 2. Real Flashlight SpotLight with ultra-soft circular radial cookie & wide round scope!
    const flashlightCookie = createSoftFlashlightCookieTexture();
    this.extraDisposables.push(flashlightCookie);
    this.flashlightSpot = new THREE.SpotLight(0xfff6e8, 0, 30, 0.78, 0.92, 1.15);
    this.flashlightSpot.map = flashlightCookie;
    this.flashlightSpot.castShadow = false;
    this.flashlightTarget = new THREE.Object3D();
    this.scene.add(this.flashlightSpot);
    this.scene.add(this.flashlightTarget);
    this.flashlightSpot.target = this.flashlightTarget;

    // 3. FX textures & pools
    const fxTex = createFxTextures();
    const holeTex = createBulletHoleTexture(maxAniso);
    this.extraDisposables.push(fxTex, holeTex);

    // 4. Viewmodel assembly attached cleanly to camera
    this.weaponPivot = new THREE.Group();
    this.weaponPivot.name = 'WeaponViewmodelPivot';
    this.camera.add(this.weaponPivot);

    // Short-range camera-local specular grazing lights to sculpt pebbled leather gloves & rusted steel
    const vmKeyLight = new THREE.PointLight(0xfff4e4, 0.62, 1.25, 2);
    vmKeyLight.position.set(-0.26, 0.24, -0.06);
    this.camera.add(vmKeyLight);

    const vmRimLight = new THREE.PointLight(0xcbe0ff, 0.48, 1.25, 2);
    vmRimLight.position.set(0.30, 0.16, -0.34);
    this.camera.add(vmRimLight);

    // Build all 7 equippable viewmodel rigs
    this.pistol9mm = buildPistol(maxAniso, fxTex.flashTex);
    this.weaponPivot.add(this.pistol9mm.root);

    this.futuristicGun = buildFuturisticGun(maxAniso, fxTex.flashTex);
    this.futuristicGun.root.visible = false;
    this.weaponPivot.add(this.futuristicGun.root);

    this.rustSmg = buildRusticRussianSmg(maxAniso, fxTex.flashTex);
    this.rustSmg.root.visible = false;
    this.weaponPivot.add(this.rustSmg.root);

    this.retroSmg = buildRetroSovietSmg(maxAniso, fxTex.flashTex);
    this.retroSmg.root.visible = false;
    this.weaponPivot.add(this.retroSmg.root);

    this.rustShotgun = buildRusticRussianShotgun(maxAniso, fxTex.flashTex);
    this.rustShotgun.root.visible = false;
    this.weaponPivot.add(this.rustShotgun.root);

    this.sword = buildTacticalSword(maxAniso);
    this.sword.root.visible = false;
    this.weaponPivot.add(this.sword.root);

    this.plainFlashlight = buildPlainFlashlight(maxAniso);
    this.plainFlashlight.root.visible = false;
    this.plainFlashlight.setOn(false);
    this.weaponPivot.add(this.plainFlashlight.root);

    this.hands = buildRealisticHands(initialTone, maxAniso);
    this.weaponPivot.add(this.hands.root);

    this.hands.getLeftHandRestPose(this.leftHandRestPos, this.leftHandRestQuat);
    this.hands.getRightHandRestPose(this.rightHandRestPos, this.rightHandRestQuat);
    this.hands.getReloadHandQuat('magGrip', this.reloadMagQuat);
    this.hands.getReloadHandQuat('overhandPinch', this.reloadOverhandQuat);
    this.hands.getReloadHandQuat('shellFeed', this.reloadShellQuat);
    this.hands.getDrinkHandPose('reach', this.drinkReachPos, this.drinkReachQuat);
    this.hands.getDrinkHandPose('hold', this.drinkHoldPos, this.drinkHoldQuat);
    this.hands.getDrinkHandPose('swig', this.drinkSwigPos, this.drinkSwigQuat);
    this.hands.getDrinkHandPose('tossWindup', this.drinkTossWindupPos, this.drinkTossWindupQuat);
    this.hands.getDrinkHandPose('tossFlick', this.drinkTossFlickPos, this.drinkTossFlickQuat);

    // 5. Pooled casings, sparks, smoke & decals
    this.initPools(fxTex.smokeTex, holeTex);

    // 6. Strict Layer 0 (World) vs Layer 1 (Viewmodel) isolation:
    //    - All weapons, hands & held close-up items render on Layer 1 after a depth clear so
    //      world walls & bullet-hole decals can NEVER clip onto or stamp over guns!
    //    - All scene/viewmodel/weapon lights illuminate BOTH Layer 0 and Layer 1 seamlessly!
    this.setObjectLayer(this.weaponPivot, 1);
    this.scene.traverse((obj) => {
      if ((obj as THREE.Light).isLight) {
        obj.layers.enable(0);
        obj.layers.enable(1);
      }
    });

    if (!this.isSoftwareGl) {
      this.camera.layers.enable(1);
      this.renderer.compile(this.scene, this.camera);
      this.camera.layers.set(0);
    }

    this.bindEvents();
    this.emitHud();

    this.lastTime = performance.now();
    this.tick();
  }

  private initPools(smokeTex: THREE.Texture, holeTex: THREE.Texture) {
    const shellGeo = new THREE.CylinderGeometry(0.0049, 0.0049, 0.019, 10);
    shellGeo.rotateX(Math.PI / 2);
    this.brassShellMat = new THREE.MeshStandardMaterial({
      color: 0xd8ae4b,
      metalness: 0.92,
      roughness: 0.24,
    });
    this.shotgunShellMat = new THREE.MeshStandardMaterial({
      color: 0xd93812,
      metalness: 0.16,
      roughness: 0.42,
    });
    this.extraDisposables.push(shellGeo, this.brassShellMat, this.shotgunShellMat);

    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(shellGeo, this.brassShellMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shells.push({
        mesh,
        active: false,
        age: 0,
        bounced: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
      });
    }

    const sparkGeo = new THREE.BoxGeometry(0.012, 0.012, 0.05);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.95,
    });
    this.extraDisposables.push(sparkGeo, sparkMat);

    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        active: false,
        age: 0,
        maxAge: 0.2,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }

    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.extraDisposables.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.smokePuffs.push({
        sprite,
        mat,
        active: false,
        age: 0,
        maxAge: 0.7,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }

    const decalGeo = new THREE.PlaneGeometry(0.085, 0.085);
    const decalMat = new THREE.MeshBasicMaterial({
      map: holeTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.extraDisposables.push(decalGeo, decalMat);

    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(decalGeo, decalMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.bulletDecals.push(mesh);
    }
  }

  // =========================================================================
  // WEAPON RIG HELPERS
  // =========================================================================
  private setObjectLayer(obj: THREE.Object3D, layer: number) {
    obj.traverse((child) => {
      if ((child as THREE.Light).isLight) {
        child.layers.enable(0);
        child.layers.enable(1);
      } else {
        child.layers.set(layer);
      }
    });
  }

  private getFirearmRig(id: WeaponId = this.activeWeaponId): PistolRig | null {
    switch (id) {
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

  private get ammo(): number {
    return this.ammoByWeapon[this.activeWeaponId];
  }

  private set ammo(value: number) {
    this.ammoByWeapon[this.activeWeaponId] = value;
  }

  private get maxAmmo(): number {
    return WEAPON_MAX_AMMO[this.activeWeaponId];
  }

  private getStanceForWeapon(id: WeaponId): HandStance {
    if (id === 'futuristic' || id === 'rustShotgun') return 'shotgun';
    if (id === 'rustSmg' || id === 'retroSmg') return 'smg';
    if (id === 'sword') return 'sword';
    if (id === 'flashlight') return 'flashlight';
    if (id === 'unarmed') return 'unarmed';
    return 'pistol';
  }

  private applyVisibleWeaponRig(id: WeaponId) {
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
    this.futuristicGun.setPumpOffset(0);
    this.futuristicGun.shellInsertMesh.visible = false;
    this.rustShotgun.setPumpOffset?.(0);
    if (this.rustShotgun.shellInsertMesh) {
      this.rustShotgun.shellInsertMesh.visible = false;
    }
    this.sword.setSlashTrail(0);

    // Sync flashlight emitter visuals to newly active weapon!
    this.syncFlashlightVisuals();

    this.hands.setStance(this.getStanceForWeapon(id));
    this.hands.getLeftHandRestPose(this.leftHandRestPos, this.leftHandRestQuat);
    this.hands.getRightHandRestPose(this.rightHandRestPos, this.rightHandRestQuat);
  }

  private syncFlashlightVisuals() {
    const on = this.flashlightOn;
    this.pistol9mm.setFlashlightOn(on && this.activeWeaponId === 'pistol9mm');
    this.futuristicGun.setFlashlightOn(on && this.activeWeaponId === 'futuristic');
    this.rustSmg.setFlashlightOn(on && this.activeWeaponId === 'rustSmg');
    this.retroSmg.setFlashlightOn(on && this.activeWeaponId === 'retroSmg');
    this.rustShotgun.setFlashlightOn(on && this.activeWeaponId === 'rustShotgun');
    this.plainFlashlight.setOn(on && this.activeWeaponId === 'flashlight');
  }

  // =========================================================================
  // PUBLIC CONTROLS API
  // =========================================================================
  public requestLock() {
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.renderer.domElement.requestPointerLock?.();
    }
  }

  public setAdsToggleMode(toggleMode: boolean) {
    this.adsToggleMode = toggleMode;
    if (!toggleMode) this.adsToggled = false;
    this.emitHud();
  }

  public toggleAdsManual() {
    if (this.pickupActive) this.cancelPickup();
    this.adsToggled = !this.adsToggled;
    this.emitHud();
  }

  public setLightingPreset(preset: LightingPreset) {
    this.room.setLightingPreset(preset);
  }

  public setMuted(muted: boolean) {
    this.audio.setMuted(muted);
  }

  public getConfig(): PlayerKitConfig {
    return this.config;
  }

  public onSoundEvent(listener: PlayerSoundEventListener): () => void {
    this.soundListeners.add(listener);
    return () => this.soundListeners.delete(listener);
  }

  public offSoundEvent(listener: PlayerSoundEventListener) {
    this.soundListeners.delete(listener);
  }

  public onInteract(listener: (source: PlayerInputSource) => void): () => void {
    this.interactListeners.add(listener);
    return () => this.interactListeners.delete(listener);
  }

  public offInteract(listener: (source: PlayerInputSource) => void) {
    this.interactListeners.delete(listener);
  }

  private emitSoundEvent(
    event: PlayerSoundEventName,
    inputSource: PlayerInputSource = this.lastInputSource,
    intensity?: number,
  ) {
    if (this.soundListeners.size === 0) return;
    const payload = {
      event,
      weaponId: this.activeWeaponId,
      inputSource,
      intensity,
      timestamp: performance.now(),
    };
    for (const listener of this.soundListeners) {
      listener(payload);
    }
  }

  public triggerInteract(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    for (const cb of this.interactListeners) {
      cb(source);
    }
    this.triggerPickup();
  }

  public toggleFlashlight(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.pickupActive) this.cancelPickup();
    if (this.quickMeleeActive) return;
    this.flashlightOn = !this.flashlightOn;
    this.flashlightClickTimer = 0.18;
    this.audio.playFlashlightClick();
    this.emitSoundEvent(this.flashlightOn ? 'flashlight_on' : 'flashlight_off', source);
    this.syncFlashlightVisuals();
    this.emitHud();
  }

  public switchWeapon(targetId?: WeaponId, source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.pickupActive) this.cancelPickup();
    if (this.quickMeleeActive) return;
    let nextId: WeaponId;
    if (targetId) {
      nextId = targetId;
    } else {
      const idx = WEAPON_ORDER.indexOf(this.activeWeaponId);
      nextId = WEAPON_ORDER[(idx + 1) % WEAPON_ORDER.length];
    }
    if (nextId === this.activeWeaponId && !this.pendingWeaponId) return;
    if (nextId === this.pendingWeaponId) return;

    this.isReloading = false;
    this.adsToggled = false;
    this.shotgunPumpTimer = -1;
    this.swordSwingActive = false;
    this.swordComboQueued = false;
    this.sword.setSlashTrail(0);

    this.swapFromWeaponId = this.activeWeaponId;
    this.pendingWeaponId = nextId;
    this.swapTimer = 0.001;
    const fromZone = getWeaponHolsterZone(this.swapFromWeaponId);
    const toZone = getWeaponHolsterZone(nextId);
    // Deliberate, tactile stow-then-draw timing: longer for heavy over-the-back weapons, snappier for hip/chest!
    this.swapDuration =
      fromZone === 'back' || toZone === 'back'
        ? 0.64
        : fromZone === 'none' || toZone === 'none'
          ? 0.44
          : 0.50;

    this.emitSoundEvent('weapon_lower', source);
    if (this.activeWeaponId === 'sword') {
      this.audio.playSwordDraw();
    } else if (this.activeWeaponId !== 'unarmed') {
      this.audio.playReloadStep('magOut', nextId === 'futuristic');
    }
    this.emitHud();
  }

  /**
   * Animated Over-the-Back Quick-Melee:
   * Smoothly stows active gun -> reaches over right shoulder to draw Katana ->
   * delivers a silky diagonal swipe -> arcs blade back over right shoulder to sheathe ->
   * raises original gun cleanly back into hand! (Zero sudden switches.)
   */
  public triggerQuickMelee() {
    if (this.pickupActive) this.cancelPickup();
    if (this.quickMeleeActive || this.pendingWeaponId) return;

    // If already holding the katana, just execute a decisive katana slash!
    if (this.activeWeaponId === 'sword') {
      this.fireShot();
      return;
    }

    this.isReloading = false;
    this.adsToggled = false;
    this.shotgunPumpTimer = -1;
    this.quickMeleeActive = true;
    this.quickMeleeTime = 0;
    this.quickMeleeReturnWeapon = this.activeWeaponId;
    this.quickMeleeStage = 0;
    this.quickMeleeHitChecked = false;
    this.emitHud();
  }

  /**
   * Immediately cancels any active bend-down / pickup / drinking sequence and restores
   * the item cleanly back to the floor when any other button or movement input occurs.
   */
  public cancelPickup() {
    if (!this.pickupActive) return;
    const item = this.pickupItem;
    if (item) {
      this.setObjectLayer(item.mesh, 0);
      if (item.kind === 'drink' && this.pickupStage >= 4) {
        // Empty can was already tossed into mid-air — let it keep flying & bouncing freely!
      } else if (item.kind === 'weapon' && this.pickupStage >= 2) {
        this.groundPickups.finishPickup(item);
      } else {
        this.groundPickups.cancelPickup(item);
      }
    }
    this.pickupActive = false;
    this.pickupItem = null;
    this.pickupTime = 0;
    this.pickupStage = 0;
    this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
    this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
    this.hands.resetLeftElbowPose();
    this.hands.setLeftHandReloadPose(0, 0);
    this.emitHud();
  }

  /**
   * Animated Ground Pickup (E / G):
   * - Requires standing right next to the floor item (<= 1.15m horizontal distance).
   * - Bends down physically toward the floor, grabs the item directly into the left gloved palm socket,
   *   and lets you walk or run away carrying it while finishing the drink/toss/stash!
   * - Any non-movement button interaction immediately cancels it!
   */
  public triggerPickup() {
    if (this.pickupActive || this.quickMeleeActive || this.pendingWeaponId) return;
    const target =
      this.targetedPickup ??
      this.groundPickups.findTarget(this.camera, this.playerPos, 1.55);
    if (!target || !target.available) return;

    this.isReloading = false;
    this.adsToggled = false;
    this.adsHeld = false;
    this.shotgunPumpTimer = -1;
    this.swordSwingActive = false;

    this.pickupActive = true;
    this.pickupItem = target;
    this.pickupTime = 0;
    this.pickupStage = 0;
    this.pickupDuration =
      target.kind === 'drink' ? 3.12 : target.kind === 'weapon' ? 1.38 : 1.26;

    this.groundPickups.beginPickup(target);
    this.emitHud();
  }

  public triggerReload(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.pickupActive) this.cancelPickup();
    if (
      this.isReloading ||
      this.pendingWeaponId ||
      this.quickMeleeActive ||
      this.activeWeaponId === 'unarmed'
    ) {
      return;
    }
    if (this.activeWeaponId === 'sword') {
      if (this.swordSwingActive) return;
      this.isReloading = true;
      this.reloadTime = 0;
      this.reloadStageAudio = 0;
      this.adsToggled = false;
      this.audio.playSwordDraw();
      this.emitSoundEvent('swing', source, 0.5);
      this.emitHud();
      return;
    }
    if (this.activeWeaponId === 'flashlight') {
      // Tactile palm-tap bulb check on the plain handheld flashlight!
      this.isReloading = true;
      this.reloadTime = 0;
      this.reloadStageAudio = 0;
      this.adsToggled = false;
      this.audio.playFlashlightClick();
      this.emitHud();
      return;
    }

    this.isReloading = true;
    this.reloadStartedEmpty = this.ammo === 0;
    this.reloadTime = 0;
    this.reloadStageAudio = 0;
    this.shotgunPumpTimer = -1;
    this.adsToggled = false;
    this.emitSoundEvent('reload_start', source);
    this.emitHud();
  }

  public clearBulletHoles() {
    for (const d of this.bulletDecals) d.visible = false;
    this.nextDecalIdx = 0;
  }

  // =========================================================================
  // INPUT HANDLING
  // =========================================================================
  private onResize = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postProcessor?.setSize(w, h);
  };

  private onPointerLockChange = () => {
    this.isPointerLocked =
      document.pointerLockElement === this.renderer.domElement;
    if (!this.isPointerLocked) {
      this.adsHeld = false;
      this.lmbHeld = false;
    }
    this.emitHud();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked) return;
    this.lastInputSource = 'kbm';
    // Raw 1:1 high-sensitivity camera look — ZERO smoothing, ZERO acceleration curve, ZERO lag!
    const sens = THREE.MathUtils.lerp(
      this.config.camera.mouseSensitivityHip,
      this.config.camera.mouseSensitivityAds,
      this.adsBlend,
    );
    const dx = e.movementX;
    const dy = e.movementY;

    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - dy * sens,
      this.config.camera.pitchMin,
      this.config.camera.pitchMax,
    );

    this.mouseDeltaX += THREE.MathUtils.clamp(dx, -90, 90);
    this.mouseDeltaY += THREE.MathUtils.clamp(dy, -90, 90);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.target !== this.renderer.domElement) return;
    this.lastInputSource = 'kbm';

    if (this.pickupActive) {
      this.cancelPickup();
    }

    if (e.button === 0) {
      if (!this.isPointerLocked) this.requestLock();
      this.lmbHeld = true;
      this.fireShot('kbm');
    } else if (e.button === 1) {
      e.preventDefault();
      this.triggerQuickMelee();
    } else if (e.button === 2) {
      e.preventDefault();
      if (this.adsToggleMode) {
        this.adsToggled = !this.adsToggled;
      } else {
        this.adsHeld = true;
      }
      this.emitHud();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.lmbHeld = false;
    } else if (e.button === 2 && !this.adsToggleMode) {
      this.adsHeld = false;
      this.emitHud();
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    if (e.target === this.renderer.domElement) e.preventDefault();
  };

  private hasBoundKey(list: readonly string[]): boolean {
    for (let i = 0; i < list.length; i++) {
      if (this.keys.has(list[i])) return true;
    }
    return false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    this.lastInputSource = 'kbm';
    const kb = this.config.keybinds;
    if (kb.jump.includes(code)) e.preventDefault();
    this.keys.add(code);

    // During pickup / drinking, walking or running away does NOT cancel (you carry it with you!),
    // while ANY other action button interaction immediately cancels it!
    if (this.pickupActive) {
      const isMoveKey =
        kb.forward.includes(code) ||
        kb.backward.includes(code) ||
        kb.left.includes(code) ||
        kb.right.includes(code) ||
        kb.sprint.includes(code);
      if (code === 'KeyH' || isMoveKey) return;
      if (kb.interact.includes(code) && e.repeat) return;
      this.cancelPickup();
      if (kb.interact.includes(code)) return;
    }

    if (kb.reload.includes(code)) {
      this.triggerReload('kbm');
    } else if (kb.adsToggle.includes(code)) {
      this.toggleAdsManual();
    } else if (kb.flashlight.includes(code)) {
      this.toggleFlashlight('kbm');
    } else if (kb.quickMelee.includes(code)) {
      this.triggerQuickMelee();
    } else if (kb.interact.includes(code)) {
      if (!e.repeat) this.triggerInteract('kbm');
    } else if (code === kb.slots.pistol9mm) {
      this.switchWeapon('pistol9mm', 'kbm');
    } else if (code === kb.slots.futuristic) {
      this.switchWeapon('futuristic', 'kbm');
    } else if (code === kb.slots.rustSmg) {
      this.switchWeapon('rustSmg', 'kbm');
    } else if (code === kb.slots.retroSmg) {
      this.switchWeapon('retroSmg', 'kbm');
    } else if (code === kb.slots.rustShotgun) {
      this.switchWeapon('rustShotgun', 'kbm');
    } else if (code === kb.slots.sword) {
      this.switchWeapon('sword', 'kbm');
    } else if (code === kb.slots.flashlight) {
      this.switchWeapon('flashlight', 'kbm');
    } else if (code === kb.slots.unarmed) {
      this.switchWeapon('unarmed', 'kbm');
    } else if (kb.switchWeapon.includes(code)) {
      e.preventDefault();
      this.switchWeapon(undefined, 'kbm');
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) > 10) {
      if (this.pickupActive) this.cancelPickup();
      this.switchWeapon();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.onContextLost,
    );
  }

  private unbindEvents() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.onContextLost,
    );
  }

  // =========================================================================
  // FIRING, SHOTGUN BUCKSHOT, FULL-AUTO SMGS, SWORD COMBO & FLASHLIGHT CLICK
  // =========================================================================
  private startSwordSwing(step: number, source: PlayerInputSource = this.lastInputSource) {
    this.swordSwingActive = true;
    this.swordComboStep = step;
    this.swordSwingTime = 0;
    this.swordSwingDuration = step === 2 ? 0.50 : step === 1 ? 0.42 : 0.44;
    this.swordComboQueued = false;
    this.swordComboResetTimer = 0.88;
    this.swordHitChecked = false;
    this.shotsFired += 1;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
    this.audio.playSwordSwing(step);
    this.emitSoundEvent('swing', source, step === 2 ? 1.0 : 0.8);
    this.emitHud();
  }

  private checkSwordWallHit() {
    this.screenCenter.set(0, 0);
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    const hits = this.raycaster.intersectObjects(this.room.shootableMeshes, false);
    if (hits.length > 0 && hits[0].distance <= 2.3) {
      const hit = hits[0];
      const worldNormal = _vecA.set(0, 0, 1);
      if (hit.face) {
        worldNormal
          .copy(hit.face.normal)
          .transformDirection(hit.object.matrixWorld)
          .normalize();
      }
      this.spawnImpactSparks(hit.point, worldNormal);
      this.spawnImpactSparks(hit.point, worldNormal);
      this.audio.playSwordClang();
      this.emitSoundEvent('blade_hit', this.lastInputSource, 1.0);
      this.recoilKickZVel += 0.56;
      this.cameraPitchKick += 0.022;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
    }
  }

  public fireShot(source: PlayerInputSource = this.lastInputSource) {
    this.lastInputSource = source;
    if (this.pendingWeaponId || this.quickMeleeActive || this.pickupActive) return;
    if (this.activeWeaponId === 'unarmed') return;

    // 1. Plain Handheld Flashlight: thumb click switch ON/OFF!
    if (this.activeWeaponId === 'flashlight') {
      this.toggleFlashlight(source);
      return;
    }

    // 2. Tactical Katana 3-Hit Smooth Chained Combo
    if (this.activeWeaponId === 'sword') {
      if (this.isReloading) {
        this.isReloading = false;
        this.reloadTime = 0;
      }
      if (this.swordSwingActive) {
        if (this.swordSwingTime > this.swordSwingDuration * 0.32) {
          this.swordComboQueued = true;
        }
        return;
      }
      const nextStep =
        this.swordComboResetTimer > 0 ? (this.swordComboStep + 1) % 3 : 0;
      this.startSwordSwing(nextStep, source);
      return;
    }

    if (this.isReloading || this.fireCooldown > 0) return;

    this.triggerPull = 1.0;

    if (this.ammo <= 0) {
      this.audio.playDryFire();
      this.emitSoundEvent('dry_fire', source);
      this.recoilRollVel += (Math.random() - 0.5) * 0.65;
      this.fireCooldown = 0.18;
      return;
    }

    this.ammo -= 1;
    this.shotsFired += 1;

    const id = this.activeWeaponId;
    const isVx9 = id === 'futuristic';
    const isKs23 = id === 'rustShotgun';
    const isSmg = id === 'rustSmg' || id === 'retroSmg';

    if (isVx9 || isKs23) {
      // VIOLENT Heavy Pump Shotgun Thunderclap (VX-9 Futuristic or KS-23 Rusted Russian)
      this.fireCooldown = isKs23 ? RUST_SHOTGUN_COOLDOWN : SHOTGUN_COOLDOWN;
      this.flashTimer = isKs23 ? 0.082 : 0.074;
      this.fireHeat = 1.0;
      if (isVx9) this.futuristicGun.setFireGlow(1.0);
      else this.rustShotgun.setFireGlow(1.0);

      this.shotgunPumpTimer = 0;
      this.shotgunPumpAudioPlayed = false;
      this.shotgunShellEjected = false;

      const adsControl = THREE.MathUtils.lerp(1.0, 0.74, this.adsBlend);
      const power = isKs23 ? 1.26 : 1.08;
      this.recoilKickZVel += 1.78 * power * adsControl;
      this.recoilPitchVel += (5.85 + Math.random() * 0.95) * power * adsControl;
      this.recoilRollVel += (Math.random() - 0.5) * 5.6 * power * adsControl;
      // Dramatic spring-weighted camera concussion recoil + crisp Gaussian impact burst!
      this.cameraPitchKickVel += (1.92 + Math.random() * 0.36) * power * adsControl;
      this.cameraYawKick += (Math.random() - 0.5) * 0.036 * power * adsControl;
      this.cameraRollKickVel +=
        (Math.random() < 0.5 ? -1 : 1) * (1.28 + Math.random() * 0.45) * power * adsControl;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.88 * power);
      this.shotFovKick = Math.min(5.2, this.shotFovKick + 3.4 * power);
      this.shotImpactBlur = Math.min(1.0, this.shotImpactBlur + 0.86 * power);

      if (isKs23) this.audio.playRustShotgunBlast();
      else this.audio.playShotgunBlast();
      this.emitSoundEvent('fire', source, 1.0);

      this.spawnMuzzleSmoke();
      this.spawnMuzzleSmoke();

      const pellets = isKs23 ? 10 : 8;
      const spread = THREE.MathUtils.lerp(0.056, 0.027, this.adsBlend);
      for (let i = 0; i < pellets; i++) {
        const angle = (i / pellets) * Math.PI * 2 + Math.random() * 0.55;
        const rad = Math.sqrt(Math.random()) * spread;
        this.screenCenter.set(Math.cos(angle) * rad, Math.sin(angle) * rad);
        this.raycaster.setFromCamera(this.screenCenter, this.camera);
        const hits = this.raycaster.intersectObjects(this.room.shootableMeshes, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const worldNormal = _vecA.set(0, 0, 1);
          if (hit.face) {
            worldNormal
              .copy(hit.face.normal)
              .transformDirection(hit.object.matrixWorld)
              .normalize();
          }
          this.spawnBulletDecal(hit.point, worldNormal);
          if (i % 2 === 0) this.spawnImpactSparks(hit.point, worldNormal);
        }
      }
      this.emitHud();
      return;
    }

    if (isSmg) {
      // RAW, VIOLENT Full-Auto Russian SMG Rattle (PP-41 Buria / AK-74M Kobra-Pulse)
      const isAk = id === 'retroSmg';
      this.fireCooldown = isAk ? AK74M_COOLDOWN : PP41_COOLDOWN;
      this.flashTimer = 0.048;
      this.slidePos = 0.068;
      this.slideHoldTimer = 0.026;
      this.fireHeat = Math.min(1, this.fireHeat + 0.28);
      if (isAk) this.retroSmg.setFireGlow(this.fireHeat);
      else this.rustSmg.setFireGlow(this.fireHeat);

      const adsControl = THREE.MathUtils.lerp(1.0, 0.66, this.adsBlend);
      const kickMult = isAk ? 1.24 : 0.96;
      this.recoilKickZVel += 0.82 * kickMult * adsControl;
      this.recoilPitchVel += (2.75 + Math.random() * 0.65) * kickMult * adsControl;
      this.recoilRollVel += (Math.random() - 0.5) * 4.5 * kickMult * adsControl;
      this.cameraPitchKickVel += (0.82 + Math.random() * 0.24) * kickMult * adsControl;
      this.cameraYawKick += (Math.random() - 0.5) * 0.022 * kickMult * adsControl;
      this.cameraRollKickVel += (Math.random() - 0.5) * 1.15 * kickMult * adsControl;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.46 * kickMult);
      this.shotFovKick = Math.min(3.8, this.shotFovKick + 1.38 * kickMult);
      this.shotImpactBlur = Math.min(0.64, this.shotImpactBlur + 0.30 * kickMult);

      this.audio.playSmgShot(isAk);
      this.emitSoundEvent('fire', source, isAk ? 0.85 : 0.72);
      this.spawnShellCasing(false);
      this.spawnMuzzleSmoke();

      const spread = THREE.MathUtils.lerp(0.022, 0.004, this.adsBlend);
      this.screenCenter.set(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
      );
      this.raycaster.setFromCamera(this.screenCenter, this.camera);
      const hits = this.raycaster.intersectObjects(this.room.shootableMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const worldNormal = _vecA.set(0, 0, 1);
        if (hit.face) {
          worldNormal
            .copy(hit.face.normal)
            .transformDirection(hit.object.matrixWorld)
            .normalize();
        }
        this.spawnBulletDecal(hit.point, worldNormal);
        this.spawnImpactSparks(hit.point, worldNormal);
      }
      this.emitHud();
      return;
    }

    // SNAPPY, AGGRESSIVE 9mm Tactical Pistol Whip
    this.fireCooldown = FIRE_COOLDOWN;
    this.flashTimer = 0.052;
    this.slidePos = 0.076;
    this.slideHoldTimer = 0.050;

    const adsControl = THREE.MathUtils.lerp(1.0, 0.72, this.adsBlend);
    this.recoilKickZVel += 1.12 * adsControl;
    this.recoilPitchVel += (4.15 + Math.random() * 0.62) * adsControl;
    this.recoilRollVel += (Math.random() - 0.5) * 4.1 * adsControl;
    this.cameraPitchKickVel += (1.18 + Math.random() * 0.25) * adsControl;
    this.cameraYawKick += (Math.random() - 0.5) * 0.020 * adsControl;
    this.cameraRollKickVel +=
      (Math.random() < 0.5 ? -1 : 1) * (0.68 + Math.random() * 0.28) * adsControl;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.54);
    this.shotFovKick = Math.min(3.6, this.shotFovKick + 1.65);
    this.shotImpactBlur = Math.min(0.76, this.shotImpactBlur + 0.48);

    this.audio.playGunshot(false);
    this.emitSoundEvent('fire', source, 0.78);
    this.spawnShellCasing(false);
    this.spawnMuzzleSmoke();

    const spread = THREE.MathUtils.lerp(0.014, 0.0006, this.adsBlend);
    this.screenCenter.set(
      (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread,
    );
    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    const hits = this.raycaster.intersectObjects(this.room.shootableMeshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const worldNormal = _vecA.set(0, 0, 1);
      if (hit.face) {
        worldNormal
          .copy(hit.face.normal)
          .transformDirection(hit.object.matrixWorld)
          .normalize();
      }
      this.spawnBulletDecal(hit.point, worldNormal);
      this.spawnImpactSparks(hit.point, worldNormal);
    }

    this.emitHud();
  }

  private spawnShellCasing(isShotgunHull = false) {
    const gun = this.getFirearmRig();
    if (!gun) return;

    let slot: EjectedShell | undefined;
    for (const s of this.shells) {
      if (!s.active) {
        slot = s;
        break;
      }
    }
    if (!slot) slot = this.shells[0];

    this.camera.updateMatrixWorld(true);
    gun.ejectionPort.getWorldPosition(slot.pos);
    gun.ejectionPort.getWorldQuaternion(_quatA);

    slot.mesh.material = isShotgunHull ? this.shotgunShellMat : this.brassShellMat;
    if (isShotgunHull) slot.mesh.scale.set(1.85, 1.85, 2.75);
    else slot.mesh.scale.set(1, 1, 1);

    slot.mesh.position.copy(slot.pos);
    slot.mesh.quaternion.copy(_quatA);
    slot.mesh.visible = true;
    slot.active = true;
    slot.age = 0;
    slot.bounced = false;

    _vecB
      .set(1.45 + Math.random() * 0.45, 1.35 + Math.random() * 0.35, 0.25)
      .applyQuaternion(this.camera.quaternion);
    slot.vel.copy(_vecB);
    slot.rotVel.set(
      14 + Math.random() * 14,
      10 + Math.random() * 10,
      18 + Math.random() * 16,
    );
  }

  private spawnMuzzleSmoke() {
    const gun = this.getFirearmRig();
    if (!gun) return;

    let slot: SmokePuff | undefined;
    for (const p of this.smokePuffs) {
      if (!p.active) {
        slot = p;
        break;
      }
    }
    if (!slot) slot = this.smokePuffs[0];

    gun.muzzleTip.getWorldPosition(slot.pos);
    slot.sprite.position.copy(slot.pos);
    slot.sprite.scale.setScalar(0.06);
    slot.sprite.visible = true;
    slot.mat.opacity = 0.28;
    slot.active = true;
    slot.age = 0;
    slot.maxAge = 0.55 + Math.random() * 0.3;

    _vecB
      .set((Math.random() - 0.5) * 0.25, 0.28 + Math.random() * 0.18, -0.55)
      .applyQuaternion(this.camera.quaternion);
    slot.vel.copy(_vecB);
  }

  private spawnBulletDecal(point: THREE.Vector3, normal: THREE.Vector3) {
    const decal = this.bulletDecals[this.nextDecalIdx];
    this.nextDecalIdx = (this.nextDecalIdx + 1) % this.bulletDecals.length;

    decal.position.copy(point).addScaledVector(normal, 0.003);
    _quatA.setFromUnitVectors(_zAxis, normal);
    decal.quaternion.copy(_quatA);
    decal.rotateZ(Math.random() * Math.PI * 2);
    const sc = 0.85 + Math.random() * 0.35;
    decal.scale.set(sc, sc, 1);
    decal.visible = true;
  }

  private spawnImpactSparks(point: THREE.Vector3, normal: THREE.Vector3) {
    let spawned = 0;
    for (const sp of this.sparks) {
      if (sp.active) continue;
      sp.active = true;
      sp.age = 0;
      sp.maxAge = 0.11 + Math.random() * 0.12;
      sp.pos.copy(point).addScaledVector(normal, 0.01);
      sp.vel
        .copy(normal)
        .multiplyScalar(2.4 + Math.random() * 2.2)
        .addScaledVector(
          _vecC.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5),
          3.4,
        );
      sp.mesh.position.copy(sp.pos);
      sp.mesh.visible = true;
      spawned++;
      if (spawned >= 5) break;
    }
  }

  // =========================================================================
  // GAMEPAD POLLING (Simultaneous Xbox Controller: Sticks, RT, LT, A, B, X, Y, LB, D-Pad)
  // =========================================================================
  private pollGamepad(dt: number) {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
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
    // Raw 1:1 linear right-stick turning above deadzone — ZERO smoothing, ZERO curve softening, ZERO stop easing!
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
    const lxStick =
      Math.abs(rawLx) > lDz
        ? Math.sign(rawLx) * ((Math.abs(rawLx) - lDz) / (1 - lDz))
        : 0;
    const lyStick =
      Math.abs(rawLy) > lDz
        ? Math.sign(rawLy) * ((Math.abs(rawLy) - lDz) / (1 - lDz))
        : 0;

    this.gpMoveRight = lxStick;
    this.gpMoveFwd = -lyStick;
    this.gpSprint =
      Boolean(pad.buttons[gp.sprintButton]?.pressed) || lyStick < -0.82;

    const aPressed = Boolean(pad.buttons[gp.jumpButton]?.pressed);
    const bPressed = Boolean(pad.buttons[gp.crouchSlideButton]?.pressed);
    const xPressed = Boolean(pad.buttons[gp.reloadInteractButton]?.pressed);
    const yPressed = Boolean(pad.buttons[gp.switchWeaponButton]?.pressed);
    const lbPressed = Boolean(pad.buttons[gp.quickMeleeButton]?.pressed);
    const ltVal = pad.buttons[gp.adsTrigger]?.value ?? 0;
    const rtPressed = (pad.buttons[gp.fireTrigger]?.value ?? 0) > gp.triggerThreshold;

    let dpadPressed = false;
    for (let i = 0; i < gp.flashlightButtons.length; i++) {
      if (pad.buttons[gp.flashlightButtons[i]]?.pressed) {
        dpadPressed = true;
        break;
      }
    }

    // B (button 1) = Crouch AND Slide (when sprinting)
    this.gpCrouch = bPressed;
    // A (button 0) = Jump / Slide-Hop
    this.gpJump = aPressed;

    if (
      lxStick !== 0 ||
      lyStick !== 0 ||
      aPressed ||
      bPressed ||
      xPressed ||
      yPressed ||
      lbPressed ||
      dpadPressed ||
      ltVal > gp.triggerThreshold ||
      rtPressed
    ) {
      this.lastInputSource = 'gamepad';
    }

    if (
      this.pickupActive &&
      (ltVal > gp.triggerThreshold ||
        rtPressed ||
        aPressed ||
        bPressed ||
        yPressed ||
        lbPressed ||
        dpadPressed ||
        (xPressed && !this.prevXPressed))
    ) {
      this.cancelPickup();
    }

    // LT (button 6) = ADS (independent from mouse RMB so both live simultaneously!)
    this.gpAdsHeld = ltVal > gp.triggerThreshold;

    // RT (button 7) = Fire
    this.rtHeld = rtPressed;
    if (rtPressed && !this.prevRtPressed) {
      this.fireShot('gamepad');
    }
    this.prevRtPressed = rtPressed;

    // D-Pad (buttons 12..15) = Flashlight Toggle
    if (dpadPressed && !this.prevDpadPressed) {
      this.toggleFlashlight('gamepad');
    }
    this.prevDpadPressed = dpadPressed;

    // LB (button 4) = Quick-Melee Over-the-Back Katana Slash
    if (lbPressed && !this.prevLbPressed) {
      this.triggerQuickMelee();
    }
    this.prevLbPressed = lbPressed;

    // X (button 2) = Interact if right next to floor item, otherwise Reload!
    if (xPressed && !this.prevXPressed) {
      if (this.targetedPickup) this.triggerInteract('gamepad');
      else this.triggerReload('gamepad');
    }
    this.prevXPressed = xPressed;

    // Y (button 3) = Switch Weapon
    if (yPressed && !this.prevYPressed) {
      this.switchWeapon(undefined, 'gamepad');
    }
    this.prevYPressed = yPressed;
  }

  // =========================================================================
  // MAIN SIMULATION & ORGANIC MOTION STEP
  // =========================================================================
  private update(dt: number) {
    this.elapsed += dt;
    const mv = this.config.movement;
    const sl = this.config.slide;
    const kb = this.config.keybinds;

    // 1. Grounded weighted movement, sprint, crouch-slide & jump/slide-hop (all from single config!)
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

    const kbmCrouch = this.hasBoundKey(kb.crouch);
    const crouchHeld = kbmCrouch || this.gpCrouch;
    const crouchJustPressed = crouchHeld && !this.prevCrouchHeld;
    this.prevCrouchHeld = crouchHeld;

    const kbmJump = this.hasBoundKey(kb.jump);
    const jumpHeld = kbmJump || this.gpJump;
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

    // Jump/crouch cancels pickup; walking & running do NOT cancel so you can carry stuff as you move!
    if (this.pickupActive && this.pickupTime > 0.14 && (jumpHeld || crouchHeld)) {
      this.cancelPickup();
    }

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

    // Trigger Smooth Slightly-Physics-Defying Slide when sprinting + crouching!
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
      this.slideLeanSign =
        moveRight > 0.15 ? 1 : moveRight < -0.15 ? -1 : -1;
      // Visceral aggressive slide-drop punch!
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
      this.recoilRollVel += this.slideLeanSign * 1.4;
      this.emitSoundEvent('slide', src, 1.0);
      this.hudEmitTimer = 99;
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

    // Jump & Slide-Hop (jumping mid-slide preserves juicy forward momentum!)
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
        this.hudEmitTimer = 99;
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
        const steerAlpha = 1 - Math.exp(-sl.steerRate * dt);
        this.slideDir.lerp(_vecC, steerAlpha).normalize();
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
        this.hudEmitTimer = 99;
      }
    } else {
      if (this.isGrounded) {
        this.isCrouching = crouchHeld;
      }

      const baseSpeed = this.isCrouching
        ? THREE.MathUtils.lerp(mv.crouchSpeed, mv.crouchAdsSpeed, this.adsBlend)
        : isSprinting
          ? mv.sprintSpeed
          : THREE.MathUtils.lerp(mv.walkSpeed, mv.adsSpeed, this.adsBlend);
      const maxSpeed =
        this.pickupActive && this.pickupStage === 0 ? baseSpeed * 0.72 : baseSpeed;

      _vecC.set(0, 0, 0);
      const hasInput = Math.abs(moveFwd) > 0.01 || Math.abs(moveRight) > 0.01;
      if (hasInput) {
        _vecC
          .addScaledVector(_vecA, moveFwd)
          .addScaledVector(_vecB, moveRight);
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

    // Apply horizontal motion with room bounds
    const prevX = this.playerPos.x;
    const prevZ = this.playerPos.z;
    this.playerPos.x = THREE.MathUtils.clamp(
      this.playerPos.x + this.moveVel.x * dt,
      this.room.bounds.minX,
      this.room.bounds.maxX,
    );
    this.playerPos.z = THREE.MathUtils.clamp(
      this.playerPos.z + this.moveVel.z * dt,
      this.room.bounds.minZ,
      this.room.bounds.maxZ,
    );
    const frameDist = Math.hypot(this.playerPos.x - prevX, this.playerPos.z - prevZ);

    // Footstep sound hooks (stride-distance accumulated when grounded & not sliding!)
    if (this.isGrounded && !this.isSliding && frameDist > 0.001) {
      const stride = isSprinting ? mv.footstepDistanceSprint : mv.footstepDistanceWalk;
      this.footstepAccum += frameDist;
      if (this.footstepAccum >= stride) {
        this.footstepAccum -= stride;
        const stepIntensity = isSprinting ? 1.0 : this.isCrouching ? 0.35 : 0.68;
        this.emitSoundEvent('footstep', moveSource, stepIntensity);
      }
    } else if (!this.isGrounded || this.isSliding) {
      this.footstepAccum = 0;
    }

    // Vertical jump gravity & landing (landing while holding crouch at speed chains right into a slide!)
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

    // Smooth camera eye height (Standing -> Crouch -> Athletic Low Slide)
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

    // Detect targeted ground pickup ONLY when standing right next to it (<= 1.15m horizontal distance!)
    const prevTarget = this.targetedPickup;
    this.targetedPickup =
      !this.pickupActive && !this.quickMeleeActive
        ? this.groundPickups.findTarget(this.camera, this.playerPos, 1.55)
        : null;
    if (prevTarget !== this.targetedPickup) {
      this.hudEmitTimer = 99;
    }
    this.groundPickups.update(dt, this.targetedPickup, this.elapsed);

    // Full-auto firing for PP-41 & AK-74M SMGs while holding LMB or RT!
    if (
      (this.lmbHeld || this.rtHeld) &&
      (this.activeWeaponId === 'rustSmg' || this.activeWeaponId === 'retroSmg') &&
      this.fireCooldown <= 0 &&
      !this.isReloading &&
      !this.quickMeleeActive &&
      !this.pickupActive &&
      !this.pendingWeaponId &&
      this.ammo > 0
    ) {
      this.fireShot(this.rtHeld ? 'gamepad' : 'kbm');
    }

    // 2. Smooth organic ADS / Guard / Flashlight Focus blend & FOV + edge-triggered ads_in/ads_out hooks!
    const isSword = this.activeWeaponId === 'sword';
    const isFlashlight = this.activeWeaponId === 'flashlight';
    const isUnarmed = this.activeWeaponId === 'unarmed';
    const isPistol = this.activeWeaponId === 'pistol9mm';
    const isVx9 = this.activeWeaponId === 'futuristic';
    const isKs23 = this.activeWeaponId === 'rustShotgun';
    const isShotgun = isVx9 || isKs23;
    const isSmg =
      this.activeWeaponId === 'rustSmg' || this.activeWeaponId === 'retroSmg';
    const gunRig = this.getFirearmRig();

    const wantsAds =
      !isUnarmed &&
      !this.isReloading &&
      !this.pendingWeaponId &&
      !this.swordSwingActive &&
      !this.quickMeleeActive &&
      !this.pickupActive &&
      (this.adsHeld || this.gpAdsHeld || this.adsToggled);
    if (wantsAds !== this.prevWantsAds) {
      this.prevWantsAds = wantsAds;
      const adsSrc: PlayerInputSource = this.gpAdsHeld ? 'gamepad' : 'kbm';
      this.emitSoundEvent(wantsAds ? 'ads_in' : 'ads_out', adsSrc);
    }

    const targetAds = wantsAds ? 1 : 0;
    const prevAds = this.adsBlend;
    this.adsBlend = THREE.MathUtils.damp(
      this.adsBlend,
      targetAds,
      wantsAds ? 16.5 : 13.0,
      dt,
    );
    if (Math.abs(this.adsBlend - prevAds) > 0.002) this.hudEmitTimer = 99;

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

    // 3. Camera realism: second-order spring recoil kick + concussion Gaussian impact + trauma + handheld sway
    const camSpringK = 165;
    const camSpringC = 22;
    this.cameraPitchKickVel +=
      (-this.cameraPitchKick * camSpringK - this.cameraPitchKickVel * camSpringC) * dt;
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
    this.shotImpactBlur = THREE.MathUtils.damp(this.shotImpactBlur, 0, 14, dt);
    const shakeMag = this.cameraTrauma * this.cameraTrauma;
    const traumaPitch =
      shakeMag * 0.026 * Math.sin(this.elapsed * 71.0) * (1 - this.adsBlend * 0.42);
    const traumaYaw =
      shakeMag * 0.018 * Math.cos(this.elapsed * 63.0) * (1 - this.adsBlend * 0.48);
    const traumaRoll = shakeMag * 0.040 * Math.sin(this.elapsed * 54.0 + 1.1);

    // Subtle organic handheld camera breathing & live weight-shift drift (damped cleanly during ADS)
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

    // Physical strafe-bank roll & natural stride head-bob
    const lateralSpeed = this.moveVel.x * _vecB.x + this.moveVel.z * _vecB.z;
    const targetStrafeRoll =
      THREE.MathUtils.clamp(-lateralSpeed * 0.0068, -0.024, 0.024) *
      (1 - this.adsBlend * 0.68) *
      (1 - this.slideBlend);
    this.strafeCamRoll = THREE.MathUtils.damp(this.strafeCamRoll, targetStrafeRoll, 11, dt);

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
    const slideRumbleY = this.slideBlend * Math.sin(this.elapsed * 46) * 0.0032;
    const slideCamRoll =
      this.slideBlend * this.slideLeanSign * sl.cameraRoll * (1 - this.adsBlend * 0.65);
    const slideCamPitch = this.slideBlend * sl.cameraPitch * (1 - this.adsBlend * 0.7);
    const breathCamY = Math.sin(this.elapsed * 1.6) * 0.0036 * (1 - this.adsBlend * 0.55);
    const breathCamX = Math.cos(this.elapsed * 0.85) * 0.0022 * camSwayMask;

    // Track true instantaneous camera turn + recoil velocity for Gaussian directional motion blur
    const dYaw = this.yaw - this.prevYaw;
    const dPitch = this.pitch - this.prevPitch;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    const rawBlurX = THREE.MathUtils.clamp(
      (dYaw / Math.max(0.006, dt)) * 0.00125 +
        lateralSpeed * 0.00035 +
        this.cameraRollKickVel * 0.0022,
      -0.0115,
      0.0115,
    );
    const rawBlurY = THREE.MathUtils.clamp(
      (-dPitch / Math.max(0.006, dt)) * 0.00115 +
        this.recoilPitchVel * 0.00065 +
        this.cameraPitchKickVel * 0.0038,
      -0.0115,
      0.0115,
    );
    this.blurVelX = THREE.MathUtils.damp(this.blurVelX, rawBlurX, 26, dt);
    this.blurVelY = THREE.MathUtils.damp(this.blurVelY, rawBlurY, 26, dt);

    const camRightOff = walkBobX + breathCamX;
    this.camera.position.set(
      this.playerPos.x + _vecB.x * camRightOff,
      this.playerPos.y +
        walkBobY +
        slideRumbleY +
        this.landDipY +
        breathCamY +
        this.pickupCamDipY,
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
        this.pickupCamPitch +
        slideCamPitch,
      this.yaw +
        this.cameraYawKick +
        traumaYaw +
        handheldYaw +
        this.pickupCamYaw,
      -this.swayX * 0.11 +
        this.strafeCamRoll +
        walkBobRoll +
        handheldRoll +
        this.cameraRollKick +
        traumaRoll +
        this.reloadCamRoll +
        this.swapCamRoll +
        this.swordCamRoll +
        this.pickupCamRoll +
        slideCamRoll,
    );

    // 4. Weapon look-lag sway
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

    // 5. High-energy second-order spring recoil physics (snappy, vicious, fast recovery!)
    this.recoilKickZVel += (-310 * this.recoilKickZ - 26 * this.recoilKickZVel) * dt;
    this.recoilKickZ += this.recoilKickZVel * dt;

    this.recoilPitchVel += (-275 * this.recoilPitch - 22 * this.recoilPitchVel) * dt;
    this.recoilPitch += this.recoilPitchVel * dt;

    this.recoilRollVel += (-250 * this.recoilRoll - 20 * this.recoilRollVel) * dt;
    this.recoilRoll += this.recoilRollVel * dt;

    // 6. Cooldown, trigger, flashlight switch thumb-click, heat decay
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

    // 7. Two-Phase Tactical Weapon Switch:
    //    Phase 1: Put current weapon AWAY (over-the-back for big guns/blade, right hip for pistol, chest rig for light)
    //    Phase 2: Reach to the new weapon's physical holster (back / hip / chest) & whip it up into sightline!
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

        // Tactile physical catch weight when drawing heavy weapons off your back vs snappy hip draw!
        const drawZone = getWeaponHolsterZone(this.activeWeaponId);
        if (drawZone === 'back') {
          this.recoilPitchVel -= 1.35;
          this.recoilRollVel += 1.25;
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.16);
        } else if (drawZone === 'hip' || drawZone === 'chest') {
          this.recoilPitchVel += 0.95;
          this.recoilRollVel -= 0.75;
        }

        if (this.activeWeaponId === 'sword') {
          this.audio.playSwordDraw();
        } else if (
          this.activeWeaponId === 'futuristic' ||
          this.activeWeaponId === 'rustShotgun'
        ) {
          this.audio.playShotgunPump();
        } else if (this.activeWeaponId === 'flashlight') {
          this.audio.playFlashlightClick();
        } else if (this.activeWeaponId !== 'unarmed') {
          this.audio.playReloadStep('magIn', false);
        }
        this.emitHud();
      }

      const p = THREE.MathUtils.clamp(this.swapTimer / this.swapDuration, 0, 1);
      const inStowPhase = p < 0.48;
      const phaseFrac = inStowPhase ? p / 0.48 : 1 - (p - 0.48) / 0.52;
      // Smooth S-curve with brisk acceleration into holster & crisp settle on draw!
      const ease = phaseFrac * phaseFrac * (3 - 2 * phaseFrac);
      const zone = getWeaponHolsterZone(
        inStowPhase ? this.swapFromWeaponId : this.activeWeaponId,
      );

      if (zone === 'back') {
        // BIG WEAPONS (Shotguns, SMGs, Katana): Drop cleanly LOW & RIGHT below sightline so arms NEVER obstruct view!
        swapPosX = ease * 0.22;
        swapPosY = -ease * 0.38;
        swapPosZ = ease * 0.08;
        swapRotX = -ease * 0.56;
        swapRotY = -ease * 0.32;
        swapRotZ = -ease * 0.36;
        targetSwapCamRoll = -ease * 0.022;
        targetSwapCamPitch = -ease * 0.014;
      } else if (zone === 'hip') {
        // PISTOL SIDEARM: Fast low tactical tuck/draw at RIGHT HIP HOLSTER!
        swapPosX = ease * 0.22;
        swapPosY = -ease * 0.36;
        swapPosZ = ease * 0.10;
        swapRotX = -ease * 0.72;
        swapRotY = -ease * 0.22;
        swapRotZ = -ease * 0.36;
        targetSwapCamRoll = -ease * 0.016;
        targetSwapCamPitch = -ease * 0.012;
      } else if (zone === 'chest') {
        // COMPACT GEAR (Flashlight): Pull/clip cleanly LOW so arms stay out of center sightline!
        swapPosX = ease * 0.14;
        swapPosY = -ease * 0.34;
        swapPosZ = ease * 0.10;
        swapRotX = -ease * 0.52;
        swapRotY = -ease * 0.24;
        swapRotZ = -ease * 0.28;
        targetSwapCamRoll = -ease * 0.012;
        targetSwapCamPitch = -ease * 0.010;
      } else {
        // UNARMED: Clean low ready transition
        swapPosY = -ease * 0.20;
        swapRotX = -ease * 0.28;
      }

      if (this.swapTimer >= this.swapDuration) {
        this.swapTimer = 0;
      }
    }
    this.swapCamRoll = THREE.MathUtils.damp(this.swapCamRoll, targetSwapCamRoll, 13, dt);
    this.swapCamPitch = THREE.MathUtils.damp(this.swapCamPitch, targetSwapCamPitch, 13, dt);

    // Slide/bolt blowback (9mm pistol + Russian SMGs)
    if (isPistol || isSmg) {
      if (this.slideHoldTimer > 0) {
        this.slideHoldTimer = Math.max(0, this.slideHoldTimer - dt);
        this.slidePos = THREE.MathUtils.damp(this.slidePos, isPistol ? 0.074 : 0.066, 26, dt);
      } else if (!this.isReloading) {
        const slideRest = isPistol && this.ammo === 0 ? 0.068 : 0;
        this.slidePos = THREE.MathUtils.damp(this.slidePos, slideRest, 19, dt);
      } else if (this.reloadStartedEmpty && isPistol && this.reloadTime < 0.62) {
        this.slidePos = THREE.MathUtils.damp(this.slidePos, 0.068, 20, dt);
      } else if (this.reloadTime < 0.62) {
        this.slidePos = THREE.MathUtils.damp(this.slidePos, 0, 22, dt);
      }
    } else {
      this.slidePos = 0;
    }

    // Muzzle flash
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

    // =========================================================================
    // 8. CHOREOGRAPHY: RELOADS (Simultaneous Cocked-Up Dynamic Motion!),
    //    SHOTGUN PUMP, QUICK-MELEE OVER-THE-BACK KATANA SWIPE,
    //    ANIMATED GROUND PICKUPS (D⚡ DRINK + ITEMS + GUNS) & SWORD COMBO!
    // =========================================================================
    let reloadPosX = 0;
    let reloadPosY = 0;
    let reloadPosZ = 0;
    let reloadRotX = 0;
    let reloadRotY = 0;
    let reloadRotZ = 0;
    let targetReloadCamRoll = 0;
    let targetReloadCamPitch = 0;
    let targetSwordCamRoll = 0;
    let targetSwordCamPitch = 0;
    let targetPickupCamPitch = 0;
    let targetPickupCamRoll = 0;
    let targetPickupCamDipY = 0;
    let activePumpAmount = 0;
    let handsOverridden = false;

    // A. Post-shot Shotgun Mechanical Pump-Action Rack (VX-9 & KS-23)
    if (isShotgun && !this.isReloading && !this.quickMeleeActive && !this.pickupActive && this.shotgunPumpTimer >= 0) {
      this.shotgunPumpTimer += dt;
      const pt = this.shotgunPumpTimer;
      if (pt >= 0.14 && !this.shotgunPumpAudioPlayed) {
        this.audio.playShotgunPump();
        this.emitSoundEvent('pump', this.lastInputSource, 1.0);
        this.recoilRollVel += 1.45;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
        this.shotgunPumpAudioPlayed = true;
      }
      if (pt >= 0.25 && !this.shotgunShellEjected) {
        this.spawnShellCasing(true);
        this.shotgunShellEjected = true;
      }
      if (pt >= 0.13 && pt < 0.45) {
        const pull = THREE.MathUtils.smoothstep(pt, 0.13, 0.26);
        const push = THREE.MathUtils.smoothstep(pt, 0.29, 0.44);
        activePumpAmount = pull * (1 - push);
        reloadRotZ += activePumpAmount * 0.16;
        reloadRotX -= activePumpAmount * 0.08;
        reloadPosZ += activePumpAmount * 0.024;
      } else if (pt >= 0.46) {
        this.shotgunPumpTimer = -1;
      }
    }

    // B. VIOLENT, TACTILE, RIGHT-SIDE-UP COCKED RELOADS ACROSS ALL GUNS!
    if (this.isReloading && isPistol) {
      handsOverridden = true;
      this.reloadTime += dt;
      const t = this.reloadTime;
      const duration = 1.12;

      if (t >= 0.04 && this.reloadStageAudio < 1) {
        this.audio.playReloadStep('magOut', false);
        this.recoilRollVel -= 2.15;
        this.recoilPitchVel += 1.45;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
        this.reloadStageAudio = 1;
      }
      if (t >= 0.42 && this.reloadStageAudio < 2) {
        this.audio.playReloadStep('magIn', false);
        this.recoilPitchVel += 2.35;
        this.recoilKickZVel -= 0.34;
        this.recoilRollVel += 1.95;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
        this.reloadStageAudio = 2;
      }
      if (t >= 0.64 && this.reloadStageAudio < 3) {
        this.audio.playReloadStep('slideRack', false);
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
        this.reloadStageAudio = 3;
      }
      if (t >= 0.84 && this.reloadStageAudio < 4) {
        this.recoilKickZVel -= 0.62;
        this.recoilPitchVel -= 1.65;
        this.recoilRollVel -= 1.35;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.28);
        this.reloadStageAudio = 4;
      }

      const cockUp = THREE.MathUtils.smoothstep(t, 0.0, 0.14);
      const cockDown = 1 - THREE.MathUtils.smoothstep(t, duration - 0.18, duration);
      const cockEnv = cockUp * cockDown;
      const seatSlam = Math.sin(THREE.MathUtils.clamp((t - 0.34) / 0.20, 0, 1) * Math.PI);
      const rackTilt =
        THREE.MathUtils.smoothstep(t, 0.50, 0.64) *
        (1 - THREE.MathUtils.smoothstep(t, 0.88, 1.04));

      reloadPosX = -0.048 * cockEnv + 0.018 * rackTilt;
      reloadPosY = 0.038 * cockEnv + 0.032 * seatSlam - 0.010 * rackTilt;
      reloadPosZ = 0.058 * cockEnv + 0.018 * rackTilt;
      reloadRotX = 0.62 * cockEnv + 0.22 * seatSlam - 0.12 * rackTilt;
      reloadRotY = 0.36 * cockEnv + 0.14 * rackTilt;
      reloadRotZ = 0.76 * cockEnv - 0.16 * rackTilt;

      targetReloadCamRoll = 0.034 * cockEnv - 0.020 * rackTilt;
      targetReloadCamPitch = -0.022 * cockEnv + 0.026 * seatSlam;

      let magDrop = 0;
      if (t >= 0.02 && t < 0.24) {
        magDrop = THREE.MathUtils.smoothstep(t, 0.02, 0.22);
      } else if (t >= 0.24 && t < 0.45) {
        magDrop = 1 - THREE.MathUtils.smoothstep(t, 0.25, 0.44);
      }
      this.pistol9mm.magazineGroup.position.set(0, -magDrop * 0.22, magDrop * 0.075);

      let lx = this.leftHandRestPos.x;
      let ly = this.leftHandRestPos.y;
      let lz = this.leftHandRestPos.z;
      let openBlend = 0;
      let slidePinchBlend = 0;
      let overhandRotBlend = 0;

      const slideGripX = -0.054;
      const slideGripY = 0.046;
      const slideGripZ = 0.078;

      if (t < 0.24) {
        const p = THREE.MathUtils.smoothstep(t, 0.0, 0.22);
        const arcOutX = -Math.sin(p * Math.PI) * 0.032;
        lx = THREE.MathUtils.lerp(this.leftHandRestPos.x, -0.068, p) + arcOutX;
        ly = THREE.MathUtils.lerp(this.leftHandRestPos.y, -0.265, p);
        lz = THREE.MathUtils.lerp(this.leftHandRestPos.z, 0.142, p);
        openBlend = p * 0.85;
      } else if (t < 0.47) {
        const p = THREE.MathUtils.smoothstep(t, 0.24, 0.44);
        lx = THREE.MathUtils.lerp(-0.068, -0.034, p);
        ly = THREE.MathUtils.lerp(-0.265, -0.106, p);
        lz = THREE.MathUtils.lerp(0.142, 0.082, p);
        openBlend = THREE.MathUtils.lerp(0.85, 0.42, p);
      } else if (t < 0.64) {
        const p = THREE.MathUtils.smoothstep(t, 0.47, 0.63);
        const arcOutX = -Math.sin(p * Math.PI) * 0.048;
        const arcUpY = Math.sin(p * Math.PI) * 0.032;
        lx = THREE.MathUtils.lerp(-0.034, slideGripX, p) + arcOutX;
        ly = THREE.MathUtils.lerp(-0.106, slideGripY, p) + arcUpY;
        lz = THREE.MathUtils.lerp(0.082, slideGripZ, p);
        openBlend = THREE.MathUtils.lerp(0.42, 0.88, p);
        slidePinchBlend = THREE.MathUtils.smoothstep(t, 0.54, 0.64);
        overhandRotBlend = p;
      } else if (t < 0.90) {
        const pullBack = THREE.MathUtils.smoothstep(t, 0.64, 0.80);
        const releaseBack = THREE.MathUtils.smoothstep(t, 0.82, 0.88);
        const slideTravel = pullBack * (1 - releaseBack);
        const baseLock = this.reloadStartedEmpty ? 0.068 : 0;

        this.slidePos = Math.max(baseLock * (1 - releaseBack), slideTravel * 0.074);

        lx = slideGripX - releaseBack * 0.034;
        ly = slideGripY + releaseBack * 0.018;
        lz = slideGripZ + pullBack * 0.072 + releaseBack * 0.022;
        reloadPosZ -= slideTravel * 0.034;
        reloadRotX -= slideTravel * 0.18;
        reloadRotZ += slideTravel * 0.16;

        openBlend = 0.88;
        slidePinchBlend = 1 - releaseBack * 0.68;
        overhandRotBlend = 1.0;
      } else {
        const p = THREE.MathUtils.smoothstep(t, 0.90, duration);
        const arcOutX = -Math.sin(p * Math.PI) * 0.032;
        lx = THREE.MathUtils.lerp(slideGripX - 0.034, this.leftHandRestPos.x, p) + arcOutX;
        ly = THREE.MathUtils.lerp(slideGripY + 0.018, this.leftHandRestPos.y, p);
        lz = THREE.MathUtils.lerp(slideGripZ + 0.094, this.leftHandRestPos.z, p);
        this.slidePos = THREE.MathUtils.damp(this.slidePos, 0, 26, dt);
        openBlend = THREE.MathUtils.lerp(0.75, 0, p);
        slidePinchBlend = THREE.MathUtils.lerp(0.35, 0, p);
        overhandRotBlend = 1 - p;
      }

      this.hands.leftHandGroup.position.set(lx, ly, lz);
      this.hands.setLeftHandReloadPose(openBlend, slidePinchBlend);

      // Verified RIGHT-SIDE-UP overhand slide pinch (dorsal back UP, fingers pinching DOWN onto slide!)
      this.hands.leftHandGroup.quaternion
        .copy(this.reloadMagQuat)
        .slerp(this.reloadOverhandQuat, overhandRotBlend);

      if (t >= duration) {
        this.isReloading = false;
        this.reloadStartedEmpty = false;
        this.ammo = this.maxAmmo;
        this.pistol9mm.magazineGroup.position.set(0, 0, 0);
        this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
        this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
        this.hands.setLeftHandReloadPose(0, 0);
        this.emitSoundEvent('reload_end', this.lastInputSource);
        this.emitHud();
      }
    } else if (this.isReloading && isShotgun) {
      // VX-9 & KS-23 Shotguns: VIOLENT COCKED-UP SHELL STUFF + HEAVY PUMP CLACK!
      handsOverridden = true;
      this.reloadTime += dt;
      const t = this.reloadTime;
      const duration = 1.36;
      const shellMesh = isVx9
        ? this.futuristicGun.shellInsertMesh
        : this.rustShotgun.shellInsertMesh!;

      if (t >= 0.24 && this.reloadStageAudio < 1) {
        this.audio.playShellInsert();
        this.recoilPitchVel += 1.95;
        this.recoilRollVel -= 1.45;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
        this.reloadStageAudio = 1;
      }
      if (t >= 0.58 && this.reloadStageAudio < 2) {
        this.audio.playShellInsert();
        this.recoilPitchVel += 1.95;
        this.recoilRollVel -= 1.45;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
        this.reloadStageAudio = 2;
      }
      if (t >= 0.88 && this.reloadStageAudio < 3) {
        this.audio.playShotgunPump();
        this.emitSoundEvent('pump', this.lastInputSource, 1.0);
        this.recoilKickZVel -= 0.45;
        this.recoilRollVel += 1.85;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
        this.fireHeat = Math.max(this.fireHeat, 0.45);
        this.reloadStageAudio = 3;
      }

      const cockIn = THREE.MathUtils.smoothstep(t, 0.0, 0.14);
      const cockOut = 1 - THREE.MathUtils.smoothstep(t, duration - 0.18, duration);
      const cockEnv = cockIn * cockOut;
      const pumpRelax = THREE.MathUtils.smoothstep(t, 0.78, 0.94);

      const bump1 = Math.sin(THREE.MathUtils.clamp((t - 0.18) / 0.18, 0, 1) * Math.PI);
      const bump2 = Math.sin(THREE.MathUtils.clamp((t - 0.52) / 0.18, 0, 1) * Math.PI);

      reloadPosX = -0.044 * cockEnv + 0.018 * pumpRelax * cockEnv;
      reloadPosY = 0.048 * cockEnv + (bump1 + bump2) * 0.034 - 0.016 * pumpRelax * cockEnv;
      reloadPosZ = 0.072 * cockEnv;
      reloadRotX =
        (0.66 - 0.26 * pumpRelax) * cockEnv + (bump1 + bump2) * 0.18;
      reloadRotY = 0.30 * cockEnv;
      reloadRotZ = (0.82 - 0.36 * pumpRelax) * cockEnv;

      targetReloadCamRoll = 0.036 * cockEnv;
      targetReloadCamPitch = -0.022 * cockEnv + (bump1 + bump2) * 0.024;

      let lx = this.leftHandRestPos.x;
      let ly = this.leftHandRestPos.y;
      let lz = this.leftHandRestPos.z;
      let openBlend = 0;
      let shellHandBlend = 0;

      if (t < 0.34) {
        const dropP = THREE.MathUtils.smoothstep(t, 0.0, 0.14);
        const feedP = THREE.MathUtils.smoothstep(t, 0.14, 0.31);
        shellHandBlend = THREE.MathUtils.smoothstep(t, 0.0, 0.14);
        if (t < 0.14) {
          lx = THREE.MathUtils.lerp(this.leftHandRestPos.x, -0.088, dropP);
          ly = THREE.MathUtils.lerp(this.leftHandRestPos.y, -0.245, dropP);
          lz = THREE.MathUtils.lerp(this.leftHandRestPos.z, -0.025, dropP);
          shellMesh.visible = false;
        } else {
          lx = THREE.MathUtils.lerp(-0.088, -0.032, feedP);
          ly = THREE.MathUtils.lerp(-0.245, -0.068, feedP);
          lz = THREE.MathUtils.lerp(-0.025, -0.075, feedP);
          shellMesh.visible = feedP < 0.92;
          shellMesh.position.set(
            0,
            THREE.MathUtils.lerp(-0.155, -0.022, feedP),
            THREE.MathUtils.lerp(-0.045, -0.095, feedP),
          );
        }
        openBlend = 0.62;
      } else if (t < 0.70) {
        const dropP = THREE.MathUtils.smoothstep(t, 0.34, 0.48);
        const feedP = THREE.MathUtils.smoothstep(t, 0.48, 0.66);
        shellHandBlend = 1.0;
        if (t < 0.48) {
          lx = THREE.MathUtils.lerp(-0.032, -0.088, dropP);
          ly = THREE.MathUtils.lerp(-0.068, -0.245, dropP);
          lz = THREE.MathUtils.lerp(-0.075, -0.025, dropP);
          shellMesh.visible = false;
        } else {
          lx = THREE.MathUtils.lerp(-0.088, -0.032, feedP);
          ly = THREE.MathUtils.lerp(-0.245, -0.068, feedP);
          lz = THREE.MathUtils.lerp(-0.025, -0.075, feedP);
          shellMesh.visible = feedP < 0.92;
          shellMesh.position.set(
            0,
            THREE.MathUtils.lerp(-0.155, -0.022, feedP),
            THREE.MathUtils.lerp(-0.045, -0.095, feedP),
          );
        }
        openBlend = 0.62;
      } else if (t < 0.87) {
        shellMesh.visible = false;
        const p = THREE.MathUtils.smoothstep(t, 0.70, 0.86);
        shellHandBlend = 1 - p;
        lx = THREE.MathUtils.lerp(-0.032, this.leftHandRestPos.x, p);
        ly = THREE.MathUtils.lerp(-0.068, this.leftHandRestPos.y, p);
        lz = THREE.MathUtils.lerp(-0.075, this.leftHandRestPos.z, p);
        openBlend = THREE.MathUtils.lerp(0.62, 0, p);
      } else {
        shellMesh.visible = false;
        shellHandBlend = 0;
        const pull = THREE.MathUtils.smoothstep(t, 0.87, 1.06);
        const push = THREE.MathUtils.smoothstep(t, 1.09, 1.28);
        activePumpAmount = pull * (1 - push);
        lx = this.leftHandRestPos.x;
        ly = this.leftHandRestPos.y;
        lz = this.leftHandRestPos.z + activePumpAmount * 0.11;
        reloadPosZ += activePumpAmount * 0.038;
        reloadRotZ += activePumpAmount * 0.20;
        reloadRotX -= activePumpAmount * 0.13;
        openBlend = 0;
      }

      this.hands.leftHandGroup.position.set(lx, ly, lz);
      this.hands.leftHandGroup.quaternion
        .copy(this.leftHandRestQuat)
        .slerp(this.reloadShellQuat, shellHandBlend);
      this.hands.setLeftHandReloadPose(openBlend, 0);

      if (t >= duration) {
        this.isReloading = false;
        this.reloadStartedEmpty = false;
        this.ammo = this.maxAmmo;
        shellMesh.visible = false;
        this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
        this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
        this.hands.setLeftHandReloadPose(0, 0);
        this.emitSoundEvent('reload_end', this.lastInputSource);
        this.emitHud();
      }
    } else if (this.isReloading && isSmg && gunRig) {
      // PP-41 & AK-74M SMGs: VIOLENT COCKED-UP MAG SLAM + RIGHT-SIDE-UP OVERHAND CHARGING HANDLE PINCH!
      handsOverridden = true;
      this.reloadTime += dt;
      const t = this.reloadTime;
      const duration = 1.24;

      if (t >= 0.05 && this.reloadStageAudio < 1) {
        this.audio.playReloadStep('magOut', false);
        this.recoilRollVel -= 2.1;
        this.recoilPitchVel += 1.2;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
        this.reloadStageAudio = 1;
      }
      if (t >= 0.50 && this.reloadStageAudio < 2) {
        this.audio.playReloadStep('magIn', false);
        this.recoilPitchVel += 2.3;
        this.recoilRollVel += 1.9;
        this.recoilKickZVel -= 0.30;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
        this.reloadStageAudio = 2;
      }
      if (t >= 0.78 && this.reloadStageAudio < 3) {
        this.audio.playReloadStep('slideRack', false);
        this.recoilKickZVel -= 0.42;
        this.recoilRollVel -= 1.45;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.26);
        this.reloadStageAudio = 3;
      }

      const cockUp = THREE.MathUtils.smoothstep(t, 0.0, 0.15);
      const cockDown = 1 - THREE.MathUtils.smoothstep(t, duration - 0.18, duration);
      const cockEnv = cockUp * cockDown;
      const magSlam = Math.sin(THREE.MathUtils.clamp((t - 0.42) / 0.20, 0, 1) * Math.PI);
      const boltTilt =
        THREE.MathUtils.smoothstep(t, 0.62, 0.76) *
        (1 - THREE.MathUtils.smoothstep(t, 1.02, 1.18));

      reloadPosX = -0.046 * cockEnv + 0.020 * boltTilt;
      reloadPosY = 0.042 * cockEnv + 0.030 * magSlam;
      reloadPosZ = 0.058 * cockEnv;
      reloadRotX = 0.58 * cockEnv + 0.18 * magSlam - 0.15 * boltTilt;
      reloadRotY = 0.32 * cockEnv;
      reloadRotZ = 0.74 * cockEnv - 0.28 * boltTilt;

      targetReloadCamRoll = 0.032 * cockEnv - 0.018 * boltTilt;
      targetReloadCamPitch = -0.020 * cockEnv + 0.024 * magSlam;

      let magDrop = 0;
      if (t >= 0.03 && t < 0.28) {
        magDrop = THREE.MathUtils.smoothstep(t, 0.03, 0.26);
      } else if (t >= 0.28 && t < 0.52) {
        magDrop = 1 - THREE.MathUtils.smoothstep(t, 0.30, 0.51);
      }
      gunRig.magazineGroup.position.set(0, -magDrop * 0.24, magDrop * 0.05);
      gunRig.magazineGroup.rotation.x = magDrop * 0.38;

      let lx = this.leftHandRestPos.x;
      let ly = this.leftHandRestPos.y;
      let lz = this.leftHandRestPos.z;
      let openBlend = 0;
      let slidePinch = 0;

      if (t < 0.28) {
        const p = THREE.MathUtils.smoothstep(t, 0.0, 0.26);
        lx = THREE.MathUtils.lerp(this.leftHandRestPos.x, -0.064, p);
        ly = THREE.MathUtils.lerp(this.leftHandRestPos.y, -0.26, p);
        lz = THREE.MathUtils.lerp(this.leftHandRestPos.z, -0.10, p);
        openBlend = p * 0.78;
        // Rotate cleanly from underhand grip into right-side-up magazine grip!
        this.hands.leftHandGroup.quaternion
          .copy(this.leftHandRestQuat)
          .slerp(this.reloadMagQuat, p);
      } else if (t < 0.55) {
        const p = THREE.MathUtils.smoothstep(t, 0.28, 0.51);
        lx = THREE.MathUtils.lerp(-0.064, -0.038, p);
        ly = THREE.MathUtils.lerp(-0.26, -0.11, p);
        lz = THREE.MathUtils.lerp(-0.10, -0.13, p);
        openBlend = THREE.MathUtils.lerp(0.78, 0.40, p);
        this.hands.leftHandGroup.quaternion.copy(this.reloadMagQuat);
      } else if (t < 0.76) {
        // Reach UP and rotate cleanly into RIGHT-SIDE-UP overhand charging-handle pinch!
        const p = THREE.MathUtils.smoothstep(t, 0.55, 0.74);
        lx = THREE.MathUtils.lerp(-0.038, -0.022, p);
        ly = THREE.MathUtils.lerp(-0.11, 0.044, p);
        lz = THREE.MathUtils.lerp(-0.13, -0.055, p);
        openBlend = 0.80;
        slidePinch = THREE.MathUtils.smoothstep(t, 0.66, 0.76);
        this.hands.leftHandGroup.quaternion
          .copy(this.reloadMagQuat)
          .slerp(this.reloadOverhandQuat, p);
      } else if (t < 1.02) {
        const pull = THREE.MathUtils.smoothstep(t, 0.76, 0.91);
        const rel = THREE.MathUtils.smoothstep(t, 0.93, 1.00);
        const travel = pull * (1 - rel);
        this.slidePos = travel * 0.070;
        lx = -0.022 - rel * 0.03;
        ly = 0.044 + rel * 0.015;
        lz = -0.055 + pull * 0.072;
        reloadPosZ -= travel * 0.028;
        reloadRotX -= travel * 0.12;
        openBlend = 0.80;
        slidePinch = 1 - rel * 0.6;
        this.hands.leftHandGroup.quaternion.copy(this.reloadOverhandQuat);
      } else {
        const p = THREE.MathUtils.smoothstep(t, 1.02, duration);
        lx = THREE.MathUtils.lerp(-0.052, this.leftHandRestPos.x, p);
        ly = THREE.MathUtils.lerp(0.059, this.leftHandRestPos.y, p);
        lz = THREE.MathUtils.lerp(0.017, this.leftHandRestPos.z, p);
        this.slidePos = THREE.MathUtils.damp(this.slidePos, 0, 26, dt);
        openBlend = THREE.MathUtils.lerp(0.7, 0, p);
        slidePinch = THREE.MathUtils.lerp(0.4, 0, p);
        this.hands.leftHandGroup.quaternion
          .copy(this.reloadOverhandQuat)
          .slerp(this.leftHandRestQuat, p);
      }

      this.hands.leftHandGroup.position.set(lx, ly, lz);
      this.hands.setLeftHandReloadPose(openBlend, slidePinch);

      if (t >= duration) {
        this.isReloading = false;
        this.reloadStartedEmpty = false;
        this.ammo = this.maxAmmo;
        gunRig.magazineGroup.position.set(0, 0, 0);
        gunRig.magazineGroup.rotation.set(0, 0, 0);
        this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
        this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
        this.hands.setLeftHandReloadPose(0, 0);
        this.emitSoundEvent('reload_end', this.lastInputSource);
        this.emitHud();
      }
    } else if (this.isReloading && isSword) {
      // Tactical Katana Stylish Blade Flourish (arms stay low below screen!)
      this.reloadTime += dt;
      const t = this.reloadTime;
      const duration = 1.04;
      const env =
        THREE.MathUtils.smoothstep(t, 0.0, 0.18) *
        (1 - THREE.MathUtils.smoothstep(t, duration - 0.24, duration));
      const sweep = Math.sin(THREE.MathUtils.clamp(t / duration, 0, 1) * Math.PI * 2);

      reloadPosX = -0.10 * env;
      reloadPosY = -0.02 * env + Math.sin(t * Math.PI * 2) * 0.015 * env;
      reloadPosZ = 0.02 * env;
      reloadRotX = -0.24 * env + sweep * 0.18 * env;
      reloadRotY = 0.65 * env + Math.sin((t / duration) * Math.PI * 2) * 0.85 * env;
      reloadRotZ = 0.56 * env - sweep * 0.35 * env;
      targetReloadCamRoll = 0.018 * env;

      if (t >= duration) {
        this.isReloading = false;
        this.emitHud();
      }
    } else if (this.isReloading && isFlashlight) {
      // Plain Flashlight Tactile Palm-Tap & Flicker Bulb Check!
      handsOverridden = true;
      this.reloadTime += dt;
      const t = this.reloadTime;
      const duration = 0.78;
      const env =
        THREE.MathUtils.smoothstep(t, 0.0, 0.16) *
        (1 - THREE.MathUtils.smoothstep(t, duration - 0.18, duration));
      const tap1 = Math.exp(-Math.pow((t - 0.28) / 0.06, 2));
      const tap2 = Math.exp(-Math.pow((t - 0.48) / 0.06, 2));

      reloadPosX = -0.05 * env;
      reloadPosY = 0.03 * env - (tap1 + tap2) * 0.016;
      reloadRotZ = 0.42 * env;
      reloadRotX = 0.24 * env - (tap1 + tap2) * 0.08;

      this.hands.leftHandGroup.position.set(
        THREE.MathUtils.lerp(this.leftHandRestPos.x, -0.04, env) + (tap1 + tap2) * 0.035,
        THREE.MathUtils.lerp(this.leftHandRestPos.y, 0.025, env),
        THREE.MathUtils.lerp(this.leftHandRestPos.z, -0.09, env),
      );
      this.hands.setLeftHandReloadPose(env * 0.75, 0);

      if (t >= duration) {
        this.isReloading = false;
        this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
        this.hands.setLeftHandReloadPose(0, 0);
        this.emitHud();
      }
    }

    // C. ANIMATED OVER-THE-BACK QUICK-MELEE KATANA SWIPE (Blade commands frame, arms stay cleanly below screen!)
    let qmPosX = 0;
    let qmPosY = 0;
    let qmPosZ = 0;
    let qmRotX = 0;
    let qmRotY = 0;
    let qmRotZ = 0;

    if (this.quickMeleeActive) {
      this.quickMeleeTime += dt;
      const t = this.quickMeleeTime;

      if (t < 0.20) {
        // Phase 1: Tuck active weapon away
        const p = THREE.MathUtils.smoothstep(t, 0.0, 0.20);
        qmPosX = -0.18 * p;
        qmPosY = -0.34 * p;
        qmPosZ = 0.08 * p;
        qmRotX = -0.66 * p;
        qmRotY = 0.28 * p;
        qmRotZ = 0.42 * p;
        targetSwordCamRoll = 0.018 * p;
      } else if (t < 0.44) {
        // Phase 2: Reach over right shoulder to unsheathe Katana — blade gleams across right side, arms stay below screen!
        if (this.quickMeleeStage < 1) {
          this.quickMeleeStage = 1;
          this.activeWeaponId = 'sword';
          this.applyVisibleWeaponRig('sword');
          this.audio.playSwordDraw();
          this.emitSoundEvent('weapon_raise', this.lastInputSource);
          this.emitHud();
        }
        const p = THREE.MathUtils.smoothstep(t, 0.20, 0.44);
        qmPosX = THREE.MathUtils.lerp(0.28, 0.14, p);
        qmPosY = THREE.MathUtils.lerp(0.06, -0.02, p);
        qmPosZ = THREE.MathUtils.lerp(0.14, 0.02, p);
        qmRotX = THREE.MathUtils.lerp(0.76, 0.36, p);
        qmRotY = THREE.MathUtils.lerp(-0.44, -0.58, p);
        qmRotZ = THREE.MathUtils.lerp(-0.88, -0.78, p);
        targetSwordCamRoll = THREE.MathUtils.lerp(-0.026, -0.018, p);
        targetSwordCamPitch = THREE.MathUtils.lerp(0.018, 0.012, p);
      } else if (t < 0.78) {
        // Phase 3: Vicious diagonal Katana swipe — pure razor steel sweeping the viewport, arms kept below screen!
        if (this.quickMeleeStage < 2) {
          this.quickMeleeStage = 2;
          this.audio.playSwordSwing(0);
          this.emitSoundEvent('swing', this.lastInputSource, 1.0);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
          this.shotsFired += 1;
        }
        const raw = THREE.MathUtils.clamp((t - 0.44) / 0.30, 0, 1);
        const strike =
          raw < 0.5
            ? 4 * raw * raw * raw
            : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        if (!this.quickMeleeHitChecked && raw >= 0.42) {
          this.quickMeleeHitChecked = true;
          this.checkSwordWallHit();
        }
        qmPosX = THREE.MathUtils.lerp(0.14, -0.22, strike);
        qmPosY = THREE.MathUtils.lerp(-0.02, -0.14, strike);
        qmPosZ = THREE.MathUtils.lerp(0.02, -0.06, strike);
        qmRotX = THREE.MathUtils.lerp(0.36, -0.96, strike);
        qmRotY = THREE.MathUtils.lerp(-0.58, 1.08, strike);
        qmRotZ = THREE.MathUtils.lerp(-0.78, 1.28, strike);
        targetSwordCamRoll = THREE.MathUtils.lerp(-0.018, 0.048, strike);
        targetSwordCamPitch = THREE.MathUtils.lerp(0.012, -0.028, strike);
        const trail = Math.sin(Math.min(1, raw * 1.15) * Math.PI);
        this.sword.setSlashTrail(trail * 1.0);
      } else if (t < 1.02) {
        // Phase 4: Arc blade back over right shoulder to sheathe
        if (this.quickMeleeStage < 3) {
          this.quickMeleeStage = 3;
          this.sword.setSlashTrail(0);
          this.audio.playSwordDraw();
          this.emitSoundEvent('weapon_lower', this.lastInputSource);
        }
        const p = THREE.MathUtils.smoothstep(t, 0.78, 1.02);
        qmPosX = THREE.MathUtils.lerp(-0.22, 0.28, p);
        qmPosY = THREE.MathUtils.lerp(-0.14, 0.06, p);
        qmPosZ = THREE.MathUtils.lerp(-0.06, 0.14, p);
        qmRotX = THREE.MathUtils.lerp(-0.96, 0.76, p);
        qmRotY = THREE.MathUtils.lerp(1.08, -0.44, p);
        qmRotZ = THREE.MathUtils.lerp(1.28, -0.88, p);
        targetSwordCamRoll = THREE.MathUtils.lerp(0.048, -0.024, p);
        targetSwordCamPitch = THREE.MathUtils.lerp(-0.028, 0.016, p);
      } else if (t < 1.28) {
        // Phase 5: Raise original weapon cleanly back into hand!
        if (this.quickMeleeStage < 4) {
          this.quickMeleeStage = 4;
          this.activeWeaponId = this.quickMeleeReturnWeapon;
          this.applyVisibleWeaponRig(this.activeWeaponId);
          this.hands.resetRightElbowPose();
          this.hands.resetLeftElbowPose();
          this.audio.playReloadStep('magIn', this.activeWeaponId === 'futuristic');
          this.emitSoundEvent('weapon_raise', this.lastInputSource);
          this.emitHud();
        }
        const p = THREE.MathUtils.smoothstep(t, 1.02, 1.28);
        const inv = 1 - p;
        qmPosX = -0.18 * inv;
        qmPosY = -0.34 * inv;
        qmPosZ = 0.08 * inv;
        qmRotX = -0.66 * inv;
        qmRotY = 0.28 * inv;
        qmRotZ = 0.42 * inv;
        targetSwordCamRoll = 0.016 * inv;
      } else {
        this.quickMeleeActive = false;
        this.quickMeleeTime = 0;
        this.sword.setSlashTrail(0);
        this.hands.resetRightElbowPose();
        this.hands.resetLeftElbowPose();
        this.emitHud();
      }
    }

    // D. ANIMATED GROUND PICKUPS (D⚡ Energy Drink Can, General Items, Floor Guns!)
    let puPosX = 0;
    let puPosY = 0;
    let puPosZ = 0;
    let puRotX = 0;
    let puRotY = 0;
    let puRotZ = 0;

    let targetPickupCamYaw = 0;
    let targetDrinkDof = 0;

    if (this.pickupActive && this.pickupItem) {
      handsOverridden = true;
      this.pickupTime += dt;
      const t = this.pickupTime;
      const item = this.pickupItem;

      if (item.kind === 'drink') {
        // HERO CAN-FOCUS DRINK SEQUENCE + RACK-FOCUS F/1.2 BOKEH + BACKWARDS OVER-THE-SHOULDER TOSS!
        // Bend down -> lock into left palm (Layer 1 razor-sharp!) -> hold big & readable close to face
        // while room racks into creamy F/1.2 bokeh -> tilt to mouth at bottom of camera ->
        // swing joint windup & whip backwards over left shoulder with camera sway & hint of Gaussian!
        const dur = this.pickupDuration;
        const cantIn = THREE.MathUtils.smoothstep(t, 0.0, 0.28);
        const cantOut = 1 - THREE.MathUtils.smoothstep(t, dur - 0.30, dur);
        const cantEnv = cantIn * cantOut;

        // Tuck active right-hand gun cleanly down-right so the huge close-up D⚡ can owns the hero foreground!
        puPosX = 0.20 * cantEnv;
        puPosY = -0.16 * cantEnv;
        puPosZ = 0.02 * cantEnv;
        puRotX = -0.10 * cantEnv;
        puRotY = -0.14 * cantEnv;
        puRotZ = -0.20 * cantEnv;

        const bendDown =
          THREE.MathUtils.smoothstep(t, 0.0, 0.42) *
          (1 - THREE.MathUtils.smoothstep(t, 0.48, 0.90));
        const swigTilt =
          THREE.MathUtils.smoothstep(t, 1.52, 1.80) *
          (1 - THREE.MathUtils.smoothstep(t, 2.08, 2.28));
        const gulpBob =
          Math.exp(-Math.pow((t - 1.82) / 0.065, 2)) +
          Math.exp(-Math.pow((t - 2.02) / 0.065, 2));
        // Joint-driven anticipatory windup sway -> sweeping over-the-left-shoulder toss follow-through!
        const windupSway =
          THREE.MathUtils.smoothstep(t, 2.18, 2.44) *
          (1 - THREE.MathUtils.smoothstep(t, 2.44, 2.60));
        const tossWhip =
          Math.sin(THREE.MathUtils.clamp((t - 2.44) / 0.36, 0, 1) * Math.PI);

        targetPickupCamDipY = -0.68 * bendDown;
        targetPickupCamPitch =
          -0.30 * bendDown +
          0.11 * swigTilt +
          0.022 * gulpBob -
          0.024 * windupSway +
          0.056 * tossWhip;
        targetPickupCamYaw = -0.028 * windupSway + 0.088 * tossWhip;
        targetPickupCamRoll =
          0.042 * bendDown -
          0.026 * swigTilt -
          0.036 * windupSway +
          0.072 * tossWhip;

        // Creamy F/1.2 Rack-Focus Background Blur: ramps up smoothly as the big can enters close-up
        // (readable hold + close-up drink), then cleanly racks focus back onto the room on toss!
        const dofIn = THREE.MathUtils.smoothstep(t, 0.62, 1.06);
        const dofOut = 1 - THREE.MathUtils.smoothstep(t, 2.12, 2.48);
        targetDrinkDof = dofIn * dofOut;

        let reachPose = 0;
        let grabPose = 0;

        if (t < 0.44) {
          // Phase 1: Bend down & extend left hand toward floor can
          const p = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
          this.hands.leftHandGroup.position
            .copy(this.leftHandRestPos)
            .lerp(this.drinkReachPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.leftHandRestQuat)
            .slerp(this.drinkReachQuat, p);
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.42, -0.22, p),
            -0.20,
            0,
          );
          reachPose = p;
          grabPose = THREE.MathUtils.smoothstep(t, 0.32, 0.44);
        } else if (t < 0.90) {
          // Phase 2: Lock can into leftPalmSocket on Layer 1 (razor-sharp above F/1.2 bokeh!) & raise big close-up!
          if (this.pickupStage < 1) {
            this.pickupStage = 1;
            this.audio.playPickup(false);
            this.camera.updateMatrixWorld(true);
            this.hands.leftPalmSocket.attach(item.mesh);
            this.setObjectLayer(item.mesh, 1);
            this.pickupGrabLocalPos.copy(item.mesh.position);
            this.pickupGrabLocalQuat.copy(item.mesh.quaternion);
            this.emitHud();
          }
          const p = THREE.MathUtils.smoothstep(t, 0.44, 0.90);
          this.hands.leftHandGroup.position
            .copy(this.drinkReachPos)
            .lerp(this.drinkHoldPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkReachQuat)
            .slerp(this.drinkHoldQuat, p);
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.22, -0.34, p),
            -0.18,
            0,
          );
          reachPose = 1;
          grabPose = 1;

          const seatP = THREE.MathUtils.smoothstep(t, 0.44, 0.62);
          _vecA.set(0, -0.075, 0);
          _eulerA.set(0, Math.PI * 0.14, 0, 'YXZ');
          _quatB.setFromEuler(_eulerA);
          item.mesh.position.copy(this.pickupGrabLocalPos).lerp(_vecA, seatP);
          item.mesh.quaternion.copy(this.pickupGrabLocalQuat).slerp(_quatB, seatP);
        } else if (t < 1.54) {
          // Phase 3: Big Readable Hero Showcase (0.64s) — D⚡ label takes up a bold chunk of the screen
          // so you can clearly read the side while the room melts into F/1.2 bokeh & crack the pull-tab!
          if (this.pickupStage < 2 && t >= 1.02) {
            this.pickupStage = 2;
            this.audio.playDrinkCrack();
            this.recoilPitchVel += 0.36;
            this.emitHud();
          }
          const crackBump = Math.exp(-Math.pow((t - 1.04) / 0.055, 2));
          const inspectRoll = Math.sin((t - 0.90) * 3.8) * 0.048;
          this.hands.leftHandGroup.position.set(
            this.drinkHoldPos.x,
            this.drinkHoldPos.y + crackBump * 0.012,
            this.drinkHoldPos.z,
          );
          _eulerA.set(-crackBump * 0.11, inspectRoll, 0, 'YXZ');
          _quatB.setFromEuler(_eulerA);
          this.hands.leftHandGroup.quaternion.copy(this.drinkHoldQuat).multiply(_quatB);
          this.hands.setLeftElbowPose(-0.34, -0.18, 0);

          item.mesh.position.set(0, -0.075, 0);
          item.mesh.rotation.set(0, Math.PI * 0.14 + inspectRoll * 0.6, 0);
          reachPose = 1;
          grabPose = 1;
        } else if (t < 2.18) {
          // Phase 4: Close-Up Chug — mouth at bottom of camera, forearm tucked cleanly below screen,
          // huge sharp glistening can tilting toward the bottom lens against full F/1.2 background bokeh!
          if (this.pickupStage < 3 && t >= 1.72) {
            this.pickupStage = 3;
            this.audio.playDrinkGulp();
            this.emitHud();
          }
          const curlUp = THREE.MathUtils.smoothstep(t, 1.54, 1.82);
          const gulpShift = gulpBob * 0.012;
          this.hands.leftHandGroup.position
            .copy(this.drinkHoldPos)
            .lerp(this.drinkSwigPos, curlUp);
          this.hands.leftHandGroup.position.y += gulpShift;
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkHoldQuat)
            .slerp(this.drinkSwigQuat, curlUp);
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.34, -0.44, curlUp),
            -0.16,
            0,
          );

          item.mesh.position.set(0, -0.075, 0);
          item.mesh.rotation.set(0, Math.PI * 0.14, 0);
          reachPose = 1;
          grabPose = 1;
        } else if (t < 2.46) {
          // Phase 5: Joint-driven down-left swing windup (elbow loads up smoothly for backwards shoulder toss!)
          const p = THREE.MathUtils.smoothstep(t, 2.18, 2.46);
          const swingArcY = -Math.sin(p * Math.PI) * 0.028;
          this.hands.leftHandGroup.position
            .copy(this.drinkSwigPos)
            .lerp(this.drinkTossWindupPos, p);
          this.hands.leftHandGroup.position.y += swingArcY;
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkSwigQuat)
            .slerp(this.drinkTossWindupQuat, p);
          // Progressive elbow-joint windup curl
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.44, -0.88, p),
            THREE.MathUtils.lerp(-0.16, -0.36, p),
            THREE.MathUtils.lerp(0, 0.18, p),
          );

          item.mesh.position.set(0, -0.075, 0);
          item.mesh.rotation.set(0, Math.PI * 0.14, 0);
          reachPose = 1;
          grabPose = 1;
        } else if (t < 2.82) {
          // Phase 6: Carefree BACKWARDS OVER-THE-LEFT-SHOULDER TOSS with joint swing mechanics,
          // organic camera sway & a crisp hint of Gaussian whip blur!
          const flickP = THREE.MathUtils.smoothstep(t, 2.46, 2.74);
          // Pendulum swing arc lifting cleanly out & back over the left shoulder
          const swingArcX = -Math.sin(flickP * Math.PI) * 0.045;
          const swingArcY = Math.sin(flickP * Math.PI) * 0.055;
          this.hands.leftHandGroup.position
            .copy(this.drinkTossWindupPos)
            .lerp(this.drinkTossFlickPos, flickP);
          this.hands.leftHandGroup.position.x += swingArcX;
          this.hands.leftHandGroup.position.y += swingArcY;
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkTossWindupQuat)
            .slerp(this.drinkTossFlickQuat, flickP);
          // Elbow & wrist joint follow-through whip!
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.88, -1.24, Math.sin(flickP * Math.PI * 0.72)),
            THREE.MathUtils.lerp(-0.36, 0.24, flickP),
            THREE.MathUtils.lerp(0.18, -0.26, flickP),
          );

          // Launch empty can physically BACKWARDS over the player's left shoulder right at apex!
          if (this.pickupStage < 4 && t >= 2.55) {
            this.pickupStage = 4;
            this.audio.playCanToss();
            // Hint of Gaussian whip blur + subtle shoulder toss kick
            this.shotImpactBlur = Math.max(this.shotImpactBlur, 0.34);
            this.blurVelX += 0.0085;
            this.blurVelY -= 0.0055;
            this.camera.updateMatrixWorld(true);

            // Capture exact world transform of can & restore Layer 0 so tossed can renders in World space!
            item.mesh.getWorldPosition(_vecA);
            item.mesh.getWorldQuaternion(_quatB);
            this.setObjectLayer(item.mesh, 0);

            // Backwards over-the-left-shoulder lobbed throw + brisk end-over-end tumble spin!
            this.camera.getWorldDirection(_vecB);
            _vecC.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
            const throwVel = _vecD
              .copy(_vecB)
              .multiplyScalar(-3.15)
              .addScaledVector(_vecC, -1.95);
            throwVel.y += 2.65;
            throwVel.x += this.moveVel.x * 0.45;
            throwVel.z += this.moveVel.z * 0.45;

            _vecB.set(-14.5, 7.2, 13.8);
            this.groundPickups.launchTossedCan(
              item,
              _vecA,
              _quatB,
              throwVel,
              _vecB,
              (impactSpd) => this.audio.playCanBounce(impactSpd),
            );
            this.emitHud();
          }

          reachPose = 1;
          grabPose = this.pickupStage >= 4 ? Math.max(0, 1 - (t - 2.55) * 14) : 1;
        } else {
          // Phase 7: Empty left hand swings smoothly back from shoulder follow-through to weapon grip!
          const p = THREE.MathUtils.smoothstep(t, 2.82, dur);
          this.hands.leftHandGroup.position
            .copy(this.drinkTossFlickPos)
            .lerp(this.leftHandRestPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkTossFlickQuat)
            .slerp(this.leftHandRestQuat, p);
          this.hands.setLeftElbowPose(
            THREE.MathUtils.lerp(-0.92, -0.24, p),
            THREE.MathUtils.lerp(0.24, -0.24, p),
            THREE.MathUtils.lerp(-0.26, 0, p),
          );
          reachPose = 1 - p;
          grabPose = 0;
        }

        this.hands.setPickupHandPose(reachPose, grabPose);

        if (t >= dur) {
          // Can is already flying/bouncing behind player in groundPickups.tossedBodies — only reset hand & state!
          if (this.pickupStage < 4) {
            this.setObjectLayer(item.mesh, 0);
            this.groundPickups.finishPickup(item);
          }
          this.pickupActive = false;
          this.pickupItem = null;
          this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
          this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
          this.hands.resetLeftElbowPose();
          this.hands.setLeftHandReloadPose(0, 0);
          this.emitHud();
        }
      } else if (item.kind === 'item') {
        // GENERAL FLOOR ITEM PICKUP: Full bend-down -> lock into palm -> stand up & pocket!
        const dur = this.pickupDuration;
        const cantEnv =
          THREE.MathUtils.smoothstep(t, 0.0, 0.24) *
          (1 - THREE.MathUtils.smoothstep(t, dur - 0.28, dur));

        puPosX = 0.12 * cantEnv;
        puPosY = -0.08 * cantEnv;
        puRotZ = -0.32 * cantEnv;
        puRotY = -0.20 * cantEnv;

        const bendDown =
          THREE.MathUtils.smoothstep(t, 0.0, 0.42) *
          (1 - THREE.MathUtils.smoothstep(t, 0.48, 0.94));
        targetPickupCamDipY = -0.66 * bendDown;
        targetPickupCamPitch = -0.30 * bendDown;
        targetPickupCamRoll = 0.038 * bendDown;

        const pocketPos = _vecD.set(-0.26, -0.16, 0.14);
        let reachPose = 0;
        let grabPose = 0;

        if (t < 0.44) {
          const p = THREE.MathUtils.smoothstep(t, 0.0, 0.42);
          this.hands.leftHandGroup.position
            .copy(this.leftHandRestPos)
            .lerp(this.drinkReachPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.leftHandRestQuat)
            .slerp(this.drinkReachQuat, p);
          reachPose = p;
          grabPose = THREE.MathUtils.smoothstep(t, 0.32, 0.44);
        } else if (t < 0.94) {
          if (this.pickupStage < 1) {
            this.pickupStage = 1;
            this.audio.playPickup(false);
            this.camera.updateMatrixWorld(true);
            this.hands.leftPalmSocket.attach(item.mesh);
            this.setObjectLayer(item.mesh, 1);
            this.pickupGrabLocalPos.copy(item.mesh.position);
            this.pickupGrabLocalQuat.copy(item.mesh.quaternion);
            if (item.refillsAmmo && this.maxAmmo > 0) {
              this.ammo = this.maxAmmo;
            }
            this.emitHud();
          }
          const p = THREE.MathUtils.smoothstep(t, 0.44, 0.94);
          this.hands.leftHandGroup.position
            .copy(this.drinkReachPos)
            .lerp(pocketPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkReachQuat)
            .slerp(this.drinkHoldQuat, p);
          reachPose = 1;
          grabPose = 1;

          const seatP = THREE.MathUtils.smoothstep(t, 0.44, 0.62);
          _vecA.set(0, -0.075, 0);
          _quatB.identity();
          item.mesh.position.copy(this.pickupGrabLocalPos).lerp(_vecA, seatP);
          item.mesh.quaternion.copy(this.pickupGrabLocalQuat).slerp(_quatB, seatP);
        } else {
          const p = THREE.MathUtils.smoothstep(t, 0.94, dur);
          this.hands.leftHandGroup.position
            .copy(pocketPos)
            .lerp(this.leftHandRestPos, p);
          this.hands.leftHandGroup.quaternion
            .copy(this.drinkHoldQuat)
            .slerp(this.leftHandRestQuat, p);
          reachPose = 1 - p;
          grabPose = 1 - p;
          item.mesh.visible = false;
        }

        this.hands.setPickupHandPose(reachPose, grabPose);

        if (t >= dur) {
          this.setObjectLayer(item.mesh, 0);
          this.groundPickups.finishPickup(item);
          this.pickupActive = false;
          this.pickupItem = null;
          this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
          this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
          this.hands.setLeftHandReloadPose(0, 0);
          this.hands.resetLeftElbowPose();
          this.emitHud();
        }
      } else {
        // ANIMATED GROUND WEAPON PICKUP: Full bend-down -> grab floor gun -> stand up & raise equipped weapon!
        const dur = this.pickupDuration;
        if (t < 0.48) {
          const p = THREE.MathUtils.smoothstep(t, 0.0, 0.46);
          puPosY = -0.34 * p;
          puRotX = -0.68 * p;
          puRotZ = 0.26 * p;
          targetPickupCamDipY = -0.68 * p;
          targetPickupCamPitch = -0.32 * p;
          targetPickupCamRoll = 0.032 * p;
          this.hands.leftHandGroup.position
            .copy(this.leftHandRestPos)
            .lerp(this.drinkReachPos, p * 0.7);
          this.hands.setPickupHandPose(p, p * 0.75);
        } else if (t < 0.78) {
          if (this.pickupStage < 1) {
            this.pickupStage = 1;
            this.audio.playPickup(true);
            this.camera.updateMatrixWorld(true);
            this.hands.leftPalmSocket.attach(item.mesh);
            this.setObjectLayer(item.mesh, 1);
            this.pickupGrabLocalPos.copy(item.mesh.position);
            this.pickupGrabLocalQuat.copy(item.mesh.quaternion);
            this.emitHud();
          }
          const p = THREE.MathUtils.smoothstep(t, 0.48, 0.78);
          puPosY = -0.36;
          puRotX = -0.72;
          targetPickupCamDipY = -0.68 * (1 - p * 0.52);
          targetPickupCamPitch = -0.32 * (1 - p * 0.55);
          targetPickupCamRoll = 0.032 * (1 - p * 0.5);

          _vecA.set(0, -0.04, 0.04);
          item.mesh.position.copy(this.pickupGrabLocalPos).lerp(_vecA, p);
          this.hands.setPickupHandPose(1, 1);
        } else {
          if (this.pickupStage < 2) {
            this.pickupStage = 2;
            item.mesh.visible = false;
            if (item.weaponId) {
              this.activeWeaponId = item.weaponId;
              this.applyVisibleWeaponRig(this.activeWeaponId);
              if (this.maxAmmo > 0) this.ammo = this.maxAmmo;
              if (
                this.activeWeaponId === 'futuristic' ||
                this.activeWeaponId === 'rustShotgun'
              ) {
                this.audio.playShotgunPump();
              } else if (this.activeWeaponId === 'flashlight') {
                this.audio.playFlashlightClick();
              } else {
                this.audio.playReloadStep('slideRack', false);
              }
              this.emitHud();
            }
          }
          const p = THREE.MathUtils.smoothstep(t, 0.78, dur);
          const inv = 1 - p;
          const inspectRoll = Math.sin(p * Math.PI) * 0.24;
          puPosY = -0.34 * inv;
          puRotX = -0.52 * inv + inspectRoll * 0.35;
          puRotZ = inspectRoll;
          targetPickupCamDipY = -0.32 * inv;
          targetPickupCamPitch = -0.14 * inv;
        }

        if (t >= dur) {
          this.setObjectLayer(item.mesh, 0);
          this.groundPickups.finishPickup(item);
          this.pickupActive = false;
          this.pickupItem = null;
          this.hands.leftHandGroup.position.copy(this.leftHandRestPos);
          this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
          this.hands.setLeftHandReloadPose(0, 0);
          this.hands.resetLeftElbowPose();
          this.emitHud();
        }
      }
    }
    this.pickupCamYaw = THREE.MathUtils.damp(this.pickupCamYaw, targetPickupCamYaw, 11, dt);
    this.drinkDofBlur = THREE.MathUtils.damp(this.drinkDofBlur, targetDrinkDof, 9, dt);

    if (!handsOverridden) {
      this.pistol9mm.magazineGroup.position.set(0, 0, 0);
      this.rustSmg.magazineGroup.position.set(0, 0, 0);
      this.rustSmg.magazineGroup.rotation.set(0, 0, 0);
      this.retroSmg.magazineGroup.position.set(0, 0, 0);
      this.retroSmg.magazineGroup.rotation.set(0, 0, 0);
      this.futuristicGun.shellInsertMesh.visible = false;
      if (this.rustShotgun.shellInsertMesh) {
        this.rustShotgun.shellInsertMesh.visible = false;
      }
      this.hands.leftHandGroup.position.set(
        this.leftHandRestPos.x,
        this.leftHandRestPos.y,
        this.leftHandRestPos.z + (isShotgun ? activePumpAmount * 0.095 : 0),
      );
      this.hands.leftHandGroup.quaternion.copy(this.leftHandRestQuat);
    }

    // E. Tactical Katana 3-Hit Razor Combo (Blade commands center frame, arms start cleanly below screen!)
    let swordPosX = 0;
    let swordPosY = 0;
    let swordPosZ = 0;
    let swordRotX = 0;
    let swordRotY = 0;
    let swordRotZ = 0;

    if (this.swordComboResetTimer > 0 && !this.swordSwingActive) {
      this.swordComboResetTimer = Math.max(0, this.swordComboResetTimer - dt);
    }

    if (isSword && this.swordSwingActive && !this.quickMeleeActive) {
      this.swordSwingTime += dt;
      const u = THREE.MathUtils.clamp(
        this.swordSwingTime / this.swordSwingDuration,
        0,
        1,
      );

      const wind = THREE.MathUtils.smoothstep(u, 0.0, 0.22);
      const strikeRaw = THREE.MathUtils.clamp((u - 0.20) / 0.36, 0, 1);
      const strike =
        strikeRaw < 0.5
          ? 4 * strikeRaw * strikeRaw * strikeRaw
          : 1 - Math.pow(-2 * strikeRaw + 2, 3) / 2;
      const recover = THREE.MathUtils.smoothstep(u, 0.62, 1.0);
      const trailPeak = Math.sin(
        THREE.MathUtils.clamp((u - 0.22) / 0.34, 0, 1) * Math.PI,
      );

      if (!this.swordHitChecked && u >= 0.38) {
        this.swordHitChecked = true;
        this.checkSwordWallHit();
      }

      // Keep elbows softly neutral so ONLY the gleaming steel blade & bottom-edge wrists ever enter the viewport!
      this.hands.resetLeftElbowPose();
      this.hands.resetRightElbowPose();

      if (this.swordComboStep === 0) {
        // Forehand diagonal cleave across viewport — blade leads, arms stay off bottom edge!
        swordPosX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.11 * wind, -0.18, strike), 0, recover);
        swordPosY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.01 * wind, -0.10, strike), 0, recover);
        swordPosZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.02 * wind, -0.05, strike), 0, recover);
        swordRotX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.28 * wind, -0.96, strike), 0, recover);
        swordRotY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.44 * wind, 1.06, strike), 0, recover);
        swordRotZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.68 * wind, 1.24, strike), 0, recover);
        targetSwordCamRoll = (0.044 * strike - 0.018 * wind) * (1 - recover);
        targetSwordCamPitch = (-0.026 * strike + 0.012 * wind) * (1 - recover);
        this.sword.setSlashTrail(trailPeak * 0.98);
      } else if (this.swordComboStep === 1) {
        // Reverse upward-right diagonal riposte — gleaming edge whips cleanly across center screen!
        swordPosX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.16 * wind, 0.15, strike), 0, recover);
        swordPosY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.10 * wind, -0.01, strike), 0, recover);
        swordPosZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.02 * wind, -0.04, strike), 0, recover);
        swordRotX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.48 * wind, 0.36, strike), 0, recover);
        swordRotY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.88 * wind, -0.90, strike), 0, recover);
        swordRotZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.16 * wind, -0.98, strike), 0, recover);
        targetSwordCamRoll = (-0.046 * strike + 0.018 * wind) * (1 - recover);
        targetSwordCamPitch = (0.024 * strike - 0.012 * wind) * (1 - recover);
        this.sword.setSlashTrail(trailPeak * 0.98);
      } else {
        // Heavy vertical guillotine finisher — crisp blade drop with zero arm clutter!
        swordPosX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.04 * wind, -0.09, strike), 0, recover);
        swordPosY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.03 * wind, -0.14, strike), 0, recover);
        swordPosZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.03 * wind, -0.08, strike), 0, recover);
        swordRotX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.56 * wind, -1.32, strike), 0, recover);
        swordRotY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.14 * wind, 0.16, strike), 0, recover);
        swordRotZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.12 * wind, 0.22, strike), 0, recover);
        targetSwordCamRoll = 0.022 * strike * (1 - recover);
        targetSwordCamPitch = (-0.048 * strike + 0.022 * wind) * (1 - recover);
        this.sword.setSlashTrail(trailPeak * 1.0);
      }

      if (this.swordComboQueued && u >= 0.64) {
        this.startSwordSwing((this.swordComboStep + 1) % 3);
      } else if (u >= 1.0) {
        this.swordSwingActive = false;
        this.sword.setSlashTrail(0);
        this.hands.resetLeftElbowPose();
        this.hands.resetRightElbowPose();
      }
    } else if (!this.quickMeleeActive) {
      this.sword.setSlashTrail(0);
      if (!this.pickupActive) {
        this.hands.resetRightElbowPose();
      }
    }

    // Damp action camera offsets smoothly
    this.swordCamRoll = THREE.MathUtils.damp(this.swordCamRoll, targetSwordCamRoll, 14, dt);
    this.swordCamPitch = THREE.MathUtils.damp(this.swordCamPitch, targetSwordCamPitch, 14, dt);
    this.reloadCamRoll = THREE.MathUtils.damp(this.reloadCamRoll, targetReloadCamRoll, 12, dt);
    this.reloadCamPitch = THREE.MathUtils.damp(this.reloadCamPitch, targetReloadCamPitch, 12, dt);
    this.pickupCamPitch = THREE.MathUtils.damp(this.pickupCamPitch, targetPickupCamPitch, 10, dt);
    this.pickupCamRoll = THREE.MathUtils.damp(this.pickupCamRoll, targetPickupCamRoll, 10, dt);
    this.pickupCamDipY = THREE.MathUtils.damp(this.pickupCamDipY, targetPickupCamDipY, 10, dt);

    // Drive VERY active living knuckles, recoil clench & frequent expressive finger motion!
    const recoilClench = THREE.MathUtils.clamp(
      Math.abs(this.recoilPitch) * 3.8 +
        Math.abs(this.recoilKickZ) * 18 +
        (this.swordSwingActive || this.quickMeleeActive ? 0.85 : 0),
      0,
      1,
    );
    this.hands.updateAliveMotion(
      dt,
      this.elapsed,
      recoilClench,
      this.adsBlend,
      handsOverridden,
      gunRig ? this.triggerPull : 0,
      speedRatio + rawTurnActivity,
    );

    // Update mechanical slides, pumps & live LEDs/Nixie vacuum bulbs on active weapon
    if (isVx9) {
      this.futuristicGun.setSlideOffset(0);
      this.futuristicGun.setPumpOffset(activePumpAmount);
      this.futuristicGun.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (isKs23) {
      this.rustShotgun.setSlideOffset(0);
      this.rustShotgun.setPumpOffset?.(activePumpAmount);
      this.rustShotgun.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (this.activeWeaponId === 'rustSmg') {
      this.rustSmg.setSlideOffset(this.slidePos);
      this.rustSmg.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (this.activeWeaponId === 'retroSmg') {
      this.retroSmg.setSlideOffset(this.slidePos);
      this.retroSmg.updateLeds(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    } else if (isPistol) {
      this.pistol9mm.setSlideOffset(this.slidePos);
      this.pistol9mm.updateLeds?.(this.ammo, this.maxAmmo, this.isReloading, this.elapsed);
    }

    // 9. Final Weapon Rig Pose: Smooth S-curve Hip <-> ADS / Guard / Flashlight Focus / Unarmed!
    const adsSmooth = this.adsBlend * this.adsBlend * (3 - 2 * this.adsBlend);

    const hipX = isSword
      ? 0.198
      : isUnarmed
        ? 0.045
        : isFlashlight
          ? 0.132
          : isShotgun || isSmg
            ? 0.106
            : 0.098;
    const hipY = isSword
      ? -0.264
      : isUnarmed
        ? -0.14
        : isFlashlight
          ? -0.096
          : isShotgun || isSmg
            ? -0.114
            : -0.105;
    const hipZ = isSword
      ? -0.328
      : isUnarmed
        ? -0.28
        : isFlashlight
          ? -0.312
          : isShotgun || isSmg
            ? -0.315
            : -0.325;
    const hipRotX = isSword ? -0.22 : isFlashlight ? 0.02 : isUnarmed ? 0 : 0.022;
    const hipRotY = isSword ? 0.24 : isFlashlight ? 0.04 : isUnarmed ? 0 : 0.078;
    const hipRotZ = isSword ? 0.16 : isFlashlight ? -0.02 : isUnarmed ? 0 : -0.048;

    const adsX = isSword ? -0.035 : isFlashlight ? 0.042 : isUnarmed ? 0.045 : 0.0;
    const adsY = isSword
      ? -0.185
      : isUnarmed
        ? -0.14
        : isFlashlight
          ? -0.056
          : -(gunRig?.sightLineY ?? 0.026);
    const adsZ = isSword
      ? -0.295
      : isUnarmed
        ? -0.28
        : isFlashlight
          ? -0.268
          : isShotgun || isSmg
            ? -0.252
            : -0.255;
    const adsRotX = isSword ? -0.20 : isFlashlight ? 0.02 : 0.0;
    const adsRotY = isSword ? 0.34 : isFlashlight ? 0.02 : 0.0;
    const adsRotZ = isSword ? 0.84 : isFlashlight ? 0.0 : 0.0;

    const idleScale = THREE.MathUtils.lerp(1.0, isSword ? 0.35 : 0.16, adsSmooth);
    const breathX = Math.sin(this.elapsed * 1.15) * 0.0026 * idleScale;
    const breathY = Math.sin(this.elapsed * 2.3 + 0.7) * 0.0020 * idleScale;
    const breathRoll = Math.cos(this.elapsed * 1.15) * 0.009 * idleScale;

    const moveBobScale =
      THREE.MathUtils.lerp(1.0, 0.22, adsSmooth) * speedRatio * groundBobMask;
    const wBobX = Math.cos(this.walkPhase) * 0.0105 * moveBobScale;
    const wBobY = Math.abs(Math.sin(this.walkPhase)) * -0.009 * moveBobScale;

    // Tactical combat cant on the weapon while sliding (smoothly straightens when ADSing mid-slide!)
    const slideWepMask = this.slideBlend * (1 - adsSmooth * 0.78);
    const slideWepPosX = -0.030 * slideWepMask;
    const slideWepPosY = -0.028 * slideWepMask + this.landDipY * 0.34;
    const slideWepPosZ = -0.028 * slideWepMask;
    const slideWepRotX = 0.075 * slideWepMask;
    const slideWepRotZ = 0.32 * slideWepMask * -this.slideLeanSign;

    const adsArcY = Math.sin(adsSmooth * Math.PI) * -0.009;
    const adsArcRoll = Math.sin(adsSmooth * Math.PI) * 0.07;

    this.weaponPivot.position.set(
      THREE.MathUtils.lerp(hipX, adsX, adsSmooth) +
        this.swayX +
        breathX +
        wBobX +
        slideWepPosX +
        reloadPosX +
        swapPosX +
        swordPosX +
        qmPosX +
        puPosX,
      THREE.MathUtils.lerp(hipY, adsY, adsSmooth) +
        this.swayY +
        breathY +
        wBobY +
        slideWepPosY +
        adsArcY +
        reloadPosY +
        swapPosY +
        swordPosY +
        qmPosY +
        puPosY,
      THREE.MathUtils.lerp(hipZ, adsZ, adsSmooth) +
        this.recoilKickZ +
        slideWepPosZ +
        reloadPosZ +
        swapPosZ +
        swordPosZ +
        qmPosZ +
        puPosZ,
    );

    const wepFidgetScale =
      (1 - adsSmooth * 0.86) *
      (1 - this.slideBlend * 0.7) *
      (this.swordSwingActive || this.quickMeleeActive || this.pickupActive ? 0 : 1);
    this.weaponPivot.rotation.order = 'YXZ';
    this.weaponPivot.rotation.set(
      THREE.MathUtils.lerp(hipRotX, adsRotX, adsSmooth) +
        this.recoilPitch +
        this.swayY * 1.3 +
        slideWepRotX +
        reloadRotX +
        swapRotX +
        swordRotX +
        qmRotX +
        puRotX +
        this.hands.fidgetWeaponPitch * wepFidgetScale,
      THREE.MathUtils.lerp(hipRotY, adsRotY, adsSmooth) -
        this.swayX * 1.6 +
        reloadRotY +
        swapRotY +
        swordRotY +
        qmRotY +
        puRotY,
      THREE.MathUtils.lerp(hipRotZ, adsRotZ, adsSmooth) +
        this.recoilRoll +
        breathRoll +
        adsArcRoll +
        slideWepRotZ -
        this.swayX * 2.4 +
        reloadRotZ +
        swapRotZ +
        swordRotZ +
        qmRotZ +
        puRotZ +
        this.hands.fidgetWeaponRoll * wepFidgetScale,
    );

    // 10. Sync Real Tactical Flashlight SpotLight to Active Gun's Under-Barrel Lens OR Plain Flashlight!
    this.camera.updateMatrixWorld(true);
    const activeLensAnchor = isFlashlight
      ? this.plainFlashlight.lensAnchor
      : gunRig?.flashlightLens ?? null;

    if (
      this.flashlightOn &&
      activeLensAnchor &&
      !isSword &&
      !isUnarmed &&
      !this.quickMeleeActive
    ) {
      activeLensAnchor.getWorldPosition(_vecA);
      activeLensAnchor.getWorldQuaternion(_quatA);
      _vecB.set(0, 0, -1).applyQuaternion(_quatA).normalize();

      this.flashlightSpot.position.copy(_vecA);
      this.flashlightTarget.position.copy(_vecA).addScaledVector(_vecB, 8.0);
      this.flashlightTarget.updateMatrixWorld();

      // Softer, rounder, wider-scope flood beam (plain flashlight throws an ultra-wide 90° soft cone!)
      const isPlain = isFlashlight;
      this.flashlightSpot.intensity = isPlain ? 16.5 : 12.8;
      this.flashlightSpot.penumbra = isPlain ? 0.94 : 0.88;
      this.flashlightSpot.angle = isPlain
        ? THREE.MathUtils.lerp(0.78, 0.52, adsSmooth)
        : 0.66;
    } else {
      this.flashlightSpot.intensity = 0;
    }

    // 11. Update pooled shells, sparks & muzzle smoke
    this.updateEffects(dt);

    // Throttled HUD updates
    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.05) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }
  }

  private updateEffects(dt: number) {
    for (const s of this.shells) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age > 3.5) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 9.8 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y <= 0.008) {
        s.pos.y = 0.008;
        if (Math.abs(s.vel.y) > 0.45) {
          s.vel.y = -s.vel.y * 0.42;
          s.vel.x *= 0.65;
          s.vel.z *= 0.65;
          s.rotVel.multiplyScalar(0.58);
          if (!s.bounced) {
            s.bounced = true;
            this.audio.playShellBounce(0.11);
          }
        } else {
          s.vel.set(0, 0, 0);
          s.rotVel.set(0, 0, 0);
        }
      }
      s.mesh.position.copy(s.pos);
      s.mesh.rotation.x += s.rotVel.x * dt;
      s.mesh.rotation.y += s.rotVel.y * dt;
      s.mesh.rotation.z += s.rotVel.z * dt;
    }

    for (const sp of this.sparks) {
      if (!sp.active) continue;
      sp.age += dt;
      if (sp.age >= sp.maxAge) {
        sp.active = false;
        sp.mesh.visible = false;
        continue;
      }
      sp.vel.y -= 9.8 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      sp.mesh.position.copy(sp.pos);
      sp.mesh.scale.setScalar(1 - sp.age / sp.maxAge);
      sp.mesh.lookAt(_vecA.copy(sp.pos).add(sp.vel));
    }

    for (const p of this.smokePuffs) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const prog = p.age / p.maxAge;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 3.5));
      p.vel.y += 0.25 * dt;
      p.sprite.position.copy(p.pos);
      p.sprite.scale.setScalar(0.06 + prog * 0.28);
      p.mat.opacity = 0.26 * (1 - prog);
    }
  }

  private emitHud() {
    let actionLabel: string | null = null;
    if (this.quickMeleeActive) {
      actionLabel = 'Quick Slash';
    } else if (this.pickupActive && this.pickupItem) {
      if (this.pickupStage === 0) {
        actionLabel = `Bending down · Move freely · Action buttons cancel`;
      } else if (this.pickupItem.kind === 'drink') {
        actionLabel =
          this.pickupStage >= 4
            ? `Tossed empty ${this.pickupItem.name}`
            : `Drinking ${this.pickupItem.name} · Move freely`;
      } else {
        actionLabel = `Carrying ${this.pickupItem.name} · Move freely`;
      }
    } else if (this.isSliding) {
      actionLabel = 'Sliding';
    }

    this.onHudUpdate({
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      weaponId: this.activeWeaponId,
      isAds: this.adsBlend > 0.45,
      adsBlend: this.adsBlend,
      isReloading: this.isReloading,
      isLocked: this.isPointerLocked,
      shotsFired: this.shotsFired,
      flashlightOn: this.flashlightOn,
      pickupPrompt: this.targetedPickup ? this.targetedPickup.name : null,
      pickupKind: this.targetedPickup ? this.targetedPickup.kind : null,
      actionLabel,
    });
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    this.update(dt);
    if (this.postProcessor && !this.isSoftwareGl) {
      const speedBlur = THREE.MathUtils.clamp(
        this.slideBlend * 0.85 + this.sprintBlend * 0.28,
        0,
        1,
      );
      this.postProcessor.render(this.scene, this.camera, {
        motionX: this.blurVelX,
        motionY: this.blurVelY,
        speedBlur,
        flashIntensity: this.activeFlashIntensity,
        dofBlur: this.drinkDofBlur,
        shotImpactBlur: this.shotImpactBlur,
        splitViewmodelLayer: true,
        elapsed: this.elapsed,
      });
    } else {
      // Software-GL fallback also splits Layer 0 (World) -> clearDepth -> Layer 1 (Viewmodel) so bullet holes NEVER clip onto guns!
      // CRITICAL: Temporarily null scene.background on Pass 2 so WebGLBackground does not force-clear the room & floor pickups!
      this.camera.layers.set(0);
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
      const prevBg = this.scene.background;
      const prevShadowAuto = this.renderer.shadowMap.autoUpdate;
      this.scene.background = null;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.camera.layers.set(1);
      this.renderer.render(this.scene, this.camera);
      this.scene.background = prevBg;
      this.renderer.shadowMap.autoUpdate = prevShadowAuto;
      this.camera.layers.set(0);
      this.renderer.autoClear = true;
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.unbindEvents();
    this.audio.dispose();
    this.pistol9mm.dispose();
    this.futuristicGun.dispose();
    this.rustSmg.dispose();
    this.retroSmg.dispose();
    this.rustShotgun.dispose();
    this.sword.dispose();
    this.plainFlashlight.dispose();
    this.hands.dispose();
    this.groundPickups.dispose();
    this.room.dispose();
    this.postProcessor?.dispose();
    for (const d of this.extraDisposables) d.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
