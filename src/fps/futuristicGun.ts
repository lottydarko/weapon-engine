import * as THREE from 'three';
import { createUnderbarrelFlashlight } from './flashlight';
import { enhanceGunMetalMaterial } from './gunShader';
import { createPhotorealisticMuzzleFlash } from './muzzleFlash';
import type { PistolRig } from './pistol';
import { createGunmetalTexture, createPolymerStippleTextures } from './textures';

export interface FuturisticShotgunRig extends PistolRig {
  pumpGroup: THREE.Group;
  shellInsertMesh: THREE.Mesh;
  /** Drives the sliding ribbed shotgun pump forend (0 = forward battery, 1 = full rearward pump) */
  setPumpOffset: (amount01: number) => void;
  /** Drives the dramatic thermal plasma/heat glow along the barrel, vents & receiver when firing */
  setFireGlow: (heat01: number) => void;
  updateLeds: (
    ammo: number,
    maxAmmo: number,
    isReloading: boolean,
    elapsed: number,
  ) => void;
}

/**
 * Builds the VX-9 Futuristic Matte-Black & Safety-Orange Tactical Combat Shotgun:
 * - Heavy sculpted multi-faceted black & anodized orange shotgun receiver & over/under barrel shroud
 * - Prominent glowing side-mounted Green & Red LED indicator arrays + rear diagnostic light-pipes
 * - Intense firing thermal glow channels along the receiver flanks & ventilated barrel heatshield
 *   that surge bright orange/amber as it blasts and cool down smoothly
 * - Sliding ribbed tactical pump forend + twin steel action bars + reciprocating heavy top bolt
 * - Single-piece hollow-extruded beveled Holographic Red Dot Sight aligned dead-center for ADS
 */
