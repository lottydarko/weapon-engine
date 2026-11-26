import * as THREE from 'three';
import { createUnderbarrelFlashlight } from './flashlight';
import { enhanceGunMetalMaterial, enhanceGunWoodMaterial } from './gunShader';
import {
  createPhotorealisticMuzzleFlash,
  type MuzzleFlashProfile,
} from './muzzleFlash';
import type { PistolRig } from './pistol';
import {
  createGunmetalTexture,
  createRustedRussianSteelTextures,
  createRussianWoodTextures,
  createSovietBakeliteTextures,
} from './textures';

export interface RetroWeaponRig extends PistolRig {
  pumpGroup?: THREE.Group;
  shellInsertMesh?: THREE.Mesh;
  setPumpOffset?: (amount01: number) => void;
  setFireGlow: (heat01: number) => void;
  updateLeds: (
    ammo: number,
    maxAmmo: number,
    isReloading: boolean,
    elapsed: number,
  ) => void;
}

interface RearLedPanelHandle {
  update: (
    frac: number,
    isEmpty: boolean,
    isReloading: boolean,
    elapsed: number,
  ) => void;
}

function ammoFractionToHue(frac: number): number {
  const f = THREE.MathUtils.clamp(frac, 0, 1);
  // Full = Neon Emerald Green (0.36) -> Half = Neon Yellow (0.145) -> Empty = Alarm Red (0.0)
  return f >= 0.5
    ? THREE.MathUtils.lerp(0.145, 0.36, (f - 0.5) * 2.0)
    : THREE.MathUtils.lerp(0.0, 0.145, f * 2.0);
}

/**
 * Bolts a sleek retrofuturist dark-steel bezel housing 4 individually-animated neon LED
 * elements (twin curved bars + twin pips) directly onto the rear end of a weapon facing the
 * operator in both hip-fire and ADS — drains Green -> Yellow -> Red and swirls arcade neon on reload!
 */
function addRearFuturisticLedPanel(
  parent: THREE.Group,
  pos: [number, number, number],
  scale: number,
  housingMat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
  disposables: Array<{ dispose: () => void }>,
): RearLedPanelHandle {
  const ledMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7effa8,
      emissive: 0x00ff66,
      emissiveIntensity: 3.4,
      roughness: 0.12,
      metalness: 0.08,
    });
    ledMats.push(mat);
    disposables.push(mat);
  }

  const panel = new THREE.Group();
  panel.position.set(pos[0], pos[1], pos[2]);
  panel.scale.setScalar(scale);

  // Curved-arch beveled machined housing (zero boxy slab!)
  const archShape = new THREE.Shape();
  archShape.moveTo(-0.0145, -0.0052);
  archShape.lineTo(0.0145, -0.0052);
  archShape.quadraticCurveTo(0.0168, -0.0046, 0.0168, -0.0012);
  archShape.quadraticCurveTo(0.0164, 0.0048, 0.0095, 0.0058);
  archShape.quadraticCurveTo(0, 0.0072, -0.0095, 0.0058);
  archShape.quadraticCurveTo(-0.0164, 0.0048, -0.0168, -0.0012);
  archShape.quadraticCurveTo(-0.0168, -0.0046, -0.0145, -0.0052);
  archShape.closePath();

  const plateGeo = trackGeo(
    new THREE.ExtrudeGeometry(archShape, {
      depth: 0.0032,
      bevelEnabled: true,
      bevelSize: 0.0009,
      bevelThickness: 0.0012,
      bevelSegments: 3,
      curveSegments: 12,
    }),
  );
  plateGeo.translate(0, 0, -0.0016);
  panel.add(new THREE.Mesh(plateGeo, housingMat));

  const barGeo = trackGeo(new THREE.CapsuleGeometry(0.0015, 0.0072, 4, 10));
  barGeo.rotateZ(Math.PI / 2);
  const pipGeo = trackGeo(new THREE.SphereGeometry(0.0014, 10, 8));

  const gBar = new THREE.Mesh(barGeo, ledMats[0]);
  gBar.position.set(-0.0072, 0.0018, 0.0022);
  gBar.rotation.z = 0.08;
  panel.add(gBar);

  const gPip = new THREE.Mesh(pipGeo, ledMats[1]);
  gPip.position.set(-0.0072, -0.0024, 0.0022);
  panel.add(gPip);

  const rBar = new THREE.Mesh(barGeo, ledMats[2]);
  rBar.position.set(0.0072, 0.0018, 0.0022);
  rBar.rotation.z = -0.08;
  panel.add(rBar);

  const rPip = new THREE.Mesh(pipGeo, ledMats[3]);
  rPip.position.set(0.0072, -0.0024, 0.0022);
  panel.add(rPip);

  parent.add(panel);

  return {
    update(frac: number, isEmpty: boolean, isReloading: boolean, elapsed: number) {
      if (isReloading) {
        // Arcade neon swirl chasing clockwise around all 4 rear LEDs!
        for (let i = 0; i < 4; i++) {
          const m = ledMats[i];
          const hue = (elapsed * 1.65 - i * 0.22 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.45);
          m.emissive.setHSL(hue, 1.0, 0.52);
          m.color.setHSL(hue, 0.92, 0.76);
          m.emissiveIntensity = 2.0 + chase * 3.0;
        }
        return;
      }

      const hue = ammoFractionToHue(frac);
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);
      const low = frac <= 0.25;
      for (let i = 0; i < 4; i++) {
        const m = ledMats[i];
        m.emissive.setHSL(hue, 1.0, 0.50);
        m.color.setHSL(hue, 0.92, 0.74);
        m.emissiveIntensity = isEmpty
          ? 1.4 + pulse * 3.4
          : low
            ? 2.4 + pulse * 2.2
            : 3.3;
      }
    },
  };
}

/**
 * Shared helper: builds the ergonomic Soviet pistol grip + trigger guard + curved trigger
 * matching the gloved right hand's exact coordinates (zero clipping across all weapons).
 */
function addStandardGripAndTrigger(
  parent: THREE.Group,
  gripMat: THREE.Material,
  metalMat: THREE.Material,
  triggerMat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const gripProfile = new THREE.Shape();
  gripProfile.moveTo(0.004, -0.012);
  gripProfile.quadraticCurveTo(0.008, -0.036, 0.014, -0.044);
  gripProfile.quadraticCurveTo(0.017, -0.062, 0.023, -0.073);
  gripProfile.quadraticCurveTo(0.027, -0.088, 0.033, -0.104);
  gripProfile.lineTo(0.081, -0.104);
  gripProfile.quadraticCurveTo(0.076, -0.076, 0.065, -0.048);
  gripProfile.quadraticCurveTo(0.054, -0.028, 0.051, -0.012);
  gripProfile.closePath();

  const gripGeo = trackGeo(
    new THREE.ExtrudeGeometry(gripProfile, {
      depth: 0.024,
      bevelEnabled: true,
      bevelSize: 0.0026,
      bevelThickness: 0.003,
      bevelSegments: 4,
    }),
  );
  gripGeo.rotateY(-Math.PI / 2);
  gripGeo.translate(0.012, 0, 0);
  const gripMesh = new THREE.Mesh(gripGeo, gripMat);
  gripMesh.castShadow = true;
  gripMesh.receiveShadow = true;
  parent.add(gripMesh);

  // Stamped steel trigger guard
  const guardShape = new THREE.Shape();
  guardShape.moveTo(0.008, -0.012);
  guardShape.lineTo(-0.044, -0.012);
  guardShape.lineTo(-0.047, -0.036);
  guardShape.lineTo(-0.039, -0.040);
  guardShape.lineTo(0.009, -0.040);
  guardShape.lineTo(0.011, -0.034);
  guardShape.lineTo(-0.037, -0.034);
  guardShape.lineTo(-0.039, -0.016);
  guardShape.lineTo(0.008, -0.016);
  guardShape.closePath();

  const guardGeo = trackGeo(
    new THREE.ExtrudeGeometry(guardShape, {
      depth: 0.012,
      bevelEnabled: true,
      bevelSize: 0.0008,
      bevelThickness: 0.0008,
      bevelSegments: 2,
    }),
  );
  guardGeo.rotateY(-Math.PI / 2);
  guardGeo.translate(0.006, 0, 0);
  const guardMesh = new THREE.Mesh(guardGeo, metalMat);
  guardMesh.castShadow = true;
  parent.add(guardMesh);

  const triggerPivot = new THREE.Group();
  triggerPivot.position.set(0, -0.012, -0.012);
  parent.add(triggerPivot);

  const trig = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0056, 0.020, 0.0044)),
    triggerMat,
  );
  trig.position.set(0, -0.010, -0.003);
  trig.rotation.x = 0.16;
  triggerPivot.add(trig);

  return triggerPivot;
}

/**
 * Shared helper: builds a glowing Soviet retrofuturist glass vacuum / Nixie filament bulb
 * enclosed in rusted brass rings with internal glowing core.
 */
function createVacuumBulb(
  radius: number,
  length: number,
  glowMat: THREE.MeshStandardMaterial,
  glassMat: THREE.MeshPhysicalMaterial,
  brassMat: THREE.Material,
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T,
): THREE.Group {
  const g = new THREE.Group();

  const filament = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, length * 0.78, 10)),
    glowMat,
  );
  g.add(filament);

  const glass = new THREE.Mesh(
    trackGeo(new THREE.CapsuleGeometry(radius, length * 0.65, 6, 12)),
    glassMat,
  );
  glass.renderOrder = 2;
  g.add(glass);

  const capGeo = trackGeo(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.006, 12));
  for (const cy of [-length * 0.45, length * 0.45]) {
    const cap = new THREE.Mesh(capGeo, brassMat);
    cap.position.y = cy;
    g.add(cap);
  }

  return g;
}

