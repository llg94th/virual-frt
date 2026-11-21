import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, N8AO, SMAA, Vignette, ToneMapping, ChromaticAberration, DepthOfField } from '@react-three/postprocessing';
import { BlendFunction, Effect, ToneMappingMode } from 'postprocessing';
import { live, useCity } from '../shared';
import { wx } from './weatherState';

const gradeFrag = /* glsl */ `
uniform float uAmount; uniform float uNight;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sh = 1.0 - smoothstep(0.0, 0.35, l);
  float hi = smoothstep(0.35, 1.4, l);
  vec3 teal = vec3(-0.012, 0.012, 0.03);
  vec3 orange = vec3(0.07, 0.02, -0.04);
  c += (teal * sh + orange * hi * (1.0 - uNight * 0.5)) * uAmount;
  c = mix(vec3(l), c, 1.0 + 0.3 * uAmount);
  c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(1.0 + 0.09 * uAmount));
  outputColor = vec4(max(c, 0.0), inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor() {
    super('CityGrade', gradeFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([['uAmount', new THREE.Uniform(1)], ['uNight', new THREE.Uniform(0)]]),
    });
  }
}

class FxBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('[city3d] PostFx disabled:', e); }
  render() { return this.state.failed ? null : this.props.children; }
}

const PostFxInner: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const mode = useCity((s) => s.cameraMode);
  const bloom = useRef<any>(null);
  const grade = useMemo(() => new GradeEffect(), []);
  const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0008), []);
  const high = quality === 'high';
  const low = quality === 'low';
  const toneMode = useMemo(() => {
    const m = ToneMappingMode as unknown as Record<string, number>;
    return m.ACES_FILMIC as ToneMappingMode;
  }, []);

  useEffect(() => () => grade.dispose(), [grade]);

  useFrame(() => {
    const n = live.nightFactor;
    if (bloom.current) bloom.current.intensity = (low ? 0.5 : 0.7) + (low ? 0.8 : 1.6) * n + wx.flash * 1.5;
    grade.uniforms.get('uNight')!.value = n;
    grade.uniforms.get('uAmount')!.value = low ? 0.6 : 1;
    if (high) {
      // storms get a touch more aberration
      caOffset.set(0.0006 + wx.flash * 0.002, 0.0008 + wx.flash * 0.002);
    }
  });

  const fx: JSX.Element[] = [];
  if (high) fx.push(<N8AO key="ao" aoRadius={5} distanceFalloff={2} intensity={2.4} quality="medium" halfRes />);
  fx.push(<Bloom key="bloom" ref={bloom} mipmapBlur luminanceThreshold={low ? 1.0 : 0.85} luminanceSmoothing={0.25} intensity={1} radius={0.75} />);
  fx.push(<primitive key="grade" object={grade} />);
  if (high) fx.push(<ChromaticAberration key="ca" offset={caOffset} radialModulation={false} modulationOffset={0} blendFunction={BlendFunction.NORMAL} />);
  if (mode === 'cinematic' && !low) fx.push(<DepthOfField key="dof" worldFocusDistance={90} worldFocusRange={140} bokehScale={high ? 3.2 : 2} />);
  fx.push(<Vignette key="vig" eskil={false} offset={0.28} darkness={low ? 0.45 : 0.62} />);
  if (!high) fx.push(<SMAA key="smaa" />);
  fx.push(<ToneMapping key="tm" mode={toneMode} />);

  return (
    <EffectComposer key={quality} multisampling={high ? 4 : 0} enableNormalPass={false}>
      {fx}
    </EffectComposer>
  );
};

export const PostFx: React.FC = () => (
  <FxBoundary>
    <PostFxInner />
  </FxBoundary>
);
