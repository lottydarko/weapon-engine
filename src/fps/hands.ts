import * as THREE from 'three';
import {
  createBlackLeatherGloveTextures,
  createBlackLeatherJacketTextures,
  createSkinTextures,
  SKIN_PALETTES,
  type LeatherGloveTextureSet,
  type LeatherJacketTextureSet,
  type SkinTextureSet,
  type SkinToneId,
} from './textures';

export interface FingerJoints {
  mcp: THREE.Group;
  pip: THREE.Group;
  dip: THREE.Group;
}

export type HandStance =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'sword'
  | 'flashlight'
  | 'unarmed';

export type DrinkHandPhase = 'reach' | 'hold' | 'swig' | 'tossWindup' | 'tossFlick';

export type ReloadHandPhase = 'magGrip' | 'overhandPinch' | 'shellFeed';

export interface RealisticHandsRig {
  root: THREE.Group;
  rightHandGroup: THREE.Group;
  leftHandGroup: THREE.Group;
  /** Exact socket nested inside the cupped left leather palm so drinks & items lock 100% into the hand */
  leftPalmSocket: THREE.Group;
  rightIndex: FingerJoints;
  /** Subtle playful weapon roll/pitch impulse driven by idle hand fidgets (zero GC) */
  fidgetWeaponRoll: number;
  fidgetWeaponPitch: number;
  setStance: (stance: HandStance) => void;
  getLeftHandRestPose: (outPos: THREE.Vector3, outQuat: THREE.Quaternion) => void;
  getRightHandRestPose: (outPos: THREE.Vector3, outQuat: THREE.Quaternion) => void;
  /** Returns anatomically verified right-side-up left-hand quaternion for mag swap, overhand slide/bolt pinch, or shotgun shell feed */
  getReloadHandQuat: (phase: ReloadHandPhase, outQuat: THREE.Quaternion) => void;
  /** Returns anatomically calibrated left-hand poses in weaponPivot space for reach, hold, swig behind camera, and toss */
  getDrinkHandPose: (
    phase: DrinkHandPhase,
    outPos: THREE.Vector3,
    outQuat: THREE.Quaternion,
  ) => void;
  /** Dynamically bends the left articulated elbow joint during drinking, reaching, sword slashes, or tossing */
  setLeftElbowPose: (rx: number, ry: number, rz: number) => void;
  /** Restores the left articulated elbow joint back to the active weapon stance bend */
  resetLeftElbowPose: () => void;
  /** Dynamically bends the right articulated elbow joint during sword slashes & swings */
  setRightElbowPose: (rx: number, ry: number, rz: number) => void;
  /** Restores the right articulated elbow joint back to the active weapon stance bend */
  resetRightElbowPose: () => void;
  setTriggerFingerCurl: (pull: number) => void;
  /** Smoothly blends left fingers from grip (0) to open/slide-pinch (1) during reload */
  setLeftHandReloadPose: (openBlend: number, slidePinchBlend: number) => void;
  /** Opens left hand wide on reach (reach01) then wraps fingers snugly around a 66mm drink can / item (grab01) */
  setPickupHandPose: (reach01: number, grab01: number) => void;
  /** Presses right thumb down onto the top rubber switch of the plain flashlight */
  setFlashlightThumbPress: (press01: number) => void;
  /** Drives organic living knuckle flex, recoil clench, and very active idle finger/thumb motion */
  updateAliveMotion: (
    dt: number,
    elapsed: number,
    recoilClench: number,
    adsBlend: number,
    isReloading: boolean,
    triggerPull: number,
    moveActivity?: number,
  ) => void;
  dispose: () => void;
}

interface LoftStation {
  pos: THREE.Vector3;
  rx: number;
  ry: number;
  deform?: (theta: number) => { dx: number; dy: number };
}

/**
 * Generates a high-resolution, organically lofted BufferGeometry along a sequence
 * of anatomical cross-section stations with smooth outward normals & UVs.
 */
