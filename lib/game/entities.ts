// Entities + custom AABB collision against the tilemap. Movement is delta-time
// based; collision is resolved one axis at a time (move X, resolve, move Y,
// resolve) which is the classic robust approach for tile platformers.

import {
  TILE,
  GRAVITY,
  MAX_FALL,
  PLAYER_RUN_SPEED,
  PLAYER_ACCEL,
  PLAYER_AIR_ACCEL,
  PLAYER_FRICTION,
  JUMP_VELOCITY,
  JUMP_CUT,
  STOMP_BOUNCE,
  COYOTE_TIME,
  JUMP_BUFFER,
  HURT_KNOCKBACK,
  INVULN_TIME,
  SUPER_JUMP_VELOCITY,
  SUPER_RUN_SPEED,
} from "./constants";
import type { InputState, Rect } from "./types";
import type { Level, PlatformMotion } from "./level";

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Axis-separated AABB resolution against solid tiles. Returns touched sides. */
function moveAndCollide(
  level: Level,
  ent: { x: number; y: number; w: number; h: number; vx: number; vy: number },
  dt: number,
) {
  const touched = { ground: false, ceiling: false, left: false, right: false };

  // --- X axis ---
  ent.x += ent.vx * dt;
  {
    const top = Math.floor(ent.y / TILE);
    const bottom = Math.floor((ent.y + ent.h - 1) / TILE);
    if (ent.vx > 0) {
      const right = Math.floor((ent.x + ent.w - 1) / TILE);
      for (let r = top; r <= bottom; r++) {
        if (level.isSolidTile(right, r)) {
          ent.x = right * TILE - ent.w;
          ent.vx = 0;
          touched.right = true;
          break;
        }
      }
    } else if (ent.vx < 0) {
      const left = Math.floor(ent.x / TILE);
      for (let r = top; r <= bottom; r++) {
        if (level.isSolidTile(left, r)) {
          ent.x = (left + 1) * TILE;
          ent.vx = 0;
          touched.left = true;
          break;
        }
      }
    }
  }

  // --- Y axis ---
  ent.y += ent.vy * dt;
  {
    const left = Math.floor(ent.x / TILE);
    const right = Math.floor((ent.x + ent.w - 1) / TILE);
    if (ent.vy > 0) {
      const bottom = Math.floor((ent.y + ent.h - 1) / TILE);
      for (let c = left; c <= right; c++) {
        if (level.isSolidTile(c, bottom)) {
          ent.y = bottom * TILE - ent.h;
          ent.vy = 0;
          touched.ground = true;
          break;
        }
      }
      // Resting ground-snap: a perfectly grounded entity sinks a sub-pixel
      // amount each frame from gravity, which made the floor probe round up to
      // the empty row for a few frames (onGround flickering false → "fall" →
      // jittery "multiple animations"). If a solid tile sits within 1px below
      // the feet, snap to it so a resting entity stays grounded every frame.
      if (!touched.ground) {
        const probe = Math.floor((ent.y + ent.h + 1) / TILE);
        for (let c = left; c <= right; c++) {
          if (level.isSolidTile(c, probe)) {
            ent.y = probe * TILE - ent.h;
            ent.vy = 0;
            touched.ground = true;
            break;
          }
        }
      }
    } else if (ent.vy < 0) {
      const top = Math.floor(ent.y / TILE);
      for (let c = left; c <= right; c++) {
        if (level.isSolidTile(c, top)) {
          ent.y = (top + 1) * TILE;
          ent.vy = 0;
          touched.ceiling = true;
          break;
        }
      }
    }
  }

  return touched;
}

export type PlayerState = "idle" | "run" | "jump" | "fall";

export class Player {
  x: number;
  y: number;
  w = 16;
  h = 26;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  onGround = false;
  state: PlayerState = "idle";
  animTime = 0;
  private coyote = 0;
  private buffer = 0;
  invuln = 0;
  dead = false;
  // Super Star power-up timer (seconds remaining of "super" mode).
  powerT = 0;

