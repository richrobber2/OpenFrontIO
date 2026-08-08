#version 300 es
precision highp float;
precision highp int;

// [tileRef, terrainByte, packedRGBA]
layout(location = 0) in uvec3 aPatch;

uniform uvec2 uMapSize;

flat out uint vTerrain;
flat out uint vRgba;

void main() {
  uint x = aPatch.x % uMapSize.x;
  uint y = aPatch.x / uMapSize.x;
  vec2 tile = vec2(float(x), float(y));
  vec2 mapSize = vec2(uMapSize);
  vec2 ndc = ((tile + 0.5) / mapSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = 1.0;
  vTerrain = aPatch.y;
  vRgba = aPatch.z;
}
