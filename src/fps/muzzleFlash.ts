import * as THREE from 'three';

export type MuzzleFlashProfile = 'pistol' | 'smg' | 'shotgun';

export interface VolumetricMuzzleFlashRig {
  group: THREE.Group;
  light: THREE.PointLight;
  setIntensity: (intensity: number) => void;
  dispose: () => void;
}

const MUZZLE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Volumetric 3D flame cone / shock-diamond jet shader (zero flat card edges!)
const PLUME_FRAG = /* glsl */ `
  precision highp float;

  uniform float uIntensity;
  uniform float uSeed;
  uniform float uTime;
  uniform vec3 uTint;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.34, 311.71));
    p += dot(p, p + 34.45);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.08 + vec2(13.7, 7.3);
      a *= 0.48;
    }
    return v;
  }

  // Physically motivated blackbody fire ramp (1500K crimson -> 2600K orange -> 4200K gold -> 6000K white-blue core)
  vec3 blackbodyFire(float t) {
    vec3 c0 = vec3(0.42, 0.04, 0.005);
    vec3 c1 = vec3(1.15, 0.28, 0.03);
    vec3 c2 = vec3(1.95, 0.92, 0.24);
    vec3 c3 = vec3(2.85, 2.35, 1.45);
    vec3 c4 = vec3(3.4, 3.35, 3.6);
    vec3 col = mix(c0, c1, smoothstep(0.0, 0.28, t));
    col = mix(col, c2, smoothstep(0.24, 0.56, t));
    col = mix(col, c3, smoothstep(0.52, 0.82, t));
    col = mix(col, c4, smoothstep(0.80, 1.0, t));
    return col;
  }

  void main() {
    // vUv.y: 0 at muzzle exit, 1 at forward flame tip
    float along = clamp(vUv.y, 0.0, 1.0);
    float angle = vUv.x * 6.2831853;

    // Soften silhouette edges via view-normal grazing Fresnel so 3D shell feels volumetric
    float ndotv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float edgeSoft = pow(smoothstep(0.06, 0.72, ndotv), 0.75);

    // Seamless cylindrical noise coordinates with per-shot seed
    vec2 nCoord = vec2(cos(angle) * 2.1 + uSeed * 7.3, sin(angle) * 2.1 + along * 5.2 - uTime * 3.0);
    float turb = fbm(nCoord);
    float detail = fbm(nCoord * 2.4 + vec2(uSeed * 3.1, -along * 3.5));

    // Mach shock-diamond pressure rings near barrel throat
    float diamonds = pow(max(0.0, sin(along * 16.5 - 0.5)), 4.0) * exp(-along * 2.6) * 0.55;

    // Longitudinal falloff with jagged turbulent flame tongues
    float tipCut = smoothstep(1.0, 0.22 + turb * 0.42, along);
    float rootFade = smoothstep(0.0, 0.09, along);

    float density = (tipCut * rootFade * (0.48 + turb * 0.72 + detail * 0.32) + diamonds) * edgeSoft;
    float heat = clamp((1.0 - along * 0.85) * 0.92 + turb * 0.34 + diamonds * 0.65, 0.0, 1.0);

    // Cooling as flash decays
    heat *= (0.58 + 0.48 * uIntensity);
    float alpha = clamp(density * uIntensity * 1.45, 0.0, 1.0);
    if (alpha < 0.01) discard;

    vec3 color = blackbodyFire(heat) * uTint * (0.85 + uIntensity * 1.15);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

// Radial starburst gas crown & compensator side-port blast shader
const STAR_FRAG = /* glsl */ `
  precision highp float;

  uniform float uIntensity;
  uniform float uSeed;
  uniform float uSpikes;
  uniform vec3 uTint;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  vec3 blackbody(float t) {
    vec3 c0 = vec3(0.55, 0.07, 0.01);
    vec3 c1 = vec3(1.45, 0.42, 0.05);
    vec3 c2 = vec3(2.35, 1.35, 0.42);
    vec3 c3 = vec3(3.4, 3.15, 2.55);
    vec3 col = mix(c0, c1, smoothstep(0.0, 0.34, t));
    col = mix(col, c2, smoothstep(0.30, 0.68, t));
    col = mix(col, c3, smoothstep(0.65, 1.0, t));
    return col;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float ang = atan(p.y, p.x);
    float n1 = vnoise(vec2(ang * 3.2 + uSeed * 11.7, r * 6.5));
    float n2 = vnoise(vec2(ang * 7.5 - uSeed * 5.3, r * 11.0 + uSeed * 2.1));

    // Compensator gas jets / muzzle crown spikes
    float lobe = pow(max(0.0, cos(ang * uSpikes + uSeed * 6.2831)), 3.2);
    float subLobe = pow(max(0.0, cos(ang * (uSpikes * 2.0) - uSeed * 4.1)), 5.0) * 0.45;
    float rayLen = 0.24 + (lobe + subLobe) * (0.48 + 0.34 * n1) + n2 * 0.16;

    // Hot incandescent core + jagged gas rays
    float core = exp(-r * r * 14.0) * 1.45;
    float rays = smoothstep(rayLen, rayLen * 0.12, r) * (0.55 + 0.55 * n1);
    float halo = exp(-r * r * 3.8) * 0.32;

    float mask = clamp(core + rays * 0.85 + halo, 0.0, 1.4);
    // Guarantee zero hard quad border
    mask *= smoothstep(1.0, 0.72, r);

    float heat = clamp(core * 0.85 + (1.0 - r) * 0.55 + n2 * 0.2, 0.0, 1.0) * (0.62 + 0.42 * uIntensity);
    float alpha = clamp(mask * uIntensity, 0.0, 1.0);
    if (alpha < 0.01) discard;

    vec3 col = blackbody(heat) * uTint * (0.85 + uIntensity * 1.25);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// Hot incandescent micro-ember spray shader (drifting radial sparks right out of the bore)
const EMBER_FRAG = /* glsl */ `
  precision highp float;

  uniform float uIntensity;
  uniform float uSeed;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float ang = atan(p.y, p.x);
    float sector = floor((ang + 3.1415926) * 5.5);
    float h = hash21(vec2(sector, floor(uSeed * 97.0)));
    float sparkR = mix(0.28, 0.88, h) * (1.22 - uIntensity * 0.35);
    float angCenter = ((sector + 0.5) / 5.5) - 3.1415926;
    float dAng = abs(ang - angCenter);

    float streak = smoothstep(0.055, 0.008, dAng) *
      smoothstep(0.16, 0.0, abs(r - sparkR)) *
      step(0.32, h);

    float haze = exp(-r * r * 4.5) * 0.16;
    float alpha = clamp((streak * 1.35 + haze) * uIntensity * smoothstep(1.0, 0.82, r), 0.0, 1.0);
    if (alpha < 0.01) discard;

    vec3 col = mix(vec3(1.4, 0.45, 0.06), vec3(3.2, 2.3, 1.1), clamp(streak, 0.0, 1.0));
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

/**
 * Builds a tapered open-ended volumetric flame shell oriented along -Z (forward from muzzle).
 * UV.y = 0 at muzzle exit (z = 0), UV.y = 1 at forward flame tip (z = -length).
 */
function createFlameShellGeometry(
  baseRadius: number,
  midRadius: number,
  tipRadius: number,
  length: number,
  radialSegments = 18,
  heightSegments = 8,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    tipRadius,
    baseRadius,
    length,
    radialSegments,
    heightSegments,
    true,
  );
  // Bulge midsection slightly like expanding supersonic propellant gas
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const yNorm = pos.getY(i) / length + 0.5; // 0 at base, 1 at tip
    const bulge = Math.sin(yNorm * Math.PI) * (midRadius / Math.max(0.001, baseRadius));
    const scale = 1 + bulge * 0.65;
    pos.setX(i, pos.getX(i) * scale);
    pos.setZ(i, pos.getZ(i) * scale);
  }
  pos.needsUpdate = true;
  // Cylinder default axis is +Y centered at 0; rotate so base is at z=0 and tip points to -Z
  geo.translate(0, length * 0.5, 0);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a photorealistic, physically-shaded volumetric GLSL muzzle flash assembly
 * (Mach shock-diamond inner core + turbulent outer fireball shell + compensator star jets +
 * incandescent cordite ember spray + warm dynamic point light).
 * Zero per-frame allocations!
 */
export function createPhotorealisticMuzzleFlash(options: {
  profile: MuzzleFlashProfile;
  scale?: number;
  tintHex?: number;
  lightRange?: number;
  lightIntensity?: number;
}): VolumetricMuzzleFlashRig {
  const {
    profile,
    scale = 1.0,
    tintHex = 0xffc88a,
    lightRange = profile === 'shotgun' ? 8.5 : 5.8,
    lightIntensity = profile === 'shotgun' ? 11.5 : profile === 'smg' ? 7.8 : 7.2,
  } = options;

  const group = new THREE.Group();
  group.name = `VolumetricMuzzleFlash_${profile}`;
  group.visible = false;

  const disposables: Array<{ dispose: () => void }> = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const tintColor = new THREE.Color(tintHex);
  const sharedUniforms = {
    uIntensity: { value: 0 },
    uSeed: { value: 0.37 },
    uTime: { value: 0 },
    uTint: { value: tintColor },
  };

  const outerPlumeMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: sharedUniforms.uIntensity,
      uSeed: sharedUniforms.uSeed,
      uTime: sharedUniforms.uTime,
      uTint: sharedUniforms.uTint,
    },
    vertexShader: MUZZLE_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const innerCoreMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: sharedUniforms.uIntensity,
      uSeed: { value: 1.73 },
      uTime: sharedUniforms.uTime,
      uTint: { value: new THREE.Color(0xfff4dd) },
    },
    vertexShader: MUZZLE_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const spikes = profile === 'shotgun' ? 4.0 : profile === 'smg' ? 3.0 : 2.0;
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: sharedUniforms.uIntensity,
      uSeed: sharedUniforms.uSeed,
      uSpikes: { value: spikes },
      uTint: sharedUniforms.uTint,
    },
    vertexShader: MUZZLE_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const emberMat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: sharedUniforms.uIntensity,
      uSeed: sharedUniforms.uSeed,
    },
    vertexShader: MUZZLE_VERT,
    fragmentShader: EMBER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  disposables.push(outerPlumeMat, innerCoreMat, starMat, emberMat);

  // Dimensions tuned per caliber
  const plumeLen =
    (profile === 'shotgun' ? 0.34 : profile === 'smg' ? 0.21 : 0.165) * scale;
  const plumeBaseR =
    (profile === 'shotgun' ? 0.024 : profile === 'smg' ? 0.014 : 0.011) * scale;
  const plumeMidR =
    (profile === 'shotgun' ? 0.072 : profile === 'smg' ? 0.042 : 0.032) * scale;
  const plumeTipR =
    (profile === 'shotgun' ? 0.018 : profile === 'smg' ? 0.009 : 0.007) * scale;

  // 1. Volumetric outer propellant fireball shell
  const outerPlume = new THREE.Mesh(
    trackGeo(createFlameShellGeometry(plumeBaseR, plumeMidR, plumeTipR, plumeLen, 18, 8)),
    outerPlumeMat,
  );
  outerPlume.renderOrder = 10;
  group.add(outerPlume);

  // 2. Incandescent Mach shock-diamond inner jet (bright white-gold core inside fireball)
  const innerCore = new THREE.Mesh(
    trackGeo(
      createFlameShellGeometry(
        plumeBaseR * 0.58,
        plumeMidR * 0.42,
        plumeTipR * 0.35,
        plumeLen * 0.72,
        14,
        6,
      ),
    ),
    innerCoreMat,
  );
  innerCore.position.z = -0.003 * scale;
  innerCore.renderOrder = 11;
  group.add(innerCore);

  // 3. Compensator / muzzle-brake radial gas crown (two slightly offset discs for 3D depth)
  const starSize =
    (profile === 'shotgun' ? 0.28 : profile === 'smg' ? 0.18 : 0.145) * scale;
  const starGeo = trackGeo(new THREE.PlaneGeometry(starSize, starSize));
  const starFront = new THREE.Mesh(starGeo, starMat);
  starFront.position.z = -0.008 * scale;
  starFront.renderOrder = 11;
  group.add(starFront);

  const starMid = new THREE.Mesh(starGeo, starMat);
  starMid.position.z = -plumeLen * 0.22;
  starMid.rotation.z = 0.78;
  starMid.scale.setScalar(0.72);
  starMid.renderOrder = 10;
  group.add(starMid);

  // 4. Side compensator port V-jets (authentic sideways muzzle-brake blast!)
  const sideJetLen =
    (profile === 'shotgun' ? 0.145 : profile === 'smg' ? 0.105 : 0.082) * scale;
  const sideJetGeo = trackGeo(
    createFlameShellGeometry(
      plumeBaseR * 0.48,
      plumeMidR * 0.36,
      0.003 * scale,
      sideJetLen,
      10,
      4,
    ),
  );
  const leftJet = new THREE.Mesh(sideJetGeo, outerPlumeMat);
  leftJet.position.set(-0.005 * scale, 0.002 * scale, -0.006 * scale);
  leftJet.rotation.y = Math.PI * 0.46;
  leftJet.rotation.x = 0.16;
  leftJet.renderOrder = 10;
  group.add(leftJet);

  const rightJet = new THREE.Mesh(sideJetGeo, outerPlumeMat);
  rightJet.position.set(0.005 * scale, 0.002 * scale, -0.006 * scale);
  rightJet.rotation.y = -Math.PI * 0.46;
  rightJet.rotation.x = 0.16;
  rightJet.renderOrder = 10;
  group.add(rightJet);

  // 5. Incandescent cordite ember spray & warm atmospheric heat haze
  const emberSize = starSize * 1.48;
  const emberPlane = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(emberSize, emberSize)),
    emberMat,
  );
  emberPlane.position.z = -plumeLen * 0.28;
  emberPlane.renderOrder = 12;
  group.add(emberPlane);

  // 6. Real-time warm explosive light illuminating barrel ridges, gloves, and room walls
  const light = new THREE.PointLight(tintHex, 0, lightRange, 1.8);
  light.position.set(0, 0.018 * scale, -0.045 * scale);
  group.add(light);

  let prevIntensity = 0;

  return {
    group,
    light,
    setIntensity(intensity: number) {
      if (intensity <= 0.015) {
        group.visible = false;
        light.intensity = 0;
        prevIntensity = 0;
        return;
      }

      // Fresh stochastic plasma shape on each new ignition peak!
      if (intensity > prevIntensity + 0.18 || prevIntensity <= 0.015) {
        const seed = Math.random();
        sharedUniforms.uSeed.value = seed;
        innerCoreMat.uniforms.uSeed.value = (seed * 3.71 + 0.41) % 1.0;
        group.rotation.z = (Math.random() - 0.5) * 0.85;
        starFront.rotation.z = Math.random() * Math.PI * 2;
        emberPlane.rotation.z = Math.random() * Math.PI * 2;
      }
      prevIntensity = intensity;

      group.visible = true;
      sharedUniforms.uIntensity.value = intensity;
      sharedUniforms.uTime.value = (1 - intensity) * 1.4;

      // Rapid ballistic expansion & slight elongation along bore axis
      const expand = 0.72 + Math.pow(intensity, 0.55) * 0.58;
      const stretch = 0.78 + intensity * 0.46;
      group.scale.set(expand, expand, stretch);

      // Flickering intense light spill onto receiver curves, ridges & gloved hands
      light.intensity = Math.pow(intensity, 0.72) * lightIntensity;
    },
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
