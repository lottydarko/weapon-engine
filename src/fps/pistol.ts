import * as THREE from 'three';
import { createUnderbarrelFlashlight } from './flashlight';
import { enhanceGunMetalMaterial } from './gunShader';
import { createPhotorealisticMuzzleFlash } from './muzzleFlash';
import { createGunmetalTexture, createPolymerStippleTextures } from './textures';

export interface PistolRig {
  root: THREE.Group;
  slideGroup: THREE.Group;
  barrelGroup: THREE.Group;
  triggerPivot: THREE.Group;
  magazineGroup: THREE.Group;
  muzzleFlashGroup: THREE.Group;
  muzzleLight: THREE.PointLight;
  muzzleTip: THREE.Object3D;
  ejectionPort: THREE.Object3D;
  flashlightLens: THREE.Object3D;
  /** Exact Y coordinate of the iron-sight center line in pistol local space */
  sightLineY: number;
  setSlideOffset: (backMeters: number) => void;
  setTriggerPull: (amount: number) => void;
  setMuzzleFlash: (intensity: number) => void;
  setFlashlightOn: (on: boolean) => void;
  updateLeds?: (
    ammo: number,
    maxAmmo: number,
    isReloading: boolean,
    elapsed: number,
  ) => void;
  dispose: () => void;
}

/**
 * Builds a photorealistically textured & shaded modern striker-fired 9mm pistol
 * with true recessed ejection port, CNC brushed DLC nitride slide, anisotropic
 * stainless chamber hood, stippled polymer frame with normal maps, and anti-glare tritium sights.
 * Coordinate convention: -Z = forward toward muzzle, +Y = up, +X = right.
 */
