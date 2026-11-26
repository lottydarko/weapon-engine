import * as THREE from 'three';
import { enhanceGunMetalMaterial } from './gunShader';
import { createGunmetalTexture, createPolymerStippleTextures } from './textures';

export interface UnderbarrelLightRig {
  group: THREE.Group;
  lensAnchor: THREE.Object3D;
  setOn: (on: boolean) => void;
  dispose: () => void;
}

export interface PlainFlashlightRig {
  root: THREE.Group;
  lensAnchor: THREE.Object3D;
  switchCap: THREE.Mesh;
  setOn: (on: boolean) => void;
  setSwitchPress: (press01: number) => void;
  dispose: () => void;
}

/**
 * Generates a smooth, ultra-soft circular radial cookie texture for SpotLight.map
 * so the flashlight throws a genuinely round, creamy, wide-scope flood beam with
 * a gentle warm core and feathered falloff (zero harsh polygonal edge!).
 */
export function createSoftFlashlightCookieTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 253, 248, 1.0)');
  grad.addColorStop(0.22, 'rgba(255, 250, 240, 0.92)');
  grad.addColorStop(0.48, 'rgba(248, 242, 232, 0.62)');
  grad.addColorStop(0.74, 'rgba(225, 220, 212, 0.26)');
  grad.addColorStop(0.90, 'rgba(180, 178, 175, 0.06)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Generates a vertical alpha fade texture so the volumetric haze cone fades
 * softly from the lens out into open air with zero hard geometric edge.
 */
function createSoftBeamFadeTexture(): THREE.CanvasTexture {
  const w = 16;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  // Cone UV: v=1 is apex (near lens), v=0 is wide far mouth
  grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Builds a realistic compact under-barrel weapon-mounted tactical flashlight
 * (rail clamp, softly rounded anodized aluminum body, wide parabolic reflector,
 * emissive LED emitter lens & soft-feathered wide volumetric haze cone).
 */
export function createUnderbarrelFlashlight(options: {
  maxAnisotropy: number;
  rustic?: boolean;
  orangeAccent?: boolean;
  scale?: number;
}): UnderbarrelLightRig {
  const { maxAnisotropy, rustic = false, orangeAccent = false, scale = 1.0 } = options;
  const group = new THREE.Group();
  group.name = 'UnderbarrelWeaponFlashlight';

  const gunmetal = createGunmetalTexture(maxAnisotropy);
  const beamFadeTex = createSoftBeamFadeTexture();
  const disposables: Array<{ dispose: () => void }> = [gunmetal, beamFadeTex];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: rustic ? 0x3b2c25 : 0x181c22,
    map: gunmetal.map,
    normalMap: gunmetal.normalMap,
    normalScale: new THREE.Vector2(rustic ? 1.15 : 0.7, rustic ? 1.15 : 0.7),
    roughnessMap: gunmetal.roughnessMap,
    metalness: rustic ? 0.62 : 0.84,
    roughness: rustic ? 0.56 : 0.34,
    clearcoat: rustic ? 0.08 : 0.22,
    envMapIntensity: 1.25,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: orangeAccent ? 0xff5a10 : rustic ? 0x8d6c3d : 0x2a303a,
    metalness: 0.75,
    roughness: 0.32,
  });

  const reflectorMat = new THREE.MeshStandardMaterial({
    color: 0xe6ecf5,
    metalness: 0.98,
    roughness: 0.08,
  });

  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xdce6f2,
    emissive: 0xfff3dc,
    emissiveIntensity: 0,
    roughness: 0.08,
    metalness: 0.1,
  });

  const beamConeMat = new THREE.MeshBasicMaterial({
    color: 0xfff5e4,
    alphaMap: beamFadeTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  disposables.push(bodyMat, accentMat, reflectorMat, lensMat, beamConeMat);

  // Rail clamp mount bracket
  const clamp = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.017, 0.011, 0.030)),
    bodyMat,
  );
  clamp.position.set(0, 0.0085, 0.002);
  group.add(clamp);

  // Cylindrical tactical lamp housing
  const body = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0092, 0.0088, 0.062, 22)),
    bodyMat,
  );
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  // Accent heat-sink bezel ring
  const ring = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0102, 0.0102, 0.006, 22)),
    accentMat,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -0.022;
  group.add(ring);

  // Rounded flared bezel head
  const bezel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0118, 0.0096, 0.016, 24)),
    bodyMat,
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = -0.034;
  group.add(bezel);

  // Parabolic mirror reflector cup + glass emitter lens
  const reflector = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0102, 0.0045, 0.009, 22, 1, true)),
    reflectorMat,
  );
  reflector.rotation.x = Math.PI / 2;
  reflector.position.z = -0.038;
  group.add(reflector);

  const lens = new THREE.Mesh(
    trackGeo(new THREE.CircleGeometry(0.0102, 22)),
    lensMat,
  );
  lens.rotation.y = Math.PI;
  lens.position.z = -0.0422;
  group.add(lens);

  // Rear paddle toggle switch tabs
  const tailCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0082, 0.0076, 0.012, 18)),
    accentMat,
  );
  tailCap.rotation.x = Math.PI / 2;
  tailCap.position.z = 0.035;
  group.add(tailCap);

  // Soft wide volumetric light haze cone extending forward from lens
  const coneGeo = trackGeo(new THREE.ConeGeometry(0.18, 0.62, 24, 1, true));
  coneGeo.translate(0, -0.31, 0);
  coneGeo.rotateX(Math.PI / 2);
  const beamCone = new THREE.Mesh(coneGeo, beamConeMat);
  beamCone.position.z = -0.043;
  beamCone.visible = false;
  group.add(beamCone);

  const lensAnchor = new THREE.Object3D();
  lensAnchor.position.set(0, 0, -0.044);
  group.add(lensAnchor);

  group.scale.setScalar(scale);

  return {
    group,
    lensAnchor,
    setOn(on: boolean) {
      lensMat.emissiveIntensity = on ? 6.0 : 0;
      beamCone.visible = on;
      beamConeMat.opacity = on ? 0.075 : 0;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Builds a softly rounded, classic wide-head anodized-aluminum handheld flashlight
 * (smooth lathe-profiled body, rubberized knurled grip barrel, softly contoured flare head,
 * wide circular reflector + convex diffuser lens, rubber thumb switch & soft wide haze cone).
 * Coordinate convention: barrel runs along Z (-Z = wide round lamp head, +Z = rounded tailcap),
 * centered cleanly inside the right gloved fist!
 */
export function buildPlainFlashlight(maxAnisotropy: number): PlainFlashlightRig {
  const root = new THREE.Group();
  root.name = 'PlainHandheldFlashlight';

  const gunmetal = createGunmetalTexture(maxAnisotropy);
  const stipple = createPolymerStippleTextures(maxAnisotropy);
  const beamFadeTex = createSoftBeamFadeTexture();
  const disposables: Array<{ dispose: () => void }> = [gunmetal, stipple, beamFadeTex];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const anodizedMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x1b2028,
      map: gunmetal.map,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.84,
      roughness: 0.30,
      anisotropy: 0.52,
      clearcoat: 0.34,
      clearcoatRoughness: 0.24,
      envMapIntensity: 1.48,
    }),
    { edgeWear: 0.48, cavityDepth: 0.42, sheenColor: 0x98b4d8, sheenStrength: 0.28 },
  );

  const knurledGripMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f25,
    map: stipple.map,
    normalMap: stipple.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughnessMap: stipple.roughnessMap,
    metalness: 0.42,
    roughness: 0.64,
  });

  const steelBezelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xa6b0be,
      map: gunmetal.barrelMap,
      normalMap: gunmetal.barrelNormalMap,
      metalness: 0.94,
      roughness: 0.20,
      anisotropy: 0.68,
      envMapIntensity: 1.56,
    }),
    { edgeWear: 0.44, cavityDepth: 0.34, sheenColor: 0xdce6f5, sheenStrength: 0.28 },
  );

  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x13161a,
    roughness: 0.90,
    metalness: 0.04,
  });

  const reflectorMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8ff,
    metalness: 0.98,
    roughness: 0.06,
    side: THREE.DoubleSide,
  });

  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xecf3fa,
    emissive: 0xfff5e4,
    emissiveIntensity: 6.4,
    roughness: 0.08,
    metalness: 0.04,
    clearcoat: 0.88,
    clearcoatRoughness: 0.06,
  });

  const beamConeMat = new THREE.MeshBasicMaterial({
    color: 0xfff6e8,
    alphaMap: beamFadeTex,
    transparent: true,
    opacity: 0.095,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  disposables.push(
    anodizedMat,
    knurledGripMat,
    steelBezelMat,
    rubberMat,
    reflectorMat,
    lensMat,
    beamConeMat,
  );

  // Softly contoured rubberized grip barrel (radius 0.0175m — fills the closed right gloved fist snugly!)
  const gripBarrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0175, 0.0175, 0.118, 32)),
    knurledGripMat,
  );
  gripBarrel.rotation.x = Math.PI / 2;
  gripBarrel.position.set(0, 0, -0.014);
  gripBarrel.castShadow = true;
  gripBarrel.receiveShadow = true;
  root.add(gripBarrel);

  // Softly rounded machined aluminum rear tailcap dome (strictly INCREASING Y -> outward LatheGeometry normals!)
  const tailProfile = [
    new THREE.Vector2(0.0175, 0.042),
    new THREE.Vector2(0.0188, 0.046),
    new THREE.Vector2(0.0190, 0.056),
    new THREE.Vector2(0.0174, 0.063),
    new THREE.Vector2(0.0128, 0.067),
    new THREE.Vector2(0.0001, 0.068),
  ];
  const tailGeo = trackGeo(new THREE.LatheGeometry(tailProfile, 32));
  tailGeo.rotateX(Math.PI / 2);
  const tail = new THREE.Mesh(tailGeo, anodizedMat);
  tail.castShadow = true;
  tail.receiveShadow = true;
  root.add(tail);

  // Smoothly flared, machined heavy tactical lamp head (strictly INCREASING Y -> 100% outward normals!)
  const headProfile = [
    new THREE.Vector2(0.0258, -0.168),
    new THREE.Vector2(0.0286, -0.164),
    new THREE.Vector2(0.0298, -0.150),
    new THREE.Vector2(0.0292, -0.132),
    new THREE.Vector2(0.0256, -0.114),
    new THREE.Vector2(0.0218, -0.098),
    new THREE.Vector2(0.0195, -0.084),
    new THREE.Vector2(0.0175, -0.072),
  ];
  const headGeo = trackGeo(new THREE.LatheGeometry(headProfile, 36));
  headGeo.rotateX(Math.PI / 2);
  const head = new THREE.Mesh(headGeo, anodizedMat);
  head.castShadow = true;
  head.receiveShadow = true;
  root.add(head);

  // Machined tactical cooling-fin collars along the flared head neck
  const finSpecs: Array<[number, number, number]> = [
    [0.0226, 0.0018, -0.096],
    [0.0246, 0.0019, -0.106],
    [0.0268, 0.0020, -0.116],
  ];
  for (const [r, tube, z] of finSpecs) {
    const fin = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(r, tube, 10, 32)),
      anodizedMat,
    );
    fin.position.set(0, 0, z);
    fin.castShadow = true;
    root.add(fin);
  }

  // Smooth rounded brushed-steel front bezel lip
  const bezelRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0268, 0.0028, 14, 36)),
    steelBezelMat,
  );
  bezelRing.position.set(0, 0, -0.167);
  root.add(bezelRing);

  // Gentle rubberized grip accent rings near neck & tailcap for tactile contrast
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.0192 + i * 0.0012, 0.0016, 10, 32)),
      rubberMat,
    );
    ring.position.set(0, 0, -0.078 - i * 0.0078);
    root.add(ring);
  }
  const tailAccentRing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0188, 0.0014, 10, 32)),
    steelBezelMat,
  );
  tailAccentRing.position.set(0, 0, 0.045);
  root.add(tailAccentRing);

  // Deep wide parabolic reflector cup (DoubleSide) + gently curved convex diffuser glass lens
  const reflector = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0252, 0.0082, 0.024, 32, 1, true)),
    reflectorMat,
  );
  reflector.rotation.x = Math.PI / 2;
  reflector.position.set(0, 0, -0.155);
  root.add(reflector);

  const lensGeo = trackGeo(
    new THREE.SphereGeometry(0.0252, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.34),
  );
  lensGeo.rotateX(-Math.PI / 2);
  lensGeo.scale(1, 1, 0.42);
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.position.set(0, 0, -0.156);
  root.add(lens);

  // Tactile side rubber click-switch on upper-right neck collar right under the forward-pointing right thumb!
  const switchBezel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0072, 0.0080, 0.0034, 18)),
    steelBezelMat,
  );
  switchBezel.position.set(0.0145, 0.0105, -0.056);
  switchBezel.rotation.z = -0.94;
  root.add(switchBezel);

  const switchCapGeo = trackGeo(
    new THREE.SphereGeometry(0.0058, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
  );
  const switchCap = new THREE.Mesh(switchCapGeo, rubberMat);
  switchCap.position.set(0.0160, 0.0116, -0.056);
  switchCap.rotation.z = -0.94;
  root.add(switchCap);

  // Wide, ultra-soft feathered volumetric light haze cone extending forward from the wide round head
  const coneGeo = trackGeo(new THREE.ConeGeometry(0.32, 0.92, 32, 1, true));
  coneGeo.translate(0, -0.46, 0);
  coneGeo.rotateX(Math.PI / 2);
  const beamCone = new THREE.Mesh(coneGeo, beamConeMat);
  beamCone.position.set(0, 0, -0.169);
  root.add(beamCone);

  const lensAnchor = new THREE.Object3D();
  lensAnchor.position.set(0, 0, -0.171);
  root.add(lensAnchor);

  return {
    root,
    lensAnchor,
    switchCap,
    setOn(on: boolean) {
      lensMat.emissiveIntensity = on ? 6.4 : 0;
      beamCone.visible = on;
      beamConeMat.opacity = on ? 0.095 : 0;
    },
    setSwitchPress(press01: number) {
      const p = THREE.MathUtils.clamp(press01, 0, 1);
      switchCap.position.set(0.0160 - p * 0.0018, 0.0116 - p * 0.0013, -0.056);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
