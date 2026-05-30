// The Game orchestrator: owns the level, entities, camera, audio and game state;
// drives update() at a fixed timestep and render() once per frame. Rendering
// uses generated image sprites blitted with transform-based animation (bob,
// lean, squash/stretch, spin) for life without needing per-frame sprite sheets.

import {
  TILE,
  VIEW_W,
  VIEW_H,
  START_LIVES,
  START_TIME,
  COIN_SCORE,
  GEM_SCORE,
  STOMP_SCORE_MIN,
  STOMP_SCORE_MAX,
  STOMP_SCORE_STEP,
  GOAL_SCORE,
  PALETTE,
} from "./constants";
import type {
  Assets,
  GameStatus,
  HudSnapshot,
  InputState,
  Rect,
  Sprite,
  Tileset,
} from "./types";
import {
  Level,
  LEVEL_1,
  SOLID_GROUND,
  SOLID_STONE,
  SOLID_CLOUD,
  SOLID_CRATE,
} from "./level";
import { Player, Snail, Coin, Gem, MovingPlatform, overlaps } from "./entities";
import { Camera } from "./camera";
import type { AudioEngine } from "./audio";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Firefly {
  x: number;
  y: number;
  phase: number;
  speed: number;
  factor: number;
  drift: number;
}

interface CloudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ScorePopup {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
}

export class Game {
  level: Level;
  player: Player;
  snails: Snail[] = [];
  coins: Coin[] = [];
  gems: Gem[] = [];
  camera: Camera;
  particles: Particle[] = [];
  scorePopups: ScorePopup[] = [];
  fireflies: Firefly[] = [];
  cloudRects: CloudRect[] = [];
  platforms: MovingPlatform[] = [];

  status: GameStatus = "ready";
  score = 0;
  coinCount = 0;
  lives = START_LIVES;
  timeLeft = START_TIME;
  godMode = false;

  goalRect: { x: number; y: number; w: number; h: number };
  flagWave = 0;
  private shakeT = 0;
  private shakeMag = 0;
  private flashT = 0;
  private flashDur = 0;
  private flashColor = "#ffffff";
  private dustTimer = 0;
  private hudListeners: ((s: HudSnapshot) => void)[] = [];
  private lastHud = "";

  constructor(
    private assets: Assets,
    private tileset: Tileset,
    private audio: AudioEngine,
  ) {
    this.level = new Level(LEVEL_1);
    this.player = new Player(LEVEL_1.playerStart.col, LEVEL_1.playerStart.row);
    this.camera = new Camera(this.level.pixelWidth, this.level.pixelHeight);
    this.goalRect = {
      x: LEVEL_1.goal.col * TILE,
      y: (LEVEL_1.goal.row - 3) * TILE,
      w: TILE,
      h: 4 * TILE,
    };
    this.cloudRects = LEVEL_1.platforms
      .filter((p) => p.type === SOLID_CLOUD)
      .map((p) => ({
        x: p.col * TILE,
        y: p.row * TILE,
        w: p.len * TILE,
        h: TILE,
      }));
    // cloud platforms are dynamic moving platforms (static clouds use range 0)
    this.platforms = LEVEL_1.platforms
      .filter((p) => p.type === SOLID_CLOUD)
      .map(
        (p) =>
          new MovingPlatform(
            p.col,
            p.row,
            p.len,
            p.move ?? { axis: "x", range: 0, speed: 0 },
          ),
      );
    this.spawnEntities();
    this.scatterFireflies();
    this.camera.snapTo(this.player.rect);
  }

  private spawnEntities() {
    this.snails = LEVEL_1.snails.map((s) => new Snail(s.col, s.row));
    this.coins = LEVEL_1.coins.map(([c, r]) => new Coin(c, r));
    this.gems = LEVEL_1.gems.map(([c, r]) => new Gem(c, r));
  }