  // death sequence (pit fall): a little hop then a spinning tumble
  dying = false;
  deathT = 0;
  deathSpin = 0;

  // one-shot flags consumed by the Game for audio/score
  justJumped = false;

  constructor(col: number, row: number) {
    this.x = col * TILE + (TILE - this.w) / 2;
    this.y = row * TILE + (TILE - this.h);
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Is the hero currently in Super Star mode (higher jump, invincible)? */
  get powered(): boolean {
    return this.powerT > 0;
  }

  /** Grant (or refresh) Super Star mode for `duration` seconds. */
  empower(duration: number) {
    this.powerT = Math.max(this.powerT, duration);
  }

  respawn(col: number, row: number) {
    this.x = col * TILE + (TILE - this.w) / 2;
    this.y = row * TILE + (TILE - this.h);
    this.vx = 0;
    this.vy = 0;
    this.invuln = INVULN_TIME;
    this.powerT = 0;
    this.dead = false;
    this.dying = false;
    this.deathT = 0;
    this.deathSpin = 0;
  }

  /** Begin the death tumble: a small launch up, then fall spinning (no collision). */
  die() {
    if (this.dying) return;
    this.dying = true;
    this.dead = true;
    this.deathT = 1.1;
    this.deathSpin = 0;
    this.vy = -560;
    this.vx = 0;
    this.onGround = false;
  }

  hurt(fromX: number) {
    this.invuln = INVULN_TIME;
    this.vy = -260;
    this.vx = this.x < fromX ? -HURT_KNOCKBACK : HURT_KNOCKBACK;
  }

  bounce() {
    this.vy = STOMP_BOUNCE;
    this.onGround = false;
  }

  update(dt: number, input: InputState, level: Level) {
    this.justJumped = false;

    // death tumble - ignore input + collision, just arc and spin off-screen
    if (this.dying) {
      this.deathT -= dt;
      this.deathSpin += dt * 9;
      this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
      this.y += this.vy * dt;
      this.animTime += dt;
      this.state = "fall";
      return;
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.powerT > 0) this.powerT = Math.max(0, this.powerT - dt);

    const runSpeed = this.powered ? SUPER_RUN_SPEED : PLAYER_RUN_SPEED;
    const jumpVel = this.powered ? SUPER_JUMP_VELOCITY : JUMP_VELOCITY;
    const accel = this.onGround ? PLAYER_ACCEL : PLAYER_AIR_ACCEL;
    if (input.left && !input.right) {
      this.vx -= accel * dt;
      this.facing = -1;
    } else if (input.right && !input.left) {
      this.vx += accel * dt;
      this.facing = 1;
    } else if (this.onGround) {
      // friction
      const f = PLAYER_FRICTION * dt;
      if (this.vx > 0) this.vx = Math.max(0, this.vx - f);
      else if (this.vx < 0) this.vx = Math.min(0, this.vx + f);
    }
    this.vx = Math.max(-runSpeed, Math.min(runSpeed, this.vx));

    // jump w/ coyote-time + input buffering
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    if (input.jumpPressed) this.buffer = JUMP_BUFFER;
    else this.buffer = Math.max(0, this.buffer - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = jumpVel;
      this.onGround = false;
      this.coyote = 0;
      this.buffer = 0;
      this.justJumped = true;
    }
    // variable jump height: release early = cut upward velocity
    if (!input.jump && this.vy < jumpVel * JUMP_CUT)
      this.vy = jumpVel * JUMP_CUT;

    // gravity
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);

    const touched = moveAndCollide(level, this, dt);
    this.onGround = touched.ground;
    if (touched.ceiling && this.vy < 0) this.vy = 0;

    // state + animation
    this.animTime += dt;
    this.refreshState();
  }

  /**
   * Recompute the animation state from the current grounded/velocity values.
   * Called at the end of update(), and again by the Game after one-way platform
   * (cloud) resolution - clouds aren't solid tiles, so without this the hero
   * would be stuck in the "fall" pose while actually standing on a cloud.
   */
  refreshState() {
    if (!this.onGround) this.state = this.vy < 0 ? "jump" : "fall";
    else if (Math.abs(this.vx) > 12) this.state = "run";
    else this.state = "idle";
  }
}

