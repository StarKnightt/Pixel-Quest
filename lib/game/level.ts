// Level definition + tilemap. The layout is authored as a compact config and
// expanded into a 2D solid grid so collision queries are O(1). Tile *rendering*
// type is derived from neighbours (grass when the cell above is empty, etc.)

import { TILE } from "./constants";

export const SOLID_EMPTY = 0;
export const SOLID_GROUND = 1; // grass/dirt
export const SOLID_STONE = 2;
export const SOLID_CLOUD = 3; // glowing mushroom-cap platform
export const SOLID_CRATE = 4; // wooden crate block

export interface PlatformMotion {
  axis: "x" | "y";
  range: number; // peak offset in tiles
  speed: number; // oscillation speed (rad/s)
  phase?: number; // starting phase offset
}

export interface Platform {
  col: number;
  row: number;
  len: number;
  type:
    | typeof SOLID_GROUND
    | typeof SOLID_STONE
    | typeof SOLID_CLOUD
    | typeof SOLID_CRATE;
  // Cloud platforms may drift back and forth as moving platforms.
  move?: PlatformMotion;
}

export interface LevelConfig {
  width: number; // columns
  height: number; // rows
  groundRow: number; // first solid ground row (inclusive) down to bottom
  pits: [number, number][]; // [startCol, endCol] inclusive, ground removed
  platforms: Platform[];
  coins: [number, number][]; // [col, row] (air cell, coin centered)
  gems: [number, number][];
  powerups: [number, number][]; // candidate spots; a random subset spawns per run
  powerupCount?: number; // how many candidates actually spawn (default 3)
  snails: { col: number; row: number }[]; // feet rest on top of tile (col,row)
  playerStart: { col: number; row: number };
  goal: { col: number; row: number };
}

// Design rules (jump budget = ~3.8 tiles up, ~3-tile running gap):
//  - The GROUND route is always traversable: every pit is <=3 wide and has a
//    flat run-up, so the player can always progress without precise platforming.
//  - Floating platforms are optional vertical rewards, always reachable in
//    <=2-3 tile steps from an adjacent surface (stepping chains).
export const LEVEL_1: LevelConfig = {
  width: 154,
  height: 12,
  groundRow: 10,
  pits: [
    [18, 20],
    [40, 42],
    [70, 72],
    [98, 100],
    [124, 126],
  ],
  platforms: [
    // - opening climb -
    { col: 5, row: 7, len: 3, type: SOLID_GROUND },
    { col: 9, row: 5, len: 2, type: SOLID_STONE },
    { col: 16, row: 9, len: 1, type: SOLID_CRATE }, // pre-pit step
    // - section 2 -
    {
      col: 24,
      row: 7,
      len: 3,
      type: SOLID_CLOUD,
      move: { axis: "x", range: 1.6, speed: 1.1 },
    },
    { col: 28, row: 5, len: 2, type: SOLID_STONE },
    { col: 34, row: 9, len: 1, type: SOLID_CRATE }, // little stair
    { col: 35, row: 9, len: 1, type: SOLID_CRATE },
    { col: 35, row: 8, len: 1, type: SOLID_CRATE },
    // - descending mushroom stairs -
    {
      col: 46,
      row: 7,
      len: 4,
      type: SOLID_CLOUD,
      move: { axis: "y", range: 1.1, speed: 1.4 },
    },
    { col: 52, row: 6, len: 3, type: SOLID_GROUND },
    { col: 58, row: 7, len: 3, type: SOLID_STONE },
    {
      col: 63,
      row: 8,
      len: 3,
      type: SOLID_CLOUD,
      move: { axis: "x", range: 2, speed: 0.9, phase: 1.5 },
    },
    { col: 67, row: 9, len: 1, type: SOLID_CRATE }, // pre-pit step
    // - section 4 -
    { col: 75, row: 7, len: 3, type: SOLID_GROUND },
    { col: 80, row: 5, len: 2, type: SOLID_STONE },
    {
      col: 86,
      row: 7,
      len: 4,
      type: SOLID_CLOUD,
      move: { axis: "y", range: 1.2, speed: 1.2, phase: 0.8 },
    },
    { col: 92, row: 6, len: 3, type: SOLID_STONE },
    {
      col: 99,
      row: 8,
      len: 1,
      type: SOLID_CLOUD,
      move: { axis: "x", range: 1, speed: 1.6 },
    }, // stepping stone over pit4
    // - finale climb -
    { col: 104, row: 7, len: 3, type: SOLID_GROUND },
    {
      col: 109,
      row: 5,
      len: 3,
      type: SOLID_CLOUD,
      move: { axis: "x", range: 2.2, speed: 1, phase: 2 },
    },
    { col: 118, row: 9, len: 1, type: SOLID_CRATE }, // end stair stack
    { col: 119, row: 9, len: 1, type: SOLID_CRATE },
    { col: 119, row: 8, len: 1, type: SOLID_CRATE },
    { col: 121, row: 7, len: 3, type: SOLID_STONE },
    { col: 130, row: 7, len: 4, type: SOLID_GROUND },
    {
      col: 136,
      row: 5,
      len: 3,
      type: SOLID_CLOUD,
      move: { axis: "y", range: 1.3, speed: 1.3 },
    },
  ],
  coins: [
    [5, 6],
    [6, 6],
    [7, 6],
    [12, 9],
    [18, 8],
    [19, 7],
    [20, 8], // arc over pit1
    [24, 6],
    [25, 6],
    [26, 6],
    [34, 8],
    [35, 7],
    [40, 8],
    [41, 7],
    [42, 8], // arc over pit2
    [46, 6],
    [47, 6],
    [48, 6],
    [52, 5],
    [53, 5],
    [63, 7],
    [64, 7],
    [65, 7],
    [70, 8],
    [71, 7],
    [72, 8], // arc over pit3
    [75, 6],
    [76, 6],
    [77, 6],
    [86, 6],
    [87, 6],
    [88, 6],
    [89, 6],
    [99, 7], // over the stepping stone
    [104, 6],
    [105, 6],
    [121, 6],
    [122, 6],
    [130, 6],
    [131, 6],
    [132, 6],
  ],
  gems: [
    [10, 4],
    [29, 4],
    [54, 5],
    [81, 4],
    [93, 5],
    [110, 4],
    [137, 4],
  ],
  // super-star power-up candidates: a random few of these spawn each run so the
  // pickups aren't in the same spot every time. All are safe, reachable air cells.
  powerups: [
    [12, 8],
    [22, 8],
    [47, 6],
    [52, 5],
    [64, 7],
    [73, 7],
    [88, 6],
    [104, 6],
    [115, 6],
    [131, 6],
  ],
  powerupCount: 3,
  snails: [
    { col: 13, row: 10 },
    { col: 31, row: 10 }, // moved off the (now-moving) cloud at col 24
    { col: 50, row: 10 }, // moved off the (now-moving) cloud at col 46
    { col: 55, row: 10 },
    { col: 77, row: 7 },
    { col: 90, row: 10 }, // moved off the (now-moving) cloud at col 86
    { col: 94, row: 10 },
    { col: 105, row: 7 },
    { col: 131, row: 7 },
    { col: 142, row: 10 },
  ],
  playerStart: { col: 2, row: 9 },
  goal: { col: 149, row: 9 },
};

