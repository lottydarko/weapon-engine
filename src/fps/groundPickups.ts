import * as THREE from 'three';
import {
  createGunmetalTexture,
  createRustedRussianSteelTextures,
  createRussianWoodTextures,
  createSovietBakeliteTextures,
} from './textures';

export type PickupKind = 'drink' | 'item' | 'weapon';

export type PickupWeaponId =
  | 'pistol9mm'
  | 'futuristic'
  | 'rustSmg'
  | 'retroSmg'
  | 'rustShotgun'
  | 'sword'
  | 'flashlight';

export interface GroundPickupItem {
  id: string;
  name: string;
  kind: PickupKind;
  weaponId?: PickupWeaponId;
  refillsAmmo?: boolean;
  mesh: THREE.Group;
  shadowDisc: THREE.Mesh;
  anchorPos: THREE.Vector3;
  anchorQuat: THREE.Quaternion;
  available: boolean;
  respawnTimer: number;
}

export interface GroundPickupManager {
  root: THREE.Group;
  items: GroundPickupItem[];
  findTarget: (
    camera: THREE.Camera,
    playerPos: THREE.Vector3,
    maxHorizDist?: number,
  ) => GroundPickupItem | null;
  beginPickup: (item: GroundPickupItem) => THREE.Group;
  cancelPickup: (item: GroundPickupItem) => void;
  finishPickup: (item: GroundPickupItem) => void;
  /** Launches an empty drink can carefree into the room with gravity, tumble spin, floor bounces & clatter callback */
  launchTossedCan: (
    item: GroundPickupItem,
    worldPos: THREE.Vector3,
    worldQuat: THREE.Quaternion,
    vel: THREE.Vector3,
    angVel: THREE.Vector3,
    onBounce?: (impactSpeed: number) => void,
  ) => void;
  update: (dt: number, targeted: GroundPickupItem | null, elapsed: number) => void;
  dispose: () => void;
}

const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _toItem = new THREE.Vector3();
const _tumbleAxis = new THREE.Vector3();
const _tumbleDeltaQ = new THREE.Quaternion();

interface TossedCanBody {
  item: GroundPickupItem;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  age: number;
  bounces: number;
  onBounce?: (impactSpeed: number) => void;
}

/**
 * Generates a high-contrast metallic label texture for the "D⚡" Energy Drink can:
 * Bold stylized letter "D" fused with an electric golden-amber lightning bolt emblem,
 * brushed charcoal aluminum body, hazard micro-stripes, and crisp specular detail.
 */
