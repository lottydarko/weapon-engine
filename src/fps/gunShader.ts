import * as THREE from 'three';

export interface GunMetalShaderOptions {
  /** Strength of bright bare-steel edge highlighting along beveled ridges & curves (0..1) */
  edgeWear?: number;
  /** Strength of dark micro-cavity contact occlusion in serration grooves & seams (0..1) */
  cavityDepth?: number;
  /** Blued-steel / gun-oil grazing Fresnel sheen tint */
  sheenColor?: number;
  /** Grazing sheen intensity (0..1) */
  sheenStrength?: number;
}

/**
 * Custom PBR micro-ridge & curvature shader extension built via Three.js `onBeforeCompile`.
 * Preserves 100% of Three.js physically-based lighting, shadows, RoomEnvironment IBL, normal maps,
 * and dynamic muzzle-flash illumination while adding real-time screen-space curvature shading:
 *  - Detects every machined ridge, chamfer, bevel, sight notch, and curved receiver shoulder via
 *    hardware normal/position derivatives (`dFdx`/`dFdy`)
 *  - Catches sharp bare-steel specular micro-highlights along worn edges & curved contours
 *  - Deepens concave grooves (serrations, panel seams, screw slots) with physical micro-AO
 *  - Layers realistic blued-steel / gun-oil grazing Fresnel sheen across curved metal flanks
 */
export function enhanceGunMetalMaterial<
  T extends THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
>(material: T, options: GunMetalShaderOptions = {}): T {
  const edgeWear = options.edgeWear ?? 0.42;
  const cavityDepth = options.cavityDepth ?? 0.34;
  const sheenColor = new THREE.Color(options.sheenColor ?? 0x9ab4d4);
  const sheenStrength = options.sheenStrength ?? 0.24;

  const key = `gunmetal_${edgeWear.toFixed(2)}_${cavityDepth.toFixed(2)}_${sheenColor.getHexString()}_${sheenStrength.toFixed(2)}`;
  material.customProgramCacheKey = () => key;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeWear = { value: edgeWear };
    shader.uniforms.uCavityDepth = { value: cavityDepth };
    shader.uniforms.uSheenColor = { value: sheenColor };
    shader.uniforms.uSheenStrength = { value: sheenStrength };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uEdgeWear;
      uniform float uCavityDepth;
      uniform vec3 uSheenColor;
      uniform float uSheenStrength;
      `,
    );

    // Inject curvature-driven edge-wear albedo/roughness sculpting right after normal_fragment_maps
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `
      #include <normal_fragment_maps>
      // Hardware screen-space curvature & micro-ridge detector
      vec3 _gmDxP = dFdx( vViewPosition );
      vec3 _gmDyP = dFdy( vViewPosition );
      vec3 _gmDxN = dFdx( normal );
      vec3 _gmDyN = dFdy( normal );
      float _gmPosLen = max( length( _gmDxP ) + length( _gmDyP ), 0.00018 );
      // Signed mean curvature: positive on convex ridges/bevels, negative inside concave grooves
      float _gmSignedCurv = ( dot( _gmDxN, _gmDxP ) + dot( _gmDyN, _gmDyP ) ) / ( _gmPosLen * _gmPosLen );
      float _gmRidgeMag = length( _gmDxN ) + length( _gmDyN );
      float _gmConvexRidge = clamp( smoothstep( 0.055, 0.38, _gmRidgeMag ) * smoothstep( -0.35, 0.45, -_gmSignedCurv ), 0.0, 1.0 );
      float _gmConcaveGroove = clamp( smoothstep( 0.05, 0.34, _gmRidgeMag ) * smoothstep( -0.25, 0.55, _gmSignedCurv ), 0.0, 1.0 );

      // Worn convex ridges expose slightly brighter, smoother burnished steel
      diffuseColor.rgb = mix( diffuseColor.rgb, max( diffuseColor.rgb * 1.48, vec3( 0.36, 0.39, 0.44 ) ), _gmConvexRidge * uEdgeWear * 0.65 );
      roughnessFactor = clamp( roughnessFactor * ( 1.0 - _gmConvexRidge * uEdgeWear * 0.42 ) + _gmConcaveGroove * uCavityDepth * 0.22, 0.08, 0.98 );
      `,
    );

    // Add curved-surface grazing oil-sheen + ridge rim glint + cavity micro-occlusion to final PBR light
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      vec3 _gmViewDir = normalize( vViewPosition );
      float _gmNdotV = clamp( dot( normal, _gmViewDir ), 0.0, 1.0 );
      float _gmFresnel = pow( 1.0 - _gmNdotV, 3.2 );

      // Micro-cavity occlusion deepens serration valleys, screw heads & bevel channels
      float _gmCavityAO = 1.0 - _gmConcaveGroove * uCavityDepth * 0.48;
      outgoingLight *= _gmCavityAO;

      // Sculptural ridge grazing highlight & curved blued-steel sheen
      float _gmUpperLight = clamp( normal.y * 0.5 + 0.5, 0.15, 1.0 );
      vec3 _gmEdgeSpec = mix( vec3( 0.78, 0.84, 0.94 ), uSheenColor, 0.45 ) *
        ( _gmConvexRidge * uEdgeWear * ( 0.16 + 0.42 * _gmFresnel ) * _gmUpperLight +
          _gmFresnel * uSheenStrength * 0.22 * _gmUpperLight );
      outgoingLight += _gmEdgeSpec;
      #include <opaque_fragment>
      `,
    );
  };

  material.needsUpdate = true;
  return material;
}

/**
 * Subtle warm satin lacquer & curved-grain edge highlight enhancement for Russian birch/walnut stocks
 * and polymer receivers so every rounded stock comb and grip contour reads with tactile realism.
 */
export function enhanceGunWoodMaterial<
  T extends THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
>(material: T, sheenStrength = 0.16): T {
  const key = `gunwood_${sheenStrength.toFixed(2)}`;
  material.customProgramCacheKey = () => key;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWoodSheen = { value: sheenStrength };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uWoodSheen;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      vec3 _gwView = normalize( vViewPosition );
      float _gwFresnel = pow( 1.0 - clamp( dot( normal, _gwView ), 0.0, 1.0 ), 3.4 );
      float _gwRidge = clamp( ( length( dFdx( normal ) ) + length( dFdy( normal ) ) ) * 1.4, 0.0, 1.0 );
      // Subtle warm rubbed-lacquer catchlight along curved stock comb & bevels
      outgoingLight += vec3( 0.42, 0.30, 0.19 ) * ( _gwFresnel * uWoodSheen * 0.35 + _gwRidge * uWoodSheen * 0.18 );
      #include <opaque_fragment>
      `,
    );
  };

  material.needsUpdate = true;
  return material;
}
