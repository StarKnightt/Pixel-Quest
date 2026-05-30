// 3D renderer for Pixel Quest. The simulation (physics, collision, entities,
// camera, audio) is unchanged and lives in Game; this module renders that state
// as a real 3D world: extruded block terrain with directional lighting + soft
// shadows, a perspective camera tilted to reveal block tops for depth, and the
// painterly hero / snails / pickups kept as camera-facing billboard sprites so
// the hand-painted art still shines. Coordinate mapping: worldX = gameX,
// worldY = -gameY (screen-down becomes world-up), blocks extruded along -Z.

import * as THREE from "three";
import { TILE, VIEW_W, VIEW_H } from "./constants";
import type { Assets, Sprite, Tileset } from "./types";
import {
  Level,
  SOLID_GROUND,
  SOLID_STONE,
  SOLID_CRATE,
} from "./level";
import type { Game } from "./game";

const DEPTH = TILE * 1.15; // how far blocks extrude into the screen
const CHAR_Z = 7; // billboards sit just in front of the block faces (z=0)
const PICKUP_Z = 9;
const CLOUD_Z = 3;
const GOAL_Z = 5;
const MAX_PARTICLES = 220;

function texFromTile(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

function texFromSprite(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter; // sprites aren't power-of-two
  t.generateMipmaps = false;
  return t;
}

/** A round soft alpha blob used for particles + contact shadows. */
function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A chunky 5-point "super star" power-up sprite, drawn procedurally so we
 *  don't need to extend the image-asset pipeline. Glowing gold body, white
 *  core, dark outline + two sparkle eyes for that classic power-up charm. */
function starTexture(): THREE.CanvasTexture {
  const theme = {
    glow: "rgba(255,231,120,0.55)",
    outline: "#7a3cff",
    body: ["#fff7c4", "#ffe14d", "#ff9b2f"] as const,
    eye: "#5a2bb8",
  };
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2 + 4;
  const outer = S * 0.42;
  const inner = outer * 0.45;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  // soft outer glow
  const glow = ctx.createRadialGradient(cx, cy, inner * 0.5, cx, cy, outer * 1.5);
  glow.addColorStop(0, theme.glow);
  glow.addColorStop(1, theme.glow.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);
  // dark outline
  ctx.lineJoin = "round";
  ctx.lineWidth = 9;
  ctx.strokeStyle = theme.outline;
  path();
  ctx.stroke();
  // body gradient
  const body = ctx.createLinearGradient(cx, cy - outer, cx, cy + outer);
  body.addColorStop(0, theme.body[0]);
  body.addColorStop(0.5, theme.body[1]);
  body.addColorStop(1, theme.body[2]);
  ctx.fillStyle = body;
  path();
  ctx.fill();
  // glossy highlight
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx - outer * 0.18, cy - outer * 0.28, outer * 0.22, outer * 0.34, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // sparkle eyes
  ctx.fillStyle = theme.eye;
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * outer * 0.2, cy + outer * 0.06, outer * 0.06, outer * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

interface EntityRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  private hemi!: THREE.HemisphereLight;
  private fog!: THREE.Fog;

  private quad = new THREE.PlaneGeometry(1, 1);
  private shadowMat: THREE.MeshBasicMaterial;
  private mats: Record<"snail" | "coin" | "star" | "cloud", THREE.MeshBasicMaterial>;
  private aspect: Record<"snail" | "coin" | "star", number>;
  private heroMats!: {
    idle: THREE.MeshBasicMaterial;
    run: THREE.MeshBasicMaterial[];
    jump: THREE.MeshBasicMaterial;
  };
  private heroSprites!: { idle: Sprite; run: Sprite[]; jump: Sprite };
  private heroPPU = 0.32; // world units per sprite pixel (keeps frames same size)

  private hero: THREE.Mesh;
  private heroShadow: THREE.Mesh;
  private snailMeshes = new Map<object, { body: THREE.Mesh; shadow: THREE.Mesh }>();
  private coinMeshes = new Map<object, THREE.Mesh>();
  private gemMeshes = new Map<object, THREE.Mesh>();
  private powerupMeshes = new Map<object, THREE.Mesh>();
  private powerMat!: THREE.MeshBasicMaterial;
  private heroAura!: THREE.Mesh;
  private cloudMeshes: { mesh: THREE.Mesh; h: number }[] = [];
  private flag: THREE.Mesh | null = null;

  // floating "+N" score popups: a reusable mesh pool + a cache of text textures
  private scorePopupMeshes: THREE.Mesh[] = [];
  private textTexCache = new Map<
    string,
    { tex: THREE.CanvasTexture; aspect: number }
  >();

  private particles: THREE.Points;
  private particlePos: Float32Array;

  // falling-snow field (shown only in snowy biomes), anchored to the camera
  private snow!: THREE.Points;
  private snowPos!: Float32Array;
  private snowMat!: THREE.PointsMaterial;
  private snowSeed: { fx: number; fy: number; speed: number; sway: number }[] = [];

  private level: Level;
  private cw = 0;
  private ch = 0;

  constructor(
    canvas: HTMLCanvasElement,
    assets: Assets,
    tileset: Tileset,
    game: Game,
  ) {
    this.level = game.level;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // painterly backdrop as the scene background (fills the viewport)
    const bg = new THREE.Texture(assets.scene);
    bg.colorSpace = THREE.SRGBColorSpace;
    bg.needsUpdate = true;
    this.scene.background = bg;
    this.fog = new THREE.Fog(0x241a3a, 700, 1500);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 4000);

    // --- lighting ------------------------------------------------------
    this.ambient = new THREE.AmbientLight(0x9aa6d6, 1.05);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a2b55, 0.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1400;
    const s = 360;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 1.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // warm rim/back light from the glowing forest behind the player
    const rim = new THREE.DirectionalLight(0x7fe3ff, 0.35);
    rim.position.set(120, 60, -200);
    this.scene.add(rim);

    // --- static block terrain -----------------------------------------
    this.buildTerrain(tileset);
    this.buildClouds(game.cloudRects, assets.cloud);
    this.buildGoal(game.goalRect);

    // --- shared sprite materials ---------------------------------------
    const mkMat = (spr: Sprite, transparent = false): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        map: texFromSprite(spr.canvas),
        transparent,
        alphaTest: transparent ? 0.04 : 0.4,
        depthWrite: !transparent,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

    this.mats = {
      snail: mkMat(assets.snail),
      coin: mkMat(assets.coin),
      star: mkMat(assets.star),
      cloud: mkMat(assets.cloud, true),
    };
    this.aspect = {
      snail: assets.snail.w / assets.snail.h,
      coin: assets.coin.w / assets.coin.h,
      star: assets.star.w / assets.star.h,
    };
    // hero animation: one material per frame, swapped each frame for real motion
    this.heroSprites = {
      idle: assets.heroIdle,
      run: assets.heroRun,
      jump: assets.heroJump,
    };
    this.heroMats = {
      idle: mkMat(assets.heroIdle),
      run: assets.heroRun.map((s) => mkMat(s)),
      jump: mkMat(assets.heroJump),
    };
    this.heroPPU = 38 / assets.hero.h; // base run frame ≈ 38 world units tall

    this.shadowMat = new THREE.MeshBasicMaterial({
      map: radialTexture("rgba(6,4,14,0.55)", "rgba(6,4,14,0)"),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    // super-star power-up: procedural glowing-star billboard
    this.powerMat = new THREE.MeshBasicMaterial({
      map: starTexture(),
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    // additive glow that haloes the hero while Super mode is active
    this.heroAura = new THREE.Mesh(
      this.quad,
      new THREE.MeshBasicMaterial({
        map: radialTexture("rgba(255,231,120,0.9)", "rgba(155,246,255,0)"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.heroAura.renderOrder = 4;
    this.heroAura.visible = false;
    this.scene.add(this.heroAura);

    this.hero = new THREE.Mesh(this.quad, this.heroMats.idle);
    this.hero.renderOrder = 5;
    this.scene.add(this.hero);
    this.heroShadow = new THREE.Mesh(this.quad, this.shadowMat);
    this.heroShadow.renderOrder = 1;
    this.scene.add(this.heroShadow);

    // --- particles -----------------------------------------------------
    this.particlePos = new Float32Array(MAX_PARTICLES * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.BufferAttribute(this.particlePos, 3));
    pgeo.setDrawRange(0, 0);
    const pmat = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: true,
      map: radialTexture("rgba(255,240,200,1)", "rgba(255,200,120,0)"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.particles = new THREE.Points(pgeo, pmat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    // --- falling snow (camera-anchored, faded in by biome) -------------
    const SNOW = 150;
    this.snowPos = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW; i++) {
      this.snowSeed.push({
        fx: Math.random(),
        fy: Math.random(),
        speed: 0.06 + Math.random() * 0.1,
        sway: Math.random() * Math.PI * 2,
      });
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3));
    this.snowMat = new THREE.PointsMaterial({
      size: 7,
      sizeAttenuation: true,
      map: radialTexture("rgba(255,255,255,1)", "rgba(235,245,255,0)"),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.snow = new THREE.Points(sgeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 20;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  // ---------------------------------------------------------------- build

  private buildTerrain(tileset: Tileset) {
    const lvl = this.level;
    const collect = {
      grass: [] as number[][],
      dirt: [] as number[][],
      stone: [] as number[][],
      crate: [] as number[][],
    };
    for (let r = 0; r < lvl.rows; r++) {
      for (let c = 0; c < lvl.cols; c++) {
        const t = lvl.tileAt(c, r);
        if (t === SOLID_GROUND) {
          const above = lvl.tileAt(c, r - 1);
          (above === 0 ? collect.grass : collect.dirt).push([c, r]);
        } else if (t === SOLID_STONE) {
          collect.stone.push([c, r]);
        } else if (t === SOLID_CRATE) {
          collect.crate.push([c, r]);
        }
      }
    }

    const box = new THREE.BoxGeometry(TILE, TILE, DEPTH);
    const make = (cells: number[][], tex: HTMLCanvasElement, rough: number) => {
      if (cells.length === 0) return;
      const mat = new THREE.MeshStandardMaterial({
        map: texFromTile(tex),
        roughness: rough,
        metalness: 0,
      });
      const mesh = new THREE.InstancedMesh(box, mat, cells.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const m = new THREE.Matrix4();
      cells.forEach(([c, r], i) => {
        m.makeTranslation(
          c * TILE + TILE / 2,
          -(r * TILE + TILE / 2),
          -DEPTH / 2,
        );
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    };
    make(collect.grass, tileset.grassTop, 0.95);
    make(collect.dirt, tileset.dirt, 0.98);
    make(collect.stone, tileset.stone, 0.8);
    make(collect.crate, tileset.crate, 0.7);
  }

  private buildClouds(rects: EntityRect[], cloud: Sprite) {
    const mat = new THREE.MeshBasicMaterial({
      map: texFromSprite(cloud.canvas),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const cloudAspect = cloud.w / cloud.h; // keep the puff's natural shape
    for (const c of rects) {
      // width follows the platform; height follows the sprite aspect (no squeeze)
      const w = Math.max(c.w + 22, 64);
      const h = Math.min(Math.max(w / cloudAspect, TILE * 1.05), TILE * 2.0);
      const mesh = new THREE.Mesh(this.quad, mat);
      mesh.scale.set(w, h, 1);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.cloudMeshes.push({ mesh, h });
    }
  }

  private buildGoal(goal: EntityRect) {
    const group = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xe6e6ee,
      roughness: 0.4,
      metalness: 0.3,
    });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, goal.h + 8, 10),
      poleMat,
    );
    pole.castShadow = true;
    pole.position.set(goal.x + goal.w / 2, -(goal.y + goal.h / 2), GOAL_Z);
    group.add(pole);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(4, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffd23f,
        emissive: 0x6b4a00,
        roughness: 0.3,
      }),
    );
    knob.position.set(goal.x + goal.w / 2, -(goal.y - 6), GOAL_Z);
    group.add(knob);

    const flag = new THREE.Mesh(
      this.quad,
      new THREE.MeshStandardMaterial({
        color: 0xe2543e,
        emissive: 0x3a0f06,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    flag.scale.set(26, 16, 1);
    flag.position.set(goal.x + goal.w / 2 + 14, -(goal.y + 10), GOAL_Z + 1);
    flag.castShadow = true;
    group.add(flag);
    this.flag = flag;

    this.scene.add(group);
  }

  // ------------------------------------------------------------- per-frame

  /** Lay a sprite mesh out as a camera-facing billboard. */
  private billboard(
    mesh: THREE.Mesh,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    flip: boolean,
    rot: number,
  ) {
    mesh.position.set(x, y, z);
    mesh.quaternion.copy(this.camera.quaternion);
    if (rot) mesh.rotateZ(rot);
    mesh.scale.set(flip ? -w : w, h, 1);
  }

  /** Ground Y (game space) directly below a rect, for contact shadows. */
  private groundBelow(rect: EntityRect): number {
    let gy = rect.y + rect.h;
    const cx = rect.x + rect.w / 2;
    for (let i = 0; i < 16; i++) {
      if (this.level.isSolidAt(cx, gy + 2)) break;
      gy += TILE;
    }
    return gy;
  }

  private layShadow(mesh: THREE.Mesh, rect: EntityRect) {
    const gy = this.groundBelow(rect);
    const dist = Math.max(0, gy - (rect.y + rect.h));
    const shrink = Math.max(0.4, 1 - dist / (TILE * 5));
    const w = (rect.w + 6) * shrink;
    mesh.position.set(rect.x + rect.w / 2, -gy + 2, CHAR_Z - 3);
    mesh.quaternion.copy(this.camera.quaternion);
    mesh.scale.set(w, w * 0.5, 1);
    mesh.visible = w > 2;
  }

  sync(game: Game) {
    this.resize();

    // --- camera follows the (already smoothed + clamped) game camera ---
    const shake = game.getShakeOffset();
    const tx = game.camera.x + VIEW_W / 2 + shake.x;
    const ty = -(game.camera.y + VIEW_H / 2) + shake.y;
    this.camera.position.set(tx, ty + 64, 430);
    this.camera.lookAt(tx, ty - 28, 0);

    this.sun.position.set(tx - 220, ty + 340, 280);
    this.sun.target.position.set(tx, ty, -DEPTH / 2);
    this.sun.target.updateMatrixWorld();

    // --- biome atmosphere: lerp fog + light colours by camera position --
    const sc = game.getScenery();
    this.fog.color.setRGB(sc.fog[0], sc.fog[1], sc.fog[2]);
    this.sun.color.setRGB(sc.sun[0], sc.sun[1], sc.sun[2]);
    this.ambient.color.setRGB(sc.ambient[0], sc.ambient[1], sc.ambient[2]);
    this.hemi.color.setRGB(sc.hemiSky[0], sc.hemiSky[1], sc.hemiSky[2]);
    this.hemi.groundColor.setRGB(
      sc.hemiGround[0],
      sc.hemiGround[1],
      sc.hemiGround[2],
    );

    const t = performance.now() / 1000;

    // --- falling snow, faded in by the snow-biome factor ---------------
    this.snow.visible = sc.snow > 0.02;
    if (this.snow.visible) {
      this.snowMat.opacity = sc.snow * 0.9;
      const W = VIEW_W + 180;
      const H = VIEW_H + 180;
      const left = tx - W / 2;
      const top = ty + H / 2;
      for (let i = 0; i < this.snowSeed.length; i++) {
        const sd = this.snowSeed[i];
        const fx = (sd.fx + Math.sin(t * 0.5 + sd.sway) * 0.04 + 1) % 1;
        const fy = (sd.fy + t * sd.speed) % 1; // 0 at top -> 1 at bottom
        this.snowPos[i * 3] = left + fx * W;
        this.snowPos[i * 3 + 1] = top - fy * H;
        this.snowPos[i * 3 + 2] = PICKUP_Z + 6;
      }
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
        true;
    }

    // --- hero (real per-frame animation: legs/arms actually move) ------
    const p = game.player;
    const blink =
      !game.godMode && p.invuln > 0 && Math.floor(p.invuln * 16) % 2 === 0;
    this.hero.visible = !blink;
    {
      let spr: Sprite;
      let mat: THREE.MeshBasicMaterial;
      let rot = 0;

      if (p.dying) {
        spr = this.heroSprites.jump;
        mat = this.heroMats.jump;
        rot = p.deathSpin;
      } else if (p.state === "jump" || p.state === "fall") {
        spr = this.heroSprites.jump;
        mat = this.heroMats.jump;
      } else if (p.state === "run") {
        // cycle the run frames; cadence scales a little with speed
        const frames = this.heroSprites.run;
        const cadence = 0.16 - (Math.abs(p.vx) / 178) * 0.07;
        const i = Math.floor(p.animTime / Math.max(0.07, cadence)) % frames.length;
        spr = frames[i];
        mat = this.heroMats.run[i];
      } else {
        // idle: stand perfectly still and grounded (no bob/squash) - any
        // per-frame vertical motion here reads as the hero never settling
        spr = this.heroSprites.idle;
        mat = this.heroMats.idle;
      }

      if (this.hero.material !== mat) this.hero.material = mat;

      // Super Star mode: shimmer the hero + show a pulsing halo. In the final
      // ~2.5s the whole hero blinks to warn the power is about to run out.
      if (p.powered && !p.dying) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 18);
        mat.color.setRGB(1, 0.68 + 0.32 * pulse, 0.38 + 0.62 * pulse);
        const ending = p.powerT < 2.5 && Math.floor(p.powerT * 10) % 2 === 0;
        if (ending) this.hero.visible = false;
      } else {
        mat.color.setRGB(1, 1, 1);
      }

      const hW = spr.w * this.heroPPU;
      const hH = spr.h * this.heroPPU;
      const feet = p.y + p.h;
      const flip = p.facing < 0;
      this.billboard(
        this.hero,
        p.x + p.w / 2,
        -feet + hH / 2,
        CHAR_Z,
        hW,
        hH,
        flip,
        flip && !p.dying ? -rot : rot,
      );

      // halo aura behind the hero while powered
      this.heroAura.visible = p.powered && !p.dying;
      if (this.heroAura.visible) {
        const aura = 58 + Math.sin(t * 10) * 8;
        (this.heroAura.material as THREE.MeshBasicMaterial).opacity =
          0.55 + 0.25 * (0.5 + 0.5 * Math.sin(t * 12));
        this.billboard(
          this.heroAura,
          p.x + p.w / 2,
          -(p.y + p.h / 2),
          CHAR_Z - 1,
          aura,
          aura,
          false,
          t * 1.4,
        );
      }
    }
    if (!p.dying) this.layShadow(this.heroShadow, p.rect);
    else this.heroShadow.visible = false;

    // --- snails (pooled) ----------------------------------------------
    this.pruneSnails(game.snails);
    for (const s of game.snails) {
      const entry = this.snailEntry(s);
      const sH = 26;
      const sW = sH * this.aspect.snail;
      let sx = 1;
      let sy = 1;
      let bob = 0;
      if (s.dead) {
        // snappy squash: flatten + bulge wide fast, then shrink into a poof
        const prog = Math.min(1, Math.max(0, 1 - s.squashTimer / 0.7));
        const fSq = Math.min(1, prog / 0.28);
        const ease = 1 - Math.pow(1 - fSq, 3); // easeOutCubic
        sy = 1 - 0.74 * ease;
        sx = 1 + 0.6 * ease + Math.sin(fSq * Math.PI) * 0.14; // mid bulge
        const shrink = prog > 0.55 ? Math.max(0, 1 - (prog - 0.55) / 0.45) : 1;
        sx *= shrink;
        sy *= shrink;
      } else {
        bob = -Math.abs(Math.sin(s.animTime * 8)) * 1.5;
      }
      const feet = s.y + s.h + bob;
      this.billboard(
        entry.body,
        s.x + s.w / 2,
        -feet + (sH * sy) / 2,
        CHAR_Z,
        sW * sx,
        sH * sy,
        s.dir > 0,
        0,
      );
      if (s.dead) entry.shadow.visible = false;
      else this.layShadow(entry.shadow, s.rect);
    }

    // --- coins ---------------------------------------------------------
    this.prunePickups(this.coinMeshes, game.coins);
    for (const c of game.coins) {
      const mesh = this.pickupMesh(this.coinMeshes, c, this.mats.coin);
      const cH = 22;
      const cW = cH * this.aspect.coin;
      const spin = Math.abs(Math.cos(t * 3 + c.x * 0.05)) * 0.85 + 0.15;
      this.billboard(mesh, c.x + c.w / 2, -(c.y + c.h / 2), PICKUP_Z, cW * spin, cH, false, 0);
    }

    // --- gems / stars --------------------------------------------------
    this.prunePickups(this.gemMeshes, game.gems);
    for (const g of game.gems) {
      const mesh = this.pickupMesh(this.gemMeshes, g, this.mats.star);
      const gH = 26;
      const gW = gH * this.aspect.star;
      const pulse = 1 + Math.sin(t * 4 + g.x * 0.05) * 0.08;
      this.billboard(
        mesh,
        g.x + g.w / 2,
        -(g.y + g.h / 2),
        PICKUP_Z,
        gW * pulse,
        gH * pulse,
        false,
        t * 1.6 + g.x,
      );
    }

    // --- super-star power-ups -----------------------------------------
    this.prunePickups(this.powerupMeshes, game.powerups);
    for (const pu of game.powerups) {
      const mesh = this.pickupMesh(this.powerupMeshes, pu, this.powerMat);
      const sz = 30 + Math.sin(t * 5 + pu.x * 0.05) * 2.5;
      this.billboard(
        mesh,
        pu.x + pu.w / 2,
        -(pu.y + pu.h / 2),
        PICKUP_Z,
        sz,
        sz,
        false,
        Math.sin(t * 2 + pu.x) * 0.25,
      );
    }

    // --- moving cloud platforms ---------------------------------------
    const plats = game.platforms;
    for (let i = 0; i < this.cloudMeshes.length && i < plats.length; i++) {
      const { mesh, h } = this.cloudMeshes[i];
      const r = plats[i].rect;
      mesh.position.set(r.x + r.w / 2, -r.y - h * 0.3, CLOUD_Z);
    }

    // --- goal flag sway ------------------------------------------------
    if (this.flag) this.flag.rotation.z = Math.sin(game.flagWave) * 0.12;

    // --- particles -----------------------------------------------------
    const parts = game.particles;
    const n = Math.min(parts.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      this.particlePos[i * 3] = parts[i].x;
      this.particlePos[i * 3 + 1] = -parts[i].y;
      this.particlePos[i * 3 + 2] = PICKUP_Z + 1;
    }
    this.particles.geometry.setDrawRange(0, n);
    (this.particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;

    // --- floating "+N" score popups ------------------------------------
    const pops = game.scorePopups;
    for (const m of this.scorePopupMeshes) m.visible = false;
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      const { tex, aspect } = this.getTextTex(p.text, p.color);
      const mesh = this.getPopupMesh(i);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const k = Math.max(0, Math.min(1, p.life / p.maxLife));
      mat.opacity = k < 0.3 ? k / 0.3 : 1; // hold, then fade out near the end
      const hH = 15;
      const hW = hH * aspect;
      mesh.visible = true;
      this.billboard(mesh, p.x, -p.y, PICKUP_Z + 2, hW, hH, false, 0);
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------- pooling

  private snailEntry(s: object): { body: THREE.Mesh; shadow: THREE.Mesh } {
    let entry = this.snailMeshes.get(s);
    if (!entry) {
      const body = new THREE.Mesh(this.quad, this.mats.snail);
      body.renderOrder = 5;
      const shadow = new THREE.Mesh(this.quad, this.shadowMat);
      shadow.renderOrder = 1;
      this.scene.add(body, shadow);
      entry = { body, shadow };
      this.snailMeshes.set(s, entry);
    }
    return entry;
  }

  private pruneSnails(list: object[]) {
    const alive = new Set<object>(list);
    for (const [key, entry] of this.snailMeshes) {
      if (!alive.has(key)) {
        this.scene.remove(entry.body, entry.shadow);
        this.snailMeshes.delete(key);
      }
    }
  }

  private pickupMesh(
    map: Map<object, THREE.Mesh>,
    e: object,
    mat: THREE.MeshBasicMaterial,
  ): THREE.Mesh {
    let mesh = map.get(e);
    if (!mesh) {
      mesh = new THREE.Mesh(this.quad, mat);
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      map.set(e, mesh);
    }
    return mesh;
  }

  /** Cache a crisp outlined-text texture for a "+N" popup (keyed by text+color). */
  private getTextTex(text: string, color: string) {
    const key = `${text}|${color}`;
    let entry = this.textTexCache.get(key);
    if (!entry) {
      const fontPx = 72;
      const pad = 18;
      const font = `900 ${fontPx}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
      const measure = document.createElement("canvas").getContext("2d")!;
      measure.font = font;
      const w = Math.ceil(measure.measureText(text).width) + pad * 2;
      const h = fontPx + pad * 2;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "rgba(8,5,16,0.95)";
      ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, h / 2);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      entry = { tex, aspect: w / h };
      this.textTexCache.set(key, entry);
    }
    return entry;
  }

  private getPopupMesh(i: number): THREE.Mesh {
    let m = this.scorePopupMeshes[i];
    if (!m) {
      m = new THREE.Mesh(
        this.quad,
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      m.renderOrder = 12;
      this.scene.add(m);
      this.scorePopupMeshes[i] = m;
    }
    return m;
  }

  private prunePickups(map: Map<object, THREE.Mesh>, list: object[]) {
    const alive = new Set<object>(list);
    for (const [key, mesh] of map) {
      if (!alive.has(key)) {
        this.scene.remove(mesh);
        map.delete(key);
      }
    }
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (w === this.cw && h === this.ch) return;
    this.cw = w;
    this.ch = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.dispose();
  }
}