export class Level {
  readonly cfg: LevelConfig;
  readonly cols: number;
  readonly rows: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  private grid: Uint8Array;

  constructor(cfg: LevelConfig) {
    this.cfg = cfg;
    this.cols = cfg.width;
    this.rows = cfg.height;
    this.pixelWidth = cfg.width * TILE;
    this.pixelHeight = cfg.height * TILE;
    this.grid = new Uint8Array(cfg.width * cfg.height);

    // ground rows
    for (let r = cfg.groundRow; r < cfg.height; r++) {
      for (let c = 0; c < cfg.width; c++) this.set(c, r, SOLID_GROUND);
    }
    // carve pits
    for (const [s, e] of cfg.pits) {
      for (let c = s; c <= e; c++) {
        for (let r = cfg.groundRow; r < cfg.height; r++) this.set(c, r, SOLID_EMPTY);
      }
    }
    // floating platforms (cloud platforms are dynamic moving platforms and are
    // resolved separately, so they're NOT baked into the static collision grid)
    for (const p of cfg.platforms) {
      if (p.type === SOLID_CLOUD) continue;
      for (let i = 0; i < p.len; i++) this.set(p.col + i, p.row, p.type);
    }
  }

  private set(c: number, r: number, v: number) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
    this.grid[r * this.cols + c] = v;
  }

  /** Tile type at a column/row (0 = empty). Out of bounds is open everywhere so
   *  pits are truly bottomless (the player falls to their death). */
  tileAt(c: number, r: number): number {
    if (c < 0 || c >= this.cols) return SOLID_EMPTY;
    if (r < 0 || r >= this.rows) return SOLID_EMPTY;
    return this.grid[r * this.cols + c];
  }

  isSolidTile(c: number, r: number): boolean {
    return this.tileAt(c, r) !== SOLID_EMPTY;
  }

  /** Is the world-space pixel solid? */
  isSolidAt(px: number, py: number): boolean {
    return this.isSolidTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }
}
