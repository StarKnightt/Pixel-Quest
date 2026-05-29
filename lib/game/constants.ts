// Core tuning constants for the Pixel Quest engine.
// Everything is authored against a fixed internal resolution and scaled up
// with image-rendering: pixelated so the art never turns to mush.

export const TILE = 32;

// Fixed internal render resolution (16:9). The canvas backing store is locked
// to this and CSS scales it up to fill the frame.
export const VIEW_W = 512;
export const VIEW_H = 288;

// Fixed-timestep simulation. We accumulate real time and step the sim in
// constant slices so collision/physics stay deterministic regardless of fps.
export const FIXED_DT = 1 / 120;
export const MAX_FRAME_DT = 0.25; // clamp huge tab-stall gaps

// Physics (pixels / second). Tuned so a full jump clears ~3.8 tiles of height
// and a running jump comfortably crosses a 3-tile gap - the whole level is
// authored against this budget so every jump is fair.
export const GRAVITY = 2200;
export const MAX_FALL = 980;
export const PLAYER_RUN_SPEED = 178;
export const PLAYER_ACCEL = 1500;
export const PLAYER_FRICTION = 1700;
export const PLAYER_AIR_ACCEL = 1080;
export const JUMP_VELOCITY = -740; // ~124px / 3.8 tiles apex
export const STOMP_BOUNCE = -520;
export const COYOTE_TIME = 0.1; // grace after leaving a ledge
export const JUMP_BUFFER = 0.12; // grace pressing jump before landing
export const HURT_KNOCKBACK = 260;
export const INVULN_TIME = 1.4;
export const JUMP_CUT = 0.42; // velocity retained when jump released early

// Gameplay.
export const START_LIVES = 3;
export const START_TIME = 240;
export const COIN_SCORE = 100;
export const GEM_SCORE = 250;
export const STOMP_SCORE = 200;
// Stomping a snail awards a random bonus (in 50-point steps) for some variety.
export const STOMP_SCORE_MIN = 100;
export const STOMP_SCORE_MAX = 500;
export const STOMP_SCORE_STEP = 50;
export const GOAL_SCORE = 1000;

// Twilight enchanted-forest palette (replaces the old sky-island theme).
export const PALETTE = {
  // sky gradient behind the painterly scene
  skyTop: "#141436",
  skyMid: "#5b2b66",
  skyBottom: "#e8743f",
  // magical rim light cast by the glowing forest (used on sprite edges)
  rim: "#7fe3ff",
  firefly: "#ffe79a",
  // mossy forest floor
  grass: "#6fb84a",
  grassLight: "#9bdc63",
  grassDark: "#4d8f33",
  grassShadow: "#356322",
  dirt: "#7a4a2c",
  dirtLight: "#9a6038",
  dirtDark: "#4f2f1c",
  dirtSpeck: "#a06b3f",
  // dewy stone blocks
  stone: "#8a93a8",
  stoneLight: "#b6bfd0",
  stoneDark: "#525a72",
  // glowing mushroom platforms (re-skin of the old cloud tiles)
  shroom: "#56d6c8",
  shroomLight: "#aef6ee",
  shroomDark: "#2b8f88",
  shroomStem: "#e9e0c8",
  shroomStemDark: "#b7ab8a",
  // wooden crate
  crate: "#b5793c",
  crateLight: "#d79a55",
  crateDark: "#7c4d24",
  crateMetal: "#8a6b3a",
  // pickups
  coin: "#ffd23f",
  coinDark: "#c8870f",
  coinShine: "#fff7d6",
  gem: "#ff7a3c",
  gemLight: "#ffd089",
  gemDark: "#b53c16",
  heart: "#ff5d6c",
  heartDark: "#c43d52",
  shadow: "rgba(10,6,20,0.32)",
} as const;
