// Horizontal-follow camera with a little vertical lead and smoothing. Clamped
// to the level bounds so we never reveal past the edges.

import { VIEW_W, VIEW_H } from "./constants";
import type { Rect } from "./types";

// Where the player sits vertically within the view when grounded (0 = top).
const REST_Y = 0.58;
// Vertical dead-zone: the camera only scrolls up/down when the player's screen
// position leaves this band, so normal jumps never move the camera.
const TOP_EDGE = 0.12;
const BOTTOM_EDGE = 0.86;

export class Camera {
  x = 0;
  y = 0;
  private anchorY = 0; // player's focus Y the last time they were grounded

  constructor(
    private levelW: number,
    private levelH: number,
  ) {}

  follow(target: Rect, dt: number, grounded: boolean) {
    const focusY = target.y + target.h / 2;
    // Lock the vertical anchor to the standing height; jumps don't move it.
    if (grounded) this.anchorY = focusY;

    const desiredX = target.x + target.w / 2 - VIEW_W / 2;

    // Hold the camera at the last grounded height (so jumping/falling in place
    // doesn't bob the view). Only chase vertically when the player nears the
    // top/bottom of the screen (a tall jump or a long fall) so they stay in view.
    let desiredY = this.anchorY - VIEW_H * REST_Y;
    const screenY = focusY - this.y; // player centre within the viewport
    if (screenY < VIEW_H * TOP_EDGE) desiredY = focusY - VIEW_H * TOP_EDGE;
    else if (screenY > VIEW_H * BOTTOM_EDGE) desiredY = focusY - VIEW_H * BOTTOM_EDGE;

    // exponential smoothing toward the target
    const lerp = 1 - Math.pow(0.0008, dt);
    this.x += (desiredX - this.x) * lerp;
    this.y += (desiredY - this.y) * lerp;

    this.x = clamp(this.x, 0, Math.max(0, this.levelW - VIEW_W));
    this.y = clamp(this.y, 0, Math.max(0, this.levelH - VIEW_H));
  }

  snapTo(target: Rect) {
    this.anchorY = target.y + target.h / 2;
    this.x = clamp(
      target.x + target.w / 2 - VIEW_W / 2,
      0,
      Math.max(0, this.levelW - VIEW_W),
    );
    this.y = clamp(
      this.anchorY - VIEW_H * REST_Y,
      0,
      Math.max(0, this.levelH - VIEW_H),
    );
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
