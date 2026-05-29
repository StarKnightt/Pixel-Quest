// Horizontal-follow camera with a little vertical lead and smoothing. Clamped
// to the level bounds so we never reveal past the edges.

import { VIEW_W, VIEW_H } from "./constants";
import type { Rect } from "./types";

export class Camera {
  x = 0;
  y = 0;

  constructor(
    private levelW: number,
    private levelH: number,
  ) {}

  follow(target: Rect, dt: number) {
    const desiredX = target.x + target.w / 2 - VIEW_W / 2;
    const desiredY = target.y + target.h / 2 - VIEW_H * 0.58;

    // exponential smoothing toward the target
    const lerp = 1 - Math.pow(0.0008, dt);
    this.x += (desiredX - this.x) * lerp;
    this.y += (desiredY - this.y) * lerp;

    this.x = clamp(this.x, 0, Math.max(0, this.levelW - VIEW_W));
    this.y = clamp(this.y, 0, Math.max(0, this.levelH - VIEW_H));
  }

  snapTo(target: Rect) {
    this.x = clamp(
      target.x + target.w / 2 - VIEW_W / 2,
      0,
      Math.max(0, this.levelW - VIEW_W),
    );
    this.y = clamp(
      target.y + target.h / 2 - VIEW_H * 0.58,
      0,
      Math.max(0, this.levelH - VIEW_H),
    );
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
