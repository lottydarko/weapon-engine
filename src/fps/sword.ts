import * as THREE from 'three';
import { createGunmetalTexture, createPolymerStippleTextures } from './textures';

export interface TacticalSwordRig {
  root: THREE.Group;
  bladeGroup: THREE.Group;
  tipAnchor: THREE.Object3D;
  /** Controls the dynamic additive steel motion-arc trail during fast slashes (0..1) */
  setSlashTrail: (intensity: number) => void;
  dispose: () => void;
}

/**
 * Builds a photorealistically textured modern tactical carbon-steel katana
 * with curved shinogi-zukuri beveled blade, mirror-honed cutting edge, dark fuller,
 * machined titanium habaki collar, sculpted tactical tsuba guard with subtle orange inlay,
 * diamond-wrapped black leather tsuka hilt, and dynamic slash motion trail.
 *
 * Coordinate convention: hilt centered around origin (right hand at y≈-0.055, left hand at y≈-0.145),
 * blade extends upward (+Y) and gently curved toward (-Z) with razor edge facing forward (-Z).
 */
export function buildTacticalSword(maxAnisotropy: number): TacticalSwordRig {
  const root = new THREE.Group();
  root.name = 'TacticalKatana';

  const gunmetal = createGunmetalTexture(maxAnisotropy);
  const stipple = createPolymerStippleTextures(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [gunmetal, stipple];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Brushed dark Damascus / forged carbon-steel blade spine
  const bladeSpineMat = new THREE.MeshPhysicalMaterial({
    color: 0xb8c2ce,
    map: gunmetal.barrelMap,
    normalMap: gunmetal.barrelNormalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: gunmetal.roughnessMap,
    metalness: 0.96,
    roughness: 0.18,
    anisotropy: 0.85,
    clearcoat: 0.35,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.75,
  });

  // Razor-honed mirror steel cutting edge (hamon highlight)
  const bladeEdgeMat = new THREE.MeshPhysicalMaterial({
    color: 0xeef4fa,
    metalness: 0.99,
    roughness: 0.08,
    anisotropy: 0.9,
    clearcoat: 0.5,
    clearcoatRoughness: 0.08,
    envMapIntensity: 2.0,
  });

  // Matte black CNC carbon guard & pommel fittings
  const guardMat = new THREE.MeshPhysicalMaterial({
    color: 0x161920,
    map: gunmetal.map,
    normalMap: gunmetal.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: gunmetal.roughnessMap,
    metalness: 0.72,
    roughness: 0.36,
    clearcoat: 0.25,
    envMapIntensity: 1.3,
  });

  // Subtle brushed titanium habaki blade collar
  const collarMat = new THREE.MeshPhysicalMaterial({
    color: 0x8e96a2,
    metalness: 0.92,
    roughness: 0.26,
    anisotropy: 0.65,
  });

  // Tactile dark leather diamond-wrap grip (tsuka-ito)
  const wrapMat = new THREE.MeshStandardMaterial({
    color: 0x1b1e23,
    map: stipple.map,
    normalMap: stipple.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: stipple.roughnessMap,
    metalness: 0.06,
    roughness: 0.82,
  });

  // Subtle anodized safety-orange tactical micro-inlay on guard & pommel
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: 0xff5a10,
    metalness: 0.62,
    roughness: 0.28,
    clearcoat: 0.45,
  });

  // Sleek additive motion-blur slash ribbon attached behind blade edge
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xdceeff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  disposables.push(
    bladeSpineMat,
    bladeEdgeMat,
    guardMat,
    collarMat,
    wrapMat,
    accentMat,
    trailMat,
  );

  const bladeGroup = new THREE.Group();
  root.add(bladeGroup);

  // =========================================================================
  // 1. SCULPTED CURVED BEVELED KATANA BLADE (Lofted diamond cross-section!)
  //    Length ~0.78m from guard (y=0.02) to razor kissaki tip (y=0.80)
  // =========================================================================
  const segs = 28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 6-vertex cross-section per station:
  // 0: back spine center, 1: right ridge (shinogi), 2: razor front edge, 3: left ridge (shinogi)
  // Duplicate ring vertices cleanly for sharp crisp specular bevel facets!
  const ringPts = 5; // closed loop: spine -> right ridge -> edge -> left ridge -> spine
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = 0.018 + t * 0.785;
    // Authentic katana sori curvature (curves gracefully rearward +Z toward the tip)
    const curveZ = t * t * 0.044;

    // Taper smoothly toward kissaki tip in last 14%
    let width = THREE.MathUtils.lerp(0.031, 0.023, t);
    let halfThick = THREE.MathUtils.lerp(0.0044, 0.0024, t);
    if (t > 0.86) {
      const tipT = (t - 0.86) / 0.14;
      const taper = Math.pow(1 - tipT, 0.72);
      width *= Math.max(0.02, taper);
      halfThick *= Math.max(0.05, taper);
    }

    const zSpine = curveZ + width * 0.42;
    const zRidge = curveZ + width * 0.12;
    const zEdge = curveZ - width * 0.58;

    const ring: Array<[number, number, number, number]> = [
      [0, y, zSpine, 0.0],
      [halfThick, y, zRidge, 0.25],
      [0, y, zEdge, 0.5],
      [-halfThick, y, zRidge, 0.75],
      [0, y, zSpine, 1.0],
    ];

    for (let j = 0; j < ringPts; j++) {
      positions.push(ring[j][0], ring[j][1], ring[j][2]);
      uvs.push(ring[j][3], t * 5.0);
    }
  }

  for (let i = 0; i < segs; i++) {
    const rowA = i * ringPts;
    const rowB = (i + 1) * ringPts;
    for (let j = 0; j < ringPts - 1; j++) {
      const a = rowA + j;
      const b = rowB + j;
      const c = rowB + j + 1;
      const d = rowA + j + 1;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const bladeGeo = trackGeo(new THREE.BufferGeometry());
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bladeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bladeGeo.setIndex(indices);
  bladeGeo.computeVertexNormals();

  const bladeMesh = new THREE.Mesh(bladeGeo, bladeSpineMat);
  bladeMesh.castShadow = true;
  bladeMesh.receiveShadow = true;
  bladeGroup.add(bladeMesh);

  // Polished mirror-steel cutting edge highlight strip (hamon glint!)
  const edgePositions: number[] = [];
  const edgeIndices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = 0.022 + t * 0.778;
    const curveZ = t * t * 0.044;
    let width = THREE.MathUtils.lerp(0.031, 0.023, t);
    let halfThick = THREE.MathUtils.lerp(0.0021, 0.0011, t);
    if (t > 0.86) {
      const tipT = (t - 0.86) / 0.14;
      const taper = Math.pow(1 - tipT, 0.72);
      width *= Math.max(0.02, taper);
      halfThick *= Math.max(0.05, taper);
    }
    const zBack = curveZ - width * 0.30;
    const zEdge = curveZ - width * 0.59;
    edgePositions.push(halfThick, y, zBack);
    edgePositions.push(0, y, zEdge);
    edgePositions.push(-halfThick, y, zBack);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    edgeIndices.push(a, b, a + 1, b, b + 1, a + 1);
    edgeIndices.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
  }
  const edgeGeo = trackGeo(new THREE.BufferGeometry());
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  edgeGeo.setIndex(edgeIndices);
  edgeGeo.computeVertexNormals();
  bladeGroup.add(new THREE.Mesh(edgeGeo, bladeEdgeMat));

  // Sleek motion-blur slash ribbon trailing behind the cutting edge
  const trailPos: number[] = [];
  const trailIdx: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const y = 0.12 + t * 0.68;
    const curveZ = t * t * 0.044;
    const zEdge = curveZ - 0.018;
    const trailW = Math.sin(t * Math.PI) * 0.11 + t * 0.06;
    trailPos.push(0, y, zEdge);
    trailPos.push(0, y, zEdge + trailW);
  }
  for (let i = 0; i < 16; i++) {
    const a = i * 2;
    const b = (i + 1) * 2;
    trailIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const trailGeo = trackGeo(new THREE.BufferGeometry());
  trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trailPos, 3));
  trailGeo.setIndex(trailIdx);
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  trailMesh.visible = false;
  bladeGroup.add(trailMesh);

  // =========================================================================
  // 2. MACHINED HABAKI COLLAR, SCULPTED TSUBA GUARD & DIAMOND-WRAPPED HILT
  // =========================================================================
  const habaki = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.0135, 0.026, 0.036)),
    collarMat,
  );
  habaki.position.set(0, 0.016, -0.002);
  habaki.castShadow = true;
  bladeGroup.add(habaki);

  // Sculpted chamfered octagonal tactical tsuba handguard
  const tsubaShape = new THREE.Shape();
  const tw = 0.030;
  const td = 0.042;
  tsubaShape.moveTo(-tw + 0.009, -td);
  tsubaShape.lineTo(tw - 0.009, -td);
  tsubaShape.lineTo(tw, -td + 0.012);
  tsubaShape.lineTo(tw, td - 0.012);
  tsubaShape.lineTo(tw - 0.009, td);
  tsubaShape.lineTo(-tw + 0.009, td);
  tsubaShape.lineTo(-tw, td - 0.012);
  tsubaShape.lineTo(-tw, -td + 0.012);
  tsubaShape.closePath();

  const tsubaGeo = trackGeo(
    new THREE.ExtrudeGeometry(tsubaShape, {
      depth: 0.0068,
      bevelEnabled: true,
      bevelThickness: 0.0014,
      bevelSize: 0.0012,
      bevelSegments: 2,
    }),
  );
  tsubaGeo.rotateX(Math.PI / 2);
  const tsuba = new THREE.Mesh(tsubaGeo, guardMat);
  tsuba.position.set(0, 0.004, 0);
  tsuba.castShadow = true;
  bladeGroup.add(tsuba);

  // Thin tactical orange trim ring tucked neatly beneath guard
  const seppaRing = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.023, 0.0032, 0.036)),
    accentMat,
  );
  seppaRing.position.set(0, -0.0055, 0);
  bladeGroup.add(seppaRing);

  // Oval ergonomic wrapped katana hilt (tsuka: y ∈ [-0.245, -0.006])
  const hiltCoreGeo = trackGeo(new THREE.CylinderGeometry(0.0138, 0.0146, 0.238, 18));
  hiltCoreGeo.scale(0.84, 1.0, 1.24);
  const hiltCore = new THREE.Mesh(hiltCoreGeo, wrapMat);
  hiltCore.position.set(0, -0.125, 0.002);
  hiltCore.castShadow = true;
  hiltCore.receiveShadow = true;
  bladeGroup.add(hiltCore);

  // Sculpted diagonal tsuka-ito leather wrap ridges down the hilt
  const wrapBandGeo = trackGeo(new THREE.TorusGeometry(0.0154, 0.0024, 6, 16));
  wrapBandGeo.scale(0.82, 1.24, 1.0);
  wrapBandGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 11; i++) {
    const band = new THREE.Mesh(wrapBandGeo, guardMat);
    band.position.set(0, -0.018 - i * 0.020, 0.002);
    band.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.18;
    bladeGroup.add(band);
  }

  // Machined metallic kashira pommel cap at hilt base
  const pommelGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.0135, 0.018, 18));
  pommelGeo.scale(0.86, 1.0, 1.26);
  const pommel = new THREE.Mesh(pommelGeo, guardMat);
  pommel.position.set(0, -0.250, 0.003);
  bladeGroup.add(pommel);

  const pommelInlay = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.008, 0.003, 0.026)),
    accentMat,
  );
  pommelInlay.position.set(0, -0.260, 0.003);
  bladeGroup.add(pommelInlay);

  const tipAnchor = new THREE.Object3D();
  tipAnchor.position.set(0, 0.79, 0.02);
  bladeGroup.add(tipAnchor);

  return {
    root,
    bladeGroup,
    tipAnchor,
    setSlashTrail(intensity: number) {
      const v = THREE.MathUtils.clamp(intensity, 0, 1);
      if (v <= 0.02) {
        trailMesh.visible = false;
        trailMat.opacity = 0;
        return;
      }
      trailMesh.visible = true;
      trailMat.opacity = v * 0.42;
    },
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
