#version 300 es
precision highp float;
precision highp int;

flat in uint vTerrain;
layout(location = 0) out uvec4 fragColor;

void main() {
  fragColor = uvec4(vTerrain & 0xffu, 0u, 0u, 0u);
}
