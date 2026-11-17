// 3D Gaussian splatting (Kerbl et al. 2023): each splat's 3D covariance is projected to a 2D
// screen-space ellipse with the camera Jacobian, drawn as an instanced quad and blended back
// to front. On top of that, every splat morphs between two scenes; the motion matches
// morph.ts, which the sort worker uses.
import { STAGGER, SWIRL } from "./morph.ts";
import { TEXTURE_WIDTH } from "./pack.ts";

/** Half-size of each quad in standard deviations. */
export const QUAD_EXTENT = 2.6;

export const vertexShader = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in uint aIndex;

uniform sampler2D uCenters;
uniform sampler2D uCovA;
uniform sampler2D uCovB;
uniform sampler2D uColors;
uniform int uRows;
uniform int uFrom;
uniform int uTo;
uniform float uT;
uniform float uTime;
uniform mat4 uModelA;
uniform mat4 uModelB;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uViewport;
uniform vec2 uFocal;

out vec4 vColor;
out vec2 vPos;

const float STAGGER = ${STAGGER.toFixed(4)};
const float SWIRL = ${SWIRL.toFixed(4)};
const int WIDTH = ${TEXTURE_WIDTH};

ivec2 texel(int scene, int id) {
  return ivec2(id % WIDTH, id / WIDTH + scene * uRows);
}

mat3 covariance(int scene, int id) {
  vec4 a = texelFetch(uCovA, texel(scene, id), 0);
  vec2 b = texelFetch(uCovB, texel(scene, id), 0).xy;
  return mat3(a.x, a.y, a.z, a.y, a.w, b.x, a.z, b.x, b.y);
}

void main() {
  int id = int(aIndex);
  vec4 ca = texelFetch(uCenters, texel(uFrom, id), 0);
  vec4 cb = texelFetch(uCenters, texel(uTo, id), 0);
  float delay = ca.w;

  float e = clamp((uT - delay * STAGGER) / (1.0 - STAGGER), 0.0, 1.0);
  e = e * e * (3.0 - 2.0 * e);
  float lift = sin(3.14159265 * e);

  vec3 pa = (uModelA * vec4(ca.xyz, 1.0)).xyz;
  vec3 pb = (uModelB * vec4(cb.xyz, 1.0)).xyz;
  vec3 swirl = vec3(sin(delay * 7919.1), sin(delay * 3571.7 + 1.3), sin(delay * 1237.3 + 2.1));
  vec3 p = mix(pa, pb, e) + lift * SWIRL * swirl;
  // A faint shimmer so a resting scene still breathes.
  p += 0.0022 * vec3(sin(uTime * 1.3 + delay * 911.0), sin(uTime * 1.1 + delay * 533.0), 0.0);

  mat3 ma = mat3(uModelA);
  mat3 mb = mat3(uModelB);
  mat3 sa = ma * covariance(uFrom, id) * transpose(ma);
  mat3 sb = mb * covariance(uTo, id) * transpose(mb);
  // Splats shrink to sparks mid-flight.
  float shrink = 1.0 - 0.6 * lift;
  mat3 sigma = (sa * (1.0 - e) + sb * e) * (shrink * shrink);

  vec4 cam = uView * vec4(p, 1.0);
  vec4 clip = uProj * cam;
  float d = -cam.z;
  if (d < 0.05 || abs(clip.x) > 1.3 * clip.w || abs(clip.y) > 1.3 * clip.w) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  // Jacobian of the perspective projection, in pixels.
  mat3 J = mat3(
    uFocal.x / d, 0.0, 0.0,
    0.0, uFocal.y / d, 0.0,
    uFocal.x * cam.x / (d * d), uFocal.y * cam.y / (d * d), 0.0
  );
  mat3 T = J * mat3(uView);
  mat3 cov2 = T * sigma * transpose(T);

  // Low-pass filter (at least ~1 px), then the ellipse's axes from the 2×2 eigensystem.
  float a = cov2[0][0] + 0.3;
  float b = cov2[0][1];
  float c = cov2[1][1] + 0.3;
  float mid = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float l1 = mid + radius;
  float l2 = max(mid - radius, 0.1);
  vec2 e1 = abs(b) < 1e-7 ? (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(b, l1 - a));
  vec2 v1 = min(sqrt(l1), 1024.0) * e1;
  vec2 v2 = min(sqrt(l2), 1024.0) * vec2(-e1.y, e1.x);

  vColor = mix(texelFetch(uColors, texel(uFrom, id), 0), texelFetch(uColors, texel(uTo, id), 0), e);
  vPos = aCorner;
  vec2 offset = (aCorner.x * v1 + aCorner.y * v2) * 2.0 / uViewport;
  gl_Position = vec4(clip.xy + offset * clip.w, clip.z, clip.w);
}
`;

export const fragmentShader = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vPos;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  float alpha = vColor.a * exp(-0.5 * dot(vPos, vPos)) * uOpacity;
  if (alpha < 1.0 / 255.0) discard;
  fragColor = vec4(vColor.rgb * alpha, alpha);
}
`;
