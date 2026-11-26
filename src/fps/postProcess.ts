import * as THREE from 'three';

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }
`;

// High-threshold luminance extract + 9-tap separable Gaussian blur (pass 1 = H, pass 2 = V)
const GAUSSIAN_BLOOM_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tInput;
  uniform vec2 uTexelStep;
  uniform float uThreshold;
  uniform float uExtract;

  varying vec2 vUv;

  vec3 sampleColor(vec2 uv) {
    vec3 c = texture2D(tInput, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
    if (uExtract > 0.5) {
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float knee = smoothstep(uThreshold * 0.72, uThreshold * 1.38, lum);
      return c * knee;
    }
    return c;
  }

  void main() {
    // True normalized 9-tap Gaussian kernel (sigma ~ 2.0)
    vec3 sum = sampleColor(vUv) * 0.22702703;
    sum += (sampleColor(vUv + uTexelStep * 1.3846154) + sampleColor(vUv - uTexelStep * 1.3846154)) * 0.31621622;
    sum += (sampleColor(vUv + uTexelStep * 3.2307692) + sampleColor(vUv - uTexelStep * 3.2307692)) * 0.07027027;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// Wide separable creamy F/1.2 prime-lens bokeh depth-of-field blur for out-of-focus background while drinking
const BOKEH_DOF_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tInput;
  uniform vec2 uTexelStep;

  varying vec2 vUv;

  void main() {
    // Smooth wide 13-tap Gaussian/bokeh kernel with slight highlight bokeh lift
    vec3 c0 = texture2D(tInput, clamp(vUv, vec2(0.001), vec2(0.999))).rgb;
    vec3 c1 = texture2D(tInput, clamp(vUv + uTexelStep * 1.42, vec2(0.001), vec2(0.999))).rgb +
              texture2D(tInput, clamp(vUv - uTexelStep * 1.42, vec2(0.001), vec2(0.999))).rgb;
    vec3 c2 = texture2D(tInput, clamp(vUv + uTexelStep * 3.28, vec2(0.001), vec2(0.999))).rgb +
              texture2D(tInput, clamp(vUv - uTexelStep * 3.28, vec2(0.001), vec2(0.999))).rgb;
    vec3 c3 = texture2D(tInput, clamp(vUv + uTexelStep * 5.20, vec2(0.001), vec2(0.999))).rgb +
              texture2D(tInput, clamp(vUv - uTexelStep * 5.20, vec2(0.001), vec2(0.999))).rgb;

    vec3 sum = c0 * 0.196 + c1 * 0.184 + c2 * 0.132 + c3 * 0.086;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// Fullscreen alpha-blended bokeh background copy back onto HDR scene target before Layer-1 sharp foreground draw
const DOF_BLIT_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tBlurred;
  uniform float uBlend;

  varying vec2 vUv;

  void main() {
    vec3 col = texture2D(tBlurred, clamp(vUv, vec2(0.001), vec2(0.999))).rgb;
    gl_FragColor = vec4(col, uBlend);
  }
`;