/**
 * Shared helper: builds photorealistic volumetric GLSL muzzle flash + dynamic point light.
 */
function createMuzzleFlashRig(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  scaleBase: number,
  tintHex: number,
  profile: MuzzleFlashProfile,
  disposables: Array<{ dispose: () => void }>,
) {
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(x, y, z);
  parent.add(muzzleTip);

  const volumetric = createPhotorealisticMuzzleFlash({
    profile,
    scale: scaleBase,
    tintHex,
    lightRange: profile === 'shotgun' ? 8.8 : 6.4,
    lightIntensity: profile === 'shotgun' ? 12.2 : 8.4,
  });
  volumetric.group.position.set(x, y, z - 0.004);
  parent.add(volumetric.group);
  disposables.push(volumetric);

  return {
    muzzleTip,
    muzzleFlashGroup: volumetric.group,
    muzzleLight: volumetric.light,
    setIntensity: volumetric.setIntensity,
  };
}

// ============================================================================
// 1. PP-41 "BURIA" — RUSTIC RUSSIAN SUBMACHINE GUN (Drum Mag + Nixie & Phosphor)
// ============================================================================
export function buildRusticRussianSmg(
  maxAnisotropy: number,
  _flashTexture?: THREE.Texture,
): RetroWeaponRig {
  const root = new THREE.Group();
  root.name = 'RusticRussianPP41SMG';

  const rustSet = createRustedRussianSteelTextures(maxAnisotropy, 1);
  const woodSet = createRussianWoodTextures(maxAnisotropy);
  const metalSet = createGunmetalTexture(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [rustSet, woodSet, metalSet];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Authentic corroded Soviet stamped steel with curvature edge-burnishing & micro-cavity occlusion
  const rustedSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: rustSet.map,
      normalMap: rustSet.normalMap,
      normalScale: new THREE.Vector2(1.55, 1.55),
      roughnessMap: rustSet.roughnessMap,
      roughness: 1.0,
      metalnessMap: rustSet.metalnessMap,
      metalness: 0.92,
      clearcoat: 0.10,
      clearcoatRoughness: 0.56,
      envMapIntensity: 1.4,
    }),
    { edgeWear: 0.58, cavityDepth: 0.48, sheenColor: 0x98aec4, sheenStrength: 0.24 },
  );

  const darkSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x1e2126,
      map: metalSet.map,
      normalMap: metalSet.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: metalSet.roughnessMap,
      metalness: 0.86,
      roughness: 0.42,
      envMapIntensity: 1.32,
    }),
    { edgeWear: 0.48, cavityDepth: 0.44, sheenColor: 0x8ea6c2, sheenStrength: 0.26 },
  );

  const agedBrassMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x9b7a44,
      normalMap: rustSet.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: rustSet.roughnessMap,
      metalness: 0.84,
      roughness: 0.44,
      envMapIntensity: 1.36,
    }),
    { edgeWear: 0.36, cavityDepth: 0.36, sheenColor: 0xdec07a, sheenStrength: 0.22 },
  );

  const birchWoodMat = enhanceGunWoodMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: woodSet.map,
      normalMap: woodSet.normalMap,
      normalScale: new THREE.Vector2(1.22, 1.22),
      roughnessMap: woodSet.roughnessMap,
      roughness: 0.70,
      metalness: 0.02,
      clearcoat: 0.28,
      clearcoatRoughness: 0.44,
    }),
    0.20,
  );

  const nixieAmberMat = new THREE.MeshStandardMaterial({
    color: 0xffc67a,
    emissive: 0xff6210,
    emissiveIntensity: 3.4,
    roughness: 0.15,
    metalness: 0.05,
  });

  const phosphorGreenMat = new THREE.MeshStandardMaterial({
    color: 0xb6ffce,
    emissive: 0x22ff6a,
    emissiveIntensity: 2.8,
    roughness: 0.15,
    metalness: 0.05,
  });

  const bulbGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffe4c4,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const barMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const bm = new THREE.MeshStandardMaterial({
      color: 0xb2ffc8,
      emissive: 0x20ff68,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    });
    barMats.push(bm);
    disposables.push(bm);
  }

  disposables.push(
    rustedSteelMat,
    darkSteelMat,
    agedBrassMat,
    birchWoodMat,
    nixieAmberMat,
    phosphorGreenMat,
    bulbGlassMat,
  );

  // 1. Stamped-steel tubular Soviet receiver + heavy wooden stock neck
  const receiverTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0205, 0.0215, 0.23, 20)),
    rustedSteelMat,
  );
  receiverTube.rotation.x = Math.PI / 2;
  receiverTube.position.set(0, 0.015, -0.028);
  receiverTube.castShadow = true;
  receiverTube.receiveShadow = true;
  root.add(receiverTube);

  // Lower stamped steel rounded-belly chassis flowing smoothly into the tubular receiver
  const ppLowerShape = new THREE.Shape();
  ppLowerShape.moveTo(-0.014, -0.016);
  ppLowerShape.lineTo(0.014, -0.016);
  ppLowerShape.quadraticCurveTo(0.018, -0.015, 0.018, -0.006);
  ppLowerShape.lineTo(0.018, 0.012);
  ppLowerShape.lineTo(-0.018, 0.012);
  ppLowerShape.lineTo(-0.018, -0.006);
  ppLowerShape.quadraticCurveTo(-0.018, -0.015, -0.014, -0.016);
  ppLowerShape.closePath();

  const lowerGeo = trackGeo(
    new THREE.ExtrudeGeometry(ppLowerShape, {
      depth: 0.205,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.0028,
      bevelSegments: 4,
      curveSegments: 12,
    }),
  );
  lowerGeo.translate(0, 0, -0.126);
  const lowerBox = new THREE.Mesh(lowerGeo, rustedSteelMat);
  lowerBox.castShadow = true;
  lowerBox.receiveShadow = true;
  root.add(lowerBox);

  // Domed rear receiver cap + takedown button + curved Soviet birchwood stock wrist & comb!
  const rearCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0212, 0.0222, 0.018, 24)),
    darkSteelMat,
  );
  rearCap.rotation.x = Math.PI / 2;
  rearCap.position.set(0, 0.015, 0.086);
  root.add(rearCap);

  const rearDome = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0212, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    darkSteelMat,
  );
  rearDome.rotation.x = Math.PI / 2;
  rearDome.scale.set(1, 0.52, 1);
  rearDome.position.set(0, 0.015, 0.094);
  root.add(rearDome);

  // Curved oiled birchwood PPSh-41 buttstock wrist & rounded stock comb sweeping back from receiver
  const ppStockShape = new THREE.Shape();
  ppStockShape.moveTo(0.056, 0.006);
  ppStockShape.quadraticCurveTo(0.095, 0.004, 0.132, -0.006);
  ppStockShape.quadraticCurveTo(0.168, -0.016, 0.205, -0.022);
  ppStockShape.lineTo(0.205, -0.056);
  ppStockShape.quadraticCurveTo(0.145, -0.044, 0.098, -0.032);
  ppStockShape.quadraticCurveTo(0.072, -0.024, 0.056, -0.014);
  ppStockShape.closePath();

  const ppStockGeo = trackGeo(
    new THREE.ExtrudeGeometry(ppStockShape, {
      depth: 0.026,
      bevelEnabled: true,
      bevelSize: 0.0058,
      bevelThickness: 0.0062,
      bevelSegments: 5,
      curveSegments: 16,
    }),
  );
  ppStockGeo.rotateY(-Math.PI / 2);
  ppStockGeo.translate(0.013, 0, 0);
  const ppStock = new THREE.Mesh(ppStockGeo, birchWoodMat);
  ppStock.castShadow = true;
  ppStock.receiveShadow = true;
  root.add(ppStock);

  const rearLedPanel = addRearFuturisticLedPanel(
    root,
    [0, 0.020, 0.1025],
    0.92,
    darkSteelMat,
    trackGeo,
    disposables,
  );

  const rivetGeo = trackGeo(new THREE.SphereGeometry(0.0024, 8, 6));
  for (const rz of [-0.11, -0.06, -0.01, 0.04, 0.072]) {
    for (const sx of [-0.0175, 0.0175]) {
      const r = new THREE.Mesh(rivetGeo, darkSteelMat);
      r.position.set(sx, 0.002, rz);
      root.add(r);
    }
  }

  // Aged Russian birchwood forend cradle & rear wrist cheek-stock collar
  const woodFore = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.041, 0.030, 0.145)),
    birchWoodMat,
  );
  woodFore.position.set(0, -0.012, -0.175);
  woodFore.castShadow = true;
  woodFore.receiveShadow = true;
  root.add(woodFore);

  const woodBand = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.044, 0.033, 0.014)),
    rustedSteelMat,
  );
  woodBand.position.set(0, -0.011, -0.228);
  root.add(woodBand);

  // 2. Iconic PPSh-41 Perforated Cooling Barrel Shroud + Inner Glowing Thermal Coils!
  const barrelGroup = new THREE.Group();
  root.add(barrelGroup);

  const innerBarrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0082, 0.0086, 0.25, 16)),
    darkSteelMat,
  );
  innerBarrel.rotation.x = Math.PI / 2;
  innerBarrel.position.set(0, 0.016, -0.265);
  barrelGroup.add(innerBarrel);

  // Glowing amber retrofuturist thermal induction rings inside the perforated barrel jacket!
  for (let i = 0; i < 6; i++) {
    const coil = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.0112, 0.0022, 8, 18)),
      nixieAmberMat,
    );
    coil.position.set(0, 0.016, -0.175 - i * 0.032);
    barrelGroup.add(coil);
  }

  // Perforated outer cooling shroud built from segmented rusted rings + 4 stamped ribs (real open slots!)
  const ringGeo = trackGeo(new THREE.CylinderGeometry(0.0185, 0.0185, 0.014, 18, 1, true));
  ringGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const ring = new THREE.Mesh(ringGeo, rustedSteelMat);
    ring.position.set(0, 0.016, -0.158 - i * 0.032);
    barrelGroup.add(ring);
  }
  // 4 longitudinal rusted shroud ribs framing the cooling vents
  const ribGeo = trackGeo(new THREE.BoxGeometry(0.006, 0.0055, 0.215));
  for (let a = 0; a < 4; a++) {
    const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
    const rib = new THREE.Mesh(ribGeo, rustedSteelMat);
    rib.position.set(
      Math.cos(ang) * 0.0175,
      0.016 + Math.sin(ang) * 0.0175,
      -0.258,
    );
    rib.rotation.z = ang;
    barrelGroup.add(rib);
  }

  // Slanted iconic PPSh-41 muzzle compensator shroud nose
  const muzzleComp = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.019, 0.019, 0.034, 18)),
    rustedSteelMat,
  );
  muzzleComp.rotation.x = Math.PI / 2;
  muzzleComp.position.set(0, 0.016, -0.382);
  barrelGroup.add(muzzleComp);

  const boreHole = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 14)),
    darkSteelMat,
  );
  boreHole.rotation.x = Math.PI / 2;
  boreHole.position.set(0, 0.016, -0.398);
  barrelGroup.add(boreHole);

  // 3. Reciprocating Open-Bolt Charging Handle (slideGroup)
  const slideGroup = new THREE.Group();
  root.add(slideGroup);

  const boltBody = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.013, 0.013, 0.064, 14)),
    darkSteelMat,
  );
  boltBody.rotation.x = Math.PI / 2;
  boltBody.position.set(0.003, 0.015, -0.055);
  slideGroup.add(boltBody);

  const boltStem = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0038, 0.0038, 0.028, 10)),
    rustedSteelMat,
  );
  boltStem.rotation.z = Math.PI / 2;
  boltStem.position.set(0.025, 0.016, -0.058);
  slideGroup.add(boltStem);

  const boltKnob = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0068, 0.0058, 0.014, 12)),
    agedBrassMat,
  );
  boltKnob.rotation.z = Math.PI / 2;
  boltKnob.position.set(0.038, 0.016, -0.058);
  slideGroup.add(boltKnob);

  // 4. Classic 71-Round Circular Rusted Steel Drum Magazine (magazineGroup)
  const magazineGroup = new THREE.Group();
  root.add(magazineGroup);

  const drumNeck = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.026, 0.042, 0.034)),
    rustedSteelMat,
  );
  drumNeck.position.set(0, -0.032, -0.148);
  magazineGroup.add(drumNeck);

  const drumBody = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.064, 0.064, 0.036, 28)),
    rustedSteelMat,
  );
  drumBody.rotation.x = Math.PI / 2;
  drumBody.position.set(0, -0.095, -0.148);
  drumBody.castShadow = true;
  drumBody.receiveShadow = true;
  magazineGroup.add(drumBody);

  // Concentric stamped strengthening rings + brass center winding key on drum
  for (const r of [0.052, 0.034]) {
    for (const dz of [-0.0185, 0.0185]) {
      const stampRing = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(r, 0.0024, 8, 28)),
        darkSteelMat,
      );
      stampRing.position.set(0, -0.095, -0.148 + dz);
      magazineGroup.add(stampRing);
    }
  }
  const drumHub = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.042, 16)),
    agedBrassMat,
  );
  drumHub.rotation.x = Math.PI / 2;
  drumHub.position.set(0, -0.095, -0.148);
  magazineGroup.add(drumHub);

  // 5. Retrofuturist Soviet Tech: Side Nixie Vacuum Bulb + Phosphor-Green Telemetry Bar!
  const nixieMount = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.014, 0.020, 0.068)),
    rustedSteelMat,
  );
  nixieMount.position.set(-0.024, 0.016, -0.052);
  root.add(nixieMount);

  const sideBulb = createVacuumBulb(
    0.0095,
    0.046,
    nixieAmberMat,
    bulbGlassMat,
    agedBrassMat,
    trackGeo,
  );
  sideBulb.rotation.x = Math.PI / 2;
  sideBulb.position.set(-0.032, 0.018, -0.052);
  root.add(sideBulb);

  // Protective rusted brass guard cage bars around the vacuum bulb
  for (const ang of [-0.8, 0, 0.8]) {
    const cageBar = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.0014, 0.0014, 0.050, 8)),
      agedBrassMat,
    );
    cageBar.rotation.x = Math.PI / 2;
    cageBar.position.set(
      -0.032 - Math.cos(ang) * 0.012,
      0.018 + Math.sin(ang) * 0.012,
      -0.052,
    );
    root.add(cageBar);
  }

  // Braided copper conduit tube curving from Nixie bulb into front barrel coil!
  const wireCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.032, 0.018, -0.078),
    new THREE.Vector3(-0.038, 0.006, -0.112),
    new THREE.Vector3(-0.022, 0.010, -0.155),
  ]);
  const wireTube = new THREE.Mesh(
    trackGeo(new THREE.TubeGeometry(wireCurve, 14, 0.0022, 8, false)),
    agedBrassMat,
  );
  root.add(wireTube);

  // Top-left Soviet Phosphor-Green 5-bar ammo meter housing facing the operator
  const meterBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.012, 0.018, 0.058)),
    darkSteelMat,
  );
  meterBox.position.set(-0.021, 0.032, 0.036);
  meterBox.rotation.z = 0.25;
  root.add(meterBox);

  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.004, 0.009, 0.0065)),
      barMats[i],
    );
    bar.position.set(-0.0265, 0.033, 0.058 - i * 0.0105);
    bar.rotation.z = 0.25;
    root.add(bar);
  }

  const retroGlowLight = new THREE.PointLight(0xff741c, 0.26, 0.55, 2);
  retroGlowLight.position.set(-0.05, 0.03, -0.05);
  root.add(retroGlowLight);

  // 6. Hooded Soviet Iron Sights with Glowing Phosphor Tritium Alignment Pips
  const sightLineY = 0.0565;

  // Contoured curved Soviet rear L-flip sight saddle & beveled protective ears (no square blocks!)
  const ppSightBaseShape = new THREE.Shape();
  ppSightBaseShape.moveTo(-0.0115, 0.031);
  ppSightBaseShape.lineTo(0.0115, 0.031);
  ppSightBaseShape.quadraticCurveTo(0.0125, 0.044, 0.0095, 0.049);
  ppSightBaseShape.lineTo(-0.0095, 0.049);
  ppSightBaseShape.quadraticCurveTo(-0.0125, 0.044, -0.0115, 0.031);
  ppSightBaseShape.closePath();

  const ppSightBaseGeo = trackGeo(
    new THREE.ExtrudeGeometry(ppSightBaseShape, {
      depth: 0.015,
      bevelEnabled: true,
      bevelSize: 0.0010,
      bevelThickness: 0.0014,
      bevelSegments: 3,
    }),
  );
  ppSightBaseGeo.translate(0, 0, 0.044);
  root.add(new THREE.Mesh(ppSightBaseGeo, rustedSteelMat));

  for (const sx of [-1, 1]) {
    const earShape = new THREE.Shape();
    earShape.moveTo(sx * 0.0046, 0.047);
    earShape.lineTo(sx * 0.0108, 0.047);
    earShape.quadraticCurveTo(sx * 0.0112, 0.056, sx * 0.0086, 0.0625);
    earShape.quadraticCurveTo(sx * 0.0060, 0.0632, sx * 0.0046, 0.0605);
    earShape.closePath();
    const earGeo = trackGeo(
      new THREE.ExtrudeGeometry(earShape, {
        depth: 0.0076,
        bevelEnabled: true,
        bevelSize: 0.0006,
        bevelThickness: 0.0008,
        bevelSegments: 3,
      }),
    );
    earGeo.translate(0, 0, 0.048);
    root.add(new THREE.Mesh(earGeo, darkSteelMat));

    const pip = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.0014, 10, 8)),
      phosphorGreenMat,
    );
    pip.position.set(sx * 0.0076, 0.0565, 0.0566);
    root.add(pip);
  }

  // Front hooded ring sight + glowing amber tritium front post
  const frontHood = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0115, 0.0022, 10, 22)),
    rustedSteelMat,
  );
  frontHood.position.set(0, sightLineY, -0.372);
  root.add(frontHood);

  const frontPost = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0024, 0.012, 0.003)),
    darkSteelMat,
  );
  frontPost.position.set(0, sightLineY - 0.005, -0.372);
  root.add(frontPost);

  const frontPip = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0017, 8, 8)),
    nixieAmberMat,
  );
  frontPip.position.set(0, sightLineY + 0.0005, -0.370);
  root.add(frontPip);

  // 7. Standard Pistol Grip, Trigger, Muzzle Flash & Ejection Port
  const triggerPivot = addStandardGripAndTrigger(
    root,
    birchWoodMat,
    rustedSteelMat,
    darkSteelMat,
    trackGeo,
  );

  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.016, 0.032, -0.055);
  root.add(ejectionPort);

  const flashRig = createMuzzleFlashRig(
    root,
    0,
    0.016,
    -0.405,
    1.05,
    0xffb25e,
    'smg',
    disposables,
  );

  const underbarrelLight = createUnderbarrelFlashlight({
    maxAnisotropy,
    rustic: true,
    scale: 0.92,
  });
  underbarrelLight.group.position.set(0, -0.008, -0.315);
  root.add(underbarrelLight.group);
  disposables.push(underbarrelLight);

  let currentHeat = 0;

  return {
    root,
    slideGroup,
    barrelGroup,
    triggerPivot,
    magazineGroup,
    muzzleFlashGroup: flashRig.muzzleFlashGroup,
    muzzleLight: flashRig.muzzleLight,
    muzzleTip: flashRig.muzzleTip,
    ejectionPort,
    flashlightLens: underbarrelLight.lensAnchor,
    sightLineY,
    setSlideOffset(backMeters: number) {
      slideGroup.position.z = THREE.MathUtils.clamp(backMeters, 0, 0.068);
    },
    setFlashlightOn(on: boolean) {
      underbarrelLight.setOn(on);
    },
    setTriggerPull(amount: number) {
      triggerPivot.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 0.42;
    },
    setMuzzleFlash(intensity: number) {
      flashRig.setIntensity(intensity);
    },
    setFireGlow(heat01: number) {
      currentHeat = THREE.MathUtils.clamp(heat01, 0, 1);
      nixieAmberMat.emissiveIntensity = 2.6 + currentHeat * 5.8;
      retroGlowLight.intensity = 0.22 + currentHeat * 1.35;
    },
    updateLeds(ammo, maxAmmo, isReloading, elapsed) {
      const frac = maxAmmo > 0 ? THREE.MathUtils.clamp(ammo / maxAmmo, 0, 1) : 0;
      const isEmpty = ammo === 0;
      const flicker = 0.88 + 0.12 * Math.sin(elapsed * 29) * Math.sin(elapsed * 7.3);
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);

      rearLedPanel.update(frac, isEmpty, isReloading, elapsed);

      if (isReloading) {
        const swirlHue = (elapsed * 1.55) % 1.0;
        nixieAmberMat.emissive.setHSL(swirlHue, 1.0, 0.52);
        nixieAmberMat.color.setHSL(swirlHue, 0.92, 0.76);
        nixieAmberMat.emissiveIntensity = 3.2 + pulse * 1.8;
        retroGlowLight.color.setHSL(swirlHue, 1.0, 0.54);
        retroGlowLight.intensity = 0.08 + pulse * 0.05;

        for (let i = 0; i < barMats.length; i++) {
          const m = barMats[i];
          const h = (elapsed * 1.65 - i * 0.16 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.15);
          m.emissive.setHSL(h, 1.0, 0.52);
          m.color.setHSL(h, 0.92, 0.76);
          m.emissiveIntensity = 1.8 + chase * 3.0;
        }
        return;
      }

      const ammoHue = ammoFractionToHue(frac);
      nixieAmberMat.emissive.setHSL(ammoHue, 1.0, 0.50);
      nixieAmberMat.color.setHSL(ammoHue, 0.92, 0.74);
      nixieAmberMat.emissiveIntensity = (2.6 + currentHeat * 5.2) * flicker;
      retroGlowLight.color.setHSL(ammoHue, 1.0, 0.52);
      retroGlowLight.intensity = 0.14 + currentHeat * 0.95;

      for (let i = 0; i < barMats.length; i++) {
        const thresh = (i + 0.15) / barMats.length;
        const m = barMats[i];
        if (frac >= thresh) {
          const low = frac <= 0.25;
          m.emissive.setHSL(ammoHue, 1.0, 0.50);
          m.color.setHSL(ammoHue, 0.92, 0.74);
          m.emissiveIntensity = (low ? 2.6 + pulse * 2.0 : 2.9) * flicker;
        } else {
          m.emissive.setHex(0x44140c);
          m.color.setHex(0x522018);
          m.emissiveIntensity = isEmpty ? 0.7 + pulse * 1.4 : 0.32;
        }
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ============================================================================
// 2. AK-74M "KOBRA-PULSE" — RUSTED SOVIET COMPACT SMG/CARBINE (Bakelite + Cherenkov Tubes + Kobra Sight)
// ============================================================================
export function buildRetroSovietSmg(
  maxAnisotropy: number,
  _flashTexture?: THREE.Texture,
): RetroWeaponRig {
  const root = new THREE.Group();
  root.name = 'RetroSovietAK74MSMG';

  const rustSet = createRustedRussianSteelTextures(maxAnisotropy, 3);
  const woodSet = createRussianWoodTextures(maxAnisotropy);
  const bakeliteSet = createSovietBakeliteTextures(maxAnisotropy);
  const metalSet = createGunmetalTexture(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [
    rustSet,
    woodSet,
    bakeliteSet,
    metalSet,
  ];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const rustedSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: rustSet.map,
      normalMap: rustSet.normalMap,
      normalScale: new THREE.Vector2(1.58, 1.58),
      roughnessMap: rustSet.roughnessMap,
      roughness: 1.0,
      metalnessMap: rustSet.metalnessMap,
      metalness: 0.94,
      envMapIntensity: 1.44,
    }),
    { edgeWear: 0.56, cavityDepth: 0.48, sheenColor: 0x90b2d4, sheenStrength: 0.26 },
  );

  const darkMetalMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x191d22,
      map: metalSet.map,
      normalMap: metalSet.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: metalSet.roughnessMap,
      metalness: 0.88,
      roughness: 0.38,
      envMapIntensity: 1.36,
    }),
    { edgeWear: 0.48, cavityDepth: 0.44, sheenColor: 0x8ea6c2, sheenStrength: 0.26 },
  );

  const bakeliteMat = enhanceGunWoodMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: bakeliteSet.map,
      normalMap: bakeliteSet.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: bakeliteSet.roughnessMap,
      roughness: 0.50,
      metalness: 0.04,
      clearcoat: 0.40,
      clearcoatRoughness: 0.32,
    }),
    0.18,
  );

  const woodMat = enhanceGunWoodMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: woodSet.map,
      normalMap: woodSet.normalMap,
      normalScale: new THREE.Vector2(1.22, 1.22),
      roughnessMap: woodSet.roughnessMap,
      roughness: 0.72,
      metalness: 0.02,
      clearcoat: 0.24,
    }),
    0.20,
  );

  const copperMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xb86d3b,
      roughness: 0.36,
      metalness: 0.90,
      envMapIntensity: 1.44,
    }),
    { edgeWear: 0.32, cavityDepth: 0.34, sheenColor: 0xffc694, sheenStrength: 0.22 },
  );

  // Glowing Soviet Cherenkov Electric-Cyan Plasma Tubes!
  const cherenkovMat = new THREE.MeshStandardMaterial({
    color: 0xc2ffff,
    emissive: 0x14e8ff,
    emissiveIntensity: 3.0,
    roughness: 0.12,
    metalness: 0.05,
  });

  const amberLampMat = new THREE.MeshStandardMaterial({
    color: 0xffd088,
    emissive: 0xff6a12,
    emissiveIntensity: 3.2,
    roughness: 0.15,
  });

  const glassTubeMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8f8ff,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const kobraReticleMat = new THREE.MeshBasicMaterial({
    color: 0xff5418,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const opticLensMat = new THREE.MeshPhysicalMaterial({
    color: 0x26424a,
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    clearcoat: 1.0,
    depthWrite: false,
  });

  disposables.push(
    rustedSteelMat,
    darkMetalMat,
    bakeliteMat,
    woodMat,
    copperMat,
    cherenkovMat,
    amberLampMat,
    glassTubeMat,
    kobraReticleMat,
    opticLensMat,
  );

  // 1. Beveled Stamped AK-74M Receiver + Domed Arched Dust Cover + Curved Stock Trunnion & Comb!
  const akRecShape = new THREE.Shape();
  akRecShape.moveTo(-0.0155, -0.014);
  akRecShape.lineTo(0.0155, -0.014);
  akRecShape.quadraticCurveTo(0.0185, -0.0135, 0.0185, -0.007);
  akRecShape.lineTo(0.0185, 0.024);
  akRecShape.quadraticCurveTo(0.0185, 0.0295, 0.0125, 0.0305);
  akRecShape.lineTo(-0.0125, 0.0305);
  akRecShape.quadraticCurveTo(-0.0185, 0.0295, -0.0185, 0.024);
  akRecShape.lineTo(-0.0185, -0.007);
  akRecShape.quadraticCurveTo(-0.0185, -0.0135, -0.0155, -0.014);
  akRecShape.closePath();

  const akRecGeo = trackGeo(
    new THREE.ExtrudeGeometry(akRecShape, {
      depth: 0.220,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.0032,
      bevelSegments: 4,
      curveSegments: 14,
    }),
  );
  akRecGeo.translate(0, 0, -0.136);
  const receiver = new THREE.Mesh(akRecGeo, rustedSteelMat);
  receiver.castShadow = true;
  receiver.receiveShadow = true;
  root.add(receiver);

  // Arched stamped ribbed top dust cover curving smoothly down into a rounded rear dome!
  const dustCover = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0176, 0.0184, 0.208, 18, 1, false, -Math.PI * 0.5, Math.PI)),
    rustedSteelMat,
  );
  dustCover.rotation.x = Math.PI / 2;
  dustCover.rotation.y = Math.PI / 2;
  dustCover.position.set(0, 0.026, -0.024);
  dustCover.castShadow = true;
  root.add(dustCover);

  // Rounded rear dust-cover heel dome + authentic AK recoil-spring push-button latch!
  const dustRearDome = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0178, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)),
    rustedSteelMat,
  );
  dustRearDome.rotation.x = Math.PI / 2;
  dustRearDome.scale.set(1.0, 0.62, 0.85);
  dustRearDome.position.set(0, 0.025, 0.080);
  root.add(dustRearDome);

  const akLatchButton = new THREE.Mesh(
    trackGeo(new THREE.CapsuleGeometry(0.0034, 0.0032, 4, 10)),
    darkMetalMat,
  );
  akLatchButton.rotation.z = Math.PI / 2;
  akLatchButton.position.set(0, 0.032, 0.091);
  root.add(akLatchButton);

  // Curved rear trunnion & contoured Soviet polymer/wood stock neck sweeping cleanly rearward!
  const akStockShape = new THREE.Shape();
  akStockShape.moveTo(0.072, 0.020);
  akStockShape.quadraticCurveTo(0.106, 0.018, 0.145, 0.008);
  akStockShape.quadraticCurveTo(0.180, 0.000, 0.215, -0.006);
  akStockShape.lineTo(0.215, -0.044);
  akStockShape.quadraticCurveTo(0.155, -0.034, 0.105, -0.020);
  akStockShape.quadraticCurveTo(0.084, -0.014, 0.072, -0.010);
  akStockShape.closePath();

  const akStockGeo = trackGeo(
    new THREE.ExtrudeGeometry(akStockShape, {
      depth: 0.026,
      bevelEnabled: true,
      bevelSize: 0.0052,
      bevelThickness: 0.0058,
      bevelSegments: 5,
      curveSegments: 16,
    }),
  );
  akStockGeo.rotateY(-Math.PI / 2);
  akStockGeo.translate(0.013, 0, 0);
  const akStock = new THREE.Mesh(akStockGeo, bakeliteMat);
  akStock.castShadow = true;
  akStock.receiveShadow = true;
  root.add(akStock);

  // Futuristic curved-arch Green & Red LED status array nestled onto the rounded rear dust cover
  const rearLedPanel = addRearFuturisticLedPanel(
    root,
    [0, 0.020, 0.0915],
    0.90,
    darkMetalMat,
    trackGeo,
    disposables,
  );

  // Stamped dust-cover reinforcing ribs + side rivets
  for (const rz of [-0.09, -0.04, 0.01, 0.055]) {
    const rib = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.037, 0.004, 0.006)),
      darkMetalMat,
    );
    rib.position.set(0, 0.038, rz);
    root.add(rib);

    for (const sx of [-0.0185, 0.0185]) {
      const riv = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.0024, 0.0024, 0.003, 8)),
        darkMetalMat,
      );
      riv.rotation.z = Math.PI / 2;
      riv.position.set(sx, 0.006, rz);
      root.add(riv);
    }
  }

  // 2. Scarred Birchwood Lower Handguard + Rusted Gas Block + Krinkov Booster Cone
  const barrelGroup = new THREE.Group();
  root.add(barrelGroup);

  const woodGuard = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.040, 0.032, 0.135)),
    woodMat,
  );
  woodGuard.position.set(0, -0.004, -0.195);
  woodGuard.castShadow = true;
  woodGuard.receiveShadow = true;
  barrelGroup.add(woodGuard);

  // Black electrical tape bands wrapped around the weathered wooden handguard
  for (const tz of [-0.158, -0.232]) {
    const tape = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0425, 0.0345, 0.018)),
      darkMetalMat,
    );
    tape.position.set(0, -0.004, tz);
    barrelGroup.add(tape);
  }

  const barrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0086, 0.0094, 0.165, 16)),
    darkMetalMat,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.008, -0.295);
  barrelGroup.add(barrel);

  // Upper gas tube + rusted front sight tower
  const gasTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0095, 0.0095, 0.135, 14)),
    rustedSteelMat,
  );
  gasTube.rotation.x = Math.PI / 2;
  gasTube.position.set(0, 0.029, -0.202);
  barrelGroup.add(gasTube);

  // Iconic AKS-74U flared Krinkov conical muzzle booster
  const booster = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.016, 0.0105, 0.046, 18)),
    rustedSteelMat,
  );
  booster.rotation.x = Math.PI / 2;
  booster.position.set(0, 0.008, -0.388);
  barrelGroup.add(booster);

  const frontPostTower = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.014, 0.036, 0.018)),
    rustedSteelMat,
  );
  frontPostTower.position.set(0, 0.036, -0.336);
  barrelGroup.add(frontPostTower);

  // 3. Reciprocating Right-Side Hooked AK Charging Handle (slideGroup)
  const slideGroup = new THREE.Group();
  root.add(slideGroup);

  const carrier = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.010, 0.016, 0.068)),
    darkMetalMat,
  );
  carrier.position.set(0.016, 0.018, -0.055);
  slideGroup.add(carrier);

  const handle = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.024, 0.008, 0.011)),
    rustedSteelMat,
  );
  handle.position.set(0.028, 0.018, -0.072);
  handle.rotation.z = 0.24;
  slideGroup.add(handle);

  // 4. Iconic Curved Mottled Russian Bakelite Banana Magazine (magazineGroup)
  const magazineGroup = new THREE.Group();
  root.add(magazineGroup);

  const magShape = new THREE.Shape();
  magShape.moveTo(-0.028, 0);
  magShape.lineTo(0.024, 0);
  magShape.quadraticCurveTo(0.020, -0.075, -0.002, -0.155);
  magShape.lineTo(-0.054, -0.140);
  magShape.quadraticCurveTo(-0.034, -0.070, -0.028, 0);
  magShape.closePath();

  const magGeo = trackGeo(
    new THREE.ExtrudeGeometry(magShape, {
      depth: 0.024,
      bevelEnabled: true,
      bevelSize: 0.0022,
      bevelThickness: 0.0022,
      bevelSegments: 3,
    }),
  );
  magGeo.rotateY(-Math.PI / 2);
  magGeo.translate(0.012, -0.014, -0.105);
  const magMesh = new THREE.Mesh(magGeo, bakeliteMat);
  magMesh.castShadow = true;
  magMesh.receiveShadow = true;
  magazineGroup.add(magMesh);

  // Rusted steel mag floorplate
  const magFloor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.029, 0.008, 0.058)),
    rustedSteelMat,
  );
  magFloor.position.set(0, -0.162, -0.132);
  magFloor.rotation.x = 0.26;
  magazineGroup.add(magFloor);

  // 5. Retrofuturist Tech: Twin Glowing Cyan Cherenkov Plasma Tubes + Rear Jewel Lamps!
  for (const sx of [-0.0245, 0.0245]) {
    const tube = createVacuumBulb(
      0.0068,
      0.098,
      cherenkovMat,
      glassTubeMat,
      copperMat,
      trackGeo,
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.set(sx, 0.027, -0.198);
    root.add(tube);

    // Copper clamp brackets
    for (const cz of [-0.158, -0.238]) {
      const clamp = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.0082, 0.0018, 6, 14)),
        copperMat,
      );
      clamp.position.set(sx, 0.027, cz);
      root.add(clamp);
    }
  }

  // Left-side rounded cylindrical rear diagnostic pod + jewel lamps facing operator!
  const rearPod = new THREE.Mesh(
    trackGeo(new THREE.CapsuleGeometry(0.0082, 0.032, 6, 14)),
    rustedSteelMat,
  );
  rearPod.rotation.x = Math.PI / 2;
  rearPod.position.set(-0.022, 0.018, 0.058);
  root.add(rearPod);

  const amberJewel = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0046, 12, 10)),
    amberLampMat,
  );
  amberJewel.position.set(-0.022, 0.022, 0.080);
  root.add(amberJewel);

  const cyanJewel = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0040, 12, 10)),
    cherenkovMat,
  );
  cyanJewel.position.set(-0.022, 0.013, 0.080);
  root.add(cyanJewel);

  const cherenkovLight = new THREE.PointLight(0x20e0ff, 0.28, 0.65, 2);
  cherenkovLight.position.set(-0.045, 0.04, -0.18);
  root.add(cherenkovLight);

  // 6. Soviet Kobra-Style Retrofuturist Reflex Optic (Hollow Extruded Rusted Hood + Glowing T-Reticle!)
  const sightLineY = 0.0685;

  // Riveted side dovetail mount arm rising from left receiver wall
  const dovetailArm = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0068, 0.040, 0.066)),
    rustedSteelMat,
  );
  dovetailArm.position.set(-0.021, 0.028, 0.002);
  root.add(dovetailArm);

  // Contoured beveled Kobra optic saddle base (curved flanks, zero flat box slab!)
  const kobraBaseShape = new THREE.Shape();
  kobraBaseShape.moveTo(-0.018, 0.041);
  kobraBaseShape.lineTo(0.014, 0.041);
  kobraBaseShape.quadraticCurveTo(0.017, 0.046, 0.014, 0.053);
  kobraBaseShape.lineTo(-0.016, 0.053);
  kobraBaseShape.quadraticCurveTo(-0.020, 0.047, -0.018, 0.041);
  kobraBaseShape.closePath();

  const kobraBaseGeo = trackGeo(
    new THREE.ExtrudeGeometry(kobraBaseShape, {
      depth: 0.068,
      bevelEnabled: true,
      bevelSize: 0.0012,
      bevelThickness: 0.0020,
      bevelSegments: 3,
    }),
  );
  kobraBaseGeo.translate(0, 0, -0.032);
  root.add(new THREE.Mesh(kobraBaseGeo, rustedSteelMat));

  // Hollow extruded arched Soviet Kobra hood (100% open clear window!)
  const kobraOuter = new THREE.Shape();
  kobraOuter.moveTo(-0.019, -0.015);
  kobraOuter.lineTo(0.019, -0.015);
  kobraOuter.lineTo(0.019, 0.007);
  kobraOuter.quadraticCurveTo(0.019, 0.020, 0.0, 0.020);
  kobraOuter.quadraticCurveTo(-0.019, 0.020, -0.019, 0.007);
  kobraOuter.closePath();

  const kobraHole = new THREE.Path();
  kobraHole.moveTo(-0.014, -0.011);
  kobraHole.lineTo(0.014, -0.011);
  kobraHole.lineTo(0.014, 0.005);
  kobraHole.quadraticCurveTo(0.014, 0.015, 0.0, 0.015);
  kobraHole.quadraticCurveTo(-0.014, 0.015, -0.014, 0.005);
  kobraHole.closePath();
  kobraOuter.holes.push(kobraHole);

  const kobraHoodGeo = trackGeo(
    new THREE.ExtrudeGeometry(kobraOuter, {
      depth: 0.042,
      bevelEnabled: true,
      bevelSize: 0.0012,
      bevelThickness: 0.0012,
      bevelSegments: 2,
    }),
  );
  kobraHoodGeo.translate(0, sightLineY, -0.024);
  const kobraHood = new THREE.Mesh(kobraHoodGeo, rustedSteelMat);
  kobraHood.castShadow = true;
  root.add(kobraHood);

  // Tinted anti-reflective optic lens + glowing Soviet Kobra T-chevron reticle!
  const kLens = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(0.027, 0.024)),
    opticLensMat,
  );
  kLens.position.set(0, sightLineY, -0.004);
  kLens.renderOrder = 3;
  root.add(kLens);

  const retGroup = new THREE.Group();
  retGroup.position.set(0, sightLineY, -0.003);
  root.add(retGroup);
  retGroup.add(new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.0013, 14)), kobraReticleMat));
  // Left, right, and lower Soviet Kobra T-bars
  const hTick = trackGeo(new THREE.PlaneGeometry(0.0052, 0.0008));
  const vTick = trackGeo(new THREE.PlaneGeometry(0.0008, 0.0052));
  const lBar = new THREE.Mesh(hTick, kobraReticleMat);
  lBar.position.set(-0.0062, 0, 0);
  retGroup.add(lBar);
  const rBar = new THREE.Mesh(hTick, kobraReticleMat);
  rBar.position.set(0.0062, 0, 0);
  retGroup.add(rBar);
  const bBar = new THREE.Mesh(vTick, kobraReticleMat);
  bBar.position.set(0, -0.0062, 0);
  retGroup.add(bBar);

  // 7. Bakelite Pistol Grip, Trigger, Muzzle Flash & Ejection Port
  const triggerPivot = addStandardGripAndTrigger(
    root,
    bakeliteMat,
    rustedSteelMat,
    darkMetalMat,
    trackGeo,
  );

  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.022, 0.018, -0.048);
  root.add(ejectionPort);

  const flashRig = createMuzzleFlashRig(
    root,
    0,
    0.008,
    -0.415,
    1.12,
    0xffcf94,
    'smg',
    disposables,
  );

  const underbarrelLight = createUnderbarrelFlashlight({
    maxAnisotropy,
    rustic: true,
    scale: 0.92,
  });
  underbarrelLight.group.position.set(0, -0.014, -0.312);
  root.add(underbarrelLight.group);
  disposables.push(underbarrelLight);

  let currentHeat = 0;

  return {
    root,
    slideGroup,
    barrelGroup,
    triggerPivot,
    magazineGroup,
    muzzleFlashGroup: flashRig.muzzleFlashGroup,
    muzzleLight: flashRig.muzzleLight,
    muzzleTip: flashRig.muzzleTip,
    ejectionPort,
    flashlightLens: underbarrelLight.lensAnchor,
    sightLineY,
    setSlideOffset(backMeters: number) {
      slideGroup.position.z = THREE.MathUtils.clamp(backMeters, 0, 0.070);
    },
    setFlashlightOn(on: boolean) {
      underbarrelLight.setOn(on);
    },
    setTriggerPull(amount: number) {
      triggerPivot.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 0.42;
    },
    setMuzzleFlash(intensity: number) {
      flashRig.setIntensity(intensity);
    },
    setFireGlow(heat01: number) {
      currentHeat = THREE.MathUtils.clamp(heat01, 0, 1);
      cherenkovMat.emissiveIntensity = 2.6 + currentHeat * 6.4;
      cherenkovLight.intensity = 0.24 + currentHeat * 1.65;
    },
    updateLeds(ammo, maxAmmo, isReloading, elapsed) {
      const frac = maxAmmo > 0 ? THREE.MathUtils.clamp(ammo / maxAmmo, 0, 1) : 0;
      const isEmpty = ammo === 0;
      const hum = 0.9 + 0.1 * Math.sin(elapsed * 22);
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);

      rearLedPanel.update(frac, isEmpty, isReloading, elapsed);

      if (isReloading) {
        const h1 = (elapsed * 1.55) % 1.0;
        const h2 = (elapsed * 1.55 + 0.42) % 1.0;
        cherenkovMat.emissive.setHSL(h1, 1.0, 0.52);
        cherenkovMat.color.setHSL(h1, 0.92, 0.78);
        cherenkovMat.emissiveIntensity = 3.2 + pulse * 2.2;

        amberLampMat.emissive.setHSL(h2, 1.0, 0.52);
        amberLampMat.color.setHSL(h2, 0.92, 0.76);
        amberLampMat.emissiveIntensity = 2.6 + (1 - pulse) * 2.6;

        cherenkovLight.color.setHSL(h1, 1.0, 0.54);
        cherenkovLight.intensity = 0.08 + pulse * 0.05;
        return;
      }

      const ammoHue = ammoFractionToHue(frac);
      cherenkovMat.emissive.setHSL(ammoHue, 1.0, 0.50);
      cherenkovMat.color.setHSL(ammoHue, 0.92, 0.76);
      cherenkovMat.emissiveIntensity = (2.6 + currentHeat * 5.6) * hum;

      amberLampMat.emissive.setHSL(ammoHue, 1.0, 0.50);
      amberLampMat.color.setHSL(ammoHue, 0.92, 0.74);
      amberLampMat.emissiveIntensity =
        isEmpty || frac <= 0.25
          ? 2.6 + pulse * 3.0
          : 2.6 + currentHeat * 2.2;

      cherenkovLight.color.setHSL(ammoHue, 1.0, 0.52);
      cherenkovLight.intensity = 0.14 + currentHeat * 1.1;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ============================================================================
// 3. KS-23 "VOSTOK" — RUSTED RUSSIAN HEAVY RETROFUTURIST PUMP SHOTGUN
//    (Corroded Heavy Bore + Ribbed Birchwood Pump + 3x Amber Vacuum Tubes + Phosphor Ring Optic)
// ============================================================================
export function buildRusticRussianShotgun(
  maxAnisotropy: number,
  _flashTexture?: THREE.Texture,
): RetroWeaponRig {
  const root = new THREE.Group();
  root.name = 'RusticRussianKS23Shotgun';

  const rustSet = createRustedRussianSteelTextures(maxAnisotropy, 7);
  const woodSet = createRussianWoodTextures(maxAnisotropy);
  const metalSet = createGunmetalTexture(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [rustSet, woodSet, metalSet];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const heavyRustMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: rustSet.map,
      normalMap: rustSet.normalMap,
      normalScale: new THREE.Vector2(1.68, 1.68),
      roughnessMap: rustSet.roughnessMap,
      roughness: 1.0,
      metalnessMap: rustSet.metalnessMap,
      metalness: 0.94,
      envMapIntensity: 1.44,
    }),
    { edgeWear: 0.62, cavityDepth: 0.52, sheenColor: 0x98b0c8, sheenStrength: 0.28 },
  );

  const darkSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x1a1e24,
      map: metalSet.map,
      normalMap: metalSet.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: metalSet.roughnessMap,
      metalness: 0.90,
      roughness: 0.40,
      envMapIntensity: 1.38,
    }),
    { edgeWear: 0.50, cavityDepth: 0.46, sheenColor: 0x8ea6c4, sheenStrength: 0.26 },
  );

  const birchWoodMat = enhanceGunWoodMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: woodSet.map,
      normalMap: woodSet.normalMap,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: woodSet.roughnessMap,
      roughness: 0.66,
      metalness: 0.02,
      clearcoat: 0.30,
      clearcoatRoughness: 0.40,
    }),
    0.22,
  );

  const brassMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xa48248,
      normalMap: rustSet.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      metalness: 0.86,
      roughness: 0.42,
      envMapIntensity: 1.40,
    }),
    { edgeWear: 0.38, cavityDepth: 0.36, sheenColor: 0xe6c882, sheenStrength: 0.22 },
  );

  const vacuumFireMat = new THREE.MeshStandardMaterial({
    color: 0xffd290,
    emissive: 0xff5a0c,
    emissiveIntensity: 2.8,
    roughness: 0.14,
  });

  const phosphorMat = new THREE.MeshStandardMaterial({
    color: 0xb8ffd4,
    emissive: 0x1aff72,
    emissiveIntensity: 3.0,
    roughness: 0.14,
  });

  const glassBulbMat = new THREE.MeshPhysicalMaterial({
    color: 0xffe6cc,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const opticReticleMat = new THREE.MeshBasicMaterial({
    color: 0x2cff82,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const opticGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x224a36,
    transparent: true,
    opacity: 0.15,
    roughness: 0.05,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const shellHullMat = new THREE.MeshStandardMaterial({
    color: 0x9b2416,
    roughness: 0.48,
    metalness: 0.08,
  });

  const barMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    const bm = new THREE.MeshStandardMaterial({
      color: 0xb8ffd4,
      emissive: 0x1aff72,
      emissiveIntensity: 2.8,
      roughness: 0.18,
    });
    barMats.push(bm);
    disposables.push(bm);
  }

  disposables.push(
    heavyRustMat,
    darkSteelMat,
    birchWoodMat,
    brassMat,
    vacuumFireMat,
    phosphorMat,
    glassBulbMat,
    opticReticleMat,
    opticGlassMat,
    shellHullMat,
  );

  // 1. Massive Sculpted Crowned-Top Milled Russian KS-23 Shotgun Receiver (NO flat square slab!)
  const ksRecShape = new THREE.Shape();
  ksRecShape.moveTo(-0.021, -0.016);
  ksRecShape.lineTo(0.021, -0.016);
  ksRecShape.quadraticCurveTo(0.030, -0.014, 0.0305, -0.002);
  ksRecShape.lineTo(0.0305, 0.030);
  ksRecShape.quadraticCurveTo(0.030, 0.047, 0.016, 0.053);
  ksRecShape.quadraticCurveTo(0, 0.0585, -0.016, 0.053);
  ksRecShape.quadraticCurveTo(-0.030, 0.047, -0.0305, 0.030);
  ksRecShape.lineTo(-0.0305, -0.002);
  ksRecShape.quadraticCurveTo(-0.030, -0.014, -0.021, -0.016);
  ksRecShape.closePath();

  const ksRecGeo = trackGeo(
    new THREE.ExtrudeGeometry(ksRecShape, {
      depth: 0.240,
      bevelEnabled: true,
      bevelSize: 0.0030,
      bevelThickness: 0.0052,
      bevelSegments: 5,
      curveSegments: 20,
    }),
  );
  ksRecGeo.translate(0, 0, -0.164);
  const receiver = new THREE.Mesh(ksRecGeo, heavyRustMat);
  receiver.castShadow = true;
  receiver.receiveShadow = true;
  root.add(receiver);

  // Curved steel rear receiver tang sloping cleanly into a carved oiled birchwood shotgun stock wrist & comb!
  const ksStockShape = new THREE.Shape();
  ksStockShape.moveTo(0.062, 0.044);
  ksStockShape.quadraticCurveTo(0.092, 0.038, 0.122, 0.018);
  ksStockShape.quadraticCurveTo(0.158, 0.004, 0.205, -0.004);
  ksStockShape.lineTo(0.205, -0.046);
  ksStockShape.quadraticCurveTo(0.142, -0.034, 0.095, -0.022);
  ksStockShape.quadraticCurveTo(0.074, -0.018, 0.062, -0.014);
  ksStockShape.closePath();

  const ksStockGeo = trackGeo(
    new THREE.ExtrudeGeometry(ksStockShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelSize: 0.0072,
      bevelThickness: 0.0078,
      bevelSegments: 5,
      curveSegments: 18,
    }),
  );
  ksStockGeo.rotateY(-Math.PI / 2);
  ksStockGeo.translate(0.018, 0, 0);
  const ksStock = new THREE.Mesh(ksStockGeo, birchWoodMat);
  ksStock.castShadow = true;
  ksStock.receiveShadow = true;
  root.add(ksStock);

  // Machined steel tang safety slide nestled on the curved top of the rear shotgun tang
  const tangSafety = new THREE.Mesh(
    trackGeo(new THREE.CapsuleGeometry(0.0052, 0.012, 4, 12)),
    darkSteelMat,
  );
  tangSafety.rotation.x = Math.PI / 2 + 0.36;
  tangSafety.position.set(0, 0.044, 0.094);
  root.add(tangSafety);

  // Heavy curved-arch futuristic Green & Red LED telemetry panel on crowned rear receiver face
  const rearLedPanel = addRearFuturisticLedPanel(
    root,
    [0, 0.026, 0.0825],
    1.18,
    darkSteelMat,
    trackGeo,
    disposables,
  );

  const hexGeo = trackGeo(new THREE.CylinderGeometry(0.0044, 0.0044, 0.005, 6));
  hexGeo.rotateZ(Math.PI / 2);
  for (const bz of [-0.135, -0.075, -0.01, 0.055]) {
    for (const sx of [-0.0315, 0.0315]) {
      const bolt = new THREE.Mesh(hexGeo, darkSteelMat);
      bolt.position.set(sx, 0.016, bz);
      root.add(bolt);
    }
  }

  // 2. Massive Heavy-Bore 23mm Rusted Barrel, Thick Tubular Magazine & Glowing Heat Vents!
  const barrelGroup = new THREE.Group();
  root.add(barrelGroup);

  const heavyBarrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0192, 0.0206, 0.375, 24)),
    heavyRustMat,
  );
  heavyBarrel.rotation.x = Math.PI / 2;
  heavyBarrel.position.set(0, 0.027, -0.335);
  heavyBarrel.castShadow = true;
  barrelGroup.add(heavyBarrel);

  // Heavy slotted industrial muzzle brake
  const muzzleBrake = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0255, 0.0225, 0.048, 16)),
    darkSteelMat,
  );
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.set(0, 0.027, -0.528);
  barrelGroup.add(muzzleBrake);

  // Thick under-barrel rusted tubular shell magazine
  const magTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0166, 0.0166, 0.342, 20)),
    darkSteelMat,
  );
  magTube.rotation.x = Math.PI / 2;
  magTube.position.set(0, -0.013, -0.32);
  barrelGroup.add(magTube);

  const magCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0182, 0.0182, 0.020, 18)),
    brassMat,
  );
  magCap.rotation.x = Math.PI / 2;
  magCap.position.set(0, -0.013, -0.495);
  barrelGroup.add(magCap);

  // Curved arched steel barrel heatshield shroud (rounded upper saddle, zero boxy plate!)
  const heatShield = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0235, 0.0242, 0.285, 18, 1, false, -Math.PI * 0.48, Math.PI * 0.96)),
    heavyRustMat,
  );
  heatShield.rotation.x = Math.PI / 2;
  heatShield.rotation.y = Math.PI / 2;
  heatShield.position.set(0, 0.027, -0.312);
  barrelGroup.add(heatShield);

  for (let i = 0; i < 6; i++) {
    const vent = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.032, 0.0052, 0.018)),
      vacuumFireMat,
    );
    vent.position.set(0, 0.0485, -0.20 - i * 0.044);
    barrelGroup.add(vent);
  }

  // Heavy barrel-to-mag rusted clamp strap
  const clamp = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.046, 0.068, 0.020)),
    heavyRustMat,
  );
  clamp.position.set(0, 0.007, -0.445);
  barrelGroup.add(clamp);

  // 3. Thick Chunky Sliding Ribbed Russian Birchwood Pump Forend (matches thickened shotgun stance!)
  const pumpGroup = new THREE.Group();
  root.add(pumpGroup);

  const woodPumpCore = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0302, 0.0314, 0.154, 24)),
    birchWoodMat,
  );
  woodPumpCore.rotation.x = Math.PI / 2;
  woodPumpCore.position.set(0, -0.014, -0.295);
  woodPumpCore.castShadow = true;
  woodPumpCore.receiveShadow = true;
  pumpGroup.add(woodPumpCore);

  // Classic turned Soviet corncob wood grooves along thick pump forend
  for (let i = 0; i < 8; i++) {
    const groove = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.0310, 0.0028, 8, 22)),
      birchWoodMat,
    );
    groove.position.set(0, -0.014, -0.236 - i * 0.0165);
    pumpGroup.add(groove);
  }

  // Rusted steel end-ferrules & twin heavy action bars
  for (const fz of [-0.218, -0.372]) {
    const ferrule = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.0318, 0.0318, 0.014, 22)),
      heavyRustMat,
    );
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.set(0, -0.014, fz);
    pumpGroup.add(ferrule);
  }
  for (const sx of [-0.0255, 0.0255]) {
    const bar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0048, 0.0086, 0.148)),
      darkSteelMat,
    );
    bar.position.set(sx, -0.014, -0.17);
    pumpGroup.add(bar);
  }

  // Reciprocating heavy bolt block visible on right ejection port
  const slideGroup = new THREE.Group();
  root.add(slideGroup);
  const boltBlock = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.014, 0.025, 0.076)),
    darkSteelMat,
  );
  boltBlock.position.set(0.028, 0.020, -0.055);
  slideGroup.add(boltBlock);

  // 4. Retrofuturist Tech: 3-Tube Caged Amber Vacuum Capacitor Bank + 6-Bar Phosphor Shell Meter!
  const bankBase = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.016, 0.018, 0.098)),
    heavyRustMat,
  );
  bankBase.position.set(-0.036, 0.006, -0.092);
  root.add(bankBase);

  for (let i = 0; i < 3; i++) {
    const bulb = createVacuumBulb(
      0.0078,
      0.038,
      vacuumFireMat,
      glassBulbMat,
      brassMat,
      trackGeo,
    );
    bulb.position.set(-0.041, 0.026, -0.062 - i * 0.028);
    bulb.rotation.z = 0.26;
    root.add(bulb);
  }

  // Protective rusted wire guard rail wrapping across the 3 vacuum tubes
  const guardRail = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0020, 0.0020, 0.10, 8)),
    brassMat,
  );
  guardRail.rotation.x = Math.PI / 2;
  guardRail.position.set(-0.051, 0.030, -0.090);
  root.add(guardRail);

  // Rear left 6-bar glowing green phosphor Nixie shell indicator
  const meterPlate = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.009, 0.024, 0.070)),
    darkSteelMat,
  );
  meterPlate.position.set(-0.033, 0.024, 0.022);
  root.add(meterPlate);

  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0046, 0.0135, 0.0072)),
      barMats[i],
    );
    seg.position.set(-0.0368, 0.024, 0.048 - i * 0.0102);
    root.add(seg);
  }

  const tubeGlowLight = new THREE.PointLight(0xff6814, 0.28, 0.7, 2);
  tubeGlowLight.position.set(-0.064, 0.040, -0.09);
  root.add(tubeGlowLight);

  // 5. Industrial Phosphor-Green Ring Optic (Hollow Extruded Rusted Frame, Beveled Curved Saddle!)
  const sightLineY = 0.0735;
  const optBaseShape = new THREE.Shape();
  optBaseShape.moveTo(-0.019, 0.050);
  optBaseShape.lineTo(0.019, 0.050);
  optBaseShape.quadraticCurveTo(0.0205, 0.056, 0.016, 0.062);
  optBaseShape.lineTo(-0.016, 0.062);
  optBaseShape.quadraticCurveTo(-0.0205, 0.056, -0.019, 0.050);
  optBaseShape.closePath();

  const optBaseGeo = trackGeo(
    new THREE.ExtrudeGeometry(optBaseShape, {
      depth: 0.066,
      bevelEnabled: true,
      bevelSize: 0.0014,
      bevelThickness: 0.0020,
      bevelSegments: 3,
    }),
  );
  optBaseGeo.translate(0, 0, -0.045);
  root.add(new THREE.Mesh(optBaseGeo, heavyRustMat));

  const ringOuter = new THREE.Shape();
  ringOuter.absarc(0, 0, 0.020, 0, Math.PI * 2, false);
  const ringHole = new THREE.Path();
  ringHole.absarc(0, 0, 0.015, 0, Math.PI * 2, true);
  ringOuter.holes.push(ringHole);

  const ringGeo = trackGeo(
    new THREE.ExtrudeGeometry(ringOuter, {
      depth: 0.048,
      bevelEnabled: true,
      bevelSize: 0.0014,
      bevelThickness: 0.0014,
      bevelSegments: 2,
    }),
  );
  ringGeo.translate(0, sightLineY, -0.036);
  const ringBody = new THREE.Mesh(ringGeo, heavyRustMat);
  ringBody.castShadow = true;
  root.add(ringBody);

  const optGlass = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(0.0148, 20)),
    opticGlassMat,
  );
  optGlass.position.set(0, sightLineY, -0.013);
  optGlass.renderOrder = 3;
  root.add(optGlass);

  // Crisp glowing seafoam-green Russian shotgun choke circle + center dot!
  const chokeRing = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(0.0068, 0.0079, 28)),
    opticReticleMat,
  );
  chokeRing.position.set(0, sightLineY, -0.012);
  root.add(chokeRing);

  const centerPip = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(0.0012, 14)),
    opticReticleMat,
  );
  centerPip.position.set(0, sightLineY, -0.012);
  root.add(centerPip);

  // 6. Birchwood Pistol Grip, Trigger, Reload Shell & Heavy Muzzle Flash
  const triggerPivot = addStandardGripAndTrigger(
    root,
    birchWoodMat,
    heavyRustMat,
    darkSteelMat,
    trackGeo,
  );

  const magazineGroup = new THREE.Group();
  root.add(magazineGroup);

  const shellInsertMesh = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0115, 0.0115, 0.064, 16)),
    shellHullMat,
  );
  shellInsertMesh.rotation.x = Math.PI / 2;
  const brassHead = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0119, 0.0119, 0.018, 16)),
    brassMat,
  );
  brassHead.position.y = -0.024;
  shellInsertMesh.add(brassHead);
  shellInsertMesh.position.set(0, -0.026, -0.075);
  shellInsertMesh.visible = false;
  magazineGroup.add(shellInsertMesh);

  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.036, 0.020, -0.052);
  root.add(ejectionPort);

  const flashRig = createMuzzleFlashRig(
    root,
    0,
    0.027,
    -0.555,
    1.28,
    0xffaa58,
    'shotgun',
    disposables,
  );

  const underbarrelLight = createUnderbarrelFlashlight({
    maxAnisotropy,
    rustic: true,
    scale: 1.08,
  });
  underbarrelLight.group.position.set(0, -0.038, -0.445);
  root.add(underbarrelLight.group);
  disposables.push(underbarrelLight);

  let currentHeat = 0;

  return {
    root,
    slideGroup,
    barrelGroup,
    triggerPivot,
    magazineGroup,
    pumpGroup,
    shellInsertMesh,
    muzzleFlashGroup: flashRig.muzzleFlashGroup,
    muzzleLight: flashRig.muzzleLight,
    muzzleTip: flashRig.muzzleTip,
    ejectionPort,
    flashlightLens: underbarrelLight.lensAnchor,
    sightLineY,
    setSlideOffset(backMeters: number) {
      slideGroup.position.z = THREE.MathUtils.clamp(backMeters, 0, 0.072);
    },
    setFlashlightOn(on: boolean) {
      underbarrelLight.setOn(on);
    },
    setPumpOffset(amount01: number) {
      const p = THREE.MathUtils.clamp(amount01, 0, 1);
      pumpGroup.position.z = p * 0.095;
      slideGroup.position.z = Math.max(slideGroup.position.z, p * 0.072);
    },
    setTriggerPull(amount: number) {
      triggerPivot.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 0.44;
    },
    setMuzzleFlash(intensity: number) {
      flashRig.setIntensity(intensity);
    },
    setFireGlow(heat01: number) {
      currentHeat = THREE.MathUtils.clamp(heat01, 0, 1);
      vacuumFireMat.emissiveIntensity = 2.4 + currentHeat * 6.4;
      tubeGlowLight.intensity = 0.24 + currentHeat * 2.1;
    },
    updateLeds(ammo, maxAmmo, isReloading, elapsed) {
      const frac = maxAmmo > 0 ? THREE.MathUtils.clamp(ammo / maxAmmo, 0, 1) : 0;
      const isEmpty = ammo === 0;
      const flicker = 0.9 + 0.1 * Math.sin(elapsed * 24 + 0.8);
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);

      rearLedPanel.update(frac, isEmpty, isReloading, elapsed);

      if (isReloading) {
        const hTube = (elapsed * 1.55) % 1.0;
        vacuumFireMat.emissive.setHSL(hTube, 1.0, 0.52);
        vacuumFireMat.color.setHSL(hTube, 0.92, 0.76);
        vacuumFireMat.emissiveIntensity = 3.0 + pulse * 2.0;
        tubeGlowLight.intensity = 0.05;

        for (let i = 0; i < barMats.length; i++) {
          const m = barMats[i];
          const h = (elapsed * 1.65 - i * 0.16 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.05);
          m.emissive.setHSL(h, 1.0, 0.52);
          m.color.setHSL(h, 0.92, 0.76);
          m.emissiveIntensity = 1.8 + chase * 3.0;
        }
        return;
      }

      const ammoHue = ammoFractionToHue(frac);
      vacuumFireMat.emissive.setHSL(ammoHue, 1.0, 0.50);
      vacuumFireMat.color.setHSL(ammoHue, 0.92, 0.74);
      vacuumFireMat.emissiveIntensity = (2.4 + currentHeat * 5.6) * flicker;
      tubeGlowLight.color.setHSL(ammoHue, 1.0, 0.52);
      tubeGlowLight.intensity = 0.14 + currentHeat * 1.35;

      for (let i = 0; i < barMats.length; i++) {
        const thresh = (i + 0.12) / barMats.length;
        const m = barMats[i];
        if (frac >= thresh) {
          const low = frac <= 0.34;
          m.emissive.setHSL(ammoHue, 1.0, 0.50);
          m.color.setHSL(ammoHue, 0.92, 0.74);
          m.emissiveIntensity = (low ? 2.6 + pulse * 2.2 : 2.9) * flicker;
        } else {
          m.emissive.setHex(0x4a160c);
          m.color.setHex(0x522018);
          m.emissiveIntensity = isEmpty ? 0.75 + pulse * 1.5 : 0.32;
        }
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