export class Snail {
  x: number;
  y: number;
  w = 24;
  h = 18;
  vx: number;
  vy = 0;
  dir: 1 | -1 = -1;
  dead = false;
  squashTimer = 0;
  animTime = 0;
  remove = false;
  private speed = 42;

  constructor(col: number, row: number) {
    this.x = col * TILE + (TILE - this.w) / 2;
    this.y = row * TILE - this.h;
    this.vx = this.dir * this.speed;
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  stomp() {
    this.dead = true;
    this.squashTimer = 0.7;
    this.vx = 0;
  }

  update(dt: number, level: Level) {
    this.animTime += dt;
    if (this.dead) {
      this.squashTimer -= dt;
      if (this.squashTimer <= 0) this.remove = true;
      return;
    }

    // gravity so snails sit on platforms / fall if shoved
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
    this.vx = this.dir * this.speed;

    const touched = moveAndCollide(level, this, dt);

    // turn at walls
    if (touched.left || touched.right) this.dir = (this.dir * -1) as 1 | -1;

    // turn at ledges: if no solid just ahead-below, reverse
    if (touched.ground) {
      const footY = this.y + this.h + 2;
      const aheadX = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
      if (!level.isSolidAt(aheadX, footY)) {
        this.dir = (this.dir * -1) as 1 | -1;
      }
    }
  }
}

abstract class Pickup {
  x: number;
  y: number;
  w: number;
  h: number;
  animTime = 0;
  collected = false;
  baseY: number;
  // random phase so a cluster of pickups doesn't bob/pulse in lockstep
  phase = Math.random() * Math.PI * 2;

  constructor(col: number, row: number, size: number) {
    this.w = size;
    this.h = size;
    this.x = col * TILE + (TILE - size) / 2;
    this.y = row * TILE + (TILE - size) / 2;
    this.baseY = this.y;
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  update(dt: number) {
    this.animTime += dt;
    // gentle floating bob (phase-offset per instance)
    this.y = this.baseY + Math.sin(this.animTime * 3 + this.phase) * 2;
  }
}

/** A one-way platform (cloud) that drifts along an axis and carries riders. */
export class MovingPlatform {
  readonly baseX: number;
  readonly baseY: number;
  readonly w: number;
  readonly h: number;
  x: number;
  y: number;
  dx = 0; // movement applied this frame (so riders can be carried)
  dy = 0;
  private t = 0;
  private axis: "x" | "y";
  private range: number; // pixels
  private speed: number;
  private phase: number;

  constructor(col: number, row: number, len: number, move: PlatformMotion) {
    this.baseX = col * TILE;
    this.baseY = row * TILE;
    this.w = len * TILE;
    this.h = TILE;
    this.x = this.baseX;
    this.y = this.baseY;
    this.axis = move.axis;
    this.range = move.range * TILE;
    this.speed = move.speed;
    this.phase = move.phase ?? 0;
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  reset() {
    this.t = 0;
    this.x = this.baseX;
    this.y = this.baseY;
    this.dx = 0;
    this.dy = 0;
  }

  update(dt: number) {
    this.t += dt;
    const off = Math.sin(this.t * this.speed + this.phase) * this.range;
    const nx = this.axis === "x" ? this.baseX + off : this.baseX;
    const ny = this.axis === "y" ? this.baseY + off : this.baseY;
    this.dx = nx - this.x;
    this.dy = ny - this.y;
    this.x = nx;
    this.y = ny;
  }
}

export class Coin extends Pickup {
  constructor(col: number, row: number) {
    super(col, row, 18);
  }
}

export class Gem extends Pickup {
  constructor(col: number, row: number) {
    super(col, row, 20);
  }
}

/** Super Star power-up: bobs + spins, grants the hero timed "super" mode. */
export class PowerUp extends Pickup {
  constructor(col: number, row: number) {
    super(col, row, 24);
  }
}

