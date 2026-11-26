// 3D Gaussian splatting (Kerbl et al. 2023): each splat's 3D covariance is projected to a 2D
// screen-space ellipse with the camera Jacobian, drawn as an instanced quad and blended back
// to front.
import { TEXTURE_WIDTH } from "./pack.ts";

/** Half-size of each quad in standard deviations. */
export const QUAD_EXTENT = 3;

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
uniform sampler2D uNormals;
uniform vec3 uEye;
uniform float uTime;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uViewport;
uniform vec2 uFocal;

out vec4 vColor;
out vec2 vPos;

const int WIDTH = ${TEXTURE_WIDTH};

ivec2 texel(int id) {
  return ivec2(id % WIDTH, id / WIDTH);
}

mat3 covariance(int id) {
  vec4 a = texelFetch(uCovA, texel(id), 0);
  vec2 b = texelFetch(uCovB, texel(id), 0).xy;
  return mat3(a.x, a.y, a.z, a.y, a.w, b.x, a.z, b.x, b.y);
}

// Studio lighting for splats that carry a surface normal: a warm key light from the upper
// left, a cool rim light from behind, and a soft fresnel sheen. Metal tints its highlights.
vec3 light(vec3 base, vec3 n, vec3 p) {
  vec3 v = normalize(uEye - p);
  if (dot(n, v) < 0.0) n = -n;
  vec3 key = normalize(vec3(-0.45, 0.75, 0.55));
  vec3 rim = normalize(vec3(0.85, 0.15, -0.5));
  vec3 fill = normalize(vec3(0.6, -0.4, 0.7));
  float diffuse = 0.3 + 0.62 * max(dot(n, key), 0.0) + 0.16 * max(dot(n, fill), 0.0);
  // A broad highlight plus a tight one: polished metal rather than plastic.
  float h = max(dot(n, normalize(key + v)), 0.0);
  float spec = pow(h, 18.0) * 0.55 + pow(h, 90.0) * 0.9 + pow(max(dot(n, normalize(rim + v)), 0.0), 14.0) * 0.45;
  float sheen = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.3;
  vec3 tint = mix(vec3(1.0, 0.94, 0.86), base * 1.4 + 0.25, 0.5);
  return base * diffuse + (spec + sheen) * tint;
}

void main() {
  int id = int(aIndex);
  vec4 center = texelFetch(uCenters, texel(id), 0);
  vec4 normal = texelFetch(uNormals, texel(id), 0);
  float shading = normal.w;

  vec3 p = (uModel * vec4(center.xyz, 1.0)).xyz;
  // Only dust drifts, slowly (center.w is how far); surfaces and ribbons stay put, so they read
  // as solid. The golden-ratio sequence spreads the phases evenly.
  if (center.w > 0.0) {
    float phase = fract(float(id) * 0.6180339887) * 6.2831853;
    p += center.w * vec3(sin(uTime * 0.31 + phase), sin(uTime * 0.27 + phase * 1.7), 0.5 * sin(uTime * 0.23 + phase * 2.3));
  }

  mat3 m = mat3(uModel);
  mat3 sigma = m * covariance(id) * transpose(m);

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
  float a0 = cov2[0][0];
  float b = cov2[0][1];
  float c0 = cov2[1][1];
  float a = a0 + 0.3;
  float c = c0 + 0.3;
  // Keep the energy of splats smaller than a pixel instead of turning them into hard dots
  // (the 2D filter of Mip-Splatting).
  float coverage = sqrt(max(a0 * c0 - b * b, 1e-12) / max(a * c - b * b, 1e-12));
  float mid = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float l1 = mid + radius;
  float l2 = max(mid - radius, 0.1);
  vec2 e1 = abs(b) < 1e-7 ? (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(b, l1 - a));
  vec2 v1 = min(sqrt(l1), 1024.0) * e1;
  vec2 v2 = min(sqrt(l2), 1024.0) * vec2(-e1.y, e1.x);

  vec4 color = texelFetch(uColors, texel(id), 0);
  if (shading > 0.004) {
    vec3 n = normalize(m * normal.xyz + 1e-5);
    color.rgb = mix(color.rgb, light(color.rgb, n, p), shading);
  }
  vColor = vec4(min(color.rgb, vec3(1.0)), color.a * coverage);
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
  float r2 = dot(vPos, vPos);
  if (r2 > ${(3 * 3).toFixed(1)}) discard;
  float alpha = vColor.a * exp(-0.5 * r2) * uOpacity;
  if (alpha < 1.0 / 255.0) discard;
  fragColor = vec4(vColor.rgb * alpha, alpha);
}
`;