  private scatterFireflies() {
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 60; i++) {
      this.fireflies.push({
        x: rnd() * this.level.pixelWidth,
        y: 30 + rnd() * (VIEW_H * 0.75),
        phase: rnd() * Math.PI * 2,
        speed: 1.5 + rnd() * 2.5,
        factor: 0.5 + rnd() * 0.35,
        drift: 6 + rnd() * 10,
      });
    }
  }

  onHud(fn: (s: HudSnapshot) => void) {
    this.hudListeners.push(fn);
    this.emitHud();
  }

  private emitHud() {
    const snap: HudSnapshot = {
      score: this.score,
      coins: this.coinCount,
      time: Math.max(0, Math.ceil(this.timeLeft)),
      lives: this.lives,
      status: this.status,
    };
    const key = `${snap.score}|${snap.coins}|${snap.time}|${snap.lives}|${snap.status}`;
    if (key !== this.lastHud) {
      this.lastHud = key;
      for (const fn of this.hudListeners) fn(snap);
    }
  }

  start() {
    if (this.status === "ready") {
      this.status = "playing";
      this.audio.startMusic();
      this.emitHud();
    }
  }

  restart() {
    this.score = 0;
    this.coinCount = 0;
    this.lives = START_LIVES;
    this.timeLeft = START_TIME;
    this.particles = [];
    this.scorePopups = [];
    this.player = new Player(LEVEL_1.playerStart.col, LEVEL_1.playerStart.row);
    this.spawnEntities();
    for (const p of this.platforms) p.reset();
    this.camera.snapTo(this.player.rect);
    this.status = "playing";
    this.audio.stopMusic();
    this.audio.startMusic();
    this.emitHud();
  }

  /** Toggle invincibility / infinite time (cheat, for recording footage). */
  setGodMode(on: boolean) {
    this.godMode = on;
    if (on) this.player.invuln = Math.max(this.player.invuln, 9999);
    else this.player.invuln = 0;
  }

  /** Cheat: instantly win the current run (nice for ending a recording). */
  forceWin() {
    if (this.status === "playing") this.win();
  }

  /** Current screen-shake offset (consumed by the renderer). */
  getShakeOffset(): { x: number; y: number } {
    if (this.shakeT <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * Math.min(1, this.shakeT * 6);
    return {
      x: (Math.random() * 2 - 1) * m,
      y: (Math.random() * 2 - 1) * m,
    };
  }

  /** Current hit-flash colour + alpha (consumed by the renderer / overlay). */
  getFlash(): { color: string; alpha: number } {
    return {
      color: this.flashColor,
      alpha:
        this.flashT > 0 ? Math.max(0, Math.min(1, this.flashT / this.flashDur)) : 0,
    };
  }

  private shake(mag: number, dur: number) {
    this.shakeMag = mag;
    this.shakeT = dur;
  }

  private flash(color: string, dur: number) {
    this.flashColor = color;
    this.flashT = dur;
    this.flashDur = dur;
  }

  private burst(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color,
        size: 1 + Math.floor(Math.random() * 2),
      });
    }
  }

  private emitDust(dt: number) {
    const p = this.player;
    if (p.onGround && Math.abs(p.vx) > 60) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.07;
        const dir = Math.sign(p.vx);
        this.particles.push({
          x: p.x + p.w / 2 - dir * 5,
          y: p.y + p.h - 2,
          vx: -dir * (20 + Math.random() * 35),
          vy: -15 - Math.random() * 28,
          life: 0.3 + Math.random() * 0.2,
          maxLife: 0.5,
          color: "rgba(225,214,190,0.85)",
          size: 1 + Math.floor(Math.random() * 2),
        });
      }
    } else {
      this.dustTimer = 0;
    }
  }

  update(dt: number, input: InputState) {
    if (this.status !== "playing") return;

    for (const plat of this.platforms) plat.update(dt);

    // death tumble: freeze the world, let the hero arc + spin, then resolve
    if (this.player.dying) {
      this.player.update(dt, input, this.level);
      this.updateParticles(dt);
      this.updateScorePopups(dt);
      this.tickFx(dt);
      this.camera.follow(this.player.rect, dt, false);
      if (this.player.deathT <= 0) this.resolveDeath();
      this.emitHud();
      return;
    }

    if (!this.godMode) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.lose();
        return;
      }
    }

    this.player.update(dt, input, this.level);
    if (this.player.justJumped) this.audio.jump();
    this.emitDust(dt);
    this.ridePlatforms();
    // clouds are one-way platforms resolved after Player.update, so re-derive
    // the animation state now that grounding-on-a-cloud is known
    this.player.refreshState();

    // fell into a (now bottomless) pit
    if (this.player.y > this.level.pixelHeight + 60) {
      if (this.godMode) {
        this.player.respawn(LEVEL_1.playerStart.col, LEVEL_1.playerStart.row);
        this.camera.snapTo(this.player.rect);
      } else {
        this.player.die();
        this.audio.hurt();
        this.flash("rgba(150,50,180,0.4)", 0.3);
        this.shake(6, 0.3);
      }
      this.emitHud();
      return;
    }

    for (const s of this.snails) s.update(dt, this.level);

    // player vs snails
    for (const s of this.snails) {
      if (s.dead || !overlaps(this.player.rect, s.rect)) continue;
      const fromAbove =
        this.player.vy > 0 && this.player.y + this.player.h - s.y < 16;
      if (fromAbove) {
        s.stomp();
        this.player.bounce();
        const steps =
          Math.floor(
            Math.random() *
              ((STOMP_SCORE_MAX - STOMP_SCORE_MIN) / STOMP_SCORE_STEP + 1),
          );
        const gain = STOMP_SCORE_MIN + steps * STOMP_SCORE_STEP;
        this.score += gain;
        this.spawnScorePopup(gain, s.x + s.w / 2, s.y - 4, "#aef6ee");
        this.audio.stomp();
        this.shake(4, 0.2);
        this.burst(s.x + s.w / 2, s.y, PALETTE.gemLight, 16);
        this.burst(s.x + s.w / 2, s.y + s.h / 2, PALETTE.coinShine, 8);
      } else if (this.player.invuln <= 0 && !this.godMode) {
        this.player.hurt(s.x + s.w / 2);
        this.audio.hurt();
        this.shake(7, 0.35);
        this.flash("rgba(255,60,60,0.5)", 0.35);
        this.loseLife(false);
      }
    }
    this.snails = this.snails.filter((s) => !s.remove);

    // pickups
    for (const c of this.coins) {
      if (c.collected) continue;
      c.update(dt);
      if (overlaps(this.player.rect, c.rect)) {
        c.collected = true;
        this.coinCount += 1;
        this.score += COIN_SCORE;
        this.spawnScorePopup(COIN_SCORE, c.x + c.w / 2, c.y, PALETTE.coin);
        this.audio.coin();
        this.burst(c.x + c.w / 2, c.y + c.h / 2, PALETTE.coin, 8);
      }
    }
    this.coins = this.coins.filter((c) => !c.collected);

    for (const g of this.gems) {
      if (g.collected) continue;
      g.update(dt);
      if (overlaps(this.player.rect, g.rect)) {
        g.collected = true;
        this.score += GEM_SCORE;
        this.spawnScorePopup(GEM_SCORE, g.x + g.w / 2, g.y, PALETTE.gemLight);
        this.audio.gem();
        this.burst(g.x + g.w / 2, g.y + g.h / 2, PALETTE.gem, 14);
      }
    }
    this.gems = this.gems.filter((g) => !g.collected);

    // goal
    if (overlaps(this.player.rect, this.goalRect)) {
      this.win();
    }

    this.updateParticles(dt);
    this.updateScorePopups(dt);
    this.tickFx(dt);
    this.camera.follow(this.player.rect, dt, this.player.onGround);
    this.emitHud();
  }

  /** One-way collision against moving cloud platforms: land on top + get carried. */
  private ridePlatforms() {
    const p = this.player;
    if (p.vy < 0) return; // rising: never snap to a platform top
    const feet = p.y + p.h;
    for (const plat of this.platforms) {
      const r = plat.rect;
      const horiz = p.x + p.w > r.x + 2 && p.x < r.x + r.w - 2;
      if (!horiz) continue;
      // landing window scales with the platform's vertical travel this frame
      if (feet >= r.y - 10 && feet <= r.y + 12 + Math.max(0, plat.dy)) {
        p.y = r.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p.x += plat.dx; // horizontal carry
      }
    }
  }

  private resolveDeath() {
    this.player.dying = false;
    this.player.dead = false;
    this.loseLife(true);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.vy += 320 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  /** Spawn a floating "+N" score popup at a world position. */
  private spawnScorePopup(amount: number, x: number, y: number, color: string) {
    this.scorePopups.push({
      x,
      y,
      vy: -52,
      life: 0.95,
      maxLife: 0.95,
      text: `+${amount}`,
      color,
    });
  }

  private updateScorePopups(dt: number) {
    for (const p of this.scorePopups) {
      p.y += p.vy * dt;
      p.vy += 40 * dt; // rise quickly then ease as it fades
      p.life -= dt;
    }
    this.scorePopups = this.scorePopups.filter((p) => p.life > 0);
  }

  private tickFx(dt: number) {
    this.flagWave += dt * 6;
    if (this.shakeT > 0) this.shakeT -= dt;
    if (this.flashT > 0) this.flashT -= dt;
  }

  private loseLife(respawn = true) {
    this.lives -= 1;
    if (this.lives <= 0) {
      this.lose();
      return;
    }
    if (respawn) {
      this.player.respawn(LEVEL_1.playerStart.col, LEVEL_1.playerStart.row);
      this.camera.snapTo(this.player.rect);
    }
    this.emitHud();
  }

  private win() {
    if (this.status !== "playing") return;
    this.status = "won";
    this.score += GOAL_SCORE + Math.ceil(this.timeLeft) * 5;
    this.audio.stopMusic();
    this.audio.win();
    this.emitHud();
  }

  private lose() {
    if (this.status !== "playing") return;
    this.status = "lost";
    this.audio.stopMusic();
    this.audio.lose();
    this.emitHud();
  }

  // ------------------------------------------------------------------ render

  render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = true;

    let ox = 0;
    let oy = 0;
    if (this.shakeT > 0) {
      const m = this.shakeMag * Math.min(1, this.shakeT * 6);
      ox = Math.round((Math.random() * 2 - 1) * m);
      oy = Math.round((Math.random() * 2 - 1) * m);
    }

    ctx.save();
    ctx.translate(ox, oy);
    this.renderBackground(ctx);
    this.renderTiles(ctx);
    this.renderClouds(ctx);
    this.renderGoal(ctx);

    const t = performance.now() / 1000;
    for (const c of this.coins) this.drawCoin(ctx, c, t);
    for (const g of this.gems) this.drawStar(ctx, g, t);

    for (const s of this.snails) {
      if (!s.dead) this.dropShadow(ctx, s.rect);
      this.drawSnail(ctx, s);
    }
    this.dropShadow(ctx, this.player.rect);
    this.drawHero(ctx, t);
    this.renderParticles(ctx);
    ctx.restore();

    // full-screen hit flash (above the world, below the DOM HUD)
    if (this.flashT > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, this.flashT / this.flashDur));
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
  }

  /** Blit a sprite at a world-space anchor with transforms. */
  private blit(
    ctx: CanvasRenderingContext2D,
    spr: Sprite,
    cx: number,
    cy: number,
    o: {
      flip?: boolean;
      rot?: number;
      sx?: number;
      sy?: number;
      anchorY?: number;
      alpha?: number;
    } = {},
  ) {
    const w = spr.w * (o.sx ?? 1);
    const h = spr.h * (o.sy ?? 1);
    const aY = o.anchorY ?? 1;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.translate(
      Math.round(cx - this.camera.x),
      Math.round(cy - this.camera.y),
    );
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    ctx.drawImage(spr.canvas, -w / 2, -h * aY, w, h);
    ctx.restore();
  }

  private renderBackground(ctx: CanvasRenderingContext2D) {
    // twilight sky gradient underlay (in case the scene image has gaps)
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.55, PALETTE.skyMid);
    grad.addColorStop(1, PALETTE.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-8, -8, VIEW_W + 16, VIEW_H + 16);

    // painterly scene layer, scaled to view height and parallax-scrolled
    const img = this.assets.scene;
    const scale = VIEW_H / img.height;
    const sw = img.width * scale;
    const offset = -((this.camera.x * 0.3) % sw);
    for (let x = offset - sw; x < VIEW_W + sw; x += sw) {
      ctx.drawImage(img, 0, 0, img.width, img.height, x, 0, sw, VIEW_H);
    }

    // ambient fireflies (glowing specks with parallax + twinkle)
    const t = performance.now() / 1000;
    ctx.fillStyle = PALETTE.firefly;
    for (const f of this.fireflies) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * f.speed + f.phase);
      if (twinkle < 0.15) continue;
      const fx =
        f.x - this.camera.x * f.factor + Math.sin(t * 0.5 + f.phase) * f.drift;
      const wrapped =
        ((fx % this.level.pixelWidth) + this.level.pixelWidth) %
        this.level.pixelWidth;
      const drawX = wrapped > VIEW_W ? wrapped - this.level.pixelWidth : wrapped;
      const fy = f.y + Math.sin(t * 0.7 + f.phase) * 4;
      ctx.globalAlpha = twinkle * 0.9;
      ctx.fillRect(Math.round(drawX), Math.round(fy), 2, 2);
      ctx.globalAlpha = twinkle * 0.3;
      ctx.fillRect(Math.round(drawX) - 1, Math.round(fy) - 1, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  private renderClouds(ctx: CanvasRenderingContext2D) {
    const cloud = this.assets.cloud;
    for (const c of this.cloudRects) {
      const w = Math.max(c.w + 12, 46);
      const h = c.h + 26;
      ctx.drawImage(
        cloud.canvas,
        Math.round(c.x - this.camera.x - 6),
        Math.round(c.y - this.camera.y - 6),
        w,
        h,
      );
    }
  }

  /** Soft contact shadow cast onto the ground directly below an entity. */
  private dropShadow(ctx: CanvasRenderingContext2D, rect: Rect) {
    let gy = rect.y + rect.h;
    const cx = rect.x + rect.w / 2;
    for (let i = 0; i < 14; i++) {
      if (this.level.isSolidAt(cx, gy + 2)) break;
      gy += TILE;
    }
    const dist = Math.max(0, gy - (rect.y + rect.h));
    const shrink = Math.max(0.35, 1 - dist / (TILE * 5));
    const rx = (rect.w / 2 + 2) * shrink;
    if (rx < 1) return;
    ctx.save();
    ctx.globalAlpha = 0.3 * shrink;
    ctx.fillStyle = "#0a0614";
    ctx.beginPath();
    ctx.ellipse(
      Math.round(cx - this.camera.x),
      Math.round(gy - this.camera.y - 1),
      rx,
      Math.max(2, rx * 0.32),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  private renderTiles(ctx: CanvasRenderingContext2D) {
    const startC = Math.max(0, Math.floor(this.camera.x / TILE));
    const endC = Math.min(
      this.level.cols,
      Math.ceil((this.camera.x + VIEW_W) / TILE) + 1,
    );
    const startR = Math.max(0, Math.floor(this.camera.y / TILE));
    const endR = Math.min(
      this.level.rows,
      Math.ceil((this.camera.y + VIEW_H) / TILE) + 1,
    );

    for (let r = startR; r < endR; r++) {
      for (let c = startC; c < endC; c++) {
        const tile = this.level.tileAt(c, r);
        if (tile === 0 || tile === SOLID_CLOUD) continue; // clouds drawn as images
        const above = this.level.tileAt(c, r - 1);
        const sx = Math.round(c * TILE - this.camera.x);
        const sy = Math.round(r * TILE - this.camera.y);
        let img: HTMLCanvasElement;
        if (tile === SOLID_GROUND) {
          img = above === 0 ? this.tileset.grassTop : this.tileset.dirt;
        } else if (tile === SOLID_STONE) {
          img = this.tileset.stone;
        } else if (tile === SOLID_CRATE) {
          img = this.tileset.crate;
        } else {
          continue;
        }
        ctx.drawImage(img, sx, sy, TILE, TILE);
      }
    }
  }

  private renderGoal(ctx: CanvasRenderingContext2D) {
    const baseX = Math.round(this.goalRect.x + 8 - this.camera.x);
    const topY = Math.round(this.goalRect.y - this.camera.y);
    const poleH = this.goalRect.h;
    ctx.fillStyle = "#e6e6ee";
    ctx.fillRect(baseX, topY, 3, poleH);
    ctx.fillStyle = "#a8a8b4";
    ctx.fillRect(baseX, topY, 1, poleH);
    ctx.fillStyle = PALETTE.coin;
    ctx.beginPath();
    ctx.arc(baseX + 1.5, topY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    const wave = Math.sin(this.flagWave) * 2;
    ctx.fillStyle = "#e2543e";
    ctx.beginPath();
    ctx.moveTo(baseX + 3, topY + 2);
    ctx.lineTo(baseX + 22 + wave, topY + 8);
    ctx.lineTo(baseX + 3, topY + 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(baseX + 9, topY + 9, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCoin(ctx: CanvasRenderingContext2D, c: Coin, t: number) {
    const spin = Math.abs(Math.cos(t * 3 + c.x * 0.05)) * 0.85 + 0.15;
    this.blit(ctx, this.assets.coin, c.x + c.w / 2, c.y + c.h / 2, {
      sx: spin,
      anchorY: 0.5,
    });
  }

  private drawStar(ctx: CanvasRenderingContext2D, g: Gem, t: number) {
    const pulse = 1 + Math.sin(t * 4 + g.x * 0.05) * 0.08;
    this.blit(ctx, this.assets.star, g.x + g.w / 2, g.y + g.h / 2, {
      rot: t * 1.6 + g.x,
      sx: pulse,
      sy: pulse,
      anchorY: 0.5,
    });
  }

  private drawSnail(ctx: CanvasRenderingContext2D, s: Snail) {
    let sy = 1;
    let bob = 0;
    if (s.dead) {
      sy = 0.4;
    } else {
      bob = -Math.abs(Math.sin(s.animTime * 8)) * 1.5;
    }
    // snail art faces LEFT by default; flip when moving right
    this.blit(ctx, this.assets.snail, s.x + s.w / 2, s.y + s.h + bob, {
      flip: s.dir > 0,
      sy,
      anchorY: 1,
    });
  }

  private drawHero(ctx: CanvasRenderingContext2D, t: number) {
    const p = this.player;
    if (p.invuln > 0 && Math.floor(p.invuln * 16) % 2 === 0) return;

    let rot = 0;
    let sx = 1;
    let sy = 1;
    let bob = 0;
    if (p.state === "run") {
      const ph = p.animTime * 18;
      bob = -Math.abs(Math.sin(ph)) * 2;
      sy = 1 + Math.sin(ph) * 0.04;
      rot = 0.06; // lean into the run (mirrored by flip when facing left)
    } else if (p.state === "jump") {
      sy = 1.08;
      sx = 0.93;
      rot = 0.08;
    } else if (p.state === "fall") {
      sy = 0.95;
      sx = 1.05;
      rot = -0.05;
    } else {
      bob = Math.sin(t * 2.2) * 1; // idle breathing
    }
    this.blit(ctx, this.assets.hero, p.x + p.w / 2, p.y + p.h + bob, {
      flip: p.facing < 0,
      rot,
      sx,
      sy,
      anchorY: 1,
    });
  }

  private renderParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.fillRect(
        Math.round(p.x - this.camera.x),
        Math.round(p.y - this.camera.y),
        p.size,
        p.size,
      );
    }
    ctx.globalAlpha = 1;
  }
}
