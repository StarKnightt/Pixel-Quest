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

// Super Star power-up: a timed "powered up" state (Mario-style). While active
// the hero jumps noticeably higher, runs faster and bowls straight through
// snails instead of taking damage.
export const POWER_DURATION = 9; // seconds of super mode per star
export const SUPER_JUMP_VELOCITY = -930; // ~6 tiles up (vs ~3.8 normally)
export const SUPER_RUN_SPEED = 232;

// Gameplay.
export const START_LIVES = 3;
export const START_TIME = 240;
export const COIN_SCORE = 100;
export const GEM_SCORE = 250;
export const POWER_SCORE = 300;
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
  // super-star power-up (electric rainbow-ish glow)
  power: "#ffe14d",
  powerMid: "#ff7be5",
  powerCore: "#9bf6ff",
  powerEdge: "#7a3cff",
  shadow: "rgba(10,6,20,0.32)",
} as const;

// ---------------------------------------------------------------------------
// Biome / atmosphere zones. As the camera scrolls across the level we blend
// between these moods - fog + light colours are lerped in the 3D renderer and
// a soft full-screen colour grade is crossfaded over the canvas - so the world
// visibly shifts from twilight forest to dawn, golden dusk and moonlit night.
export interface Biome {
  name: string;
  fog: [number, number, number]; // 0..1 linear-ish rgb
  sun: [number, number, number];
  ambient: [number, number, number];
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  grade: [number, number, number]; // 0..255 css overlay colour
  gradeAlpha: number; // 0..1 overlay strength (soft-light blend)
  snow: number; // 0..1 falling-snow intensity
}

export const BIOMES: Biome[] = [
  {
    name: "Twilight Forest",
    fog: [0.141, 0.102, 0.227],
    sun: [1.0, 0.94, 0.82],
    ambient: [0.604, 0.651, 0.839],
    hemiSky: [1.0, 0.851, 0.627],
    hemiGround: [0.227, 0.169, 0.333],
    grade: [120, 110, 180],
    gradeAlpha: 0.0,
    snow: 0,
  },
  {
    name: "Misty Dawn",
    fog: [0.32, 0.4, 0.52],
    sun: [1.0, 0.96, 0.9],
    ambient: [0.72, 0.8, 0.92],
    hemiSky: [0.86, 0.93, 1.0],
    hemiGround: [0.36, 0.4, 0.46],
    grade: [150, 200, 235],
    gradeAlpha: 0.22,
    snow: 0,
  },
  {
    name: "Frosted Peaks",
    fog: [0.74, 0.82, 0.92],
    sun: [0.95, 0.97, 1.0],
    ambient: [0.82, 0.88, 0.98],
    hemiSky: [0.92, 0.96, 1.0],
    hemiGround: [0.62, 0.68, 0.8],
    grade: [205, 228, 255],
    gradeAlpha: 0.3,
    snow: 1,
  },
  {
    name: "Golden Dusk",
    fog: [0.46, 0.22, 0.14],
    sun: [1.0, 0.78, 0.5],
    ambient: [0.82, 0.62, 0.5],
    hemiSky: [1.0, 0.72, 0.42],
    hemiGround: [0.32, 0.16, 0.12],
    grade: [255, 138, 40],
    gradeAlpha: 0.26,
    snow: 0,
  },
  {
    name: "Moonlit Night",
    fog: [0.07, 0.08, 0.18],
    sun: [0.62, 0.72, 1.0],
    ambient: [0.42, 0.5, 0.78],
    hemiSky: [0.4, 0.52, 0.9],
    hemiGround: [0.1, 0.12, 0.24],
    grade: [70, 70, 150],
    gradeAlpha: 0.34,
    snow: 0,
  },
];

/** Interpolated scenery values for the current camera position. */
export interface Scenery {
  fog: [number, number, number];
  sun: [number, number, number];
  ambient: [number, number, number];
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  grade: [number, number, number];
  gradeAlpha: number;
  snow: number; // 0..1 falling-snow intensity
}
