import * as THREE from 'three';
import { createBlankRoomTextures } from './textures';

export type LightingPreset = 'daylight' | 'moody';

export interface BlankRoomResult {
  group: THREE.Group;
  shootableMeshes: THREE.Mesh[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  setLightingPreset: (preset: LightingPreset) => void;
  dispose: () => void;
}

/**
 * Builds a clean, blank architectural concrete/plaster firing room with
 * motivated recessed overhead lighting and balanced warm/cool PBR illumination.
 */
export function buildBlankRoom(
  scene: THREE.Scene,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
): BlankRoomResult {
  const group = new THREE.Group();
  group.name = 'BlankArchitecturalRoom';

  const textures = createBlankRoomTextures(maxAnisotropy);
  const disposables: Array<{ dispose: () => void }> = [textures];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const width = 14;
  const depth = 20;
  const height = 4.6;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd9dde2,
    map: textures.wallMap,
    roughness: 0.88,
    metalness: 0.02,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xb7bdc5,
    map: textures.floorMap,
    roughness: 0.72,
    metalness: 0.04,
  });

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xcbd0d6,
    roughness: 0.92,
    metalness: 0.0,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x3b4048,
    roughness: 0.62,
    metalness: 0.15,
  });

  const panelEmissiveMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff8ee,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  });

  disposables.push(wallMat, floorMat, ceilingMat, trimMat, panelEmissiveMat);

  const shootableMeshes: THREE.Mesh[] = [];

  // Floor
  const floor = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(width, depth)),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  shootableMeshes.push(floor);

  // Ceiling
  const ceiling = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(width, depth)),
    ceilingMat,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  group.add(ceiling);
  shootableMeshes.push(ceiling);

  // Front blank firing wall (where the player naturally faces along -Z)
  const frontWall = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(width, height)),
    wallMat,
  );
  frontWall.position.set(0, height / 2, -depth / 2);
  frontWall.receiveShadow = true;
  group.add(frontWall);
  shootableMeshes.push(frontWall);

  // Back wall
  const backWall = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(width, height)),
    wallMat,
  );
  backWall.rotation.y = Math.PI;
  backWall.position.set(0, height / 2, depth / 2);
  backWall.receiveShadow = true;
  group.add(backWall);
  shootableMeshes.push(backWall);

  // Left wall
  const leftWall = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(depth, height)),
    wallMat,
  );
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width / 2, height / 2, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);
  shootableMeshes.push(leftWall);

  // Right wall
  const rightWall = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(depth, height)),
    wallMat,
  );
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(width / 2, height / 2, 0);
  rightWall.receiveShadow = true;
  group.add(rightWall);
  shootableMeshes.push(rightWall);

  // Subtle architectural dark baseboard skirting (grounds the walls cleanly to the floor)
  const skirtH = 0.11;
  const skirtFront = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(width, skirtH, 0.03)),
    trimMat,
  );
  skirtFront.position.set(0, skirtH / 2, -depth / 2 + 0.015);
  group.add(skirtFront);

  const skirtBack = skirtFront.clone();
  skirtBack.position.z = depth / 2 - 0.015;
  group.add(skirtBack);

  const skirtLeft = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.03, skirtH, depth)),
    trimMat,
  );
  skirtLeft.position.set(-width / 2 + 0.015, skirtH / 2, 0);
  group.add(skirtLeft);

  const skirtRight = skirtLeft.clone();
  skirtRight.position.x = width / 2 - 0.015;
  group.add(skirtRight);

  // Motivated overhead recessed LED ceiling light strips
  const housingGeo = trackGeo(new THREE.BoxGeometry(2.6, 0.05, 0.42));
  const diffuserGeo = trackGeo(new THREE.PlaneGeometry(2.48, 0.34));
  const lightZPositions = [-6.2, -1.5, 3.2, 7.2];
  for (const lz of lightZPositions) {
    for (const lx of [-2.8, 2.8]) {
      const housing = new THREE.Mesh(housingGeo, trimMat);
      housing.position.set(lx, height - 0.025, lz);
      group.add(housing);

      const diffuser = new THREE.Mesh(diffuserGeo, panelEmissiveMat);
      diffuser.rotation.x = Math.PI / 2;
      diffuser.position.set(lx, height - 0.052, lz);
      group.add(diffuser);
    }
  }

  scene.add(group);

  // =========================================================================
  // MOTIVATED 3-POINT + HEMISPHERE STUDIO LIGHTING RIG
  // =========================================================================
  const hemiLight = new THREE.HemisphereLight(0xdce6f2, 0x5c6066, 0.9);
  scene.add(hemiLight);

  // Warm key directional light angling across the hands & pistol from upper-left-front
  const keyLight = new THREE.DirectionalLight(0xfff1df, 1.85);
  keyLight.position.set(-3.2, 4.3, 3.8);
  keyLight.target.position.set(0, 1.2, -3.0);
  scene.add(keyLight.target);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  // Cool grazing rim light from upper-right-front to sculpt knuckles, skin pores & slide bevels
  const rimLight = new THREE.DirectionalLight(0xc2d8f8, 0.85);
  rimLight.position.set(4.5, 3.6, -4.5);
  scene.add(rimLight);

  // Subtle practical overhead point fill right above the player bay
  const bayLight = new THREE.PointLight(0xf6f0e6, 2.2, 16, 1.6);
  bayLight.position.set(0.4, 4.1, 2.4);
  scene.add(bayLight);

  const bgColor = new THREE.Color(0xcbd1d8);
  scene.background = bgColor;
  scene.fog = new THREE.FogExp2(0xcbd1d8, 0.018);

  const setLightingPreset = (preset: LightingPreset) => {
    if (preset === 'daylight') {
      wallMat.color.setHex(0xd9dde2);
      floorMat.color.setHex(0xb7bdc5);
      ceilingMat.color.setHex(0xcbd0d6);
      panelEmissiveMat.emissive.setHex(0xfff8ee);
      panelEmissiveMat.emissiveIntensity = 2.2;
      hemiLight.color.setHex(0xdce6f2);
      hemiLight.groundColor.setHex(0x5c6066);
      hemiLight.intensity = 0.92;
      keyLight.color.setHex(0xfff1df);
      keyLight.intensity = 1.85;
      rimLight.color.setHex(0xc2d8f8);
      rimLight.intensity = 0.88;
      bayLight.intensity = 2.2;
      bgColor.setHex(0xcbd1d8);
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.setHex(0xcbd1d8);
        scene.fog.density = 0.016;
      }
    } else {
      // Moody cool-desaturated overhead range lighting (high contrast on hands & glowing tritium sights!)
      wallMat.color.setHex(0x5b636e);
      floorMat.color.setHex(0x3f464f);
      ceilingMat.color.setHex(0x373c44);
      panelEmissiveMat.emissive.setHex(0xdceeff);
      panelEmissiveMat.emissiveIntensity = 1.35;
      hemiLight.color.setHex(0x7c93ad);
      hemiLight.groundColor.setHex(0x1e2228);
      hemiLight.intensity = 0.55;
      keyLight.color.setHex(0xffe7cc);
      keyLight.intensity = 1.45;
      rimLight.color.setHex(0x88b4e6);
      rimLight.intensity = 1.05;
      bayLight.intensity = 1.5;
      bgColor.setHex(0x2b313a);
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.setHex(0x2b313a);
        scene.fog.density = 0.036;
      }
    }
  };

  return {
    group,
    shootableMeshes,
    bounds: {
      minX: -width / 2 + 0.75,
      maxX: width / 2 - 0.75,
      minZ: -depth / 2 + 1.0,
      maxZ: depth / 2 - 0.9,
    },
    setLightingPreset,
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
