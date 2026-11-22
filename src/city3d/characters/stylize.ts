import * as THREE from 'three';

/** Shader snippet replacing <map_fragment>: samples the albedo with a mip bias (smooths the painted noise of the
 *  photoreal Meshy textures) and lifts saturation so figures/vehicles sit in the stylised low-poly city. */
export const STYLE_MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv, 1.6 );
  diffuseColor *= sampledDiffuseColor;
#endif
  { float Ls = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = clamp(mix(vec3(Ls), diffuseColor.rgb, 1.22), 0.0, 1.0);
    diffuseColor.rgb = pow(diffuseColor.rgb, vec3(0.94)); }
`;

/** Apply the stylised look to an existing standard material (idempotent). */
export function stylize(m: THREE.Material | THREE.Material[]) {
  for (const mat of Array.isArray(m) ? m : [m]) {
    const s = mat as THREE.MeshStandardMaterial;
    if (!s.isMeshStandardMaterial || s.userData.styled) continue;
    s.userData.styled = true;
    s.roughness = Math.max(s.roughness, 0.8); s.metalness = Math.min(s.metalness, 0.2); s.envMapIntensity = Math.min(s.envMapIntensity ?? 1, 0.5);
    const prev = s.onBeforeCompile; const key = s.customProgramCacheKey?.bind(s);
    s.customProgramCacheKey = () => (key ? key() : '') + '|city3d-style-v1';
    s.onBeforeCompile = (sh, r) => { prev?.call(s, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', STYLE_MAP); };
    s.needsUpdate = true;
  }
}
