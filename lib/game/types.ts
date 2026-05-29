export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type GameStatus = "ready" | "playing" | "won" | "lost";

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  jumpPressed: boolean; // edge: true only on the frame jump was first pressed
}

/** Snapshot the React HUD reads each time something changes. */
export interface HudSnapshot {
  score: number;
  coins: number;
  time: number;
  lives: number;
  status: GameStatus;
}

/** A processed image sprite (chroma-keyed + cropped + pre-scaled to size). */
export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

/** 32x32 opaque terrain tile canvases. */
export interface Tileset {
  grassTop: HTMLCanvasElement;
  dirt: HTMLCanvasElement;
  stone: HTMLCanvasElement;
  crate: HTMLCanvasElement;
}

export interface Assets {
  scene: HTMLImageElement;
  hero: Sprite; // legacy single frame (idle/contact)
  heroIdle: Sprite;
  heroRun: Sprite[]; // run-cycle frames (real per-frame animation)
  heroJump: Sprite;
  snail: Sprite;
  coin: Sprite;
  star: Sprite;
  cloud: Sprite;
}