export function buildFuturisticGun(
  maxAnisotropy: number,
  _flashTexture?: THREE.Texture,
): FuturisticShotgunRig {
  const root = new THREE.Group();
  root.name = 'FuturisticVX9Shotgun';

  const stipple = createPolymerStippleTextures(maxAnisotropy);
  const gunmetal = createGunmetalTexture(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [stipple, gunmetal];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // =========================================================================
  // MATERIALS (Curvature & Micro-Ridge PBR Shading)
  // =========================================================================
  const cerakoteBlackMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x191d24,
      map: gunmetal.map,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(0.92, 0.92),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.74,
      roughness: 0.34,
      clearcoat: 0.32,
      clearcoatRoughness: 0.32,
      anisotropy: 0.42,
      envMapIntensity: 1.44,
    }),
    { edgeWear: 0.50, cavityDepth: 0.44, sheenColor: 0x90aecf, sheenStrength: 0.28 },
  );

  const darkPolymerMat = new THREE.MeshPhysicalMaterial({
    color: 0x111419,
    normalMap: gunmetal.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: gunmetal.roughnessMap,
    metalness: 0.14,
    roughness: 0.68,
    sheen: 0.18,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(0x3a4250),
  });

  const recessedSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x0a0c10,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      metalness: 0.86,
      roughness: 0.40,
      envMapIntensity: 1.15,
    }),
    { edgeWear: 0.38, cavityDepth: 0.52, sheenColor: 0x7c90aa, sheenStrength: 0.20 },
  );

  const orangeAnodizedMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xff5a10,
      emissive: 0x260800,
      emissiveIntensity: 0.4,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.68,
      roughness: 0.26,
      clearcoat: 0.62,
      clearcoatRoughness: 0.20,
      anisotropy: 0.44,
      envMapIntensity: 1.54,
    }),
    { edgeWear: 0.32, cavityDepth: 0.34, sheenColor: 0xffb380, sheenStrength: 0.26 },
  );

  const gripStippleMat = new THREE.MeshStandardMaterial({
    color: 0xe6e8ec,
    map: stipple.map,
    normalMap: stipple.normalMap,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: stipple.roughnessMap,
    metalness: 0.05,
    roughness: 0.84,
  });

  const titaniumMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xdce2ea,
      map: gunmetal.barrelMap,
      normalMap: gunmetal.barrelNormalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      metalness: 0.96,
      roughness: 0.19,
      anisotropy: 0.84,
      clearcoat: 0.28,
      envMapIntensity: 1.58,
    }),
    { edgeWear: 0.46, cavityDepth: 0.36, sheenColor: 0xd8e4f5, sheenStrength: 0.28 },
  );

  // Dynamic thermal glow channels along receiver & barrel heatshield (flares bright on fire!)
  const fireGlowMat = new THREE.MeshPhysicalMaterial({
    color: 0xffa64d,
    emissive: 0xff4b00,
    emissiveIntensity: 0.75,
    roughness: 0.16,
    metalness: 0.25,
    clearcoat: 0.9,
  });

  // 4 independent rear LED materials (clockwise chasing arcade swirl on reload, matching all other guns!)
  const rearLedMats: THREE.MeshPhysicalMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x9bffbc,
      emissive: 0x16ff62,
      emissiveIntensity: 3.4,
      roughness: 0.08,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
    });
    rearLedMats.push(m);
    disposables.push(m);
  }

  // 8-segment unified side LED array (6 shell-count bars + 2 trailing status strips in one clean protocol!)
  const barLedMats: THREE.MeshPhysicalMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x9bffbc,
      emissive: 0x16ff62,
      emissiveIntensity: 3.2,
      roughness: 0.1,
      clearcoat: 1.0,
    });
    barLedMats.push(m);
    disposables.push(m);
  }

  // Coated reflex optic glass lens
  const opticGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x6ce8ff,
    metalness: 0.12,
    roughness: 0.04,
    transparent: true,
    opacity: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const redDotMat = new THREE.MeshBasicMaterial({
    color: 0xff1e1e,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const redRingMat = new THREE.MeshBasicMaterial({
    color: 0xff321c,
    transparent: true,
    opacity: 0.52,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const shellHullMat = new THREE.MeshPhysicalMaterial({
    color: 0xe63b12,
    roughness: 0.36,
    metalness: 0.12,
    clearcoat: 0.3,
  });

  const brassMat = new THREE.MeshPhysicalMaterial({
    color: 0xd9ad4e,
    metalness: 0.94,
    roughness: 0.22,
  });

  disposables.push(
    cerakoteBlackMat,
    darkPolymerMat,
    recessedSteelMat,
    orangeAnodizedMat,
    gripStippleMat,
    titaniumMat,
    fireGlowMat,
    opticGlassMat,
    redDotMat,
    redRingMat,
    shellHullMat,
    brassMat,
  );

  const boltHeadGeo = trackGeo(new THREE.CylinderGeometry(0.0019, 0.0019, 0.0016, 6));
  const boltSocketGeo = trackGeo(new THREE.CylinderGeometry(0.0009, 0.0009, 0.0019, 6));
  const addHexBolt = (
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    axis: 'x' | 'y' | 'z',
  ) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (axis === 'x') g.rotation.z = Math.PI / 2;
    else if (axis === 'z') g.rotation.x = Math.PI / 2;
    g.add(new THREE.Mesh(boltHeadGeo, titaniumMat));
    g.add(new THREE.Mesh(boltSocketGeo, recessedSteelMat));
    parent.add(g);
  };

  // =========================================================================
  // 1. HEAVY SCULPTED FUTURISTIC SHOTGUN RECEIVER (z ∈ [-0.155, +0.068])
  // =========================================================================
  const frameGroup = new THREE.Group();
  root.add(frameGroup);

  const recW = 0.062;
  const recTop = 0.045;
  const recBot = -0.016;

  // Smoothly crowned & rounded-shoulder milled receiver profile (zero sharp boxy corners!)
  const recShape = new THREE.Shape();
  recShape.moveTo(-recW / 2 + 0.010, recBot);
  recShape.lineTo(recW / 2 - 0.010, recBot);
  recShape.quadraticCurveTo(recW / 2, recBot + 0.001, recW / 2, recBot + 0.012);
  recShape.lineTo(recW / 2, recTop - 0.015);
  recShape.quadraticCurveTo(recW / 2, recTop - 0.002, recW / 2 - 0.014, recTop - 0.001);
  recShape.quadraticCurveTo(0, recTop + 0.0032, -recW / 2 + 0.014, recTop - 0.001);
  recShape.quadraticCurveTo(-recW / 2, recTop - 0.002, -recW / 2, recTop - 0.015);
  recShape.lineTo(-recW / 2, recBot + 0.012);
  recShape.quadraticCurveTo(-recW / 2, recBot + 0.001, -recW / 2 + 0.010, recBot);
  recShape.closePath();

  const receiverGeo = trackGeo(
    new THREE.ExtrudeGeometry(recShape, {
      depth: 0.220,
      bevelEnabled: true,
      bevelThickness: 0.0046,
      bevelSize: 0.0026,
      bevelSegments: 5,
      curveSegments: 18,
    }),
  );
  receiverGeo.translate(0, 0, -0.156);
  const receiverMesh = new THREE.Mesh(receiverGeo, cerakoteBlackMat);
  receiverMesh.castShadow = true;
  receiverMesh.receiveShadow = true;
  frameGroup.add(receiverMesh);

  // Beveled contoured cheek armor bolsters along receiver flanks
  const cheekShape = new THREE.Shape();
  cheekShape.moveTo(0, -0.012);
  cheekShape.quadraticCurveTo(0.006, -0.008, 0.0065, 0);
  cheekShape.quadraticCurveTo(0.006, 0.009, 0, 0.013);
  cheekShape.lineTo(0, -0.012);
  cheekShape.closePath();
  for (const side of [-1, 1]) {
    const cheekGeo = trackGeo(
      new THREE.ExtrudeGeometry(cheekShape, {
        depth: 0.188,
        bevelEnabled: true,
        bevelSize: 0.0014,
        bevelThickness: 0.0022,
        bevelSegments: 3,
      }),
    );
    if (side === -1) cheekGeo.scale(-1, 1, 1);
    cheekGeo.translate(side * (recW / 2 - 0.0005), 0.012, -0.150);
    frameGroup.add(new THREE.Mesh(cheekGeo, darkPolymerMat));
  }

  // Sculpted curved rear receiver tang transitioning organically into a rounded shoulder stock comb!
  const stockSideShape = new THREE.Shape();
  stockSideShape.moveTo(0.056, recTop - 0.003);
  stockSideShape.quadraticCurveTo(0.082, recTop - 0.006, 0.108, 0.022);
  stockSideShape.quadraticCurveTo(0.140, 0.008, 0.185, 0.004);
  stockSideShape.lineTo(0.185, -0.032);
  stockSideShape.quadraticCurveTo(0.128, -0.026, 0.088, -0.018);
  stockSideShape.quadraticCurveTo(0.068, -0.015, 0.056, recBot + 0.004);
  stockSideShape.closePath();

  const stockNeckGeo = trackGeo(
    new THREE.ExtrudeGeometry(stockSideShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelSize: 0.0068,
      bevelThickness: 0.0072,
      bevelSegments: 5,
      curveSegments: 16,
    }),
  );
  stockNeckGeo.rotateY(-Math.PI / 2);
  stockNeckGeo.translate(0.018, 0, 0);
  const stockNeck = new THREE.Mesh(stockNeckGeo, darkPolymerMat);
  stockNeck.castShadow = true;
  stockNeck.receiveShadow = true;
  frameGroup.add(stockNeck);

  // Contoured arched rear diagnostic faceplate nested smoothly onto the rounded receiver back
  const plateShape = new THREE.Shape();
  plateShape.moveTo(-0.022, -0.008);
  plateShape.lineTo(0.022, -0.008);
  plateShape.quadraticCurveTo(0.026, -0.006, 0.026, 0.004);
  plateShape.lineTo(0.026, 0.026);
  plateShape.quadraticCurveTo(0.025, 0.039, 0.012, 0.041);
  plateShape.quadraticCurveTo(0, 0.0435, -0.012, 0.041);
  plateShape.quadraticCurveTo(-0.025, 0.039, -0.026, 0.026);
  plateShape.lineTo(-0.026, 0.004);
  plateShape.quadraticCurveTo(-0.026, -0.006, -0.022, -0.008);
  plateShape.closePath();

  const rearEndplateGeo = trackGeo(
    new THREE.ExtrudeGeometry(plateShape, {
      depth: 0.0048,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.0024,
      bevelSegments: 4,
      curveSegments: 16,
    }),
  );
  rearEndplateGeo.translate(0, 0, 0.0665);
  frameGroup.add(new THREE.Mesh(rearEndplateGeo, recessedSteelMat));

  // Machined concentric domed buffer cap & anodized orange core on rear receiver face
  const bufferBezel = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0122, 0.0022, 12, 24)),
    cerakoteBlackMat,
  );
  bufferBezel.position.set(0, 0.013, 0.0724);
  frameGroup.add(bufferBezel);

  const bufferCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0108, 0.0122, 0.005, 24)),
    titaniumMat,
  );
  bufferCap.rotation.x = Math.PI / 2;
  bufferCap.position.set(0, 0.013, 0.0726);
  frameGroup.add(bufferCap);

  const bufferCore = new THREE.Mesh(
    trackGeo(new THREE.SphereGeometry(0.0064, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    orangeAnodizedMat,
  );
  bufferCore.rotation.x = Math.PI / 2;
  bufferCore.position.set(0, 0.013, 0.0736);
  frameGroup.add(bufferCore);

  // Sleek pill-contoured Green & Red LED status light-pipes nestled into the arched rear face
  const rearLedBezelGeo = trackGeo(new THREE.CapsuleGeometry(0.0026, 0.0086, 4, 12));
  rearLedBezelGeo.rotateZ(Math.PI / 2);
  const rearLedPipeGeo = trackGeo(new THREE.CapsuleGeometry(0.0016, 0.0080, 4, 12));
  rearLedPipeGeo.rotateZ(Math.PI / 2);

  const rearGreenBezel = new THREE.Mesh(rearLedBezelGeo, darkPolymerMat);
  rearGreenBezel.position.set(-0.0126, 0.0325, 0.0724);
  rearGreenBezel.rotation.z = 0.14;
  frameGroup.add(rearGreenBezel);
  const rearGreenLed = new THREE.Mesh(rearLedPipeGeo, rearLedMats[0]);
  rearGreenLed.position.set(-0.0126, 0.0325, 0.0738);
  rearGreenLed.rotation.z = 0.14;
  frameGroup.add(rearGreenLed);

  const rearRedBezel = new THREE.Mesh(rearLedBezelGeo, darkPolymerMat);
  rearRedBezel.position.set(0.0126, 0.0325, 0.0724);
  rearRedBezel.rotation.z = -0.14;
  frameGroup.add(rearRedBezel);
  const rearRedLed = new THREE.Mesh(rearLedPipeGeo, rearLedMats[2]);
  rearRedLed.position.set(0.0126, 0.0325, 0.0738);
  rearRedLed.rotation.z = -0.14;
  frameGroup.add(rearRedLed);

  // Secondary vertical pill-bezeled diagnostic LEDs flanking the buffer hub
  const sidePipBezelGeo = trackGeo(new THREE.CapsuleGeometry(0.0022, 0.0076, 4, 10));
  const sidePipLedGeo = trackGeo(new THREE.CapsuleGeometry(0.0013, 0.0066, 4, 10));
  const lowGreenBezel = new THREE.Mesh(sidePipBezelGeo, darkPolymerMat);
  lowGreenBezel.position.set(-0.0205, 0.013, 0.0724);
  frameGroup.add(lowGreenBezel);
  const lowGreenLed = new THREE.Mesh(sidePipLedGeo, rearLedMats[1]);
  lowGreenLed.position.set(-0.0205, 0.013, 0.0738);
  frameGroup.add(lowGreenLed);

  const lowRedBezel = new THREE.Mesh(sidePipBezelGeo, darkPolymerMat);
  lowRedBezel.position.set(0.0205, 0.013, 0.0724);
  frameGroup.add(lowRedBezel);
  const lowRedLed = new THREE.Mesh(sidePipLedGeo, rearLedMats[3]);
  lowRedLed.position.set(0.0205, 0.013, 0.0738);
  frameGroup.add(lowRedLed);

  addHexBolt(frameGroup, -0.0195, 0.001, 0.0732, 'z');
  addHexBolt(frameGroup, 0.0195, 0.001, 0.0732, 'z');

  // Heavy top Picatinny rail spine along receiver
  const topRailBase = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.028, 0.0048, 0.218)),
    recessedSteelMat,
  );
  topRailBase.position.set(0, recTop + 0.0028, -0.046);
  frameGroup.add(topRailBase);

  for (let i = 0; i < 14; i++) {
    const slot = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0232, 0.0024, 0.0068)),
      cerakoteBlackMat,
    );
    slot.position.set(0, recTop + 0.0048, 0.048 - i * 0.0145);
    frameGroup.add(slot);
  }

  // =========================================================================
  // 1B. PROMINENT SIDE LED LIGHTS + FIRING THERMAL GLOW CHANNELS (BOTH SIDES!)
  // =========================================================================
  for (const side of [-1, 1]) {
    // Bold anodized safety-orange chamfered armor side plates
    const sideArmor = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0046, 0.0165, 0.174)),
      orangeAnodizedMat,
    );
    sideArmor.position.set(side * (recW / 2 + 0.0042), 0.027, -0.056);
    frameGroup.add(sideArmor);

    // Long recessed GLOWING THERMAL PLASMA CHANNEL that flares up intensely when firing!
    const channelBezel = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0034, 0.0092, 0.148)),
      recessedSteelMat,
    );
    channelBezel.position.set(side * (recW / 2 + 0.0044), 0.011, -0.068);
    frameGroup.add(channelBezel);

    const glowStrip = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0026, 0.0052, 0.138)),
      fireGlowMat,
    );
    glowStrip.position.set(side * (recW / 2 + 0.0054), 0.011, -0.068);
    frameGroup.add(glowStrip);

    // CNC fasteners along receiver flanks
    addHexBolt(frameGroup, side * (recW / 2 + 0.0052), -0.006, 0.024, 'x');
    addHexBolt(frameGroup, side * (recW / 2 + 0.0052), -0.006, -0.054, 'x');
    addHexBolt(frameGroup, side * (recW / 2 + 0.0052), -0.006, -0.128, 'x');
  }

  // Dedicated LEFT-SIDE LED STATUS PANEL (clearly visible right in player's 1st-person view!)
  const ledPanelBezel = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0046, 0.0185, 0.092)),
    recessedSteelMat,
  );
  ledPanelBezel.position.set(-(recW / 2 + 0.0048), -0.001, -0.018);
  frameGroup.add(ledPanelBezel);

  // 6 individual side shell-count LEDs (bright green -> red as shells fire!)
  for (let i = 0; i < 6; i++) {
    const bar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0032, 0.0102, 0.0068)),
      barLedMats[i],
    );
    bar.position.set(-(recW / 2 + 0.0062), -0.001, 0.016 - i * 0.0108);
    frameGroup.add(bar);
  }

  // Twin trailing side status strips synced continuously with the 6-bar shell array!
  const sideGreenStrip = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0032, 0.0044, 0.024)),
    barLedMats[6],
  );
  sideGreenStrip.position.set(-(recW / 2 + 0.006), 0.0045, 0.044);
  frameGroup.add(sideGreenStrip);

  const sideRedStrip = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0032, 0.0044, 0.024)),
    barLedMats[7],
  );
  sideRedStrip.position.set(-(recW / 2 + 0.006), -0.004, 0.044);
  frameGroup.add(sideRedStrip);

  // Oversized dark ejection-port cavity on RIGHT flank of receiver
  const portCavity = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.008, 0.017, 0.084)),
    recessedSteelMat,
  );
  portCavity.position.set(recW / 2 - 0.002, 0.014, -0.042);
  frameGroup.add(portCavity);

  // =========================================================================
  // 2. RECIPROCATING HEAVY TITANIUM BOLT CARRIER & SIDE CHARGING HANDLE
  // =========================================================================
  const slideGroup = new THREE.Group();
  root.add(slideGroup);

  const boltCarrier = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.009, 0.0155, 0.078)),
    titaniumMat,
  );
  boltCarrier.position.set(recW / 2 - 0.001, 0.014, -0.042);
  slideGroup.add(boltCarrier);

  // Orange fluted tactical charging handle protruding cleanly on right side
  const boltHandle = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0042, 0.0052, 0.018, 12)),
    orangeAnodizedMat,
  );
  boltHandle.rotation.z = Math.PI / 2;
  boltHandle.position.set(recW / 2 + 0.0095, 0.014, -0.068);
  slideGroup.add(boltHandle);

  // =========================================================================
  // 3. HEAVY OVER/UNDER BARREL, GLOWING VENTED HEATSHIELD & SLIDING PUMP FOREND
  // =========================================================================
  const barrelGroup = new THREE.Group();
  root.add(barrelGroup);

  // Heavy 10/12-gauge upper barrel (thick, muscular heavy combat silhouette!)
  const upperBarrel = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0156, 0.0164, 0.365, 24)),
    titaniumMat,
  );
  upperBarrel.rotation.x = Math.PI / 2;
  upperBarrel.position.set(0, 0.021, -0.330);
  upperBarrel.castShadow = true;
  barrelGroup.add(upperBarrel);

  // Dark heavy-gauge bore hole
  const boreHole = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0124, 0.0124, 0.016, 20)),
    recessedSteelMat,
  );
  boreHole.rotation.x = Math.PI / 2;
  boreHole.position.set(0, 0.021, -0.508);
  barrelGroup.add(boreHole);

  // Thick lower tubular 8-shell magazine tube beneath barrel
  const magTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0148, 0.0148, 0.338, 22)),
    cerakoteBlackMat,
  );
  magTube.rotation.x = Math.PI / 2;
  magTube.position.set(0, -0.0125, -0.315);
  magTube.castShadow = true;
  barrelGroup.add(magTube);

  // Orange knurled magazine tube endcap
  const tubeCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0162, 0.0162, 0.020, 18)),
    orangeAnodizedMat,
  );
  tubeCap.rotation.x = Math.PI / 2;
  tubeCap.position.set(0, -0.0125, -0.486);
  barrelGroup.add(tubeCap);

  // Sculpted crowned/beveled futuristic upper barrel heatshield shroud (zero boxy rectangle!)
  const shroudShape = new THREE.Shape();
  shroudShape.moveTo(-0.023, 0.008);
  shroudShape.lineTo(0.023, 0.008);
  shroudShape.quadraticCurveTo(0.027, 0.010, 0.027, 0.020);
  shroudShape.lineTo(0.026, 0.030);
  shroudShape.quadraticCurveTo(0.025, 0.039, 0.014, 0.040);
  shroudShape.quadraticCurveTo(0, 0.0422, -0.014, 0.040);
  shroudShape.quadraticCurveTo(-0.025, 0.039, -0.026, 0.030);
  shroudShape.lineTo(-0.027, 0.020);
  shroudShape.quadraticCurveTo(-0.027, 0.010, -0.023, 0.008);
  shroudShape.closePath();

  const shroudGeo = trackGeo(
    new THREE.ExtrudeGeometry(shroudShape, {
      depth: 0.320,
      bevelEnabled: true,
      bevelSize: 0.0014,
      bevelThickness: 0.0022,
      bevelSegments: 3,
      curveSegments: 14,
    }),
  );
  shroudGeo.translate(0, 0, -0.472);
  const barrelShroud = new THREE.Mesh(shroudGeo, cerakoteBlackMat);
  barrelShroud.castShadow = true;
  barrelGroup.add(barrelShroud);

  // Top & side glowing firing-heat vent bars along the entire thick barrel shroud!
  for (let i = 0; i < 6; i++) {
    const vz = -0.190 - i * 0.044;
    const topVent = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.024, 0.0034, 0.025)),
      fireGlowMat,
    );
    topVent.position.set(0, 0.0405, vz);
    barrelGroup.add(topVent);

    for (const side of [-1, 1]) {
      const sideVent = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.0032, 0.0092, 0.027)),
        fireGlowMat,
      );
      sideVent.position.set(side * 0.0275, 0.024, vz);
      barrelGroup.add(sideVent);
    }
  }

  // Aggressive oversized futuristic breaching choke / muzzle brake with orange collar
  const brakeBox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.048, 0.044, 0.052)),
    cerakoteBlackMat,
  );
  brakeBox.position.set(0, 0.021, -0.494);
  barrelGroup.add(brakeBox);

  const brakeCollar = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.052, 0.011, 0.016)),
    orangeAnodizedMat,
  );
  brakeCollar.position.set(0, 0.021, -0.476);
  barrelGroup.add(brakeCollar);

  // Heavy barrel-to-magtube armored clamp block
  const clampBlock = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.046, 0.048, 0.028)),
    darkPolymerMat,
  );
  clampBlock.position.set(0, 0.004, -0.452);
  barrelGroup.add(clampBlock);

  // Dynamic firing thermal point light hovering along the glowing vents & barrel!
  const barrelGlowLight = new THREE.PointLight(0xff5a10, 0.16, 0.65, 2);
  barrelGlowLight.position.set(-0.055, 0.042, -0.24);
  root.add(barrelGlowLight);

  const ledGlowLight = new THREE.PointLight(0x24ff66, 0.16, 0.28, 2);
  ledGlowLight.position.set(-0.052, 0.008, -0.01);
  root.add(ledGlowLight);

  // =========================================================================
  // 3B. THICK MEATY SLIDING RIBBED TACTICAL PUMP FOREND (Driven by left hand!)
  // =========================================================================
  const pumpGroup = new THREE.Group();
  pumpGroup.name = 'ShotgunPumpForend';
  root.add(pumpGroup);

  const pumpCore = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0305, 0.0318, 0.166, 20)),
    darkPolymerMat,
  );
  pumpCore.rotation.x = Math.PI / 2;
  pumpCore.position.set(0, -0.015, -0.295);
  pumpCore.castShadow = true;
  pumpCore.receiveShadow = true;
  pumpGroup.add(pumpCore);

  // Chunky grip ribs + bold orange tactical forend hand-stop collars
  for (let i = 0; i < 8; i++) {
    const rib = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.0316, 0.0028, 8, 22)),
      i === 0 || i === 7 ? orangeAnodizedMat : cerakoteBlackMat,
    );
    rib.position.set(0, -0.015, -0.226 - i * 0.0195);
    pumpGroup.add(rib);
  }

  for (const side of [-1, 1]) {
    const pumpOrangeBar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0042, 0.0092, 0.142)),
      orangeAnodizedMat,
    );
    pumpOrangeBar.position.set(side * 0.0318, -0.014, -0.295);
    pumpGroup.add(pumpOrangeBar);

    // Twin heavy steel pump action bars connecting forend into receiver
    const actionBar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0042, 0.0062, 0.162)),
      titaniumMat,
    );
    actionBar.position.set(side * 0.0255, -0.008, -0.19);
    pumpGroup.add(actionBar);
  }

  // =========================================================================
  // 4. HOLLOW-EXTRUDED HOLOGRAPHIC RED DOT REFLEX SIGHT (Top Rail, ADS Aligned!)
  // =========================================================================
  const sightLineY = 0.0695;
  const opticGroup = new THREE.Group();
  root.add(opticGroup);

  const opticBaseY = recTop + 0.0052;
  const deckShape = new THREE.Shape();
  deckShape.moveTo(-0.0165, opticBaseY - 0.001);
  deckShape.lineTo(0.0165, opticBaseY - 0.001);
  deckShape.quadraticCurveTo(0.0175, opticBaseY + 0.0022, 0.0145, opticBaseY + 0.0052);
  deckShape.lineTo(-0.0145, opticBaseY + 0.0052);
  deckShape.quadraticCurveTo(-0.0175, opticBaseY + 0.0022, -0.0165, opticBaseY - 0.001);
  deckShape.closePath();

  const opticDeckGeo = trackGeo(
    new THREE.ExtrudeGeometry(deckShape, {
      depth: 0.054,
      bevelEnabled: true,
      bevelSize: 0.0010,
      bevelThickness: 0.0016,
      bevelSegments: 3,
    }),
  );
  opticDeckGeo.translate(0, 0, -0.045);
  const opticDeck = new THREE.Mesh(opticDeckGeo, cerakoteBlackMat);
  opticDeck.castShadow = true;
  opticGroup.add(opticDeck);

  // Rear optic deck rounded micro status lenses facing shooter (unified ammo & reload protocol)
  const microLensGeo = trackGeo(new THREE.SphereGeometry(0.0015, 10, 8));
  const deckGreenLed = new THREE.Mesh(microLensGeo, rearLedMats[0]);
  deckGreenLed.position.set(-0.0108, opticBaseY + 0.0024, 0.0108);
  opticGroup.add(deckGreenLed);

  const deckRedLed = new THREE.Mesh(microLensGeo, rearLedMats[1]);
  deckRedLed.position.set(0.0108, opticBaseY + 0.0024, 0.0108);
  opticGroup.add(deckRedLed);

  const hoodZ = -0.016;
  const hoodDepth = 0.032;
  const ow = 0.0215;
  const ohBot = opticBaseY + 0.0035;
  const ohTop = sightLineY + 0.0172;

  const hoodOuter = new THREE.Shape();
  hoodOuter.moveTo(-ow, ohBot);
  hoodOuter.lineTo(ow, ohBot);
  hoodOuter.lineTo(ow + 0.0018, ohBot + 0.009);
  hoodOuter.lineTo(ow - 0.0014, ohTop - 0.0065);
  hoodOuter.lineTo(ow - 0.0075, ohTop);
  hoodOuter.lineTo(-ow + 0.0075, ohTop);
  hoodOuter.lineTo(-ow + 0.0014, ohTop - 0.0065);
  hoodOuter.lineTo(-ow - 0.0018, ohBot + 0.009);
  hoodOuter.closePath();

  const iw = 0.016;
  const ihBot = opticBaseY + 0.0062;
  const ihTop = sightLineY + 0.0132;
  const hoodAperture = new THREE.Path();
  hoodAperture.moveTo(-iw, ihBot + 0.002);
  hoodAperture.lineTo(-iw + 0.0025, ihBot);
  hoodAperture.lineTo(iw - 0.0025, ihBot);
  hoodAperture.lineTo(iw, ihBot + 0.002);
  hoodAperture.lineTo(iw, ihTop - 0.0042);
  hoodAperture.lineTo(iw - 0.0048, ihTop);
  hoodAperture.lineTo(-iw + 0.0048, ihTop);
  hoodAperture.lineTo(-iw, ihTop - 0.0042);
  hoodAperture.closePath();
  hoodOuter.holes.push(hoodAperture);

  const reflexHoodGeo = trackGeo(
    new THREE.ExtrudeGeometry(hoodOuter, {
      depth: hoodDepth,
      bevelEnabled: true,
      bevelThickness: 0.0015,
      bevelSize: 0.001,
      bevelSegments: 3,
    }),
  );
  reflexHoodGeo.translate(0, 0, hoodZ - hoodDepth / 2);
  const reflexHood = new THREE.Mesh(reflexHoodGeo, cerakoteBlackMat);
  reflexHood.castShadow = true;
  opticGroup.add(reflexHood);

  for (const side of [-1, 1]) {
    const hoodOrange = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.002, 0.0135, hoodDepth * 0.74)),
      orangeAnodizedMat,
    );
    hoodOrange.position.set(side * (ow + 0.0015), sightLineY - 0.0005, hoodZ);
    hoodOrange.rotation.z = side * 0.14;
    opticGroup.add(hoodOrange);
  }

  const hoodTopOrange = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.015, 0.0018, hoodDepth * 0.78)),
    orangeAnodizedMat,
  );
  hoodTopOrange.position.set(0, ohTop + 0.0015, hoodZ);
  opticGroup.add(hoodTopOrange);

  // Knurled rotary brightness dial on left side of reflex housing
  const dialGroup = new THREE.Group();
  dialGroup.position.set(-(ow + 0.0026), opticBaseY + 0.0085, hoodZ + 0.004);
  dialGroup.rotation.z = Math.PI / 2;
  dialGroup.add(
    new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.0052, 0.0054, 0.0048, 16)),
      darkPolymerMat,
    ),
    new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.0036, 0.0036, 0.0052, 12)),
      orangeAnodizedMat,
    ),
  );
  opticGroup.add(dialGroup);

  addHexBolt(opticGroup, ow + 0.0016, opticBaseY + 0.008, hoodZ + 0.002, 'x');
  addHexBolt(opticGroup, 0.010, ohTop + 0.0008, hoodZ + 0.004, 'y');

  // Anti-reflective coated glass reflex lens
  const glassLens = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(iw * 2.02, ihTop - ihBot)),
    opticGlassMat,
  );
  glassLens.position.set(0, (ihTop + ihBot) * 0.5, hoodZ - 0.002);
  opticGroup.add(glassLens);

  // Holographic RED DOT + Shotgun Buckshot Spread Circle dead-center at sightLineY!
  const reticleGroup = new THREE.Group();
  reticleGroup.position.set(0, sightLineY, hoodZ - 0.0015);
  opticGroup.add(reticleGroup);

  reticleGroup.add(
    new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.0011, 18)), redDotMat),
    new THREE.Mesh(
      trackGeo(new THREE.RingGeometry(0.0068, 0.0075, 36)),
      redRingMat,
    ),
  );
  const tickH = trackGeo(new THREE.PlaneGeometry(0.0026, 0.0006));
  const tickV = trackGeo(new THREE.PlaneGeometry(0.0006, 0.0026));
  for (const [tx, ty, tg] of [
    [-0.009, 0, tickH],
    [0.009, 0, tickH],
    [0, -0.009, tickV],
    [0, 0.009, tickV],
  ] as Array<[number, number, THREE.BufferGeometry]>) {
    const tMesh = new THREE.Mesh(tg, redRingMat);
    tMesh.position.set(tx, ty, 0);
    reticleGroup.add(tMesh);
  }

  // =========================================================================
  // 5. PISTOL GRIP, TRIGGER GUARD, ORANGE MATCH TRIGGER & RELOAD SHELL
  //    (Uses exact same grip coordinates so right gloved hand locks cleanly!)
  // =========================================================================
  const gripProfile = new THREE.Shape();
  gripProfile.moveTo(0.004, -0.012);
  gripProfile.quadraticCurveTo(0.008, -0.036, 0.014, -0.044);
  gripProfile.quadraticCurveTo(0.017, -0.062, 0.023, -0.073);
  gripProfile.quadraticCurveTo(0.027, -0.088, 0.033, -0.104);
  gripProfile.lineTo(0.081, -0.104);
  gripProfile.quadraticCurveTo(0.076, -0.076, 0.065, -0.048);
  gripProfile.quadraticCurveTo(0.054, -0.028, 0.051, -0.012);
  gripProfile.closePath();

  const gripCoreGeo = trackGeo(
    new THREE.ExtrudeGeometry(gripProfile, {
      depth: 0.024,
      bevelEnabled: true,
      bevelSize: 0.0028,
      bevelThickness: 0.0032,
      bevelSegments: 4,
    }),
  );
  gripCoreGeo.rotateY(-Math.PI / 2);
  gripCoreGeo.translate(0.012, 0, 0);
  const gripCore = new THREE.Mesh(gripCoreGeo, gripStippleMat);
  gripCore.castShadow = true;
  gripCore.receiveShadow = true;
  frameGroup.add(gripCore);

  const backstrapOrange = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0076, 0.056, 0.0034)),
    orangeAnodizedMat,
  );
  backstrapOrange.position.set(0, -0.064, 0.0725);
  backstrapOrange.rotation.x = 0.34;
  frameGroup.add(backstrapOrange);

  const guardShape = new THREE.Shape();
  guardShape.moveTo(0.008, -0.012);
  guardShape.lineTo(-0.045, -0.012);
  guardShape.lineTo(-0.048, -0.036);
  guardShape.lineTo(-0.040, -0.040);
  guardShape.lineTo(0.009, -0.040);
  guardShape.lineTo(0.011, -0.034);
  guardShape.lineTo(-0.038, -0.034);
  guardShape.lineTo(-0.040, -0.016);
  guardShape.lineTo(0.008, -0.016);
  guardShape.closePath();

  const guardGeo = trackGeo(
    new THREE.ExtrudeGeometry(guardShape, {
      depth: 0.0128,
      bevelEnabled: true,
      bevelSize: 0.0009,
      bevelThickness: 0.0009,
      bevelSegments: 2,
    }),
  );
  guardGeo.rotateY(-Math.PI / 2);
  guardGeo.translate(0.0064, 0, 0);
  frameGroup.add(new THREE.Mesh(guardGeo, cerakoteBlackMat));

  const triggerPivot = new THREE.Group();
  triggerPivot.position.set(0, -0.012, -0.012);
  frameGroup.add(triggerPivot);

  const trigMesh = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0066, 0.020, 0.0048)),
    orangeAnodizedMat,
  );
  trigMesh.position.set(0, -0.010, -0.003);
  trigMesh.rotation.x = 0.16;
  triggerPivot.add(trigMesh);

  // Loading gate recess on bottom of receiver + animated 12-gauge shell for reload
  const magazineGroup = new THREE.Group();
  root.add(magazineGroup);

  const shellInsertMesh = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0096, 0.0096, 0.058, 16)),
    shellHullMat,
  );
  shellInsertMesh.rotation.x = Math.PI / 2;
  const shellBrassCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0099, 0.0099, 0.016, 16)),
    brassMat,
  );
  shellBrassCap.position.y = -0.024;
  shellInsertMesh.add(shellBrassCap);
  shellInsertMesh.position.set(0, -0.026, -0.075);
  shellInsertMesh.visible = false;
  magazineGroup.add(shellInsertMesh);

  // =========================================================================
  // 6. HEAVY SHOTGUN MUZZLE FLASH, LIGHT & EJECTION ANCHORS
  // =========================================================================
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.017, -0.525);
  root.add(muzzleTip);

  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.028, 0.016, -0.042);
  root.add(ejectionPort);

  const volumetricFlash = createPhotorealisticMuzzleFlash({
    profile: 'shotgun',
    scale: 1.12,
    tintHex: 0xffb168,
    lightRange: 8.5,
    lightIntensity: 11.5,
  });
  volumetricFlash.group.position.set(0, 0.021, -0.538);
  root.add(volumetricFlash.group);
  disposables.push(volumetricFlash);

  const muzzleFlashGroup = volumetricFlash.group;
  const muzzleLight = volumetricFlash.light;

  // Under-barrel orange-accent tactical flashlight mounted ahead of thickened pump forend
  const underbarrelLight = createUnderbarrelFlashlight({
    maxAnisotropy,
    orangeAccent: true,
    scale: 1.05,
  });
  underbarrelLight.group.position.set(0, -0.036, -0.440);
  root.add(underbarrelLight.group);
  disposables.push(underbarrelLight);

  let currentFireGlow = 0;

  return {
    root,
    slideGroup,
    barrelGroup,
    triggerPivot,
    magazineGroup,
    pumpGroup,
    shellInsertMesh,
    muzzleFlashGroup,
    muzzleLight,
    muzzleTip,
    ejectionPort,
    flashlightLens: underbarrelLight.lensAnchor,
    sightLineY,
    setSlideOffset(backMeters: number) {
      const clamped = THREE.MathUtils.clamp(backMeters, 0, 0.074);
      slideGroup.position.z = clamped;
    },
    setFlashlightOn(on: boolean) {
      underbarrelLight.setOn(on);
    },
    setPumpOffset(amount01: number) {
      const p = THREE.MathUtils.clamp(amount01, 0, 1);
      // Slides forend smoothly 9.5cm rearward and kicks bolt carrier back in lockstep!
      pumpGroup.position.z = p * 0.095;
      slideGroup.position.z = Math.max(slideGroup.position.z, p * 0.072);
    },
    setFireGlow(heat01: number) {
      currentFireGlow = THREE.MathUtils.clamp(heat01, 0, 1);
      // Dramatic blazing thermal surge when firing -> glowing molten orange -> smooth ember cooldown!
      fireGlowMat.emissiveIntensity = 0.65 + currentFireGlow * 5.8;
      orangeAnodizedMat.emissiveIntensity = 0.35 + currentFireGlow * 1.45;
      barrelGlowLight.intensity = 0.14 + currentFireGlow * 2.4;
    },
    setTriggerPull(amount: number) {
      triggerPivot.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 0.44;
    },
    setMuzzleFlash(intensity: number) {
      volumetricFlash.setIntensity(intensity);
    },
    updateLeds(
      ammo: number,
      maxAmmo: number,
      isReloading: boolean,
      elapsed: number,
    ) {
      const frac = maxAmmo > 0 ? THREE.MathUtils.clamp(ammo / maxAmmo, 0, 1) : 0;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);
      const slowPulse = 0.78 + 0.22 * Math.sin(elapsed * 3.4);

      // Subtle thermal shimmer added to baseline fire glow
      if (currentFireGlow > 0.02) {
        fireGlowMat.emissiveIntensity =
          0.65 + currentFireGlow * (5.6 + Math.sin(elapsed * 26) * 0.5);
      }

      if (isReloading) {
        // Unified reload protocol matching every other firearm:
        // 1. 4-LED clockwise chasing arcade neon swirl on the rear face
        for (let i = 0; i < rearLedMats.length; i++) {
          const m = rearLedMats[i];
          const hue = (elapsed * 1.65 - i * 0.22 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.45);
          m.emissive.setHSL(hue, 1.0, 0.52);
          m.color.setHSL(hue, 0.92, 0.76);
          m.emissiveIntensity = 2.0 + chase * 3.0;
        }

        // 2. Continuous glitch-free chasing wave across all 6 side bars + 2 trailing strips
        for (let i = 0; i < barLedMats.length; i++) {
          const m = barLedMats[i];
          const swirlHue = (elapsed * 1.65 - i * 0.16 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.05);
          m.emissive.setHSL(swirlHue, 1.0, 0.52);
          m.color.setHSL(swirlHue, 0.92, 0.76);
          m.emissiveIntensity = 1.8 + chase * 2.8;
        }

        // Keep local point-light spill ultra-subtle during reload so no blue glare blotches the dark receiver side
        ledGlowLight.intensity = 0.04;
        return;
      }

      // Smooth ammo-drain spectrum: Full Green (0.36) -> Half Yellow (0.145) -> Empty Red (0.0)
      const ammoHue =
        frac >= 0.5
          ? THREE.MathUtils.lerp(0.145, 0.36, (frac - 0.5) * 2.0)
          : THREE.MathUtils.lerp(0.0, 0.145, frac * 2.0);
      const isEmpty = ammo === 0;
      const isLow = frac <= 0.3;

      for (let i = 0; i < rearLedMats.length; i++) {
        const m = rearLedMats[i];
        m.emissive.setHSL(ammoHue, 1.0, 0.50);
        m.color.setHSL(ammoHue, 0.92, 0.74);
        m.emissiveIntensity = isEmpty
          ? 1.4 + pulse * 3.2
          : isLow
            ? 2.4 + pulse * 2.2
            : 3.1 + slowPulse * 0.3 + currentFireGlow * 1.1;
      }

      if (currentFireGlow > 0.38) {
        ledGlowLight.color.setHex(0xff6218);
      } else {
        ledGlowLight.color.setHSL(ammoHue, 1.0, 0.52);
      }
      ledGlowLight.intensity = isEmpty
        ? 0.10 + pulse * 0.06
        : 0.09 + currentFireGlow * 0.18;

      // 6 shell-count bars deplete cleanly Green -> Yellow -> Red; trailing 2 status strips match ammoHue
      for (let i = 0; i < 6; i++) {
        const threshold = (i + 0.15) / 6;
        const m = barLedMats[i];
        if (frac >= threshold) {
          m.emissive.setHSL(ammoHue, 1.0, 0.50);
          m.color.setHSL(ammoHue, 0.92, 0.74);
          m.emissiveIntensity =
            (isLow ? 2.4 + pulse * 2.1 : 3.0) + currentFireGlow * 1.3;
        } else {
          m.emissive.setHSL(0.0, 1.0, 0.45);
          m.color.setHex(0x4a1616);
          m.emissiveIntensity = isEmpty ? 0.8 + pulse * 1.6 : 0.28;
        }
      }
      for (let i = 6; i < barLedMats.length; i++) {
        const m = barLedMats[i];
        m.emissive.setHSL(ammoHue, 1.0, 0.50);
        m.color.setHSL(ammoHue, 0.92, 0.74);
        m.emissiveIntensity = isEmpty
          ? 1.2 + pulse * 2.8
          : (isLow ? 2.4 + pulse * 2.0 : 2.9) + currentFireGlow * 1.2;
      }
    },
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