export function buildPistol(
  maxAnisotropy: number,
  _flashTexture?: THREE.Texture,
): PistolRig {
  const root = new THREE.Group();
  root.name = 'TacticalPistol9mm';

  const stipple = createPolymerStippleTextures(maxAnisotropy);
  const gunmetal = createGunmetalTexture(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [stipple, gunmetal];

  // Deep blued / worn-edge Tenifer nitride slide steel (custom micro-ridge & curvature PBR)
  const slideMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xe6ecf4,
      map: gunmetal.map,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.92,
      roughness: 0.27,
      clearcoat: 0.32,
      clearcoatRoughness: 0.28,
      anisotropy: 0.56,
      envMapIntensity: 1.48,
    }),
    { edgeWear: 0.52, cavityDepth: 0.42, sheenColor: 0x94b4dc, sheenStrength: 0.30 },
  );

  // Slightly darker machined blued steel for serration recesses, sights, controls & trigger
  const darkSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0x161a21,
      normalMap: gunmetal.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.89,
      roughness: 0.33,
      clearcoat: 0.2,
      clearcoatRoughness: 0.36,
      envMapIntensity: 1.28,
    }),
    { edgeWear: 0.44, cavityDepth: 0.46, sheenColor: 0x829bb8, sheenStrength: 0.22 },
  );

  // Glass-filled matte tactical polymer chassis
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x1d2025,
    normalMap: gunmetal.normalMap,
    normalScale: new THREE.Vector2(0.24, 0.24),
    metalness: 0.05,
    roughness: 0.72,
    sheen: 0.15,
    sheenRoughness: 0.78,
    sheenColor: new THREE.Color(0x3a404a),
  });

  // Aggressive hand-stippled polymer grip panels with 1024px normal & roughness maps
  const gripStippleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: stipple.map,
    normalMap: stipple.normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughnessMap: stipple.roughnessMap,
    metalness: 0.04,
    roughness: 0.86,
  });

  // Turned anisotropic stainless steel barrel & chamber hood with breech wear maps
  const barrelSteelMat = enhanceGunMetalMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: gunmetal.barrelMap,
      normalMap: gunmetal.barrelNormalMap,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: gunmetal.roughnessMap,
      metalness: 0.96,
      roughness: 0.2,
      anisotropy: 0.82,
      clearcoat: 0.28,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.55,
    }),
    { edgeWear: 0.48, cavityDepth: 0.32, sheenColor: 0xd0dced, sheenStrength: 0.26 },
  );

  // Warm machined brass cartridge
  const brassMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4a94c,
    metalness: 0.94,
    roughness: 0.22,
    clearcoat: 0.15,
  });

  // Glowing 3-dot tritium glass-capped vials
  const tritiumRearMat = new THREE.MeshPhysicalMaterial({
    color: 0xc2ffd2,
    emissive: 0x4dff88,
    emissiveIntensity: 2.1,
    roughness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const tritiumFrontMat = new THREE.MeshPhysicalMaterial({
    color: 0xdcffe6,
    emissive: 0x72ff9e,
    emissiveIntensity: 2.8,
    roughness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });

  const frontRingMat = new THREE.MeshStandardMaterial({
    color: 0xf7652c,
    emissive: 0x521805,
    emissiveIntensity: 0.75,
    roughness: 0.3,
  });

  const indicatorRedMat = new THREE.MeshStandardMaterial({
    color: 0xc92c24,
    roughness: 0.35,
    metalness: 0.2,
  });

  // 4 individually-animated rear slide backplate LEDs (ONLY on back of pistol facing shooter!)
  // Drains Green -> Yellow -> Red as ammo empties, and swirls arcade neon colors while reloading!
  const rearLedMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.MeshStandardMaterial({
      color: 0x8dffb8,
      emissive: 0x00ff66,
      emissiveIntensity: 3.1,
      roughness: 0.12,
      metalness: 0.08,
    });
    rearLedMats.push(m);
    disposables.push(m);
  }

  disposables.push(
    slideMat,
    darkSteelMat,
    frameMat,
    gripStippleMat,
    barrelSteelMat,
    brassMat,
    tritiumRearMat,
    tritiumFrontMat,
    frontRingMat,
    indicatorRedMat,
  );

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // =========================================================================
  // 1. RECIPROCATING SLIDE (True 3-section geometry with hollowed ejection port!)
  // =========================================================================
  const slideGroup = new THREE.Group();
  root.add(slideGroup);

  const slideW = 0.0262;
  const slideH = 0.0228;
  const bevel = 0.0052;

  // True curved-shoulder arched slide profile (rounded upper flanks + subtly crowned roof, zero square corners!)
  const fullSlideShape = new THREE.Shape();
  fullSlideShape.moveTo(-slideW / 2 + 0.0014, 0);
  fullSlideShape.lineTo(slideW / 2 - 0.0014, 0);
  fullSlideShape.quadraticCurveTo(slideW / 2, 0.0004, slideW / 2, 0.0022);
  fullSlideShape.lineTo(slideW / 2, slideH - bevel);
  fullSlideShape.quadraticCurveTo(slideW / 2, slideH - 0.0006, slideW / 2 - bevel, slideH - 0.0004);
  fullSlideShape.quadraticCurveTo(0, slideH + 0.0010, -slideW / 2 + bevel, slideH - 0.0004);
  fullSlideShape.quadraticCurveTo(-slideW / 2, slideH - 0.0006, -slideW / 2, slideH - bevel);
  fullSlideShape.lineTo(-slideW / 2, 0.0022);
  fullSlideShape.quadraticCurveTo(-slideW / 2, 0.0004, -slideW / 2 + 0.0014, 0);
  fullSlideShape.closePath();

  // Rear solid slide section with generous rounded rear edge bevel: z ∈ [-0.008, +0.051]
  const rearSlideGeo = trackGeo(
    new THREE.ExtrudeGeometry(fullSlideShape, {
      depth: 0.059,
      bevelEnabled: true,
      bevelThickness: 0.0022,
      bevelSize: 0.0012,
      bevelSegments: 5,
      curveSegments: 16,
      steps: 1,
    }),
  );
  rearSlideGeo.translate(0, 0, -0.008);
  const rearSlideMesh = new THREE.Mesh(rearSlideGeo, slideMat);
  rearSlideMesh.castShadow = true;
  rearSlideMesh.receiveShadow = true;
  slideGroup.add(rearSlideMesh);

  // Front solid slide section: z ∈ [-0.122, -0.044]
  const frontSlideGeo = trackGeo(
    new THREE.ExtrudeGeometry(fullSlideShape, {
      depth: 0.078,
      bevelEnabled: true,
      bevelThickness: 0.0018,
      bevelSize: 0.0010,
      bevelSegments: 4,
      curveSegments: 16,
      steps: 1,
    }),
  );
  frontSlideGeo.translate(0, 0, -0.122);
  const frontSlideMesh = new THREE.Mesh(frontSlideGeo, slideMat);
  frontSlideMesh.castShadow = true;
  frontSlideMesh.receiveShadow = true;
  slideGroup.add(frontSlideMesh);

  // Ejection-port bridge (LEFT wall + lower right lip): z ∈ [-0.045, -0.007]
  // Leaves the top-right ejection window genuinely open down to the stainless chamber hood!
  const portLeftShape = new THREE.Shape();
  portLeftShape.moveTo(-slideW / 2, 0);
  portLeftShape.lineTo(-0.0052, 0);
  portLeftShape.lineTo(-0.0052, slideH);
  portLeftShape.lineTo(-slideW / 2 + bevel, slideH);
  portLeftShape.lineTo(-slideW / 2, slideH - bevel);
  portLeftShape.closePath();

  const portLeftGeo = trackGeo(
    new THREE.ExtrudeGeometry(portLeftShape, {
      depth: 0.039,
      bevelEnabled: true,
      bevelThickness: 0.0005,
      bevelSize: 0.0004,
      bevelSegments: 2,
      steps: 1,
    }),
  );
  portLeftGeo.translate(0, 0, -0.0455);
  const portLeftMesh = new THREE.Mesh(portLeftGeo, slideMat);
  portLeftMesh.castShadow = true;
  portLeftMesh.receiveShadow = true;
  slideGroup.add(portLeftMesh);

  // Lower right slide rail beneath ejection port opening
  const portRightLip = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0042, 0.0086, 0.040)),
    slideMat,
  );
  portRightLip.position.set(slideW / 2 - 0.0021, 0.0043, -0.026);
  portRightLip.castShadow = true;
  slideGroup.add(portRightLip);

  // Dark breech interior cavity beneath chamber hood for deep authentic shadow contrast
  const breechInterior = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.017, 0.009, 0.036)),
    darkSteelMat,
  );
  breechInterior.position.set(0.002, 0.006, -0.026);
  slideGroup.add(breechInterior);

  // Machined steel extractor claw with tiny loaded-chamber indicator mark
  const extractor = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0026, 0.0052, 0.021)),
    darkSteelMat,
  );
  extractor.position.set(slideW / 2 + 0.0004, 0.0132, 0.001);
  slideGroup.add(extractor);

  const lciDot = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0012, 0.0024, 0.0028)),
    indicatorRedMat,
  );
  lciDot.position.set(slideW / 2 + 0.0014, 0.0132, -0.006);
  slideGroup.add(lciDot);

  // Contoured arched slide rear striker backplate (matches curved slide silhouette — zero square slab!)
  const bpW = slideW - 0.0052;
  const bpH = slideH - 0.0038;
  const bpShape = new THREE.Shape();
  bpShape.moveTo(-bpW / 2 + 0.0018, 0.0018);
  bpShape.lineTo(bpW / 2 - 0.0018, 0.0018);
  bpShape.quadraticCurveTo(bpW / 2, 0.0018, bpW / 2, 0.0038);
  bpShape.lineTo(bpW / 2, bpH - 0.0046);
  bpShape.quadraticCurveTo(bpW / 2, bpH + 0.0006, bpW / 2 - 0.0048, bpH + 0.0008);
  bpShape.quadraticCurveTo(0, bpH + 0.0020, -bpW / 2 + 0.0048, bpH + 0.0008);
  bpShape.quadraticCurveTo(-bpW / 2, bpH + 0.0006, -bpW / 2, bpH - 0.0046);
  bpShape.lineTo(-bpW / 2, 0.0038);
  bpShape.quadraticCurveTo(-bpW / 2, 0.0018, -bpW / 2 + 0.0018, 0.0018);
  bpShape.closePath();

  const backplateGeo = trackGeo(
    new THREE.ExtrudeGeometry(bpShape, {
      depth: 0.0024,
      bevelEnabled: true,
      bevelThickness: 0.0011,
      bevelSize: 0.0009,
      bevelSegments: 4,
      curveSegments: 14,
    }),
  );
  backplateGeo.translate(0, 0, 0.0518);
  const backplate = new THREE.Mesh(backplateGeo, darkSteelMat);
  backplate.castShadow = true;
  slideGroup.add(backplate);

  // Machined concentric stainless striker sleeve & recessed firing-pin indicator
  const strikerBushing = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0032, 0.00075, 10, 20)),
    slideMat,
  );
  strikerBushing.position.set(0, 0.0108, 0.0550);
  slideGroup.add(strikerBushing);

  const strikerCap = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0020, 0.0022, 0.0014, 16)),
    barrelSteelMat,
  );
  strikerCap.rotation.x = Math.PI / 2;
  strikerCap.position.set(0, 0.0108, 0.0548);
  slideGroup.add(strikerCap);

  // Subtle horizontal machined traction grooves across lower backplate
  for (let i = 0; i < 3; i++) {
    const bpRib = new THREE.Mesh(
      trackGeo(new THREE.CapsuleGeometry(0.00045, slideW - 0.0115, 4, 8)),
      slideMat,
    );
    bpRib.rotation.z = Math.PI / 2;
    bpRib.position.set(0, 0.0042 + i * 0.0022, 0.0550);
    slideGroup.add(bpRib);
  }

  // Twin countersunk stainless micro-Torx pins on lower backplate corners
  const microScrewGeo = trackGeo(new THREE.CylinderGeometry(0.0010, 0.0010, 0.0012, 10));
  microScrewGeo.rotateX(Math.PI / 2);
  for (const sx of [-0.0074, 0.0074]) {
    const sc = new THREE.Mesh(microScrewGeo, barrelSteelMat);
    sc.position.set(sx, 0.0048, 0.0550);
    slideGroup.add(sc);
  }

  // Sleek pill-shaped recessed Green & Red LED telemetry lenses on arched rear backplate
  const pillBezelGeo = trackGeo(new THREE.CapsuleGeometry(0.0015, 0.0036, 4, 10));
  pillBezelGeo.rotateZ(Math.PI / 2);
  const pillLedGeo = trackGeo(new THREE.CapsuleGeometry(0.00095, 0.0032, 4, 10));
  pillLedGeo.rotateZ(Math.PI / 2);
  const roundPipGeo = trackGeo(new THREE.SphereGeometry(0.0011, 10, 8));

  const rearGreenBezel = new THREE.Mesh(pillBezelGeo, slideMat);
  rearGreenBezel.position.set(-0.0052, 0.0168, 0.0546);
  slideGroup.add(rearGreenBezel);
  const rearGreenBar = new THREE.Mesh(pillLedGeo, rearLedMats[0]);
  rearGreenBar.position.set(-0.0052, 0.0168, 0.0553);
  slideGroup.add(rearGreenBar);

  const rearRedBezel = new THREE.Mesh(pillBezelGeo, slideMat);
  rearRedBezel.position.set(0.0052, 0.0168, 0.0546);
  slideGroup.add(rearRedBezel);
  const rearRedBar = new THREE.Mesh(pillLedGeo, rearLedMats[1]);
  rearRedBar.position.set(0.0052, 0.0168, 0.0553);
  slideGroup.add(rearRedBar);

  // Twin lower rounded micro-status lenses flanking striker bushing (clockwise swirl order: 0->1->2->3)
  const lowerRedPip = new THREE.Mesh(roundPipGeo, rearLedMats[2]);
  lowerRedPip.position.set(0.0068, 0.0108, 0.0550);
  slideGroup.add(lowerRedPip);
  const lowerGreenPip = new THREE.Mesh(roundPipGeo, rearLedMats[3]);
  lowerGreenPip.position.set(-0.0068, 0.0108, 0.0550);
  slideGroup.add(lowerGreenPip);

  // Crisp angled rear & front slide cocking serrations (both sides)
  const serrationGeo = trackGeo(new THREE.BoxGeometry(0.0014, 0.0148, 0.0020));
  for (const side of [-1, 1]) {
    // 7 rear angled serrations
    for (let i = 0; i < 7; i++) {
      const groove = new THREE.Mesh(serrationGeo, darkSteelMat);
      groove.position.set(
        side * (slideW / 2 + 0.0002),
        0.0098,
        0.042 - i * 0.0045,
      );
      groove.rotation.x = 0.16;
      slideGroup.add(groove);
    }
    // 5 front press-check serrations
    for (let i = 0; i < 5; i++) {
      const groove = new THREE.Mesh(serrationGeo, darkSteelMat);
      groove.position.set(
        side * (slideW / 2 + 0.0002),
        0.0098,
        -0.088 - i * 0.0045,
      );
      groove.rotation.x = 0.16;
      slideGroup.add(groove);
    }
  }

  // ---- CONTOURED NOVAK-STYLE BEVELED 3-DOT TRITIUM NIGHT SIGHTS (Calibrated for ADS!) ----
  const sightLineY = 0.0264;

  // Beveled dovetail rear sight cradle following the crowned slide arch
  const dovetailShape = new THREE.Shape();
  dovetailShape.moveTo(-0.0098, 0);
  dovetailShape.lineTo(0.0098, 0);
  dovetailShape.quadraticCurveTo(0.0102, 0.0016, 0.0086, 0.0024);
  dovetailShape.lineTo(-0.0086, 0.0024);
  dovetailShape.quadraticCurveTo(-0.0102, 0.0016, -0.0098, 0);
  dovetailShape.closePath();

  const rearBaseGeo = trackGeo(
    new THREE.ExtrudeGeometry(dovetailShape, {
      depth: 0.0095,
      bevelEnabled: true,
      bevelSize: 0.0005,
      bevelThickness: 0.0006,
      bevelSegments: 3,
    }),
  );
  rearBaseGeo.translate(0, slideH - 0.0004, 0.0365);
  slideGroup.add(new THREE.Mesh(rearBaseGeo, darkSteelMat));

  // Swept rounded-shoulder combat rear sight ears (curved outer contour, crisp U-notch center!)
  const dotGeo = trackGeo(new THREE.CylinderGeometry(0.00105, 0.00105, 0.0011, 16));
  dotGeo.rotateX(Math.PI / 2);

  for (const side of [-1, 1]) {
    const earShape = new THREE.Shape();
    const innerX = side * 0.0024;
    const outerX = side * 0.0094;
    const midOuterX = side * 0.0080;
    const y0 = slideH + 0.0014;
    const y1 = slideH + 0.0082;
    earShape.moveTo(innerX, y0);
    earShape.lineTo(outerX, y0);
    earShape.quadraticCurveTo(outerX, y0 + 0.0038, midOuterX, y1 - 0.0006);
    earShape.quadraticCurveTo(side * 0.0068, y1 + 0.0004, side * 0.0034, y1);
    earShape.quadraticCurveTo(innerX, y1 - 0.0003, innerX, y1 - 0.0012);
    earShape.closePath();

    const earGeo = trackGeo(
      new THREE.ExtrudeGeometry(earShape, {
        depth: 0.0072,
        bevelEnabled: true,
        bevelSize: 0.00045,
        bevelThickness: 0.0006,
        bevelSegments: 3,
      }),
    );
    earGeo.translate(0, 0, 0.0380);
    const post = new THREE.Mesh(earGeo, darkSteelMat);
    post.castShadow = true;
    slideGroup.add(post);

    // White outline ring + glowing glass-capped tritium vial
    const rearRing = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.00138, 0.00138, 0.0007, 16)),
      barrelSteelMat,
    );
    rearRing.rotation.x = Math.PI / 2;
    rearRing.position.set(side * 0.00545, sightLineY, 0.0457);
    slideGroup.add(rearRing);

    const rearDot = new THREE.Mesh(dotGeo, tritiumRearMat);
    rearDot.position.set(side * 0.00545, sightLineY, 0.0461);
    slideGroup.add(rearDot);
  }

  // Front blade sight + orange daylight halo + glowing tritium vial
  const frontPost = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0032, 0.0069, 0.0118)),
    darkSteelMat,
  );
  frontPost.position.set(0, slideH + 0.0014 + 0.0034, -0.112);
  slideGroup.add(frontPost);

  const frontRing = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0015, 0.0015, 0.0008, 18)),
    frontRingMat,
  );
  frontRing.rotation.x = Math.PI / 2;
  frontRing.position.set(0, sightLineY, -0.1059);
  slideGroup.add(frontRing);

  const frontDot = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.00095, 0.00095, 0.001, 18)),
    tritiumFrontMat,
  );
  frontDot.rotation.x = Math.PI / 2;
  frontDot.position.set(0, sightLineY, -0.1056);
  slideGroup.add(frontDot);

  // =========================================================================
  // 2. ANISOTROPIC STAINLESS BARREL & CHAMFERED CHAMBER HOOD
  // =========================================================================
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0, 0.012, -0.036);
  root.add(barrelGroup);

  // Beveled stainless locking chamber hood visible directly inside the open ejection port!
  const hoodShape = new THREE.Shape();
  hoodShape.moveTo(-0.0076, -0.002);
  hoodShape.lineTo(0.0076, -0.002);
  hoodShape.lineTo(0.0076, 0.0082);
  hoodShape.lineTo(0.0052, 0.0102);
  hoodShape.lineTo(-0.0052, 0.0102);
  hoodShape.lineTo(-0.0076, 0.0082);
  hoodShape.closePath();

  const chamberHoodGeo = trackGeo(
    new THREE.ExtrudeGeometry(hoodShape, {
      depth: 0.033,
      bevelEnabled: true,
      bevelSize: 0.0005,
      bevelThickness: 0.0006,
      bevelSegments: 2,
    }),
  );
  chamberHoodGeo.translate(0.0014, 0, -0.007);
  const chamberHood = new THREE.Mesh(chamberHoodGeo, barrelSteelMat);
  chamberHood.castShadow = true;
  chamberHood.receiveShadow = true;
  barrelGroup.add(chamberHood);

  // Turned outer barrel
  const barrelTube = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0069, 0.0069, 0.098, 24)),
    barrelSteelMat,
  );
  barrelTube.rotation.x = Math.PI / 2;
  barrelTube.position.set(0, 0.001, -0.041);
  barrelGroup.add(barrelTube);

  // Recessed chamfered muzzle crown ring & deep dark bore
  const muzzleCrown = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.0058, 0.0011, 10, 20)),
    barrelSteelMat,
  );
  muzzleCrown.position.set(0, 0.001, -0.0895);
  barrelGroup.add(muzzleCrown);

  const boreHole = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0046, 0.0046, 0.009, 18)),
    darkSteelMat,
  );
  boreHole.rotation.x = Math.PI / 2;
  boreHole.position.set(0, 0.001, -0.087);
  barrelGroup.add(boreHole);

  // Dual-spring steel recoil guide rod + coiled spring rings below barrel (clearly visible when slide kicks far back!)
  const guideRod = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0038, 0.0038, 0.094, 14)),
    barrelSteelMat,
  );
  guideRod.rotation.x = Math.PI / 2;
  guideRod.position.set(0, -0.004, -0.072);
  root.add(guideRod);

  const springCoilGeo = trackGeo(new THREE.TorusGeometry(0.0046, 0.00085, 8, 16));
  for (let i = 0; i < 11; i++) {
    const coil = new THREE.Mesh(springCoilGeo, darkSteelMat);
    coil.position.set(0, -0.004, -0.114 + i * 0.0056);
    root.add(coil);
  }

  // =========================================================================
  // 3. POLYMER LOWER FRAME, PICATINNY RAIL, THUMB LEDGES & STIPPLED GRIP
  // =========================================================================
  const frameGroup = new THREE.Group();
  root.add(frameGroup);

  // Beveled polymer lower dust cover (rounded bottom belly edges — no harsh square box!)
  const dustShape = new THREE.Shape();
  dustShape.moveTo(-0.0110, -0.0146);
  dustShape.lineTo(0.0110, -0.0146);
  dustShape.quadraticCurveTo(0.0128, -0.0144, 0.0128, -0.0116);
  dustShape.lineTo(0.0128, 0);
  dustShape.lineTo(-0.0128, 0);
  dustShape.lineTo(-0.0128, -0.0116);
  dustShape.quadraticCurveTo(-0.0128, -0.0144, -0.0110, -0.0146);
  dustShape.closePath();

  const dustGeo = trackGeo(
    new THREE.ExtrudeGeometry(dustShape, {
      depth: 0.166,
      bevelEnabled: true,
      bevelSize: 0.0009,
      bevelThickness: 0.0012,
      bevelSegments: 3,
    }),
  );
  dustGeo.translate(0, 0, -0.119);
  const dustCover = new THREE.Mesh(dustGeo, frameMat);
  dustCover.castShadow = true;
  dustCover.receiveShadow = true;
  frameGroup.add(dustCover);

  // Stainless serial plate embedded under forward dust cover
  const serialPlate = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.011, 0.0012, 0.018)),
    barrelSteelMat,
  );
  serialPlate.position.set(0, -0.015, -0.060);
  frameGroup.add(serialPlate);

  // Picatinny rail cross-slots under muzzle dust cover
  for (let i = 0; i < 3; i++) {
    const lug = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0224, 0.0032, 0.0075)),
      frameMat,
    );
    lug.position.set(0, -0.0156, -0.078 - i * 0.013);
    frameGroup.add(lug);
  }

  // Molded thumb-index accelerator pads on both sides of polymer dust cover
  for (const side of [-1, 1]) {
    const indexPad = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.0014, 0.0078, 0.028)),
      gripStippleMat,
    );
    indexPad.position.set(side * 0.0128, -0.0075, -0.044);
    frameGroup.add(indexPad);
  }

  // Ergonomic beavertail tang
  const tangShape = new THREE.Shape();
  tangShape.moveTo(0.014, 0.0);
  tangShape.lineTo(0.056, 0.0);
  tangShape.quadraticCurveTo(0.066, -0.003, 0.062, -0.011);
  tangShape.quadraticCurveTo(0.053, -0.016, 0.049, -0.024);
  tangShape.lineTo(0.014, -0.014);
  tangShape.closePath();

  const tangGeo = trackGeo(
    new THREE.ExtrudeGeometry(tangShape, {
      depth: 0.0242,
      bevelEnabled: true,
      bevelSize: 0.0018,
      bevelThickness: 0.0018,
      bevelSegments: 3,
    }),
  );
  tangGeo.rotateY(-Math.PI / 2);
  tangGeo.translate(0.0121, 0, 0);
  const tangMesh = new THREE.Mesh(tangGeo, frameMat);
  tangMesh.castShadow = true;
  frameGroup.add(tangMesh);

  // Stippled ergonomic polymer grip core
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

  // Combat undercut trigger guard
  const guardShape = new THREE.Shape();
  guardShape.moveTo(0.008, -0.012);
  guardShape.lineTo(-0.042, -0.012);
  guardShape.lineTo(-0.045, -0.035);
  guardShape.quadraticCurveTo(-0.044, -0.039, -0.038, -0.039);
  guardShape.lineTo(0.009, -0.039);
  guardShape.lineTo(0.011, -0.034);
  guardShape.lineTo(-0.036, -0.034);
  guardShape.lineTo(-0.038, -0.016);
  guardShape.lineTo(0.008, -0.016);
  guardShape.closePath();

  const guardGeo = trackGeo(
    new THREE.ExtrudeGeometry(guardShape, {
      depth: 0.0126,
      bevelEnabled: true,
      bevelSize: 0.0009,
      bevelThickness: 0.0009,
      bevelSegments: 2,
    }),
  );
  guardGeo.rotateY(-Math.PI / 2);
  guardGeo.translate(0.0063, 0, 0);
  const guardMesh = new THREE.Mesh(guardGeo, frameMat);
  guardMesh.castShadow = true;
  frameGroup.add(guardMesh);

  // Articulated Trigger Blade + central safety shoe
  const triggerPivot = new THREE.Group();
  triggerPivot.position.set(0, -0.012, -0.012);
  frameGroup.add(triggerPivot);

  const trigShape = new THREE.Shape();
  trigShape.moveTo(0.001, 0);
  trigShape.lineTo(-0.004, 0);
  trigShape.quadraticCurveTo(-0.009, -0.011, -0.002, -0.021);
  trigShape.lineTo(0.0025, -0.0195);
  trigShape.quadraticCurveTo(-0.003, -0.011, 0.001, 0);
  trigShape.closePath();

  const trigGeo = trackGeo(
    new THREE.ExtrudeGeometry(trigShape, {
      depth: 0.0064,
      bevelEnabled: true,
      bevelSize: 0.0005,
      bevelThickness: 0.0005,
      bevelSegments: 2,
    }),
  );
  trigGeo.rotateY(-Math.PI / 2);
  trigGeo.translate(0.0032, 0, 0);
  const triggerMesh = new THREE.Mesh(trigGeo, darkSteelMat);
  triggerPivot.add(triggerMesh);

  // Extended tactical slide stop lever, takedown lock & checkered mag release
  const slideStop = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0028, 0.0046, 0.020)),
    darkSteelMat,
  );
  slideStop.position.set(-0.0138, -0.002, 0.004);
  frameGroup.add(slideStop);

  const takedownTab = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0272, 0.0036, 0.0048)),
    darkSteelMat,
  );
  takedownTab.position.set(0, -0.0085, -0.024);
  frameGroup.add(takedownTab);

  const magRelease = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0036, 0.0088, 0.0066)),
    darkSteelMat,
  );
  magRelease.position.set(-0.014, -0.029, 0.014);
  frameGroup.add(magRelease);

  // Steel frame cross-pins
  const pinGeo = trackGeo(new THREE.CylinderGeometry(0.0018, 0.0018, 0.0268, 14));
  pinGeo.rotateZ(Math.PI / 2);
  for (const [py, pz] of [
    [-0.007, -0.004],
    [-0.013, 0.001],
    [-0.007, 0.044],
  ]) {
    const pin = new THREE.Mesh(pinGeo, barrelSteelMat);
    pin.position.set(0, py, pz);
    frameGroup.add(pin);
  }

  // =========================================================================
  // 4. REMOVABLE MAGAZINE WITH VISIBLE BRASS TOP CARTRIDGE
  // =========================================================================
  const magazineGroup = new THREE.Group();
  root.add(magazineGroup);

  const magBody = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0216, 0.096, 0.032)),
    darkSteelMat,
  );
  magBody.position.set(0, -0.058, 0.044);
  magBody.rotation.x = 0.34;
  magazineGroup.add(magBody);

  const magBaseplate = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0282, 0.010, 0.049)),
    frameMat,
  );
  magBaseplate.position.set(0, -0.109, 0.059);
  magazineGroup.add(magBaseplate);

  // Brass 9mm cartridge casing + copper jacket bullet tip
  const topRound = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.0048, 0.0048, 0.024, 14)),
    brassMat,
  );
  topRound.rotation.x = Math.PI / 2;
  topRound.position.set(0, -0.010, 0.026);
  magazineGroup.add(topRound);

  // =========================================================================
  // 5. MUZZLE FLASH, TRANSIENT LIGHT & EJECTION ANCHORS
  // =========================================================================
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.013, -0.128);
  root.add(muzzleTip);

  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.014, 0.019, -0.026);
  root.add(ejectionPort);

  const volumetricFlash = createPhotorealisticMuzzleFlash({
    profile: 'pistol',
    scale: 1.0,
    tintHex: 0xffc67d,
    lightRange: 6.0,
    lightIntensity: 8.2,
  });
  volumetricFlash.group.position.set(0, 0.013, -0.132);
  root.add(volumetricFlash.group);
  disposables.push(volumetricFlash);

  const muzzleFlashGroup = volumetricFlash.group;
  const muzzleLight = volumetricFlash.light;

  // Under-barrel Picatinny tactical flashlight
  const underbarrelLight = createUnderbarrelFlashlight({
    maxAnisotropy,
    scale: 0.78,
  });
  underbarrelLight.group.position.set(0, -0.0255, -0.084);
  root.add(underbarrelLight.group);
  disposables.push(underbarrelLight);

  return {
    root,
    slideGroup,
    barrelGroup,
    triggerPivot,
    magazineGroup,
    muzzleFlashGroup,
    muzzleLight,
    muzzleTip,
    ejectionPort,
    flashlightLens: underbarrelLight.lensAnchor,
    sightLineY,
    setSlideOffset(backMeters: number) {
      const clamped = THREE.MathUtils.clamp(backMeters, 0, 0.074);
      slideGroup.position.z = clamped;
      const t = clamped / 0.074;
      barrelGroup.position.z = -0.036 + t * 0.0062;
      barrelGroup.position.y = 0.012 - t * 0.0024;
      barrelGroup.rotation.x = t * 0.068;
    },
    setTriggerPull(amount: number) {
      triggerPivot.rotation.x = THREE.MathUtils.clamp(amount, 0, 1) * 0.48;
    },
    setMuzzleFlash(intensity: number) {
      volumetricFlash.setIntensity(intensity);
    },
    setFlashlightOn(on: boolean) {
      underbarrelLight.setOn(on);
    },
    updateLeds(
      ammo: number,
      maxAmmo: number,
      isReloading: boolean,
      elapsed: number,
    ) {
      const frac = maxAmmo > 0 ? THREE.MathUtils.clamp(ammo / maxAmmo, 0, 1) : 0;
      const isEmpty = ammo === 0;
      const isLow = frac <= 0.28;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 13.0);

      if (isReloading) {
        // Arcade neon swirl strictly on the BACK of the pistol slide while reloading!
        for (let i = 0; i < rearLedMats.length; i++) {
          const m = rearLedMats[i];
          const hue = (elapsed * 1.65 - i * 0.24 + 10) % 1.0;
          const chase = 0.5 + 0.5 * Math.sin(elapsed * 16.0 - i * 1.45);
          m.emissive.setHSL(hue, 1.0, 0.52);
          m.color.setHSL(hue, 0.92, 0.76);
          m.emissiveIntensity = 1.9 + chase * 2.8;
        }
        return;
      }

      // Smooth ammo-drain spectrum: Green (0.36) -> Yellow (0.145) -> Red (0.0)
      const ammoHue =
        frac >= 0.5
          ? THREE.MathUtils.lerp(0.145, 0.36, (frac - 0.5) * 2.0)
          : THREE.MathUtils.lerp(0.0, 0.145, frac * 2.0);
      for (let i = 0; i < rearLedMats.length; i++) {
        const m = rearLedMats[i];
        m.emissive.setHSL(ammoHue, 1.0, 0.50);
        m.color.setHSL(ammoHue, 0.92, 0.74);
        m.emissiveIntensity = isEmpty
          ? 1.1 + pulse * 3.1
          : isLow
            ? 2.2 + pulse * 2.0
            : 3.1;
      }
    },
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