// Final optical camera composite:
//  - Tasteful Gaussian-weighted directional camera motion blur (restrained, center-sharp)
//  - Micro-Gaussian peripheral cinema-lens softness
//  - Optical bloom/halation from muzzle flash, gun neon LEDs, tritium sights & specular steel glints
//  - Subtle 35mm optical grain, natural vignette & ACES Filmic tone mapping -> sRGB
const OPTICAL_COMPOSITE_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2 uResolution;
  uniform vec2 uMotionVec;      // Directional camera/recoil velocity in UV space (already clamped!)
  uniform float uSpeedBlur;     // Subtle radial sprint/slide motion blur (0..1)
  uniform float uBloomStrength; // Optical neon/flash bloom weight
  uniform float uFlashHalation; // Momentary muzzle-flash warm optical glow (0..1)
  uniform float uShotImpact;    // Crisp momentary Gaussian concussion blur on gunshot / toss whip (0..1)
  uniform float uTime;

  varying vec2 vUv;

  // ACES Filmic tone mapping (matching Three.js ACESFilmicToneMapping)
  vec3 acesFilmic(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  vec3 linearToSrgb(vec3 c) {
    return mix(
      c * 12.92,
      1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), c)
    );
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    vec2 texel = 1.0 / uResolution;

    // Preserve razor-sharp sightline around crosshair while giving natural cinema shutter silkiness
    float radialMask = mix(0.42, 1.0, smoothstep(0.08, 0.58, dist));
    vec2 radialDir = dist > 0.0001 ? (centered / dist) : vec2(0.0);

    // Combine restrained directional turn/recoil blur + subtle sprint/slide & shot-impact radial streak
    vec2 blurVec = uMotionVec * radialMask + radialDir * ((uSpeedBlur * 0.0085 + uShotImpact * 0.0072) * dist);
    float blurMag = length(blurVec);

    vec3 color;
    if (blurMag > 0.00035) {
      // 7-tap Gaussian-bell-weighted directional motion blur (butter-smooth, zero ghost stepping!)
      const float w0 = 0.266;
      const float w1 = 0.213;
      const float w2 = 0.114;
      const float w3 = 0.040;
      color = texture2D(tScene, vUv).rgb * w0;
      color += (texture2D(tScene, clamp(vUv + blurVec * 0.33, 0.001, 0.999)).rgb +
                texture2D(tScene, clamp(vUv - blurVec * 0.33, 0.001, 0.999)).rgb) * w1;
      color += (texture2D(tScene, clamp(vUv + blurVec * 0.67, 0.001, 0.999)).rgb +
                texture2D(tScene, clamp(vUv - blurVec * 0.67, 0.001, 0.999)).rgb) * w2;
      color += (texture2D(tScene, clamp(vUv + blurVec * 1.00, 0.001, 0.999)).rgb +
                texture2D(tScene, clamp(vUv - blurVec * 1.00, 0.001, 0.999)).rgb) * w3;
    } else {
      color = texture2D(tScene, vUv).rgb;
    }

    // Crisp, restrained Gaussian concussion pulse on gunshot / heavy whip (keeps crosshair readable while you FEEL the shot!)
    if (uShotImpact > 0.005) {
      float gRad = (1.6 + uShotImpact * 2.4) * mix(0.45, 1.25, smoothstep(0.05, 0.62, dist));
      vec2 gx = vec2(texel.x * gRad, 0.0);
      vec2 gy = vec2(0.0, texel.y * gRad);
      vec3 gImp =
        color * 0.25 +
        (texture2D(tScene, clamp(vUv + gx, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv - gx, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv + gy, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv - gy, 0.001, 0.999)).rgb) * 0.125 +
        (texture2D(tScene, clamp(vUv + gx + gy, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv - gx + gy, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv + gx - gy, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv - gx - gy, 0.001, 0.999)).rgb) * 0.0625;
      float impMix = uShotImpact * mix(0.28, 0.68, smoothstep(0.08, 0.65, dist));
      color = mix(color, gImp, impMix);
    }

    // Ultra-subtle cinema prime-lens peripheral Gaussian softness at outer frame corners
    float edgeBlurAmt = smoothstep(0.46, 0.85, dist) * 0.34;
    if (edgeBlurAmt > 0.01) {
      vec3 gSoft =
        (texture2D(tScene, clamp(vUv + vec2(texel.x, texel.y) * 1.15, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv + vec2(-texel.x, texel.y) * 1.15, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv + vec2(texel.x, -texel.y) * 1.15, 0.001, 0.999)).rgb +
         texture2D(tScene, clamp(vUv + vec2(-texel.x, -texel.y) * 1.15, 0.001, 0.999)).rgb) * 0.25;
      color = mix(color, gSoft, edgeBlurAmt);
    }

    // Momentary micro-chromatic optical aberration only during muzzle discharge / shot impact / heavy motion
    float caAmt = (uFlashHalation * 0.0022 + uShotImpact * 0.0026 + blurMag * 0.14) * smoothstep(0.10, 0.68, dist);
    if (caAmt > 0.00015) {
      vec2 caOff = radialDir * caAmt;
      color.r = mix(color.r, texture2D(tScene, clamp(vUv + caOff, 0.001, 0.999)).r, 0.55);
      color.b = mix(color.b, texture2D(tScene, clamp(vUv - caOff, 0.001, 0.999)).b, 0.55);
    }

    // Add lush Gaussian optical bloom for neon gun LEDs & warm muzzle-flash halation
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    color += bloom * (uBloomStrength + uFlashHalation * 0.38);

    // Subtle warm lens scatter wash during firing
    if (uFlashHalation > 0.01) {
      float flashGlow = exp(-dist * dist * 2.4) * uFlashHalation * 0.095;
      color += vec3(1.0, 0.62, 0.28) * flashGlow;
    }

    // Exposure + ACES Filmic tone mapping
    color = acesFilmic(color * 1.08);

    // Natural cinema-lens edge vignette (subtle, grounded, never murky)
    float vig = 1.0 - smoothstep(0.44, 0.98, dist) * 0.24;
    color *= vig;

    // Micro 35mm optical sensor grain (keeps dark gunmetal gradients silky with zero banding)
    float grain = (hash12(gl_FragCoord.xy + fract(uTime * 17.3) * 256.0) - 0.5) * 0.014;
    color = clamp(color + grain, 0.0, 1.0);

    gl_FragColor = vec4(linearToSrgb(color), 1.0);
  }