function createDLightningDrinkTexture(
  maxAnisotropy: number,
  variant: 'volt' | 'surge',
): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; dispose: () => void } {
  const w = 1024;
  const h = 512;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const accent = variant === 'volt' ? '#ffbe18' : '#26ecff';
  const accentGlow = variant === 'volt' ? '#ff6a00' : '#008cff';
  const bgTop = variant === 'volt' ? '#12151b' : '#101820';
  const bgBot = variant === 'volt' ? '#1c1814' : '#11222b';

  // Matte-satin dark metallic wrap gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bgTop);
  grad.addColorStop(0.55, '#171c24');
  grad.addColorStop(1, bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle vertical brushed aluminum micro-lines & condensation texture
  for (let i = 0; i < 650; i++) {
    const x = Math.random() * w;
    ctx.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.025})`;
    ctx.fillRect(x, 0, 1.2, h);
  }

  // Top & bottom metallic electric-accent bands
  ctx.fillStyle = accent;
  ctx.fillRect(0, 16, w, 14);
  ctx.fillRect(0, h - 34, w, 12);

  // Diagonal high-voltage accent stripes across mid-wrap
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = accent;
  for (let sx = -120; sx < w + 120; sx += 56) {
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + 20, 0);
    ctx.lineTo(sx - 90, h);
    ctx.lineTo(sx - 110, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Draw the iconic "D + LIGHTNING BOLT" emblem TWICE around the cylinder (front & back so it's ALWAYS readable!)
  const drawLogoAt = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy);

    // Subtle dark circular shield medallion backing
    const radGrad = ctx.createRadialGradient(0, 0, 18, 0, 0, 138);
    radGrad.addColorStop(0, variant === 'volt' ? 'rgba(255,150,20,0.28)' : 'rgba(20,220,255,0.28)');
    radGrad.addColorStop(0.7, 'rgba(10,12,16,0.65)');
    radGrad.addColorStop(1, 'rgba(10,12,16,0)');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 138, 0, Math.PI * 2);
    ctx.fill();

    // Bold chamfered letter "D"
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = '#090b0f';
    ctx.lineWidth = 18;
    ctx.fillStyle = '#f4f7fb';
    ctx.font = '900 226px "Inter", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('D', -24, 6);
    ctx.fillText('D', -24, 6);

    // Inner metallic highlight stroke inside "D"
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.strokeText('D', -24, 6);

    // Jagged electric LIGHTNING BOLT slicing dynamically across the right side of the "D"!
    ctx.save();
    ctx.shadowColor = accentGlow;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(52, -124);
    ctx.lineTo(-10, 4);
    ctx.lineTo(36, 4);
    ctx.lineTo(-16, 128);
    ctx.lineTo(84, -18);
    ctx.lineTo(34, -18);
    ctx.lineTo(94, -124);
    ctx.closePath();

    // Dark crisp outline for contrast
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#0a0c10';
    ctx.stroke();

    // Electric bolt gradient fill
    const boltGrad = ctx.createLinearGradient(0, -124, 0, 128);
    boltGrad.addColorStop(0, '#ffffff');
    boltGrad.addColorStop(0.28, accent);
    boltGrad.addColorStop(1, accentGlow);
    ctx.fillStyle = boltGrad;
    ctx.fill();
    ctx.restore();

    // Crisp minimal bottom sub-strip (purely graphic, zero real-world brands)
    ctx.fillStyle = accent;
    ctx.fillRect(-88, 136, 176, 6);
    ctx.fillStyle = 'rgba(240,245,252,0.88)';
    ctx.font = '700 26px "Inter", sans-serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('CHARGE · 500ML', 0, 166);

    ctx.restore();
  };

  drawLogoAt(w * 0.25, h * 0.48);
  drawLogoAt(w * 0.75, h * 0.48);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = maxAnisotropy;

  // Roughness map with realistic cold condensation droplets across the can!
  const rCanvas = document.createElement('canvas');
  rCanvas.width = 512;
  rCanvas.height = 256;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = '#5a5a5a'; // satin anodized aluminum body
  rCtx.fillRect(0, 0, 512, 256);

  // Glossy cold condensation beads (darker = lower roughness = shiny wet droplets!)
  for (let i = 0; i < 420; i++) {
    const dx = Math.random() * 512;
    const dy = Math.random() * 256;
    const dr = 1.2 + Math.random() * 3.8;
    rCtx.fillStyle = `rgba(18,18,18,${0.45 + Math.random() * 0.45})`;
    rCtx.beginPath();
    rCtx.arc(dx, dy, dr, 0, Math.PI * 2);
    rCtx.fill();
  }

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    roughnessMap,
    dispose() {
      map.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Builds a realistic 3D 500ml aluminum "D⚡" Energy Drink can with tapered neck,
 * curled metallic top & bottom rims, recessed scored lid, and raised pull-tab.
 */
function buildDLightningDrinkCan(
  labelMat: THREE.Material,
  aluminumMat: THREE.Material,
  darkRimMat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'DLightningEnergyDrinkCan';

  // Base height sits cleanly at y = 0 (total can height ≈ 0.168m, diameter 0.066m)
  const bottomCone = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.033, 0.026, 0.014, 28)),
    aluminumMat,
  );
  bottomCone.position.y = 0.007;
  bottomCone.castShadow = true;
  g.add(bottomCone);

  // Main cylindrical printed label wrap with bold "D⚡" emblem
  const body = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.033, 0.033, 0.132, 32, 1, true)),
    labelMat,
  );
  body.position.y = 0.080;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Tapered brushed aluminum shoulder
  const shoulder = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0275, 0.033, 0.018, 28)),
    aluminumMat,
  );
  shoulder.position.y = 0.155;
  shoulder.castShadow = true;
  g.add(shoulder);

  // Rolled lip rim + recessed aluminum top lid
  const rim = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0272, 0.0018, 10, 28)),
    aluminumMat,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.164;
  g.add(rim);

  const lid = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0265, 0.0265, 0.002, 24)),
    aluminumMat,
  );
  lid.position.y = 0.162;
  g.add(lid);

  // Scored sip opening indent + metallic aluminum pull-tab
  const sipIndent = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.008, 0.007, 0.0014, 14)),
    darkRimMat,
  );
  sipIndent.position.set(0, 0.1632, -0.010);
  g.add(sipIndent);

  const tabLoop = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0068, 0.0015, 8, 16)),
    aluminumMat,
  );
  tabLoop.rotation.x = Math.PI / 2;
  tabLoop.scale.set(0.85, 1.35, 1);
  tabLoop.position.set(0, 0.1645, 0.006);
  g.add(tabLoop);

  const rivet = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0024, 0.0024, 0.0024, 10)),
    aluminumMat,
  );
  rivet.position.set(0, 0.164, 0);
  g.add(rivet);

  return g;
}

/**
 * Creates a tidy, photorealistically textured set of floor pickups in front of the player:
 * - Two D⚡ Energy Drink cans (Volt Gold & Surge Cyan)
 * - General supplies (Rusted Soviet Ammo Tin, Glowing Vacuum Cell, Field Canteen)
 * - Grounded floor weapons (PP-41, AK-74M, KS-23, VX-9, Plain Flashlight)
 */
export function buildGroundPickups(
  scene: THREE.Scene,
  maxAnisotropy: number,
): GroundPickupManager {
  const root = new THREE.Group();
  root.name = 'GroundPickupsRoot';
  scene.add(root);

  const rustTex = createRustedRussianSteelTextures(maxAnisotropy, 5);
  const woodTex = createRussianWoodTextures(maxAnisotropy);
  const bakeliteTex = createSovietBakeliteTextures(maxAnisotropy);
  const gunmetalTex = createGunmetalTexture(maxAnisotropy);
  const drinkVoltTex = createDLightningDrinkTexture(maxAnisotropy, 'volt');
  const drinkSurgeTex = createDLightningDrinkTexture(maxAnisotropy, 'surge');

  const disposables: Array<{ dispose: () => void }> = [
    rustTex,
    woodTex,
    bakeliteTex,
    gunmetalTex,
    drinkVoltTex,
    drinkSurgeTex,
  ];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Materials
  const rustMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: rustTex.map,
    normalMap: rustTex.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: rustTex.roughnessMap,
    roughness: 1.0,
    metalnessMap: rustTex.metalnessMap,
    metalness: 0.92,
  });

  const woodMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: woodTex.map,
    normalMap: woodTex.normalMap,
    roughnessMap: woodTex.roughnessMap,
    roughness: 0.72,
    metalness: 0.02,
  });

  const bakeliteMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: bakeliteTex.map,
    normalMap: bakeliteTex.normalMap,
    roughnessMap: bakeliteTex.roughnessMap,
    roughness: 0.52,
    clearcoat: 0.3,
  });

  const gunBlackMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b2028,
    map: gunmetalTex.map,
    normalMap: gunmetalTex.normalMap,
    roughnessMap: gunmetalTex.roughnessMap,
    metalness: 0.84,
    roughness: 0.36,
  });

  const orangeMat = new THREE.MeshPhysicalMaterial({
    color: 0xff5a10,
    emissive: 0x2a0800,
    emissiveIntensity: 0.45,
    metalness: 0.65,
    roughness: 0.28,
    clearcoat: 0.55,
  });

  const oliveTinMat = new THREE.MeshPhysicalMaterial({
    color: 0x4b533b,
    normalMap: rustTex.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: rustTex.roughnessMap,
    metalness: 0.58,
    roughness: 0.65,
  });

  const aluminumMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6dde6,
    metalness: 0.94,
    roughness: 0.22,
    clearcoat: 0.3,
    envMapIntensity: 1.5,
  });

  const darkRimMat = new THREE.MeshStandardMaterial({
    color: 0x181c22,
    metalness: 0.7,
    roughness: 0.45,
  });

  const drinkVoltMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: drinkVoltTex.map,
    roughnessMap: drinkVoltTex.roughnessMap,
    metalness: 0.46,
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.24,
    envMapIntensity: 1.4,
  });

  const drinkSurgeMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: drinkSurgeTex.map,
    roughnessMap: drinkSurgeTex.roughnessMap,
    metalness: 0.46,
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.24,
    envMapIntensity: 1.4,
  });

  const amberGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffcf80,
    emissive: 0xff6210,
    emissiveIntensity: 3.2,
    roughness: 0.16,
  });

  const cyanGlowMat = new THREE.MeshStandardMaterial({
    color: 0xb8ffff,
    emissive: 0x16e8ff,
    emissiveIntensity: 3.0,
    roughness: 0.14,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xa27e42,
    metalness: 0.86,
    roughness: 0.36,
  });

  const shadowDiscMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });

  const highlightRingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  disposables.push(
    rustMat,
    woodMat,
    bakeliteMat,
    gunBlackMat,
    orangeMat,
    oliveTinMat,
    aluminumMat,
    darkRimMat,
    drinkVoltMat,
    drinkSurgeMat,
    amberGlowMat,
    cyanGlowMat,
    brassMat,
    shadowDiscMat,
    highlightRingMat,
  );

  // Subtle floor ring that smoothly highlights whichever floor item you're looking at
  const highlightRing = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(0.11, 0.132, 32)),
    highlightRingMat,
  );
  highlightRing.rotation.x = -Math.PI / 2;
  highlightRing.position.y = 0.004;
  highlightRing.visible = false;
  root.add(highlightRing);

  const items: GroundPickupItem[] = [];
  const tossedBodies: TossedCanBody[] = [];

  const registerItem = (
    id: string,
    name: string,
    kind: PickupKind,
    mesh: THREE.Group,
    pos: [number, number, number],
    rotY: number,
    shadowRadius: number,
    extra?: { weaponId?: PickupWeaponId; refillsAmmo?: boolean; lieFlat?: boolean },
  ) => {
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (extra?.lieFlat) {
      mesh.rotation.set(0, rotY, Math.PI / 2);
    } else {
      mesh.rotation.set(0, rotY, 0);
    }
    root.add(mesh);

    const shadowDisc = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(shadowRadius, 24)),
      shadowDiscMat,
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.set(pos[0], 0.002, pos[2]);
    root.add(shadowDisc);

    items.push({
      id,
      name,
      kind,
      weaponId: extra?.weaponId,
      refillsAmmo: extra?.refillsAmmo,
      mesh,
      shadowDisc,
      anchorPos: mesh.position.clone(),
      anchorQuat: mesh.quaternion.clone(),
      available: true,
      respawnTimer: 0,
    });
  };

  // =========================================================================
  // 1. TWO "D⚡" ENERGY DRINK CANS right in front of spawn!
  // =========================================================================
  const voltCan = buildDLightningDrinkCan(
    drinkVoltMat,
    aluminumMat,
    darkRimMat,
    trackGeo,
  );
  registerItem('drink_volt', 'D⚡ Volt Energy Drink', 'drink', voltCan, [-0.26, 0, 2.25], 0.35, 0.065);

  const surgeCan = buildDLightningDrinkCan(
    drinkSurgeMat,
    aluminumMat,
    darkRimMat,
    trackGeo,
  );
  registerItem('drink_surge', 'D⚡ Surge Energy Drink', 'drink', surgeCan, [0.24, 0, 2.15], -0.42, 0.065);

  // =========================================================================
  // 2. GENERAL FLOOR SUPPLIES (Ammo Tin + Soviet Vacuum Battery Cell + Canteen)
  // =========================================================================
  // Rusted Soviet 7.62 / 12ga Ammo Tin
  const ammoTin = new THREE.Group();
  const tinBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.24, 0.14, 0.12)),
    oliveTinMat,
  );
  tinBox.position.y = 0.07;
  tinBox.castShadow = true;
  ammoTin.add(tinBox);
  const tinLid = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.252, 0.024, 0.132)),
    rustMat,
  );
  tinLid.position.y = 0.145;
  ammoTin.add(tinLid);
  const tinLatch = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.032, 0.055, 0.014)),
    brassMat,
  );
  tinLatch.position.set(0, 0.115, 0.066);
  ammoTin.add(tinLatch);
  registerItem('ammo_tin', 'Soviet Ammo Tin', 'item', ammoTin, [-0.82, 0, 2.05], 0.4, 0.17, {
    refillsAmmo: true,
  });

  // Glowing Retrofuturist Soviet Vacuum Battery Cell
  const batteryCell = new THREE.Group();
  const cellCore = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.034, 0.034, 0.14, 18)),
    amberGlowMat,
  );
  cellCore.position.y = 0.08;
  batteryCell.add(cellCore);
  for (const cy of [0.016, 0.144]) {
    const cap = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.032, 18)),
      rustMat,
    );
    cap.position.y = cy;
    cap.castShadow = true;
    batteryCell.add(cap);
  }
  for (let a = 0; a < 4; a++) {
    const ang = (a / 4) * Math.PI * 2;
    const rod = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8)),
      brassMat,
    );
    rod.position.set(Math.cos(ang) * 0.042, 0.08, Math.sin(ang) * 0.042);
    batteryCell.add(rod);
  }
  registerItem('vacuum_cell', 'Soviet Vacuum Cell', 'item', batteryCell, [0.76, 0, 2.02], -0.2, 0.08);

  // =========================================================================
  // 3. GROUNDED FLOOR WEAPONS (PP-41, AK-74M, KS-23, VX-9, Plain Flashlight)
  // =========================================================================
  // Floor PP-41 Buria SMG (with iconic drum mag & glowing coils)
  const floorPP41 = new THREE.Group();
  const ppRec = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.038, 0.044, 0.24)), rustMat);
  floorPP41.add(ppRec);
  const ppWood = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.042, 0.034, 0.16)), woodMat);
  ppWood.position.set(0, -0.012, -0.14);
  floorPP41.add(ppWood);
  const ppShroud = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 14)), rustMat);
  ppShroud.rotation.x = Math.PI / 2;
  ppShroud.position.set(0, 0.012, -0.25);
  floorPP41.add(ppShroud);
  const ppDrum = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.064, 0.064, 0.036, 20)), rustMat);
  ppDrum.rotation.x = Math.PI / 2;
  ppDrum.position.set(0, -0.082, -0.13);
  floorPP41.add(ppDrum);
  const ppBulb = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.055, 10)), amberGlowMat);
  ppBulb.rotation.x = Math.PI / 2;
  ppBulb.position.set(-0.026, 0.012, -0.05);
  floorPP41.add(ppBulb);
  registerItem('wep_pp41', 'PP-41 Buria SMG', 'weapon', floorPP41, [-1.25, 0.024, 1.32], 0.55, 0.26, {
    weaponId: 'rustSmg',
    lieFlat: true,
  });

  // Floor AK-74M Pulse Carbine (curved bakelite mag + twin cyan Cherenkov tubes)
  const floorAK = new THREE.Group();
  const akRec = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.036, 0.048, 0.23)), rustMat);
  floorAK.add(akRec);
  const akWood = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.040, 0.032, 0.14)), woodMat);
  akWood.position.set(0, -0.004, -0.18);
  floorAK.add(akWood);
  const akBar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.009, 0.010, 0.18, 12)), gunBlackMat);
  akBar.rotation.x = Math.PI / 2;
  akBar.position.set(0, 0.008, -0.29);
  floorAK.add(akBar);
  const akMag = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.026, 0.145, 0.054)), bakeliteMat);
  akMag.position.set(0, -0.088, -0.11);
  akMag.rotation.x = 0.22;
  floorAK.add(akMag);
  for (const sx of [-0.024, 0.024]) {
    const t = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.095, 10)), cyanGlowMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(sx, 0.024, -0.19);
    floorAK.add(t);
  }
  registerItem('wep_ak74m', 'AK-74M Pulse SMG', 'weapon', floorAK, [-0.52, 0.024, 1.15], 0.18, 0.26, {
    weaponId: 'retroSmg',
    lieFlat: true,
  });

  // Floor KS-23 Vostok Rusted Russian Shotgun (thickened heavy-gauge silhouette)
  const floorKS23 = new THREE.Group();
  const ksRec = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.060, 0.064, 0.246)), rustMat);
  floorKS23.add(ksRec);
  const ksBar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.019, 0.020, 0.38, 16)), rustMat);
  ksBar.rotation.x = Math.PI / 2;
  ksBar.position.set(0, 0.018, -0.31);
  floorKS23.add(ksBar);
  const ksPump = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.030, 0.031, 0.17, 14)), woodMat);
  ksPump.rotation.x = Math.PI / 2;
  ksPump.position.set(0, -0.015, -0.28);
  floorKS23.add(ksPump);
  const ksGlow = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.044, 10)), amberGlowMat);
  ksGlow.position.set(-0.038, 0.028, -0.05);
  floorKS23.add(ksGlow);
  registerItem('wep_ks23', 'KS-23 Vostok Shotgun', 'weapon', floorKS23, [0.32, 0.034, 1.12], -0.22, 0.32, {
    weaponId: 'rustShotgun',
    lieFlat: true,
  });

  // Floor VX-9 Futuristic Black & Orange Shotgun (thickened heavy-gauge silhouette)
  const floorVX9 = new THREE.Group();
  const vxRec = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.062, 0.061, 0.224)), gunBlackMat);
  floorVX9.add(vxRec);
  const vxOrange = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.068, 0.017, 0.174)), orangeMat);
  vxOrange.position.set(0, 0.014, -0.04);
  floorVX9.add(vxOrange);
  const vxShroud = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.054, 0.032, 0.324)), gunBlackMat);
  vxShroud.position.set(0, 0.018, -0.27);
  floorVX9.add(vxShroud);
  const vxPump = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.031, 0.031, 0.166, 14)), gunBlackMat);
  vxPump.rotation.x = Math.PI / 2;
  vxPump.position.set(0, -0.015, -0.26);
  floorVX9.add(vxPump);
  registerItem('wep_vx9', 'VX-9 Shotgun', 'weapon', floorVX9, [1.15, 0.034, 1.32], -0.58, 0.32, {
    weaponId: 'futuristic',
    lieFlat: true,
  });

  // Floor Plain Handheld Flashlight
  const floorLight = new THREE.Group();
  const flBody = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.017, 0.017, 0.15, 16)), gunBlackMat);
  flBody.rotation.x = Math.PI / 2;
  floorLight.add(flBody);
  const flHead = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.025, 0.019, 0.046, 18)), gunBlackMat);
  flHead.rotation.x = Math.PI / 2;
  flHead.position.z = -0.09;
  floorLight.add(flHead);
  const flBezel = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.024, 0.0024, 8, 18)), aluminumMat);
  flBezel.position.z = -0.114;
  floorLight.add(flBezel);
  registerItem('wep_light', 'Plain Flashlight', 'weapon', floorLight, [0.0, 0.024, 1.68], 0.62, 0.11, {
    weaponId: 'flashlight',
  });

  return {
    root,
    items,
    findTarget(
      camera: THREE.Camera,
      playerPos: THREE.Vector3,
      maxHorizDist = 1.55,
    ): GroundPickupItem | null {
      camera.getWorldPosition(_camPos);
      camera.getWorldDirection(_camDir);

      let best: GroundPickupItem | null = null;
      let bestScore = -Infinity;

      for (const item of items) {
        if (!item.available) continue;
        // Player should be standing near the item on the floor
        const horizDist = Math.hypot(
          item.anchorPos.x - playerPos.x,
          item.anchorPos.z - playerPos.z,
        );
        if (horizDist > maxHorizDist) continue;

        _toItem.copy(item.anchorPos);
        _toItem.y += 0.08;
        _toItem.sub(_camPos);
        const dist3D = _toItem.length();
        if (dist3D < 0.2) continue;

        _toItem.divideScalar(dist3D);
        const dot = _toItem.dot(_camDir);
        // Must be looking down toward the nearby item
        if (dot < 0.65) continue;

        const score = dot * 2.4 - horizDist * 0.85;
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }
      return best;
    },
    beginPickup(item: GroundPickupItem): THREE.Group {
      item.available = false;
      item.shadowDisc.visible = false;
      return item.mesh;
    },
    cancelPickup(item: GroundPickupItem) {
      // Remove from tossed physics if active
      for (let i = tossedBodies.length - 1; i >= 0; i--) {
        if (tossedBodies[i].item === item) tossedBodies.splice(i, 1);
      }
      // Immediately place the item cleanly back on the floor if the user cancels mid-pickup!
      if (item.mesh.parent !== root) {
        root.add(item.mesh);
      }
      item.mesh.visible = true;
      item.mesh.position.copy(item.anchorPos);
      item.mesh.quaternion.copy(item.anchorQuat);
      item.mesh.scale.set(1, 1, 1);
      item.shadowDisc.visible = true;
      item.available = true;
      item.respawnTimer = 0;
    },
    finishPickup(item: GroundPickupItem) {
      // Re-attach to floor root (hidden) and schedule clean auto-respawn so user can test repeatedly!
      if (item.mesh.parent !== root) {
        root.add(item.mesh);
      }
      item.mesh.visible = false;
      item.mesh.position.copy(item.anchorPos);
      item.mesh.quaternion.copy(item.anchorQuat);
      item.mesh.scale.set(1, 1, 1);
      item.respawnTimer = 8.5;
    },
    launchTossedCan(
      item: GroundPickupItem,
      worldPos: THREE.Vector3,
      worldQuat: THREE.Quaternion,
      vel: THREE.Vector3,
      angVel: THREE.Vector3,
      onBounce?: (impactSpeed: number) => void,
    ) {
      for (let i = tossedBodies.length - 1; i >= 0; i--) {
        if (tossedBodies[i].item === item) tossedBodies.splice(i, 1);
      }
      if (item.mesh.parent !== root) {
        root.add(item.mesh);
      }
      item.mesh.visible = true;
      item.mesh.position.copy(worldPos);
      item.mesh.quaternion.copy(worldQuat);
      item.mesh.scale.set(1, 1, 1);
      item.shadowDisc.visible = false;
      item.available = false;
      item.respawnTimer = 0;

      tossedBodies.push({
        item,
        vel: vel.clone(),
        angVel: angVel.clone(),
        age: 0,
        bounces: 0,
        onBounce,
      });
    },
    update(dt: number, targeted: GroundPickupItem | null, elapsed: number) {
      // Simulate tossed empty aluminum cans tumbling, bouncing & rolling freely across the room!
      for (let i = tossedBodies.length - 1; i >= 0; i--) {
        const body = tossedBodies[i];
        body.age += dt;

        // Gravity & linear motion
        body.vel.y -= 12.2 * dt;
        const pos = body.item.mesh.position;
        pos.x += body.vel.x * dt;
        pos.y += body.vel.y * dt;
        pos.z += body.vel.z * dt;

        // End-over-end tumble quaternion integration (zero GC)
        const angSpeed = body.angVel.length();
        if (angSpeed > 0.01) {
          _tumbleAxis.copy(body.angVel).divideScalar(angSpeed);
          _tumbleDeltaQ.setFromAxisAngle(_tumbleAxis, angSpeed * dt);
          body.item.mesh.quaternion.premultiply(_tumbleDeltaQ);
        }

        // Concrete floor bounce (can radius ≈ 0.034m)
        const floorY = 0.034;
        if (pos.y < floorY) {
          pos.y = floorY;
          const impact = Math.abs(body.vel.y);
          if (impact > 0.55) {
            body.vel.y = impact * 0.44;
            body.vel.x *= 0.72;
            body.vel.z *= 0.72;
            body.angVel.multiplyScalar(0.68);
            body.angVel.x += (Math.random() - 0.5) * 4.5;
            body.angVel.z += (Math.random() - 0.5) * 4.5;
            if (body.bounces < 4 && body.onBounce) {
              body.onBounce(Math.min(1, impact / 4.2));
            }
            body.bounces += 1;
          } else {
            body.vel.y = 0;
            // Rolling concrete drag
            const drag = Math.exp(-3.6 * dt);
            body.vel.x *= drag;
            body.vel.z *= drag;
            body.angVel.multiplyScalar(Math.exp(-4.2 * dt));
          }
        }

        // Keep tossed can inside the range walls with lively ricochet!
        if (pos.x < -3.75) {
          pos.x = -3.75;
          body.vel.x = Math.abs(body.vel.x) * 0.52;
          if (body.bounces < 4 && body.onBounce) body.onBounce(0.45);
          body.bounces += 1;
        } else if (pos.x > 3.75) {
          pos.x = 3.75;
          body.vel.x = -Math.abs(body.vel.x) * 0.52;
          if (body.bounces < 4 && body.onBounce) body.onBounce(0.45);
          body.bounces += 1;
        }
        if (pos.z < -5.75) {
          pos.z = -5.75;
          body.vel.z = Math.abs(body.vel.z) * 0.52;
          if (body.bounces < 4 && body.onBounce) body.onBounce(0.45);
          body.bounces += 1;
        } else if (pos.z > 5.75) {
          pos.z = 5.75;
          body.vel.z = -Math.abs(body.vel.z) * 0.52;
          if (body.bounces < 4 && body.onBounce) body.onBounce(0.45);
          body.bounces += 1;
        }

        // After 6.5s on the floor, clean up and schedule crisp respawn at original floor spot
        if (body.age >= 6.5) {
          body.item.mesh.visible = false;
          body.item.mesh.position.copy(body.item.anchorPos);
          body.item.mesh.quaternion.copy(body.item.anchorQuat);
          body.item.respawnTimer = 2.0;
          tossedBodies.splice(i, 1);
        }
      }

      // Respawn picked-up floor items cleanly after cooldown
      for (const item of items) {
        if (!item.available && item.respawnTimer > 0) {
          item.respawnTimer -= dt;
          if (item.respawnTimer <= 0) {
            item.respawnTimer = 0;
            item.available = true;
            item.mesh.visible = true;
            item.shadowDisc.visible = true;
            item.mesh.position.copy(item.anchorPos);
            item.mesh.quaternion.copy(item.anchorQuat);
          }
        }
      }

      if (targeted && targeted.available) {
        highlightRing.visible = true;
        highlightRing.position.set(
          targeted.anchorPos.x,
          0.005,
          targeted.anchorPos.z,
        );
        const pulse = 1.0 + Math.sin(elapsed * 5.0) * 0.08;
        const baseScale = targeted.kind === 'weapon' ? 1.55 : 0.85;
        highlightRing.scale.setScalar(baseScale * pulse);
        highlightRingMat.color.setHex(
          targeted.kind === 'drink'
            ? 0xffc424
            : targeted.kind === 'weapon'
              ? 0xff7028
              : 0x72f0ff,
        );
      } else {
        highlightRing.visible = false;
      }
    },
    dispose() {
      scene.remove(root);
      for (const d of disposables) d.dispose();
    },
  };
}