function createAnatomicalLoft(
  stations: LoftStation[],
  radialSegments = 26,
  capStart = true,
  capEnd = true,
  uvScaleV = 4.0,
): THREE.BufferGeometry {
  const numStations = stations.length;
  const ringStride = radialSegments + 1;

  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < numStations; i++) {
    const prev = stations[Math.max(0, i - 1)].pos;
    const next = stations[Math.min(numStations - 1, i + 1)].pos;
    const t = new THREE.Vector3().subVectors(next, prev).normalize();
    tangents.push(t);
  }

  const rights: THREE.Vector3[] = [];
  const ups: THREE.Vector3[] = [];
  const refUp = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tangents[0].dot(refUp)) > 0.92) {
    refUp.set(0, 0, 1);
  }
  const r0 = new THREE.Vector3().crossVectors(refUp, tangents[0]).normalize();
  const u0 = new THREE.Vector3().crossVectors(tangents[0], r0).normalize();
  rights.push(r0);
  ups.push(u0);

  for (let i = 1; i < numStations; i++) {
    const prevT = tangents[i - 1];
    const currT = tangents[i];
    const q = new THREE.Quaternion().setFromUnitVectors(prevT, currT);
    const r = rights[i - 1].clone().applyQuaternion(q).normalize();
    const u = new THREE.Vector3().crossVectors(currT, r).normalize();
    rights.push(r);
    ups.push(u);
  }

  const arcLengths: number[] = [0];
  for (let i = 1; i < numStations; i++) {
    arcLengths.push(
      arcLengths[i - 1] + stations[i].pos.distanceTo(stations[i - 1].pos),
    );
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s < numStations; s++) {
    const st = stations[s];
    const right = rights[s];
    const up = ups[s];
    const vCoord = arcLengths[s] * uvScaleV;

    for (let j = 0; j <= radialSegments; j++) {
      const uFrac = j / radialSegments;
      const theta = uFrac * Math.PI * 2;
      let lx = Math.cos(theta) * st.rx;
      let ly = Math.sin(theta) * st.ry;

      if (st.deform) {
        const d = st.deform(theta);
        lx += d.dx;
        ly += d.dy;
      }

      const vx = st.pos.x + right.x * lx + up.x * ly;
      const vy = st.pos.y + right.y * lx + up.y * ly;
      const vz = st.pos.z + right.z * lx + up.z * ly;

      positions.push(vx, vy, vz);
      uvs.push(uFrac * 1.4, vCoord);
    }
  }

  for (let s = 0; s < numStations - 1; s++) {
    const rowA = s * ringStride;
    const rowB = (s + 1) * ringStride;
    for (let j = 0; j < radialSegments; j++) {
      const a = rowA + j;
      const b = rowB + j;
      const c = rowB + j + 1;
      const d = rowA + j + 1;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  if (capStart) {
    const startCenterIdx = positions.length / 3;
    const st0 = stations[0];
    const capPos = st0.pos
      .clone()
      .addScaledVector(tangents[0], -Math.min(st0.rx, st0.ry) * 0.45);
    positions.push(capPos.x, capPos.y, capPos.z);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegments; j++) {
      indices.push(startCenterIdx, j + 1, j);
    }
  }

  if (capEnd) {
    const lastRow = (numStations - 1) * ringStride;
    const endCenterIdx = positions.length / 3;
    const stEnd = stations[numStations - 1];
    const capPos = stEnd.pos
      .clone()
      .addScaledVector(
        tangents[numStations - 1],
        Math.min(stEnd.rx, stEnd.ry) * 0.52,
      );
    positions.push(capPos.x, capPos.y, capPos.z);
    uvs.push(0.5, arcLengths[numStations - 1] * uvScaleV);
    for (let j = 0; j < radialSegments; j++) {
      indices.push(endCenterIdx, lastRow + j, lastRow + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface HandBuildContext {
  skinMat: THREE.MeshPhysicalMaterial;
  leatherMat: THREE.MeshPhysicalMaterial;
  armorMat: THREE.MeshPhysicalMaterial;
  cuffMat: THREE.MeshStandardMaterial;
  padMat: THREE.MeshPhysicalMaterial;
  sleeveMat: THREE.MeshPhysicalMaterial;
  jacketHardwareMat: THREE.MeshStandardMaterial;
  jacketLiningMat: THREE.MeshStandardMaterial;
  watchCaseMat: THREE.MeshStandardMaterial;
  watchStrapMat: THREE.MeshStandardMaterial;
  watchDialMat: THREE.MeshStandardMaterial;
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T;
}

/**
 * Adds a per-vertex `aWindWeight` attribute (0 = anchored seam, 1 = loose wind-blown leather)
 * so the GPU black leather jacket wind shader ripples loose sleeve & cuff folds with zero seam cracks.
 */
function applyWindWeightAttribute(
  geo: THREE.BufferGeometry,
  weightFn: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const weights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    weights[i] = THREE.MathUtils.clamp(
      weightFn(pos.getX(i), pos.getY(i), pos.getZ(i)),
      0,
      1,
    );
  }
  geo.setAttribute('aWindWeight', new THREE.BufferAttribute(weights, 1));
  return geo;
}

/**
 * Builds an anatomically sculpted black leather-gloved finger phalanx with
 * pebbled normal mapping, molded dorsal flex bumper ribs, and stitched grip fingertips.
 */
function createSculptedPhalanxMesh(
  length: number,
  baseRadiusX: number,
  baseRadiusY: number,
  tipRadiusX: number,
  tipRadiusY: number,
  isDistalTip: boolean,
  addBumperRibs: boolean,
  ctx: HandBuildContext,
): THREE.Group {
  const group = new THREE.Group();
  const stations: LoftStation[] = [];
  const steps = isDistalTip ? 10 : 7;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = t * length;

    let jointBulge = 1.0;
    if (!isDistalTip) {
      const midPinch = Math.sin(t * Math.PI);
      jointBulge = 1.05 - midPinch * 0.09;
    } else if (t > 0.72) {
      const capT = (t - 0.72) / 0.28;
      jointBulge = Math.sqrt(Math.max(0.08, 1 - capT * capT * 0.86));
    } else {
      jointBulge = 1.04 - Math.sin((t / 0.72) * Math.PI) * 0.05;
    }

    const rx = THREE.MathUtils.lerp(baseRadiusX, tipRadiusX, t) * jointBulge;
    const ry = THREE.MathUtils.lerp(baseRadiusY, tipRadiusY, t) * jointBulge;

    stations.push({
      pos: new THREE.Vector3(0, 0, z),
      rx,
      ry,
      deform: (theta) => {
        const s = Math.sin(theta);
        let dy = 0;
        if (s < 0) {
          const padBell = Math.sin(t * Math.PI);
          dy -= Math.abs(s) * ry * (isDistalTip ? 0.24 : 0.14) * padBell;
        }
        return { dx: 0, dy };
      },
    });
  }

  const phalanxGeo = ctx.trackGeo(
    createAnatomicalLoft(stations, 20, true, true, 8.5),
  );
  const phalanxMesh = new THREE.Mesh(phalanxGeo, ctx.leatherMat);
  phalanxMesh.castShadow = true;
  phalanxMesh.receiveShadow = true;
  group.add(phalanxMesh);

  // Seamless thick leather knuckle joint sphere so tightly curled fingers never split open
  const jointCapGeo = ctx.trackGeo(
    new THREE.SphereGeometry(baseRadiusX * 1.01, 16, 12),
  );
  jointCapGeo.scale(1.0, baseRadiusY / baseRadiusX, 0.98);
  const jointCap = new THREE.Mesh(jointCapGeo, ctx.leatherMat);
  jointCap.castShadow = true;
  jointCap.receiveShadow = true;
  group.add(jointCap);

  // Molded matte-black TPR leather-ribbed dorsal impact bumpers
  if (addBumperRibs) {
    const ribW = (baseRadiusX + tipRadiusX) * 0.78;
    const ribGeo = ctx.trackGeo(
      new THREE.CapsuleGeometry(0.0021, ribW * 0.74, 4, 10),
    );
    ribGeo.rotateZ(Math.PI / 2);

    const numRibs = length > 0.03 ? 3 : 2;
    for (let r = 0; r < numRibs; r++) {
      const frac = 0.28 + (r / Math.max(1, numRibs - 1)) * 0.44;
      const ribY = THREE.MathUtils.lerp(baseRadiusY, tipRadiusY, frac) * 0.94;
      const rib = new THREE.Mesh(ribGeo, ctx.armorMat);
      rib.position.set(0, ribY, length * frac);
      rib.scale.set(1.0, 0.78, 1.08);
      rib.castShadow = true;
      group.add(rib);
    }
  }

  // Reinforced tactical leather-suede fingertip grip overlay
  if (isDistalTip) {
    const tipCapGeo = ctx.trackGeo(
      new THREE.SphereGeometry(
        tipRadiusX * 1.025,
        16,
        12,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.62,
      ),
    );
    tipCapGeo.rotateX(Math.PI / 2);
    tipCapGeo.scale(1.0, tipRadiusY / tipRadiusX, 1.14);
    const tipCap = new THREE.Mesh(tipCapGeo, ctx.padMat);
    tipCap.position.set(0, -tipRadiusY * 0.06, length * 0.66);
    group.add(tipCap);
  }

  return group;
}

function createArticulatedFinger(
  lengths: [number, number, number],
  baseRadiusX: number,
  baseRadiusY: number,
  ctx: HandBuildContext,
  isThumb = false,
): FingerJoints {
  const [l1, l2, l3] = lengths;

  const mcp = new THREE.Group();
  const prox = createSculptedPhalanxMesh(
    l1,
    baseRadiusX,
    baseRadiusY,
    baseRadiusX * 0.92,
    baseRadiusY * 0.91,
    false,
    true,
    ctx,
  );
  mcp.add(prox);

  const pip = new THREE.Group();
  pip.position.set(0, 0, l1);
  mcp.add(pip);

  if (isThumb) {
    const distal = createSculptedPhalanxMesh(
      l2,
      baseRadiusX * 0.91,
      baseRadiusY * 0.89,
      baseRadiusX * 0.84,
      baseRadiusY * 0.76,
      true,
      false,
      ctx,
    );
    pip.add(distal);
    const dip = new THREE.Group();
    dip.position.set(0, 0, l2);
    pip.add(dip);
    return { mcp, pip, dip };
  }

  const mid = createSculptedPhalanxMesh(
    l2,
    baseRadiusX * 0.91,
    baseRadiusY * 0.90,
    baseRadiusX * 0.84,
    baseRadiusY * 0.83,
    false,
    true,
    ctx,
  );
  pip.add(mid);

  const dip = new THREE.Group();
  dip.position.set(0, 0, l2);
  pip.add(dip);

  const dist = createSculptedPhalanxMesh(
    l3,
    baseRadiusX * 0.83,
    baseRadiusY * 0.82,
    baseRadiusX * 0.76,
    baseRadiusY * 0.70,
    true,
    false,
    ctx,
  );
  dip.add(dist);

  return { mcp, pip, dip };
}

/**
 * Builds one anatomically sculpted forearm (real pored skin + rolled tactical cuff + watch)
 * seamlessly fitted into a dusted full-grain BLACK LEATHER combat glove with molded knuckle shell.
 */
function buildSingleHumanHand(side: 'right' | 'left', ctx: HandBuildContext) {
  const s = side === 'right' ? 1 : -1;
  const handGroup = new THREE.Group();
  handGroup.name = `${side}LeatherGlovedHand`;

  // 1. Exposed realistic forearm skin (from rolled sleeve cuff down into glove wrist)
  const forearmStations: LoftStation[] = [];
  const forearmSteps = 14;
  for (let i = 0; i <= forearmSteps; i++) {
    const t = i / forearmSteps;
    const z = THREE.MathUtils.lerp(-0.175, -0.012, t);
    const muscleBell = Math.sin(Math.pow(1 - t, 0.85) * Math.PI * 0.82);
    const rx = THREE.MathUtils.lerp(0.0415, 0.0285, t) + muscleBell * 0.0048;
    const ry = THREE.MathUtils.lerp(0.0375, 0.0215, t) + muscleBell * 0.0028;
    const yOffset = -0.0025 * (1 - t);
    const xOffset = -s * 0.002 * (1 - t);
    const wristProx = Math.exp(-Math.pow((t - 0.94) / 0.1, 2));

    forearmStations.push({
      pos: new THREE.Vector3(xOffset, yOffset, z),
      rx,
      ry,
      deform: (theta) => {
        const radialSide = Math.cos(theta) * s;
        const sy = Math.sin(theta);
        let dx = 0;
        let dy = 0;
        if (wristProx > 0.05 && radialSide < -0.2 && sy > 0) {
          const bump = wristProx * Math.abs(radialSide) * sy;
          dx -= s * bump * 0.0028;
          dy += bump * 0.0024;
        }
        return { dx, dy };
      },
    });
  }

  const forearmGeo = ctx.trackGeo(
    createAnatomicalLoft(forearmStations, 28, true, true, 4.5),
  );
  const forearmMesh = new THREE.Mesh(forearmGeo, ctx.skinMat);
  forearmMesh.castShadow = true;
  forearmMesh.receiveShadow = true;
  handGroup.add(forearmMesh);

  // 2. Heavy padded full-grain black leather gloved palm & metacarpus
  const palmStations: LoftStation[] = [];
  const palmSteps = 16;
  for (let i = 0; i <= palmSteps; i++) {
    const t = i / palmSteps;
    const z = THREE.MathUtils.lerp(-0.018, 0.086, t);
    const palmT = Math.max(0, (t - 0.15) / 0.85);
    const widthCurve = Math.pow(Math.sin(palmT * Math.PI * 0.55), 0.70);
    let rx = THREE.MathUtils.lerp(0.0325, 0.0480, widthCurve);
    if (palmT > 0.84) {
      const endT = (palmT - 0.84) / 0.16;
      rx *= 1 - endT * 0.07;
    }
    const ry = THREE.MathUtils.lerp(0.0258, 0.0205, palmT);
    const yOffset = Math.sin(palmT * Math.PI) * 0.0028;
    const xOffset = s * palmT * 0.0018;

    palmStations.push({
      pos: new THREE.Vector3(xOffset, yOffset, z),
      rx,
      ry,
      deform: (theta) => {
        const cx = Math.cos(theta);
        const sy = Math.sin(theta);
        const radialSide = cx * s;
        let dx = 0;
        let dy = 0;

        if (palmT > 0) {
          const thenarZone = Math.exp(-Math.pow((palmT - 0.36) / 0.28, 2));
          if (radialSide > 0.05 && sy < 0.25) {
            const w =
              thenarZone * Math.pow(radialSide, 0.9) * Math.max(0, 0.25 - sy);
            dx += s * w * 0.0092;
            dy -= w * 0.011;
          }
          const hypoZone = Math.exp(-Math.pow((palmT - 0.44) / 0.32, 2));
          if (radialSide < -0.15 && sy < 0.1) {
            const w =
              hypoZone * Math.pow(-radialSide, 1.1) * Math.max(0, 0.1 - sy);
            dy -= w * 0.0068;
          }
          if (sy < -0.25 && Math.abs(radialSide) < 0.65) {
            const hollow =
              Math.sin(palmT * Math.PI) *
              (1 - Math.abs(radialSide) / 0.65) *
              Math.abs(sy);
            // Flatten & cup inner palm surface slightly so thick leather wraps flush without clipping grip
            dy += hollow * 0.0068;
          }
          if (sy > 0.2) {
            const knuckleWave = Math.cos(radialSide * Math.PI * 3.6) * 0.5 + 0.5;
            const tendonRidge = Math.sin(palmT * Math.PI) * 0.0015 * knuckleWave;
            const knuckleDome =
              Math.exp(-Math.pow((palmT - 0.91) / 0.11, 2)) *
              0.0038 *
              knuckleWave;
            dy += sy * (tendonRidge + knuckleDome);
          }
        }
        return { dx, dy };
      },
    });
  }

  const palmGeo = ctx.trackGeo(
    createAnatomicalLoft(palmStations, 30, true, true, 7.2),
  );
  const palmMesh = new THREE.Mesh(palmGeo, ctx.leatherMat);
  palmMesh.castShadow = true;
  palmMesh.receiveShadow = true;
  handGroup.add(palmMesh);

  // =========================================================================
  // HEAVY MOLDED BLACK CARBON-LEATHER KNUCKLE SHELL, PADDED DORSAL PANELS & CUFF
  // =========================================================================
  const knuckleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(s * 0.035, 0.0185, 0.076),
    new THREE.Vector3(s * 0.013, 0.0235, 0.080),
    new THREE.Vector3(-s * 0.011, 0.0225, 0.077),
    new THREE.Vector3(-s * 0.032, 0.0165, 0.070),
  ]);
  const shellGeo = ctx.trackGeo(
    new THREE.TubeGeometry(knuckleCurve, 22, 0.0112, 14, false),
  );
  shellGeo.scale(1.0, 0.62, 1.36);
  const shellMesh = new THREE.Mesh(shellGeo, ctx.armorMat);
  shellMesh.position.set(0, 0.0092, -0.024);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  handGroup.add(shellMesh);

  const domePositions: Array<[number, number, number, number]> = [
    [s * 0.0278, 0.0205, 0.078, 0.0108],
    [s * 0.0092, 0.0224, 0.081, 0.0115],
    [-s * 0.0092, 0.0214, 0.077, 0.0108],
    [-s * 0.0265, 0.0184, 0.071, 0.0094],
  ];
  const knuckleDomes: THREE.Mesh[] = [];
  const knuckleBaseY: number[] = [];
  for (const [kx, ky, kz, rad] of domePositions) {
    const domeGeo = ctx.trackGeo(new THREE.SphereGeometry(rad, 16, 12));
    domeGeo.scale(1.12, 0.60, 1.22);
    const dome = new THREE.Mesh(domeGeo, ctx.armorMat);
    dome.position.set(kx, ky, kz);
    dome.castShadow = true;
    dome.receiveShadow = true;
    handGroup.add(dome);
    knuckleDomes.push(dome);
    knuckleBaseY.push(ky);
  }

  // Contoured thick black leather dorsal reinforcement patch
  const dorsalPadGeo = ctx.trackGeo(new THREE.BoxGeometry(0.062, 0.0056, 0.038));
  const dorsalPad = new THREE.Mesh(dorsalPadGeo, ctx.padMat);
  dorsalPad.position.set(s * 0.002, 0.0212, 0.042);
  dorsalPad.rotation.x = 0.08;
  dorsalPad.castShadow = true;
  handGroup.add(dorsalPad);

  // Heavy Molded Neoprene + Black Leather Velcro Wrist Closure Cuff
  const cuffStations: LoftStation[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const z = THREE.MathUtils.lerp(-0.028, 0.010, t);
    const lip = i === 0 || i === 6 ? 0.0018 : 0.0032;
    cuffStations.push({
      pos: new THREE.Vector3(0, 0, z),
      rx: THREE.MathUtils.lerp(0.0338, 0.0365, t) + lip,
      ry: THREE.MathUtils.lerp(0.0258, 0.0274, t) + lip,
    });
  }
  const cuffGeo = ctx.trackGeo(
    createAnatomicalLoft(cuffStations, 26, true, true, 4.5),
  );
  const cuffMesh = new THREE.Mesh(cuffGeo, ctx.cuffMat);
  cuffMesh.castShadow = true;
  cuffMesh.receiveShadow = true;
  handGroup.add(cuffMesh);

  // Molded tactical Velcro closure cinch tab across wrist cuff
  const velcroTab = new THREE.Mesh(
    ctx.trackGeo(new THREE.BoxGeometry(0.048, 0.0058, 0.021)),
    ctx.armorMat,
  );
  velcroTab.position.set(s * 0.004, 0.0282, -0.009);
  velcroTab.rotation.z = -s * 0.14;
  velcroTab.castShadow = true;
  handGroup.add(velcroTab);

  // Reinforced thick palm heel leather grip pad
  const palmGripGeo = ctx.trackGeo(new THREE.SphereGeometry(0.031, 16, 10));
  palmGripGeo.scale(1.22, 0.34, 1.38);
  const palmGrip = new THREE.Mesh(palmGripGeo, ctx.padMat);
  palmGrip.position.set(s * 0.004, -0.0212, 0.038);
  handGroup.add(palmGrip);

  // Articulated two-segment BLACK LEATHER MOTO JACKET sleeve (wind-reactive via GPU shader!):
  // 1) Sculpted, stacked-crease leather forearm sleeve (z = -0.455 .. -0.078) with a real hollow
  //    folded-inward leather cuff hem so the flared moto cuff catches light & billows in the wind!
  const forearmSleeveStations: LoftStation[] = [];
  const forearmSleeveSteps = 26;
  for (let i = 0; i <= forearmSleeveSteps; i++) {
    const t = i / forearmSleeveSteps;
    const z = THREE.MathUtils.lerp(-0.455, -0.078, t);

    // Relaxed moto leather stacking creases approaching the wrist cuff
    const stackWave =
      Math.sin(t * Math.PI * 10.5) * 0.0019 * Math.pow(t, 0.7) * Math.sin(t * Math.PI);
    const cuffFlare =
      t > 0.78 ? 0.0052 * Math.sin(((t - 0.78) / 0.22) * Math.PI * 0.85) : 0;
    const rx =
      THREE.MathUtils.lerp(0.059, 0.0472, Math.pow(t, 0.76)) +
      cuffFlare +
      stackWave;
    const ry =
      THREE.MathUtils.lerp(0.056, 0.0428, Math.pow(t, 0.76)) +
      cuffFlare +
      stackWave;
    // Slight natural heavy-leather gravity drape underneath (-Y)
    const drapeY = -0.0042 - Math.sin(t * Math.PI) * 0.0032;

    forearmSleeveStations.push({
      pos: new THREE.Vector3(-s * 0.0025 * (1 - t), drapeY, z),
      rx,
      ry,
      deform: (theta) => {
        const sy = Math.sin(theta);
        const crease = Math.cos(theta * 3 + t * 8.5) * 0.0016;
        // Slightly fuller heavy-leather drape along underside of sleeve
        const hang = sy < 0 ? -sy * 0.0030 * Math.sin(t * Math.PI) : 0;
        return {
          dx: Math.cos(theta) * crease,
          dy: sy * crease - hang,
        };
      },
    });
  }
  // Rolled thick cut-leather cuff lip turning cleanly inward into dark sleeve cavity (zero flat cap!)
  forearmSleeveStations.push(
    {
      pos: new THREE.Vector3(0, -0.0038, -0.0755),
      rx: 0.0475,
      ry: 0.0428,
    },
    {
      pos: new THREE.Vector3(0, -0.0032, -0.080),
      rx: 0.0432,
      ry: 0.0378,
    },
    {
      pos: new THREE.Vector3(0, -0.0022, -0.104),
      rx: 0.0398,
      ry: 0.0338,
    },
  );
  const forearmSleeveGeo = ctx.trackGeo(
    applyWindWeightAttribute(
      createAnatomicalLoft(forearmSleeveStations, 30, true, false, 4.6),
      (_x, y, z) => {
        const axial = THREE.MathUtils.smoothstep(z, -0.445, -0.095);
        const cuffBoost = THREE.MathUtils.smoothstep(z, -0.21, -0.078) * 0.42;
        const underBoost = 0.62 + 0.38 * THREE.MathUtils.smoothstep(0.035, -0.045, y);
        return (axial * 0.72 + cuffBoost) * underBoost;
      },
    ),
  );
  const forearmSleeveMesh = new THREE.Mesh(forearmSleeveGeo, ctx.sleeveMat);
  forearmSleeveMesh.castShadow = true;
  forearmSleeveMesh.receiveShadow = true;
  handGroup.add(forearmSleeveMesh);

  // Dark matte interior lining recess inside the open leather cuff (deepens hollow sleeve realism)
  const cuffLiningGeo = ctx.trackGeo(
    new THREE.CylinderGeometry(0.0415, 0.0395, 0.028, 24, 1, true),
  );
  cuffLiningGeo.rotateX(Math.PI / 2);
  cuffLiningGeo.scale(1.0, 0.87, 1.0);
  const cuffLiningMesh = new THREE.Mesh(cuffLiningGeo, ctx.jacketLiningMat);
  cuffLiningMesh.position.set(0, -0.0026, -0.092);
  handGroup.add(cuffLiningMesh);

  // Stitched heavy black leather moto cuff collar trim (baked into handGroup space so wind waves stay 100% phase-locked!)
  const sleeveCuffBandGeo = new THREE.TorusGeometry(0.0468, 0.0046, 10, 28);
  sleeveCuffBandGeo.scale(1.0, 0.90, 1.38);
  sleeveCuffBandGeo.translate(0, -0.0034, -0.084);
  ctx.trackGeo(
    applyWindWeightAttribute(sleeveCuffBandGeo, (_x, y, z) => {
      const axial = THREE.MathUtils.smoothstep(z, -0.445, -0.095);
      const cuffBoost = THREE.MathUtils.smoothstep(z, -0.21, -0.078) * 0.42;
      const underBoost = 0.62 + 0.38 * THREE.MathUtils.smoothstep(0.035, -0.045, y);
      return (axial * 0.72 + cuffBoost) * underBoost;
    }),
  );
  const sleeveCuffBand = new THREE.Mesh(sleeveCuffBandGeo, ctx.sleeveMat);
  sleeveCuffBand.castShadow = true;
  sleeveCuffBand.receiveShadow = true;
  handGroup.add(sleeveCuffBand);

  // Overlapping leather cuff cinch tab (baked into handGroup space for locked wind-wave phase!) + brushed gunmetal moto snap stud
  const cuffStrapGeo = new THREE.BoxGeometry(0.034, 0.0052, 0.0175);
  cuffStrapGeo.rotateZ(s * 0.54);
  cuffStrapGeo.translate(-s * 0.024, 0.0365, -0.092);
  ctx.trackGeo(
    applyWindWeightAttribute(cuffStrapGeo, (_x, y, z) => {
      const axial = THREE.MathUtils.smoothstep(z, -0.445, -0.095);
      const cuffBoost = THREE.MathUtils.smoothstep(z, -0.21, -0.078) * 0.42;
      const underBoost = 0.62 + 0.38 * THREE.MathUtils.smoothstep(0.035, -0.045, y);
      return (axial * 0.72 + cuffBoost) * underBoost * 0.75;
    }),
  );
  const cuffStrap = new THREE.Mesh(cuffStrapGeo, ctx.sleeveMat);
  cuffStrap.castShadow = true;
  handGroup.add(cuffStrap);

  const snapStud = new THREE.Mesh(
    ctx.trackGeo(new THREE.CylinderGeometry(0.0052, 0.0056, 0.0032, 16)),
    ctx.jacketHardwareMat,
  );
  snapStud.position.set(-s * 0.028, 0.0405, -0.092);
  snapStud.rotation.z = s * 0.54;
  snapStud.castShadow = true;
  handGroup.add(snapStud);

  // Outer-flank moto jacket forearm zipper track + slider + wind-dangling metal pull tab!
  const zipperTrack = new THREE.Mesh(
    ctx.trackGeo(new THREE.BoxGeometry(0.0042, 0.0068, 0.098)),
    ctx.jacketHardwareMat,
  );
  zipperTrack.position.set(-s * 0.0472, -0.0025, -0.132);
  zipperTrack.rotation.y = s * 0.04;
  zipperTrack.castShadow = true;
  handGroup.add(zipperTrack);

  const zipperSlider = new THREE.Mesh(
    ctx.trackGeo(new THREE.BoxGeometry(0.0064, 0.0086, 0.011)),
    ctx.jacketHardwareMat,
  );
  zipperSlider.position.set(-s * 0.0492, -0.0025, -0.092);
  zipperSlider.castShadow = true;
  handGroup.add(zipperSlider);

  // Articulated free-swinging gunmetal zipper pull tab driven by wind gusts & movement!
  const zipperPullPivot = new THREE.Group();
  zipperPullPivot.name = `${side}JacketZipperPull`;
  zipperPullPivot.position.set(-s * 0.052, -0.0035, -0.092);
  handGroup.add(zipperPullPivot);

  const pullRing = new THREE.Mesh(
    ctx.trackGeo(new THREE.TorusGeometry(0.0024, 0.00075, 6, 12)),
    ctx.jacketHardwareMat,
  );
  pullRing.rotation.y = Math.PI / 2;
  zipperPullPivot.add(pullRing);

  const pullTab = new THREE.Mesh(
    ctx.trackGeo(new THREE.BoxGeometry(0.0022, 0.0056, 0.0175)),
    ctx.jacketHardwareMat,
  );
  pullTab.position.set(-s * 0.0012, -0.0015, -0.010);
  pullTab.castShadow = true;
  zipperPullPivot.add(pullTab);

  // Seamless spherical black leather elbow cap positioned behind the camera plane
  const elbowJointCapGeo = ctx.trackGeo(
    applyWindWeightAttribute(new THREE.SphereGeometry(0.058, 20, 14), () => 0),
  );
  const elbowJointCap = new THREE.Mesh(elbowJointCapGeo, ctx.sleeveMat);
  elbowJointCap.position.set(-s * 0.0025, -0.0042, -0.455);
  elbowJointCap.castShadow = true;
  elbowJointCap.receiveShadow = true;
  handGroup.add(elbowJointCap);

  // Quilted dark moto leather elbow reinforcement pad behind camera plane
  const elbowPadGeo = ctx.trackGeo(new THREE.SphereGeometry(0.036, 14, 10));
  elbowPadGeo.scale(1.04, 0.62, 1.48);
  const elbowPad = new THREE.Mesh(elbowPadGeo, ctx.armorMat);
  elbowPad.position.set(-s * 0.002, 0.043, -0.458);
  elbowPad.castShadow = true;
  handGroup.add(elbowPad);

  // 2) Articulated Upper-Arm / Bicep-to-Shoulder Leather Jacket Sleeve
  const elbowPivot = new THREE.Group();
  elbowPivot.name = `${side}ElbowPivot`;
  elbowPivot.position.set(-s * 0.0025, -0.0042, -0.455);
  handGroup.add(elbowPivot);

  const upperArmStations: LoftStation[] = [];
  const upperArmSteps = 16;
  for (let i = 0; i <= upperArmSteps; i++) {
    const t = i / upperArmSteps;
    const z = THREE.MathUtils.lerp(-0.46, 0.022, t);
    const bicepBell = Math.sin(t * Math.PI) * 0.0085;
    const clothFold = Math.sin(t * Math.PI * 7) * 0.0020 * Math.sin(t * Math.PI);
    const rx = THREE.MathUtils.lerp(0.075, 0.056, Math.pow(t, 0.8)) + bicepBell + clothFold;
    const ry = THREE.MathUtils.lerp(0.071, 0.053, Math.pow(t, 0.8)) + bicepBell + clothFold;
    upperArmStations.push({
      pos: new THREE.Vector3(0, 0, z),
      rx,
      ry,
      deform: (theta) => {
        const crease = Math.cos(theta * 3 - t * 5) * 0.0015;
        return {
          dx: Math.cos(theta) * crease,
          dy: Math.sin(theta) * crease,
        };
      },
    });
  }
  const upperArmGeo = ctx.trackGeo(
    applyWindWeightAttribute(
      createAnatomicalLoft(upperArmStations, 24, true, true, 4.6),
      (_x, y, z) => {
        const normT = THREE.MathUtils.clamp((z + 0.46) / 0.482, 0, 1);
        const midBell = Math.sin(normT * Math.PI);
        const underBoost = 0.55 + 0.45 * THREE.MathUtils.smoothstep(0.04, -0.05, y);
        return midBell * 0.58 * underBoost;
      },
    ),
  );
  const upperArmMesh = new THREE.Mesh(upperArmGeo, ctx.sleeveMat);
  upperArmMesh.castShadow = true;
  upperArmMesh.receiveShadow = true;
  elbowPivot.add(upperArmMesh);

  const armMeshes: THREE.Object3D[] = [
    forearmMesh,
    forearmSleeveMesh,
    cuffLiningMesh,
    sleeveCuffBand,
    cuffStrap,
    snapStud,
    zipperTrack,
    zipperSlider,
    zipperPullPivot,
    elbowJointCap,
    elbowPad,
    elbowPivot,
  ];

  // Matte field watch on exposed left wrist skin behind glove cuff
  if (side === 'left') {
    const watchGroup = new THREE.Group();
    watchGroup.position.set(0, -0.0005, -0.054);
    handGroup.add(watchGroup);
    armMeshes.push(watchGroup);

    const strapGeo = ctx.trackGeo(new THREE.TorusGeometry(0.033, 0.0028, 10, 32));
    strapGeo.scale(0.99, 0.78, 2.5);
    const strap = new THREE.Mesh(strapGeo, ctx.watchStrapMat);
    watchGroup.add(strap);

    const bezel = new THREE.Mesh(
      ctx.trackGeo(new THREE.CylinderGeometry(0.0175, 0.0185, 0.0075, 28)),
      ctx.watchCaseMat,
    );
    bezel.position.set(0, 0.0255, 0);
    bezel.castShadow = true;
    watchGroup.add(bezel);

    const dial = new THREE.Mesh(
      ctx.trackGeo(new THREE.CylinderGeometry(0.0148, 0.0148, 0.008, 24)),
      ctx.watchDialMat,
    );
    dial.position.set(0, 0.0258, 0);
    watchGroup.add(dial);

    const crown = new THREE.Mesh(
      ctx.trackGeo(new THREE.CylinderGeometry(0.0026, 0.0026, 0.0045, 10)),
      ctx.watchCaseMat,
    );
    crown.rotation.z = Math.PI / 2;
    crown.position.set(-0.019, 0.0255, 0);
    watchGroup.add(crown);
  }

  // =========================================================================
  // 3. THICK, TIGHTLY PACKED SCULPTED LEATHER FINGERS (Flush edge-to-edge!)
  // =========================================================================
  const index = createArticulatedFinger(
    [0.036, 0.023, 0.019],
    0.0110,
    0.0108,
    ctx,
  );
  index.mcp.position.set(s * 0.0278, 0.0020, 0.083);
  handGroup.add(index.mcp);

  const middle = createArticulatedFinger(
    [0.036, 0.024, 0.019],
    0.0114,
    0.0112,
    ctx,
  );
  middle.mcp.position.set(s * 0.0092, 0.0026, 0.085);
  handGroup.add(middle.mcp);

  const ring = createArticulatedFinger(
    [0.034, 0.023, 0.018],
    0.0108,
    0.0106,
    ctx,
  );
  ring.mcp.position.set(-s * 0.0092, 0.0016, 0.082);
  handGroup.add(ring.mcp);

  const pinky = createArticulatedFinger(
    [0.030, 0.021, 0.017],
    0.0098,
    0.0096,
    ctx,
  );
  pinky.mcp.position.set(-s * 0.0265, -0.0004, 0.077);
  handGroup.add(pinky.mcp);

  const webPositions = [
    [s * 0.0185, -0.0005, 0.084],
    [0.0, -0.0002, 0.084],
    [-s * 0.0178, -0.0014, 0.079],
  ];
  const webGeo = ctx.trackGeo(new THREE.SphereGeometry(0.0105, 10, 8));
  webGeo.scale(0.92, 0.78, 1.32);
  for (const [wx, wy, wz] of webPositions) {
    const web = new THREE.Mesh(webGeo, ctx.leatherMat);
    web.position.set(wx, wy, wz);
    handGroup.add(web);
  }

  const thumbBase = new THREE.Group();
  thumbBase.position.set(s * 0.031, -0.0068, 0.027);
  handGroup.add(thumbBase);

  // Compact, anatomically proportioned thick gloved thumb (natural length, never elongated)
  const thumbMetacarpal = createSculptedPhalanxMesh(
    0.0255,
    0.0168,
    0.0158,
    0.0132,
    0.0122,
    false,
    false,
    ctx,
  );
  thumbBase.add(thumbMetacarpal);

  const purlicue = new THREE.Mesh(
    ctx.trackGeo(new THREE.SphereGeometry(0.0145, 12, 10)),
    ctx.leatherMat,
  );
  purlicue.scale.set(0.84, 0.54, 1.18);
  purlicue.position.set(s * 0.033, 0.0022, 0.042);
  handGroup.add(purlicue);

  const thumb = createArticulatedFinger(
    [0.024, 0.0195, 0],
    0.0126,
    0.0116,
    ctx,
    true,
  );
  thumb.mcp.position.set(0, 0, 0.024);
  thumbBase.add(thumb.mcp);

  return {
    handGroup,
    elbowPivot,
    zipperPullPivot,
    armMeshes,
    index,
    middle,
    ring,
    pinky,
    thumbBase,
    thumb,
    knuckleDomes,
    knuckleBaseY,
    shellMesh,
  };
}

