#version 300 es
precision highp float;
precision highp int;

flat in uint vRgba;
layout(location = 0) out vec4 fragColor;

void main() {
  fragColor = vec4(
    float(vRgba & 0xffu),
    float((vRgba >> 8u) & 0xffu),
    float((vRgba >> 16u) & 0xffu),
    float((vRgba >> 24u) & 0xffu)
  ) / 255.0;
}