`;

export interface CameraPostFrameParams {
  /** Instantaneous horizontal turn blur in UV units (clamped internally) */
  motionX: number;
  /** Instantaneous vertical turn/recoil blur in UV units (clamped internally) */
  motionY: number;
  /** Sprint / slide peripheral speed factor (0..1) */
  speedBlur: number;
  /** Active muzzle flash intensity (0..1) */
  flashIntensity: number;
  /** Elapsed time in seconds */
  elapsed: number;
  /** F/1.2 shallow Depth-of-Field background bokeh blur amount (0..1, e.g., while drinking close to face) */
  dofBlur?: number;
  /** Crisp momentary Gaussian gunshot / toss-whip impact blur (0..1) */
  shotImpactBlur?: number;
  /** When true, splits Layer 0 (world) -> optional F/1.2 bokeh -> clearDepth -> Layer 1 (sharp viewmodel, zero wall/decal clip!) */
  splitViewmodelLayer?: boolean;
}

/**
 * Lightweight 60fps optical post-processing pipeline:
 *  - MSAA HalfFloat HDR scene target
 *  - Two-pass Layer-0 (World) -> optional F/1.2 Bokeh DoF -> clearDepth -> Layer-1 (Sharp Viewmodel)
 *    so bullet holes/walls NEVER clip onto guns AND drinking melts the background into creamy F/1.2 bokeh!
 *  - Separable 9-tap Gaussian bloom/halation for futuristic neon gun LEDs & muzzle flashes
 *  - Single composite pass: restrained 7-tap Gaussian directional motion blur, prime-lens edge softness,
 *    film grain & ACES Filmic tone mapping
 */
export class CinematicPostProcessor {
  private renderer: THREE.WebGLRenderer;
  private sceneRt: THREE.WebGLRenderTarget;
  private bloomRtA: THREE.WebGLRenderTarget;
  private bloomRtB: THREE.WebGLRenderTarget;
  private dofRtA: THREE.WebGLRenderTarget;
  private dofRtB: THREE.WebGLRenderTarget;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private quadGeo: THREE.PlaneGeometry;
  private quadMesh: THREE.Mesh;
  private bloomMat: THREE.ShaderMaterial;
  private dofMat: THREE.ShaderMaterial;
  private dofBlitMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;

  private width = 1;
  private height = 1;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    const pixelRatio = renderer.getPixelRatio();
    const rtW = Math.max(1, Math.floor(this.width * pixelRatio));
    const rtH = Math.max(1, Math.floor(this.height * pixelRatio));
    const bloomW = Math.max(1, Math.floor(rtW / 3));
    const bloomH = Math.max(1, Math.floor(rtH / 3));
    const dofW = Math.max(1, Math.floor(rtW / 2));
    const dofH = Math.max(1, Math.floor(rtH / 2));

    const isWebGL2 = renderer.capabilities.isWebGL2;
    this.sceneRt = new THREE.WebGLRenderTarget(rtW, rtH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: isWebGL2 ? 4 : 0,
    });

    this.bloomRtA = new THREE.WebGLRenderTarget(bloomW, bloomH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.bloomRtB = new THREE.WebGLRenderTarget(bloomW, bloomH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.dofRtA = new THREE.WebGLRenderTarget(dofW, dofH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.dofRtB = new THREE.WebGLRenderTarget(dofW, dofH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);

    this.bloomMat = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        uTexelStep: { value: new THREE.Vector2(1 / bloomW, 0) },
        uThreshold: { value: 0.94 },
        uExtract: { value: 1.0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GAUSSIAN_BLOOM_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.dofMat = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        uTexelStep: { value: new THREE.Vector2(1 / dofW, 0) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BOKEH_DOF_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.dofBlitMat = new THREE.ShaderMaterial({
      uniforms: {
        tBlurred: { value: this.dofRtB.texture },
        uBlend: { value: 0.0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: DOF_BLIT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRt.texture },
        tBloom: { value: this.bloomRtB.texture },
        uResolution: { value: new THREE.Vector2(rtW, rtH) },
        uMotionVec: { value: new THREE.Vector2(0, 0) },
        uSpeedBlur: { value: 0 },
        uBloomStrength: { value: 0.34 },
        uFlashHalation: { value: 0 },
        uShotImpact: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OPTICAL_COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.quadMesh = new THREE.Mesh(this.quadGeo, this.compositeMat);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  public setSize(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const pixelRatio = this.renderer.getPixelRatio();
    const rtW = Math.max(1, Math.floor(this.width * pixelRatio));
    const rtH = Math.max(1, Math.floor(this.height * pixelRatio));
    const bloomW = Math.max(1, Math.floor(rtW / 3));
    const bloomH = Math.max(1, Math.floor(rtH / 3));
    const dofW = Math.max(1, Math.floor(rtW / 2));
    const dofH = Math.max(1, Math.floor(rtH / 2));

    this.sceneRt.setSize(rtW, rtH);
    this.bloomRtA.setSize(bloomW, bloomH);
    this.bloomRtB.setSize(bloomW, bloomH);
    this.dofRtA.setSize(dofW, dofH);
    this.dofRtB.setSize(dofW, dofH);
    this.compositeMat.uniforms.uResolution.value.set(rtW, rtH);
  }

  public render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    params: CameraPostFrameParams,
  ) {
    const prevToneMapping = this.renderer.toneMapping;
    const prevAutoClear = this.renderer.autoClear;
    const dofBlur = THREE.MathUtils.clamp(params.dofBlur ?? 0, 0, 1);
    const splitLayers = params.splitViewmodelLayer === true;

    // 1. Render linear HDR scene into MSAA HalfFloat target (tone mapping happens in final composite!)
    this.renderer.toneMapping = THREE.NoToneMapping;

    if (splitLayers) {
      // Pass 1A: Render World ONLY (Layer 0 — walls, floor, targets, bullet holes, pickups)
      camera.layers.set(0);
      this.renderer.autoClear = true;
      this.renderer.setRenderTarget(this.sceneRt);
      this.renderer.render(scene, camera);

      // Pass 1B: Optional creamy F/1.2 Bokeh Shallow Depth-of-Field on World Background (e.g. close-up drink!)
      if (dofBlur > 0.005) {
        const dw = this.dofRtA.width;
        const dh = this.dofRtA.height;
        const step1 = 1.25 + dofBlur * 1.35;
        const step2 = 2.05 + dofBlur * 2.15;

        this.quadMesh.material = this.dofMat;
        // Iteration 1 (H -> V)
        this.dofMat.uniforms.tInput.value = this.sceneRt.texture;
        this.dofMat.uniforms.uTexelStep.value.set(step1 / dw, 0);
        this.renderer.setRenderTarget(this.dofRtA);
        this.renderer.render(this.quadScene, this.quadCamera);

        this.dofMat.uniforms.tInput.value = this.dofRtA.texture;
        this.dofMat.uniforms.uTexelStep.value.set(0, step1 / dh);
        this.renderer.setRenderTarget(this.dofRtB);
        this.renderer.render(this.quadScene, this.quadCamera);

        // Iteration 2 (wider bokeh radius H -> V for silky true F/1.2 optical defocus!)
        this.dofMat.uniforms.tInput.value = this.dofRtB.texture;
        this.dofMat.uniforms.uTexelStep.value.set(step2 / dw, 0);
        this.renderer.setRenderTarget(this.dofRtA);
        this.renderer.render(this.quadScene, this.quadCamera);

        this.dofMat.uniforms.tInput.value = this.dofRtA.texture;
        this.dofMat.uniforms.uTexelStep.value.set(0, step2 / dh);
        this.renderer.setRenderTarget(this.dofRtB);
        this.renderer.render(this.quadScene, this.quadCamera);

        // Blend creamy out-of-focus background back onto sceneRt
        this.quadMesh.material = this.dofBlitMat;
        this.dofBlitMat.uniforms.tBlurred.value = this.dofRtB.texture;
        this.dofBlitMat.uniforms.uBlend.value = dofBlur;
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.sceneRt);
        this.renderer.render(this.quadScene, this.quadCamera);
      }

      // Pass 1C: Clear ONLY depth and render Viewmodel (Layer 1 — razor-sharp weapons, hands & close-up can, ZERO wall/decal clipping!)
      // CRITICAL: Temporarily null scene.background so Three.js WebGLBackground does NOT set forceClear=true and wipe Layer 0!
      const prevBackground = scene.background;
      const prevShadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
      scene.background = null;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(this.sceneRt);
      this.renderer.clearDepth();
      camera.layers.set(1);
      this.renderer.render(scene, camera);
      scene.background = prevBackground;
      this.renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
      camera.layers.set(0);
      this.renderer.autoClear = true;
    } else {
      this.renderer.autoClear = true;
      this.renderer.setRenderTarget(this.sceneRt);
      this.renderer.render(scene, camera);
    }

    // 2. Separable 9-tap Gaussian Bloom/Halation (Horizontal extract -> Vertical smooth)
    const bw = this.bloomRtA.width;
    const bh = this.bloomRtA.height;

    this.quadMesh.material = this.bloomMat;
    this.bloomMat.uniforms.tInput.value = this.sceneRt.texture;
    this.bloomMat.uniforms.uTexelStep.value.set(1.45 / bw, 0);
    this.bloomMat.uniforms.uExtract.value = 1.0;
    this.renderer.setRenderTarget(this.bloomRtA);
    this.renderer.render(this.quadScene, this.quadCamera);

    this.bloomMat.uniforms.tInput.value = this.bloomRtA.texture;
    this.bloomMat.uniforms.uTexelStep.value.set(0, 1.45 / bh);
    this.bloomMat.uniforms.uExtract.value = 0.0;
    this.renderer.setRenderTarget(this.bloomRtB);
    this.renderer.render(this.quadScene, this.quadCamera);

    // 3. Final Optical Composite (restrained Gaussian directional motion blur + bloom + ACES + sRGB)
    const clampedX = THREE.MathUtils.clamp(params.motionX, -0.0115, 0.0115);
    const clampedY = THREE.MathUtils.clamp(params.motionY, -0.0115, 0.0115);

    this.quadMesh.material = this.compositeMat;
    this.compositeMat.uniforms.tScene.value = this.sceneRt.texture;
    this.compositeMat.uniforms.tBloom.value = this.bloomRtB.texture;
    this.compositeMat.uniforms.uMotionVec.value.set(clampedX, clampedY);
    this.compositeMat.uniforms.uSpeedBlur.value = THREE.MathUtils.clamp(
      params.speedBlur,
      0,
      1,
    );
    this.compositeMat.uniforms.uFlashHalation.value = THREE.MathUtils.clamp(
      params.flashIntensity,
      0,
      1,
    );
    this.compositeMat.uniforms.uShotImpact.value = THREE.MathUtils.clamp(
      params.shotImpactBlur ?? 0,
      0,
      1,
    );
    this.compositeMat.uniforms.uTime.value = params.elapsed;

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);

    this.renderer.toneMapping = prevToneMapping;
    this.renderer.autoClear = prevAutoClear;
  }

  public dispose() {
    this.sceneRt.dispose();
    this.bloomRtA.dispose();
    this.bloomRtB.dispose();
    this.dofRtA.dispose();
    this.dofRtB.dispose();
    this.quadGeo.dispose();
    this.bloomMat.dispose();
    this.dofMat.dispose();
    this.dofBlitMat.dispose();
    this.compositeMat.dispose();
  }
}