/**
 * Builds the tightly clasped two-handed FPS viewmodel rig wearing richly textured,
 * dusted full-grain black tactical leather combat gloves.
 */
export function buildRealisticHands(
  initialTone: SkinToneId,
  maxAnisotropy: number,
): RealisticHandsRig {
  const root = new THREE.Group();
  root.name = 'RealisticBlackLeatherHands';

  const skinSet: SkinTextureSet = createSkinTextures(initialTone, maxAnisotropy);
  const leatherSet: LeatherGloveTextureSet =
    createBlackLeatherGloveTextures(maxAnisotropy);
  const jacketSet: LeatherJacketTextureSet =
    createBlackLeatherJacketTextures(maxAnisotropy);

  const disposables: Array<{ dispose: () => void }> = [
    skinSet,
    leatherSet,
    jacketSet,
  ];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Exposed forearm skin with micro-pore tangent normal map & subsurface sheen
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: skinSet.map,
    normalMap: skinSet.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.60,
    roughnessMap: skinSet.roughnessMap,
    metalness: 0.0,
    sheen: 0.38,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(SKIN_PALETTES[initialTone].sheenHex),
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
  });

  // Full-grain pebbled BLACK TACTICAL LEATHER with 1024px pebble normal map, dust & supple sheen
  const leatherMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: leatherSet.map,
    normalMap: leatherSet.normalMap,
    normalScale: new THREE.Vector2(1.65, 1.65),
    roughness: 0.60,
    roughnessMap: leatherSet.roughnessMap,
    metalness: 0.05,
    clearcoat: 0.26,
    clearcoatRoughness: 0.40,
    sheen: 0.28,
    sheenRoughness: 0.74,
    sheenColor: new THREE.Color(0x747a86),
    envMapIntensity: 1.32,
  });

  // Scuffed & dusted matte black 2×2 carbon-kevlar hard-knuckle armor
  const armorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: leatherSet.armorMap,
    normalMap: leatherSet.armorNormalMap,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: leatherSet.armorRoughnessMap,
    roughness: 0.56,
    metalness: 0.20,
    clearcoat: 0.32,
    clearcoatRoughness: 0.36,
    envMapIntensity: 1.38,
  });

  // Matte neoprene wrist cuff
  const cuffMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d22,
    normalMap: leatherSet.armorNormalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.86,
    metalness: 0.04,
  });

  // Reinforced matte black suede/leather grip overlays on palm & fingertips
  const padMat = new THREE.MeshPhysicalMaterial({
    color: 0xd0d2d6,
    map: leatherSet.map,
    normalMap: leatherSet.normalMap,
    normalScale: new THREE.Vector2(1.6, 1.6),
    roughness: 0.76,
    roughnessMap: leatherSet.roughnessMap,
    metalness: 0.03,
    clearcoat: 0.12,
    clearcoatRoughness: 0.55,
  });

  // Heavy milled BLACK LEATHER MOTO JACKET sleeve with live GPU wind-cloth ripple shader!
  const sleeveWindUniforms = {
    uWindTime: { value: 0 },
    uWindStrength: { value: 0.55 },
    uWindDir: { value: new THREE.Vector3(-0.35, -0.18, -0.92) },
  };

  const sleeveMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: jacketSet.map,
    normalMap: jacketSet.normalMap,
    normalScale: new THREE.Vector2(1.55, 1.55),
    roughness: 0.76,
    roughnessMap: jacketSet.roughnessMap,
    metalness: 0.07,
    clearcoat: 0.42,
    clearcoatRoughness: 0.36,
    sheen: 0.36,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(0x6d798b),
    envMapIntensity: 1.48,
  });
  sleeveMat.customProgramCacheKey = () => 'black_leather_jacket_wind_v1';
  sleeveMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = sleeveWindUniforms.uWindTime;
    shader.uniforms.uWindStrength = sleeveWindUniforms.uWindStrength;
    shader.uniforms.uWindDir = sleeveWindUniforms.uWindDir;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      attribute float aWindWeight;
      uniform float uWindTime;
      uniform float uWindStrength;
      uniform vec3 uWindDir;
      varying float vLeatherCrest;

      void calcLeatherJacketWind(
        vec3 p,
        float wWeight,
        out vec3 deltaPos,
        out vec3 normalTilt,
        out float crest
      ) {
        if (wWeight <= 0.001) {
          deltaPos = vec3(0.0);
          normalTilt = vec3(0.0);
          crest = 0.0;
          return;
        }
        float theta = atan(p.y, p.x);
        float cuffEdge = smoothstep(-0.18, -0.078, p.z);

        // Multi-harmonic weighted heavy-leather ripples traveling down the sleeve
        float phase1 = p.z * 26.0 - uWindTime * 4.7 + theta * 2.0;
        float phase2 = p.z * 48.0 - uWindTime * 8.3 - theta * 3.0 + 1.35;
        float phase3 = theta * 4.0 + p.z * 19.0 - uWindTime * 6.5;

        float w1 = sin(phase1);
        float w2 = sin(phase2) * 0.42;
        float w3 = cos(phase3) * 0.36 * cuffEdge;

        float radialLen = max(length(p.xy), 0.001);
        vec2 radDir = p.xy / radialLen;
        float clampedWind = clamp(uWindStrength, 0.0, 1.8);
        // Slightly outward-biased billow so heavy leather puffs & ripples with ZERO inner-skin clipping
        float rippleAmp = (0.0019 + 0.0029 * clampedWind) * wWeight;
        float dispR = (w1 * 0.78 + 0.28 + w2 + w3) * rippleAmp;

        // Directional breeze sway along downwind axis during gusts, sprinting & weapon blasts
        float gustSwell = 0.45 + 0.55 * sin(uWindTime * 2.4 + p.z * 8.5);
        vec3 windPush = uWindDir * (0.0028 * clampedWind * wWeight * gustSwell);

        deltaPos = vec3(radDir * dispR, 0.0) + windPush;

        // Analytical surface-slope tilt so black leather specular sheen & highlights glide across moving folds!
        float dWdz = (cos(phase1) * 26.0 * 0.78 + cos(phase2) * 48.0 * 0.42 - sin(phase3) * 19.0 * 0.36 * cuffEdge) * rippleAmp;
        float dWdTheta = (cos(phase1) * 2.0 * 0.78 - cos(phase2) * 3.0 * 0.42 - sin(phase3) * 4.0 * 0.36 * cuffEdge) * rippleAmp;
        vec2 tangDir = vec2(-radDir.y, radDir.x);
        normalTilt = vec3(tangDir * (-dWdTheta * 5.8), -dWdz * 0.62);
        crest = clamp((w1 + w2) * 0.5 + 0.5, 0.0, 1.0) * wWeight * clamp(clampedWind * 0.7, 0.0, 1.0);
      }
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
      #include <beginnormal_vertex>
      vec3 _lwDeltaPos;
      vec3 _lwNormalTilt;
      float _lwCrest;
      calcLeatherJacketWind(position, aWindWeight, _lwDeltaPos, _lwNormalTilt, _lwCrest);
      objectNormal = normalize(objectNormal + _lwNormalTilt);
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      transformed += _lwDeltaPos;
      vLeatherCrest = _lwCrest;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      varying float vLeatherCrest;
      `,
    );

    // Subtle burnished black-leather grazing sheen along wind-rippled fold crests
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      vec3 _ljView = normalize(vViewPosition);
      float _ljFresnel = pow(1.0 - clamp(dot(normal, _ljView), 0.0, 1.0), 3.1);
      float _ljUpper = clamp(normal.y * 0.5 + 0.5, 0.18, 1.0);
      outgoingLight += vec3(0.11, 0.125, 0.145) * (_ljFresnel * 0.24 + vLeatherCrest * 0.16) * _ljUpper;
      #include <opaque_fragment>
      `,
    );
  };
  sleeveMat.needsUpdate = true;

  // Brushed gunmetal steel hardware for leather jacket cuff zippers & wrist snap studs
  const jacketHardwareMat = new THREE.MeshStandardMaterial({
    color: 0x5c6470,
    metalness: 0.90,
    roughness: 0.28,
    envMapIntensity: 1.48,
  });

  // Dark satin-charcoal interior sleeve lining visible inside the flared leather cuff
  const jacketLiningMat = new THREE.MeshStandardMaterial({
    color: 0x090b0f,
    roughness: 0.72,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  const watchCaseMat = new THREE.MeshStandardMaterial({
    color: 0x454c56,
    metalness: 0.88,
    roughness: 0.28,
  });

  const watchStrapMat = new THREE.MeshStandardMaterial({
    color: 0x1b1e22,
    roughness: 0.86,
    metalness: 0.04,
  });

  const watchDialMat = new THREE.MeshStandardMaterial({
    color: 0x0e1116,
    roughness: 0.2,
    metalness: 0.25,
  });

  disposables.push(
    skinMat,
    leatherMat,
    armorMat,
    cuffMat,
    padMat,
    sleeveMat,
    jacketHardwareMat,
    jacketLiningMat,
    watchCaseMat,
    watchStrapMat,
    watchDialMat,
  );

  const ctx: HandBuildContext = {
    skinMat,
    leatherMat,
    armorMat,
    cuffMat,
    padMat,
    sleeveMat,
    jacketHardwareMat,
    jacketLiningMat,
    watchCaseMat,
    watchStrapMat,
    watchDialMat,
    trackGeo,
  };

  const computeBasisQuat = (
    targetForward: THREE.Vector3,
    targetX: THREE.Vector3,
  ): THREE.Quaternion => {
    const zAxis = targetForward.clone().normalize();
    const xAxis = targetX
      .clone()
      .addScaledVector(zAxis, -targetX.dot(zAxis))
      .normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    return new THREE.Quaternion().setFromRotationMatrix(basis);
  };

  interface HandPosePreset {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
  }

  // Precomputed zero-allocation hand rest poses for Pistol, Russian SMGs, Shotguns, and Tactical Katana
  const RIGHT_STANCE_POSES: Record<HandStance, HandPosePreset> = {
    pistol: {
      pos: new THREE.Vector3(0.0345, -0.069, 0.095),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.14, 0.26, -0.95),
        new THREE.Vector3(-0.09, 0.95, 0.28),
      ),
    },
    smg: {
      pos: new THREE.Vector3(0.0345, -0.069, 0.095),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.14, 0.26, -0.95),
        new THREE.Vector3(-0.09, 0.95, 0.28),
      ),
    },
    shotgun: {
      pos: new THREE.Vector3(0.0345, -0.069, 0.095),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.14, 0.26, -0.95),
        new THREE.Vector3(-0.09, 0.95, 0.28),
      ),
    },
    sword: {
      pos: new THREE.Vector3(0.032, -0.062, 0.056),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.24, 0.24, -0.94),
        new THREE.Vector3(-0.08, 0.96, 0.26),
      ),
    },
    flashlight: {
      // Verified ELBOW-UP tactical flashlight grip:
      // - Wrist/forearm (-Z) goes UP & BACK-RIGHT (+0.56, +0.68, +0.47) -> elbow up bent back!
      // - Inside of fingers / palm (-Y) faces UPPER-LEFT (-0.80, +0.58, +0.11), NEVER upper-right!
      // - Fingertips curl cleanly on the LEFT side of the 35mm barrel (zero clip!),
      //   thumb points forward onto the upper-right neck click-switch!
      pos: new THREE.Vector3(0.062, 0.012, 0.014),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.56, -0.68, -0.47),
        new THREE.Vector3(0.18, 0.42, -0.89),
      ),
    },
    unarmed: {
      // Relaxed low unarmed ready hand tucked cleanly at bottom-right periphery
      pos: new THREE.Vector3(0.115, -0.175, -0.045),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.26, 0.36, -0.89),
        new THREE.Vector3(0.14, 0.90, 0.41),
      ),
    },
  };

  const LEFT_STANCE_POSES: Record<HandStance, HandPosePreset> = {
    pistol: {
      pos: new THREE.Vector3(-0.0415, -0.079, 0.073),
      quat: computeBasisQuat(
        new THREE.Vector3(0.22, 0.30, -0.92),
        new THREE.Vector3(-0.15, -0.93, -0.32),
      ),
    },
    smg: {
      // Left wrist slightly supinated/rotated to the right so the palm holds the SMG handguard TIGHT
      // from underneath and all 4 fingers cusp neatly up around the bottom-right curve (zero clipping!)
      pos: new THREE.Vector3(-0.016, -0.064, -0.132),
      quat: computeBasisQuat(
        new THREE.Vector3(0.58, 0.16, -0.80),
        new THREE.Vector3(0.785, 0.156, 0.600),
      ),
    },
    shotgun: {
      // Left wrist slightly supinated/rotated to the right so the palm cups directly underneath the
      // thick shotgun pump and all 4 fingers wrap neatly up around the underside & right flank (zero clip!)
      pos: new THREE.Vector3(-0.012, -0.072, -0.228),
      quat: computeBasisQuat(
        new THREE.Vector3(0.58, 0.16, -0.80),
        new THREE.Vector3(0.785, 0.156, 0.600),
      ),
    },
    sword: {
      // Tightly clasped two-handed katana hilt gloves (arms/elbows hidden on sword stance!)
      pos: new THREE.Vector3(-0.024, -0.138, 0.056),
      quat: computeBasisQuat(
        new THREE.Vector3(0.24, 0.24, -0.94),
        new THREE.Vector3(0.08, -0.96, -0.26),
      ),
    },
    flashlight: {
      // Left hand tucked cleanly below viewport so idle fingers never clutter the screen
      pos: new THREE.Vector3(-0.26, -0.36, 0.09),
      quat: computeBasisQuat(
        new THREE.Vector3(0.24, 0.44, -0.86),
        new THREE.Vector3(-0.16, -0.88, -0.44),
      ),
    },
    unarmed: {
      // Relaxed low unarmed balance hand tucked cleanly at bottom-left periphery
      pos: new THREE.Vector3(-0.215, -0.175, -0.045),
      quat: computeBasisQuat(
        new THREE.Vector3(0.26, 0.36, -0.89),
        new THREE.Vector3(-0.14, -0.90, -0.41),
      ),
    },
  };

  // Verified right-side-up left-hand reload orientations (never upside down!):
  const RELOAD_HAND_QUATS: Record<ReloadHandPhase, THREE.Quaternion> = {
    // Gripping vertical pistol / AK / PP-41 mag from left side: thumb/index UP, palm facing RIGHT into mag
    magGrip: computeBasisQuat(
      new THREE.Vector3(0.32, 0.26, -0.91),
      new THREE.Vector3(-0.12, -0.95, -0.29),
    ),
    // Overhand top pinch for pistol slide & SMG charging handle: dorsal back UP (+Y), palm & pinch DOWN onto slide!
    overhandPinch: computeBasisQuat(
      new THREE.Vector3(0.78, -0.18, -0.60),
      new THREE.Vector3(-0.58, 0.16, -0.80),
    ),
    // Underhand palm-up shell insertion for VX-9 & KS-23 shotguns: inner palm UP pushing shell into loading gate
    shellFeed: computeBasisQuat(
      new THREE.Vector3(0.52, 0.26, -0.81),
      new THREE.Vector3(0.78, 0.18, 0.60),
    ),
  };

  // Per-stance gentle elbow flexion (elbows stay cleanly behind the camera plane, never poking into frame!)
  const LEFT_ELBOW_STANCES: Record<HandStance, [number, number, number]> = {
    pistol: [-0.18, -0.24, 0],
    smg: [-0.36, -0.28, 0.08],
    shotgun: [-0.34, -0.26, 0.08],
    sword: [-0.20, -0.18, 0.04],
    flashlight: [-0.28, -0.18, 0],
    unarmed: [-0.24, -0.16, 0],
  };

  const RIGHT_ELBOW_STANCES: Record<HandStance, [number, number, number]> = {
    pistol: [0.14, -0.16, 0],
    smg: [0.16, -0.16, 0],
    shotgun: [0.16, -0.16, 0],
    sword: [0.14, -0.18, -0.04],
    flashlight: [0.34, -0.42, 0.14],
    unarmed: [0.22, -0.18, 0],
  };

  // Hero Can-Focus Drink Poses: forearm drops cleanly straight DOWN below bottom border so it NEVER blocks
  // the screen, while the gleaming D⚡ Energy Drink can fills a bold readable chunk of the screen in F/1.2
  // close-up focus before tilting to your mouth (bottom of lens) and tossing backwards over your left shoulder!
  const DRINK_HAND_POSES: Record<DrinkHandPhase, HandPosePreset> = {
    reach: {
      // Tucked-in downward floor reach while bending down close to the item
      pos: new THREE.Vector3(-0.205, -0.225, -0.135),
      quat: computeBasisQuat(
        new THREE.Vector3(0.16, -0.58, -0.80),
        new THREE.Vector3(0.18, -0.78, 0.59),
      ),
    },
    hold: {
      // BIG READABLE HERO PRESENTATION: forearm exits completely off bottom edge (NDC y < -2.4),
      // while the gleaming D⚡ Energy Drink can fills ~45% of screen height dead-center so you can read the side!
      pos: new THREE.Vector3(-0.378, 0.104, 0.162),
      quat: computeBasisQuat(
        new THREE.Vector3(0.28, 0.56, -0.78),
        new THREE.Vector3(-0.10, -0.85, -0.52),
      ),
    },
    swig: {
      // Close-up drinking pose (mouth = bottom of camera): forearm stays below frame (NDC y < -2.6)
      // while the huge crisp D⚡ can tilts cleanly toward the bottom-center lens against creamy F/1.2 bokeh!
      pos: new THREE.Vector3(-0.386, 0.072, 0.182),
      quat: computeBasisQuat(
        new THREE.Vector3(0.26, 0.85, -0.45),
        new THREE.Vector3(0.10, 0.42, -0.90),
      ),
    },
    tossWindup: {
      // Anticipatory down-left windup before whipping the empty can backwards over your left shoulder!
      pos: new THREE.Vector3(-0.365, -0.025, 0.085),
      quat: computeBasisQuat(
        new THREE.Vector3(0.32, 0.42, -0.85),
        new THREE.Vector3(0.14, -0.86, -0.49),
      ),
    },
    tossFlick: {
      // Carefree over-the-left-shoulder backwards flick! Wrist whips up-left-back with full joint follow-through!
      pos: new THREE.Vector3(-0.445, 0.165, 0.255),
      quat: computeBasisQuat(
        new THREE.Vector3(-0.26, 0.72, 0.64),
        new THREE.Vector3(-0.34, 0.58, -0.74),
      ),
    },
  };

  // =========================================================================
  // 1. RIGHT HAND (Dominant shooting/sword hand — compact natural thumb, zero clip)
  // =========================================================================
  const right = buildSingleHumanHand('right', ctx);
  const rightHandPivot = new THREE.Group();
  rightHandPivot.name = 'RightHandPivot';
  rightHandPivot.position.copy(RIGHT_STANCE_POSES.pistol.pos);
  rightHandPivot.quaternion.copy(RIGHT_STANCE_POSES.pistol.quat);
  rightHandPivot.add(right.handGroup);
  root.add(rightHandPivot);

  // Calibrated base fist & trigger poses (compact natural thumb, zero tang/grip clipping!)
  const R_IDX_GUN = { mcpX: 0.48, mcpY: -0.08, pipX: 1.04, dipX: 0.68 };
  const R_IDX_SWORD = { mcpX: 1.32, mcpY: -0.02, pipX: 1.40, dipX: 0.76 };
  const R_MID = { mcpX: 1.38, mcpY: 0.0, pipX: 1.44, dipX: 0.78 };
  const R_RNG = { mcpX: 1.42, mcpY: 0.03, pipX: 1.48, dipX: 0.80 };
  const R_PNK = { mcpX: 1.45, mcpY: 0.06, pipX: 1.46, dipX: 0.76 };

  // Compact right thumb sweeps cleanly behind the tang and rests naturally along left frame (zero clip!)
  right.thumbBase.position.set(0.0315, -0.0022, 0.026);
  const R_THM_GUN = {
    baseX: 1.06,
    baseY: 0.16,
    baseZ: 0.05,
    mcpX: -0.34,
    mcpY: 0.06,
    mcpZ: 0.0,
    pipX: -0.36,
  };
  const R_THM_SWORD = {
    baseX: 1.02,
    baseY: 0.12,
    baseZ: 0.04,
    mcpX: -0.22,
    mcpY: 0.04,
    mcpZ: 0.0,
    pipX: -0.26,
  };

  // =========================================================================
  // 2. LEFT HAND (Pistol clasped fist / Shotgun forend cradle / Sword lower hilt)
  // =========================================================================
  const left = buildSingleHumanHand('left', ctx);
  const leftHandPivot = new THREE.Group();
  leftHandPivot.name = 'LeftHandPivot';
  leftHandPivot.position.copy(LEFT_STANCE_POSES.pistol.pos);
  leftHandPivot.quaternion.copy(LEFT_STANCE_POSES.pistol.quat);
  leftHandPivot.add(left.handGroup);
  root.add(leftHandPivot);

  // Exact palm grasp socket nested inside the cupped left gloved fingers & opposing thumb!
  // +Y of any child attached here aligns with -X_hand (upward past the index finger & thumb)
  const leftPalmSocket = new THREE.Group();
  leftPalmSocket.name = 'LeftPalmSocket';
  leftPalmSocket.position.set(0.0, -0.052, 0.072);
  leftPalmSocket.rotation.set(0, 0, Math.PI / 2);
  left.handGroup.add(leftPalmSocket);

  const L_PISTOL = {
    idx: { mcpX: 1.32, mcpY: 0.03, pipX: 1.40, dipX: 0.78 },
    mid: { mcpX: 1.36, mcpY: 0.01, pipX: 1.44, dipX: 0.80 },
    rng: { mcpX: 1.39, mcpY: -0.02, pipX: 1.46, dipX: 0.80 },
    pnk: { mcpX: 1.42, mcpY: -0.05, pipX: 1.44, dipX: 0.76 },
    thm: {
      baseX: 0.24,
      baseY: -0.10,
      baseZ: 0.08,
      mcpX: 0.18,
      mcpY: -0.04,
      mcpZ: 0.04,
      pipX: 0.14,
    },
  };

  // Neatly cupped underhand shotgun pump wrap (4 fingers curl cleanly around underside & right flank, thumb hugs left!)
  const L_SHOTGUN = {
    idx: { mcpX: 0.48, mcpY: 0.01, pipX: 0.72, dipX: 0.66 },
    mid: { mcpX: 0.50, mcpY: 0.0, pipX: 0.74, dipX: 0.68 },
    rng: { mcpX: 0.54, mcpY: -0.02, pipX: 0.76, dipX: 0.68 },
    pnk: { mcpX: 0.58, mcpY: -0.04, pipX: 0.74, dipX: 0.64 },
    thm: {
      baseX: 0.46,
      baseY: -0.24,
      baseZ: 0.14,
      mcpX: 0.24,
      mcpY: -0.08,
      mcpZ: 0.04,
      pipX: 0.22,
    },
  };

  // Tightly cupped underhand SMG wood handguard wrap (matches slimmer 41mm handguard snugly with zero clip!)
  const L_SMG = {
    idx: { mcpX: 0.58, mcpY: 0.02, pipX: 0.80, dipX: 0.68 },
    mid: { mcpX: 0.62, mcpY: 0.0, pipX: 0.84, dipX: 0.70 },
    rng: { mcpX: 0.65, mcpY: -0.02, pipX: 0.86, dipX: 0.70 },
    pnk: { mcpX: 0.68, mcpY: -0.04, pipX: 0.82, dipX: 0.66 },
    thm: {
      baseX: 0.50,
      baseY: -0.26,
      baseZ: 0.14,
      mcpX: 0.26,
      mcpY: -0.08,
      mcpZ: 0.04,
      pipX: 0.24,
    },
  };

  // Solid closed RIGHT FIST gripping the 35mm flashlight cylinder cleanly with ZERO clipping!
  const R_IDX_FLASHLIGHT = { mcpX: 1.12, mcpY: -0.02, pipX: 1.20, dipX: 0.74 };
  const R_MID_FLASHLIGHT = { mcpX: 1.14, mcpY: 0.0, pipX: 1.22, dipX: 0.76 };
  const R_RNG_FLASHLIGHT = { mcpX: 1.12, mcpY: 0.02, pipX: 1.20, dipX: 0.74 };
  const R_PNK_FLASHLIGHT = { mcpX: 1.06, mcpY: 0.04, pipX: 1.15, dipX: 0.70 };
  const R_THM_FLASHLIGHT = {
    baseX: 0.48,
    baseY: 0.28,
    baseZ: 0.10,
    mcpX: 0.34,
    mcpY: 0.14,
    mcpZ: 0.0,
    pipX: 0.26,
  };

  // Relaxed natural open-ready hand curls for unarmed state
  const R_IDX_UNARMED = { mcpX: 0.56, mcpY: -0.03, pipX: 0.68, dipX: 0.40 };
  const R_MID_UNARMED = { mcpX: 0.66, mcpY: 0.0, pipX: 0.76, dipX: 0.44 };
  const R_RNG_UNARMED = { mcpX: 0.74, mcpY: 0.03, pipX: 0.82, dipX: 0.46 };
  const R_PNK_UNARMED = { mcpX: 0.82, mcpY: 0.06, pipX: 0.86, dipX: 0.48 };
  const R_THM_UNARMED = {
    baseX: 0.26,
    baseY: 0.22,
    baseZ: -0.10,
    mcpX: 0.18,
    mcpY: 0.05,
    mcpZ: 0.0,
    pipX: 0.14,
  };

  const L_SWORD = {
    idx: { mcpX: 1.30, mcpY: 0.02, pipX: 1.38, dipX: 0.74 },
    mid: { mcpX: 1.34, mcpY: 0.0, pipX: 1.42, dipX: 0.76 },
    rng: { mcpX: 1.38, mcpY: -0.02, pipX: 1.44, dipX: 0.76 },
    pnk: { mcpX: 1.40, mcpY: -0.04, pipX: 1.42, dipX: 0.74 },
    thm: {
      baseX: 0.96,
      baseY: -0.14,
      baseZ: -0.04,
      mcpX: -0.18,
      mcpY: -0.04,
      mcpZ: 0.0,
      pipX: -0.22,
    },
  };

  const L_FLASHLIGHT = {
    idx: { mcpX: 0.62, mcpY: 0.04, pipX: 0.74, dipX: 0.42 },
    mid: { mcpX: 0.72, mcpY: 0.01, pipX: 0.84, dipX: 0.46 },
    rng: { mcpX: 0.82, mcpY: -0.02, pipX: 0.92, dipX: 0.50 },
    pnk: { mcpX: 0.92, mcpY: -0.06, pipX: 0.96, dipX: 0.52 },
    thm: {
      baseX: 0.28,
      baseY: -0.20,
      baseZ: 0.12,
      mcpX: 0.20,
      mcpY: -0.06,
      mcpZ: 0.02,
      pipX: 0.16,
    },
  };

  let currentStance: HandStance = 'pistol';
  const getLeftBase = () =>
    currentStance === 'shotgun'
      ? L_SHOTGUN
      : currentStance === 'smg'
        ? L_SMG
        : currentStance === 'sword'
          ? L_SWORD
          : currentStance === 'flashlight' || currentStance === 'unarmed'
            ? L_FLASHLIGHT
            : L_PISTOL;
  const getRightIdxBase = () =>
    currentStance === 'sword'
      ? R_IDX_SWORD
      : currentStance === 'flashlight'
        ? R_IDX_FLASHLIGHT
        : currentStance === 'unarmed'
          ? R_IDX_UNARMED
          : R_IDX_GUN;
  const getRightMidBase = () =>
    currentStance === 'flashlight'
      ? R_MID_FLASHLIGHT
      : currentStance === 'unarmed'
        ? R_MID_UNARMED
        : R_MID;
  const getRightRngBase = () =>
    currentStance === 'flashlight'
      ? R_RNG_FLASHLIGHT
      : currentStance === 'unarmed'
        ? R_RNG_UNARMED
        : R_RNG;
  const getRightPnkBase = () =>
    currentStance === 'flashlight'
      ? R_PNK_FLASHLIGHT
      : currentStance === 'unarmed'
        ? R_PNK_UNARMED
        : R_PNK;
  const getRightThmBase = () =>
    currentStance === 'sword'
      ? R_THM_SWORD
      : currentStance === 'flashlight'
        ? R_THM_FLASHLIGHT
        : currentStance === 'unarmed'
          ? R_THM_UNARMED
          : R_THM_GUN;

  const applyBaseJoints = () => {
    const rIdx = getRightIdxBase();
    const rMid = getRightMidBase();
    const rRng = getRightRngBase();
    const rPnk = getRightPnkBase();
    const rThm = getRightThmBase();
    const lBase = getLeftBase();

    right.index.mcp.rotation.set(rIdx.mcpX, rIdx.mcpY, 0.0);
    right.index.pip.rotation.set(rIdx.pipX, 0, 0);
    right.index.dip.rotation.set(rIdx.dipX, 0, 0);

    right.middle.mcp.rotation.set(rMid.mcpX, rMid.mcpY, 0.0);
    right.middle.pip.rotation.set(rMid.pipX, 0, 0);
    right.middle.dip.rotation.set(rMid.dipX, 0, 0);

    right.ring.mcp.rotation.set(rRng.mcpX, rRng.mcpY, 0.0);
    right.ring.pip.rotation.set(rRng.pipX, 0, 0);
    right.ring.dip.rotation.set(rRng.dipX, 0, 0);

    right.pinky.mcp.rotation.set(rPnk.mcpX, rPnk.mcpY, 0.0);
    right.pinky.pip.rotation.set(rPnk.pipX, 0, 0);
    right.pinky.dip.rotation.set(rPnk.dipX, 0, 0);

    right.thumbBase.rotation.set(rThm.baseX, rThm.baseY, rThm.baseZ);
    right.thumb.mcp.rotation.set(rThm.mcpX, rThm.mcpY, rThm.mcpZ);
    right.thumb.pip.rotation.set(rThm.pipX, 0, 0);

    left.thumbBase.position.set(-0.030, 0.0025, 0.027);
    left.index.mcp.rotation.set(lBase.idx.mcpX, lBase.idx.mcpY, 0.0);
    left.index.pip.rotation.set(lBase.idx.pipX, 0, 0);
    left.index.dip.rotation.set(lBase.idx.dipX, 0, 0);

    left.middle.mcp.rotation.set(lBase.mid.mcpX, lBase.mid.mcpY, 0.0);
    left.middle.pip.rotation.set(lBase.mid.pipX, 0, 0);
    left.middle.dip.rotation.set(lBase.mid.dipX, 0, 0);

    left.ring.mcp.rotation.set(lBase.rng.mcpX, lBase.rng.mcpY, 0.0);
    left.ring.pip.rotation.set(lBase.rng.pipX, 0, 0);
    left.ring.dip.rotation.set(lBase.rng.dipX, 0, 0);

    left.pinky.mcp.rotation.set(lBase.pnk.mcpX, lBase.pnk.mcpY, 0.0);
    left.pinky.pip.rotation.set(lBase.pnk.pipX, 0, 0);
    left.pinky.dip.rotation.set(lBase.pnk.dipX, 0, 0);

    left.thumbBase.rotation.set(lBase.thm.baseX, lBase.thm.baseY, lBase.thm.baseZ);
    left.thumb.mcp.rotation.set(lBase.thm.mcpX, lBase.thm.mcpY, lBase.thm.mcpZ);
    left.thumb.pip.rotation.set(lBase.thm.pipX, 0, 0);
  };

  applyBaseJoints();

  // Very active, living idle fidget state (zero per-frame allocations)
  let fidgetCooldown = 0.45;
  let fidgetActive = false;
  let fidgetType = 0; // 0=drum roll, 1=triple thumb tap, 2=knuckle crack clench, 3=trigger bounce+pinky wave, 4=wrist inspect rock, 5=alternating grip shift
  let fidgetTime = 0;
  let fidgetDuration = 1.05;
  let smoothClench = 0;
  let flashlightThumbPress = 0;
  let jacketWindPhase = 0;
  let jacketWindStrength = 0.55;
  let leftZipSwing = 0;
  let leftZipVel = 0;
  let rightZipSwing = 0;
  let rightZipVel = 0;

  const rig: RealisticHandsRig = {
    root,
    rightHandGroup: rightHandPivot,
    leftHandGroup: leftHandPivot,
    leftPalmSocket,
    rightIndex: right.index,
    fidgetWeaponRoll: 0,
    fidgetWeaponPitch: 0,
    setStance(stance: HandStance) {
      currentStance = stance;
      rightHandPivot.position.copy(RIGHT_STANCE_POSES[stance].pos);
      rightHandPivot.quaternion.copy(RIGHT_STANCE_POSES[stance].quat);
      leftHandPivot.position.copy(LEFT_STANCE_POSES[stance].pos);
      leftHandPivot.quaternion.copy(LEFT_STANCE_POSES[stance].quat);
      const lElb = LEFT_ELBOW_STANCES[stance];
      const rElb = RIGHT_ELBOW_STANCES[stance];
      left.elbowPivot.rotation.set(lElb[0], lElb[1], lElb[2]);
      right.elbowPivot.rotation.set(rElb[0], rElb[1], rElb[2]);
      // Dedicated Katana glove-only mode: hide arms, sleeves & elbows completely so ONLY the gleaming
      // blade and clasped black leather gloves at the bottom ever appear during any sword slash!
      const showArms = stance !== 'sword';
      for (let i = 0; i < right.armMeshes.length; i++) {
        right.armMeshes[i].visible = showArms;
      }
      for (let i = 0; i < left.armMeshes.length; i++) {
        left.armMeshes[i].visible = showArms;
      }
      applyBaseJoints();
    },
    getLeftHandRestPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
      outPos.copy(LEFT_STANCE_POSES[currentStance].pos);
      outQuat.copy(LEFT_STANCE_POSES[currentStance].quat);
    },
    getRightHandRestPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
      outPos.copy(RIGHT_STANCE_POSES[currentStance].pos);
      outQuat.copy(RIGHT_STANCE_POSES[currentStance].quat);
    },
    getReloadHandQuat(phase: ReloadHandPhase, outQuat: THREE.Quaternion) {
      outQuat.copy(RELOAD_HAND_QUATS[phase]);
    },
    getDrinkHandPose(
      phase: DrinkHandPhase,
      outPos: THREE.Vector3,
      outQuat: THREE.Quaternion,
    ) {
      outPos.copy(DRINK_HAND_POSES[phase].pos);
      outQuat.copy(DRINK_HAND_POSES[phase].quat);
    },
    setLeftElbowPose(rx: number, ry: number, rz: number) {
      left.elbowPivot.rotation.set(rx, ry, rz);
    },
    resetLeftElbowPose() {
      const lElb = LEFT_ELBOW_STANCES[currentStance];
      left.elbowPivot.rotation.set(lElb[0], lElb[1], lElb[2]);
    },
    setRightElbowPose(rx: number, ry: number, rz: number) {
      right.elbowPivot.rotation.set(rx, ry, rz);
    },
    resetRightElbowPose() {
      const rElb = RIGHT_ELBOW_STANCES[currentStance];
      right.elbowPivot.rotation.set(rElb[0], rElb[1], rElb[2]);
    },
    setTriggerFingerCurl(pull: number) {
      const rIdx = getRightIdxBase();
      const p =
        currentStance === 'sword' ||
        currentStance === 'flashlight' ||
        currentStance === 'unarmed'
          ? 0
          : THREE.MathUtils.clamp(pull, 0, 1);
      right.index.mcp.rotation.x = rIdx.mcpX + p * 0.24;
      right.index.pip.rotation.x = rIdx.pipX + p * 0.30;
      right.index.dip.rotation.x = rIdx.dipX + p * 0.22;
    },
    setFlashlightThumbPress(press01: number) {
      flashlightThumbPress = THREE.MathUtils.clamp(press01, 0, 1);
    },
    setLeftHandReloadPose(openBlend: number, slidePinchBlend: number) {
      const o = THREE.MathUtils.clamp(openBlend, 0, 1);
      const s = THREE.MathUtils.clamp(slidePinchBlend, 0, 1);
      const lBase = getLeftBase();

      // Keep fingers neatly together even while opening to grip magazine, shell, or top slide
      const mcpTarget = THREE.MathUtils.lerp(lBase.idx.mcpX, 0.56, o) + s * 0.44;
      const pipTarget = THREE.MathUtils.lerp(lBase.idx.pipX, 0.52, o) + s * 0.50;
      const dipTarget = THREE.MathUtils.lerp(lBase.idx.dipX, 0.34, o) + s * 0.26;

      left.index.mcp.rotation.x = mcpTarget;
      left.index.pip.rotation.x = pipTarget;
      left.index.dip.rotation.x = dipTarget;

      left.middle.mcp.rotation.x = mcpTarget + 0.04;
      left.middle.pip.rotation.x = pipTarget + 0.03;
      left.middle.dip.rotation.x = dipTarget + 0.02;

      left.ring.mcp.rotation.x = mcpTarget + 0.07;
      left.ring.pip.rotation.x = pipTarget + 0.05;
      left.ring.dip.rotation.x = dipTarget + 0.02;

      left.pinky.mcp.rotation.x = mcpTarget + 0.10;
      left.pinky.pip.rotation.x = pipTarget + 0.02;
      left.pinky.dip.rotation.x = dipTarget - 0.02;

      left.thumbBase.rotation.x = THREE.MathUtils.lerp(lBase.thm.baseX, 0.56, s);
      left.thumbBase.rotation.y = THREE.MathUtils.lerp(lBase.thm.baseY, -0.02, s);
      left.thumb.mcp.rotation.x = THREE.MathUtils.lerp(lBase.thm.mcpX, 0.36, s);
    },
    setPickupHandPose(reach01: number, grab01: number) {
      const r = THREE.MathUtils.clamp(reach01, 0, 1);
      const g = THREE.MathUtils.clamp(grab01, 0, 1);
      const lBase = getLeftBase();

      // Open hand wide during floor reach, then wrap fingers snugly around the 66mm cylinder in leftPalmSocket!
      const openMcp = 0.14;
      const openPip = 0.18;
      const openDip = 0.12;

      const grabMcp = 0.68;
      const grabPip = 0.64;
      const grabDip = 0.56;

      const targetMcp = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.idx.mcpX, openMcp, r),
        grabMcp,
        g,
      );
      const targetPip = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.idx.pipX, openPip, r),
        grabPip,
        g,
      );
      const targetDip = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.idx.dipX, openDip, r),
        grabDip,
        g,
      );

      const splay = r * (1 - g) * 0.11;

      left.index.mcp.rotation.set(targetMcp - 0.02 * g, lBase.idx.mcpY + splay, 0);
      left.index.pip.rotation.x = targetPip - 0.02 * g;
      left.index.dip.rotation.x = targetDip;

      left.middle.mcp.rotation.set(targetMcp, lBase.mid.mcpY + splay * 0.3, 0);
      left.middle.pip.rotation.x = targetPip + 0.02;
      left.middle.dip.rotation.x = targetDip + 0.02;

      left.ring.mcp.rotation.set(targetMcp + 0.03, lBase.rng.mcpY - splay * 0.4, 0);
      left.ring.pip.rotation.x = targetPip + 0.04;
      left.ring.dip.rotation.x = targetDip + 0.02;

      left.pinky.mcp.rotation.set(targetMcp + 0.06, lBase.pnk.mcpY - splay, 0);
      left.pinky.pip.rotation.x = targetPip + 0.04;
      left.pinky.dip.rotation.x = targetDip;

      // Opposing thumb clamps firmly across the near upper rim of the drink can / grabbed item!
      left.thumbBase.rotation.x = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.thm.baseX, -0.16, r),
        0.72,
        g,
      );
      left.thumbBase.rotation.y = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.thm.baseY, -0.44, r),
        -0.26,
        g,
      );
      left.thumbBase.rotation.z = THREE.MathUtils.lerp(lBase.thm.baseZ, 0.08, g);
      left.thumb.mcp.rotation.x = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.thm.mcpX, -0.10, r),
        0.30,
        g,
      );
      left.thumb.pip.rotation.x = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(lBase.thm.pipX, -0.08, r),
        0.26,
        g,
      );
    },
    updateAliveMotion(
      dt: number,
      elapsed: number,
      recoilClench: number,
      adsBlend: number,
      isReloading: boolean,
      triggerPull: number,
      moveActivity = 0,
    ) {
      smoothClench = THREE.MathUtils.damp(
        smoothClench,
        THREE.MathUtils.clamp(recoilClench, 0, 1),
        14,
        dt,
      );

      // Continuous organic wind-cloth simulation for the black leather jacket sleeves & cuff zipper pulls!
      // Runs even during reloads/swaps/drinks so the leather jacket always breathes & billows in the draft.
      const windMoveBoost = THREE.MathUtils.clamp(moveActivity, 0, 1.6);
      const ambientGust =
        0.52 +
        0.24 * Math.sin(elapsed * 0.82) +
        0.18 * Math.sin(elapsed * 2.15 + 1.1) +
        0.10 * Math.sin(elapsed * 4.6 + 0.4);
      const targetWindStrength = THREE.MathUtils.clamp(
        ambientGust + windMoveBoost * 0.78 + smoothClench * 0.70,
        0.28,
        1.78,
      );
      jacketWindStrength = THREE.MathUtils.damp(
        jacketWindStrength,
        targetWindStrength,
        5.5,
        dt,
      );
      jacketWindPhase += dt * (1.05 + windMoveBoost * 1.45 + smoothClench * 0.95);
      sleeveWindUniforms.uWindTime.value = jacketWindPhase;
      sleeveWindUniforms.uWindStrength.value = jacketWindStrength;
      // Gently swirling draft direction biased downwind (-Z) when moving/sprinting
      const swirlX = Math.sin(elapsed * 0.58) * 0.55 - 0.18;
      const swirlY = Math.cos(elapsed * 0.91) * 0.22 - 0.16;
      const swirlZ = -0.85 - windMoveBoost * 0.55;
      sleeveWindUniforms.uWindDir.value.set(swirlX, swirlY, swirlZ).normalize();

      // Spring-damped wind flutter & swing lag on the dangling gunmetal cuff zipper pulls
      const zipTargetL =
        0.18 +
        jacketWindStrength * 0.36 +
        Math.sin(jacketWindPhase * 4.9 + 0.7) * 0.22 * jacketWindStrength +
        Math.cos(jacketWindPhase * 8.1) * 0.09 * jacketWindStrength;
      const zipTargetR =
        0.18 +
        jacketWindStrength * 0.36 +
        Math.sin(jacketWindPhase * 5.2 + 2.1) * 0.22 * jacketWindStrength +
        Math.cos(jacketWindPhase * 7.8 + 1.0) * 0.09 * jacketWindStrength;
      const clampedDt = Math.min(dt, 0.05);
      leftZipVel += ((zipTargetL - leftZipSwing) * 42 - leftZipVel * 5.8) * clampedDt;
      leftZipSwing += leftZipVel * clampedDt;
      rightZipVel += ((zipTargetR - rightZipSwing) * 42 - rightZipVel * 5.8) * clampedDt;
      rightZipSwing += rightZipVel * clampedDt;

      left.zipperPullPivot.rotation.set(
        -0.22 - leftZipSwing * 0.58,
        -0.14 - leftZipSwing * 0.42,
        Math.sin(jacketWindPhase * 3.8) * 0.18 * jacketWindStrength,
      );
      right.zipperPullPivot.rotation.set(
        -0.22 - rightZipSwing * 0.58,
        0.14 + rightZipSwing * 0.42,
        -Math.sin(jacketWindPhase * 4.1 + 1.3) * 0.18 * jacketWindStrength,
      );

      if (isReloading) {
        fidgetActive = false;
        fidgetCooldown = 0.65;
        rig.fidgetWeaponRoll = THREE.MathUtils.damp(rig.fidgetWeaponRoll, 0, 14, dt);
        rig.fidgetWeaponPitch = THREE.MathUtils.damp(rig.fidgetWeaponPitch, 0, 14, dt);
        right.handGroup.rotation.set(0, 0, 0);
        right.handGroup.position.set(0, 0, 0);
        left.handGroup.rotation.set(0, 0, 0);
        left.handGroup.position.set(0, 0, 0);
        return;
      }

      // Very frequent, expressive, living hand activity every ~0.35–1.0 seconds!
      if (!fidgetActive) {
        if (smoothClench < 0.14 && triggerPull < 0.06) {
          fidgetCooldown -= dt * (1.0 + moveActivity * 0.4);
        }
        if (fidgetCooldown <= 0) {
          fidgetActive = true;
          fidgetTime = 0;
          fidgetType = (fidgetType + 1 + Math.floor(Math.random() * 5)) % 6;
          fidgetDuration = 0.88 + Math.random() * 0.44;
          fidgetCooldown = 0.35 + Math.random() * 0.65;
        }
      } else {
        fidgetTime += dt;
        if (fidgetTime >= fidgetDuration) {
          fidgetActive = false;
        }
      }

      // Expressive in hip-fire, gently restrained in ADS so sights stay razor-accurate
      const fidgetScale = THREE.MathUtils.lerp(1.0, 0.36, adsBlend);
      const u = fidgetActive ? THREE.MathUtils.clamp(fidgetTime / fidgetDuration, 0, 1) : 0;
      const bell = fidgetActive ? Math.sin(u * Math.PI) : 0;

      // Always-alive continuous finger breathing, tendon ripple & movement grip reactivity!
      const moveBoost = THREE.MathUtils.clamp(moveActivity, 0, 1.5);
      const breath = Math.sin(elapsed * 2.4) * (0.065 + moveBoost * 0.045) * fidgetScale;
      const microA = Math.sin(elapsed * 4.6 + 0.6) * (0.055 + moveBoost * 0.04) * fidgetScale;
      const microB = Math.cos(elapsed * 3.9 + 1.4) * (0.055 + moveBoost * 0.04) * fidgetScale;
      const continuousRipple = Math.sin(elapsed * 5.8) * 0.042 * fidgetScale;
      const continuousThumb = Math.sin(elapsed * 3.1 + 0.4) * 0.095 * fidgetScale;

      let lIdxOff = 0;
      let lMidOff = 0;
      let lRngOff = 0;
      let lPnkOff = 0;
      let rIdxOff = 0;
      let rMidOff = 0;
      let rRngOff = 0;
      let rPnkOff = 0;
      let lThumbLift = 0;
      let rThumbRoll = 0;
      let clenchPulse = smoothClench * 0.14 + moveBoost * 0.045 * Math.sin(elapsed * 7.5);
      let wristTwist = Math.sin(elapsed * 1.9) * 0.022 * fidgetScale;
      let wristPitch = Math.cos(elapsed * 2.3) * 0.018 * fidgetScale;
      let targetWepRoll = Math.sin(elapsed * 1.7) * 0.012 * fidgetScale;
      let targetWepPitch = Math.cos(elapsed * 2.2) * 0.008 * fidgetScale;

      if (fidgetActive) {
        if (fidgetType === 0) {
          // Energetic piano / drum-roll ripple across thick gloved knuckles (pinky -> index -> bounce back!)
          const wave = (center: number, width = 0.12) =>
            -Math.exp(-Math.pow((u - center) / width, 2)) * 0.66 * fidgetScale;
          lPnkOff = wave(0.16) + wave(0.82, 0.10) * 0.58;
          lRngOff = wave(0.32) + wave(0.70, 0.10) * 0.64;
          lMidOff = wave(0.48) + wave(0.58, 0.10) * 0.32;
          lIdxOff = wave(0.62);
          rPnkOff = wave(0.22) * 0.72;
          rRngOff = wave(0.38) * 0.72;
          rMidOff = wave(0.54) * 0.72;
          wristTwist += Math.sin(u * Math.PI * 2) * 0.075 * fidgetScale;
          targetWepRoll += Math.sin(u * Math.PI * 2) * 0.064 * fidgetScale;
        } else if (fidgetType === 1) {
          // Expressive rhythmic triple thumb drum-tap + synchronized index cadence bounce!
          const tripleTap = Math.pow(Math.abs(Math.sin(u * Math.PI * 3)), 1.15) * bell;
          lThumbLift = tripleTap * 0.72 * fidgetScale;
          rThumbRoll = Math.sin(u * Math.PI * 3) * 0.34 * fidgetScale;
          lIdxOff = -tripleTap * 0.24 * fidgetScale;
          rIdxOff = -tripleTap * 0.22 * fidgetScale;
          wristTwist += Math.sin(u * Math.PI * 3) * 0.042 * fidgetScale;
          targetWepPitch += -tripleTap * 0.032 * fidgetScale;
        } else if (fidgetType === 2) {
          // Big knuckle-crack / double grip-squeeze flex (open stretch -> strong clench -> pop!)
          const loosen = -Math.exp(-Math.pow((u - 0.18) / 0.12, 2)) * 0.38;
          const squeeze1 = Math.exp(-Math.pow((u - 0.45) / 0.12, 2)) * 0.32;
          const squeeze2 = Math.exp(-Math.pow((u - 0.75) / 0.11, 2)) * 0.26;
          clenchPulse += (loosen + squeeze1 + squeeze2) * fidgetScale;
          wristTwist += (squeeze1 - squeeze2) * 0.36 * fidgetScale;
          wristPitch += (squeeze1 + loosen) * 0.18 * fidgetScale;
          targetWepRoll += (loosen * 0.26 - squeeze1 * 0.30) * fidgetScale;
          targetWepPitch += squeeze1 * 0.12 * fidgetScale;
        } else if (fidgetType === 3) {
          // Playful rapid trigger-finger double-bounce + cheeky left pinky-ring wave!
          const dblBounce = Math.pow(Math.abs(Math.sin(u * Math.PI * 2.5)), 1.1) * bell;
          rIdxOff = -dblBounce * 0.52 * fidgetScale;
          lPnkOff = -Math.exp(-Math.pow((u - 0.48) / 0.15, 2)) * 0.62 * fidgetScale;
          lRngOff = -Math.exp(-Math.pow((u - 0.56) / 0.15, 2)) * 0.38 * fidgetScale;
          lMidOff = -Math.exp(-Math.pow((u - 0.64) / 0.15, 2)) * 0.22 * fidgetScale;
          rThumbRoll = bell * 0.28 * fidgetScale;
          targetWepRoll += -bell * 0.048 * fidgetScale;
        } else if (fidgetType === 4) {
          // Confident wrist inspect rock + quick all-knuckle re-clasp snap
          const tilt = Math.sin(u * Math.PI);
          const snap = Math.exp(-Math.pow((u - 0.74) / 0.10, 2));
          lIdxOff = (-tilt * 0.34 + snap * 0.24) * fidgetScale;
          lMidOff = (-tilt * 0.38 + snap * 0.26) * fidgetScale;
          lRngOff = (-tilt * 0.42 + snap * 0.26) * fidgetScale;
          lPnkOff = (-tilt * 0.46 + snap * 0.24) * fidgetScale;
          lThumbLift = tilt * 0.38 * fidgetScale;
          wristTwist += tilt * 0.105 * fidgetScale;
          wristPitch += tilt * 0.055 * fidgetScale;
          targetWepRoll += tilt * 0.118 * fidgetScale;
          targetWepPitch += tilt * 0.052 * fidgetScale;
        } else {
          // Alternating left-hand / right-hand tactile grip-shift & thumb stretch!
          const phaseA = Math.sin(u * Math.PI * 2);
          const stretch = Math.exp(-Math.pow((u - 0.35) / 0.16, 2));
          const regrip = Math.exp(-Math.pow((u - 0.72) / 0.14, 2));
          lIdxOff = (-stretch * 0.32 + regrip * 0.20) * fidgetScale;
          lMidOff = (-stretch * 0.26 + regrip * 0.22) * fidgetScale;
          rMidOff = (phaseA * 0.28) * fidgetScale;
          rRngOff = (-phaseA * 0.28) * fidgetScale;
          rPnkOff = (phaseA * 0.36) * fidgetScale;
          lThumbLift = (stretch * 0.42) * fidgetScale;
          rThumbRoll = (regrip * 0.30) * fidgetScale;
          wristTwist += phaseA * 0.062 * fidgetScale;
          targetWepRoll += phaseA * 0.055 * fidgetScale;
        }
      }

      rig.fidgetWeaponRoll = THREE.MathUtils.damp(
        rig.fidgetWeaponRoll,
        targetWepRoll,
        11,
        dt,
      );
      rig.fidgetWeaponPitch = THREE.MathUtils.damp(
        rig.fidgetWeaponPitch,
        targetWepPitch,
        11,
        dt,
      );

      // Apply living joint motion to LEFT hand fingers (stance-aware)
      const lBase = getLeftBase();
      const rIdxBase = getRightIdxBase();
      const rThmBase = getRightThmBase();

      const applyFinger = (
        f: FingerJoints,
        base: { mcpX: number; pipX: number; dipX: number },
        delta: number,
      ) => {
        f.mcp.rotation.x = base.mcpX + delta;
        f.pip.rotation.x = base.pipX + delta * 1.15;
        f.dip.rotation.x = base.dipX + delta * 0.70;
      };

      applyFinger(left.index, lBase.idx, breath + microA + continuousRipple + clenchPulse + lIdxOff);
      applyFinger(left.middle, lBase.mid, breath - microB + continuousRipple * 0.5 + clenchPulse + lMidOff);
      applyFinger(left.ring, lBase.rng, breath + microB - continuousRipple * 0.5 + clenchPulse + lRngOff);
      applyFinger(left.pinky, lBase.pnk, breath - microA - continuousRipple + clenchPulse + lPnkOff);

      // Left thumb living drum-tap & continuous restless motion
      left.thumbBase.rotation.x =
        lBase.thm.baseX - lThumbLift * 0.78 + breath * 0.85 + continuousThumb;
      left.thumbBase.rotation.y = lBase.thm.baseY - lThumbLift * 0.42 + microA * 0.5;
      left.thumb.mcp.rotation.x = lBase.thm.mcpX + lThumbLift * 0.64 + microA * 1.2;
      left.thumb.pip.rotation.x = lBase.thm.pipX + lThumbLift * 0.48 + microB;

      // Apply living joint motion to RIGHT hand fingers
      const p =
        currentStance === 'sword' || currentStance === 'flashlight'
          ? 0
          : THREE.MathUtils.clamp(triggerPull, 0, 1);
      right.index.mcp.rotation.x =
        rIdxBase.mcpX + p * 0.24 + rIdxOff * 0.90 + microA * 1.1;
      right.index.pip.rotation.x =
        rIdxBase.pipX + p * 0.30 + rIdxOff * 1.18 + microB * 0.7;
      right.index.dip.rotation.x = rIdxBase.dipX + p * 0.22 + rIdxOff * 0.70;

      applyFinger(right.middle, getRightMidBase(), breath + microB + clenchPulse * 0.9 + rMidOff);
      applyFinger(right.ring, getRightRngBase(), breath - microA + clenchPulse * 0.9 + rRngOff);
      applyFinger(right.pinky, getRightPnkBase(), breath + microA + clenchPulse * 0.9 + rPnkOff);

      // Right thumb: outward-clearing playful fidget on guns/sword, crisp thumb press on plain flashlight!
      if (currentStance === 'flashlight') {
        right.thumbBase.rotation.x =
          rThmBase.baseX + flashlightThumbPress * 0.14 + breath * 0.18;
        right.thumb.mcp.rotation.x =
          rThmBase.mcpX + flashlightThumbPress * 0.18 + microB * 0.35;
        right.thumb.pip.rotation.x =
          rThmBase.pipX + flashlightThumbPress * 0.22;
      } else {
        right.thumbBase.rotation.x =
          rThmBase.baseX + Math.max(0, rThumbRoll) * 0.44 + Math.abs(continuousThumb) * 0.55;
        right.thumb.mcp.rotation.x =
          rThmBase.mcpX - Math.abs(rThumbRoll) * 0.52 - Math.abs(microB) * 0.9;
        right.thumb.pip.rotation.x =
          rThmBase.pipX - Math.abs(rThumbRoll) * 0.46;
      }

      // Animate dorsal knuckle domes popping & flexing clearly with every drum-roll & clench!
      const lDeltas = [lIdxOff, lMidOff, lRngOff, lPnkOff];
      const rDeltas = [rIdxOff, rMidOff, rRngOff, rPnkOff];
      for (let i = 0; i < 4; i++) {
        const lFlex = Math.max(-0.0018, (clenchPulse - lDeltas[i] * 0.50) * 0.024);
        left.knuckleDomes[i].position.y = left.knuckleBaseY[i] + lFlex;
        left.knuckleDomes[i].scale.setScalar(1 + lFlex * 30);

        const rFlex = Math.max(-0.0018, (clenchPulse - rDeltas[i] * 0.50) * 0.024);
        right.knuckleDomes[i].position.y = right.knuckleBaseY[i] + rFlex;
        right.knuckleDomes[i].scale.setScalar(1 + rFlex * 30);
      }

      // Expressive living micro-roll, pitch & palm shift in each gloved hand
      left.handGroup.rotation.set(clenchPulse * 0.11 + wristPitch, 0, wristTwist);
      right.handGroup.rotation.set(clenchPulse * 0.09 - wristPitch * 0.65, 0, -wristTwist * 0.78);
      left.handGroup.position.set(
        Math.sin(elapsed * 2.2) * 0.0016 * fidgetScale,
        Math.cos(elapsed * 3.1) * 0.0018 * fidgetScale,
        0,
      );
      right.handGroup.position.set(
        -Math.sin(elapsed * 2.0 + 0.5) * 0.0012 * fidgetScale,
        Math.sin(elapsed * 2.9) * 0.0014 * fidgetScale,
        0,
      );
    },
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };

  return rig;
}
