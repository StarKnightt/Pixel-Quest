// Loads the painterly background plus all generated image assets and processes
// them before the first frame (no mid-loop loading => no flicker):
//   - sprites are generated on a flat magenta key colour, so we chroma-key it
//     out to transparency, auto-crop the empty margins, then pre-scale to the
//     in-game pixel size with high-quality resampling.
//   - terrain tiles are opaque squares, scaled to the tile size.

import { TILE } from "./constants";
import type { Assets, Sprite, Tileset } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Remove the flat magenta (#FF00FF) background, returning RGBA image data. */
function chromaKey(img: HTMLImageElement) {
  const c = canvasOf(img.width, img.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i];
    const g = p[i + 1];
    const b = p[i + 2];
    // magenta = high red + high blue, low green (robust to darker/vignetted bg)
    const mag = Math.min(r, b) - g;
    if (r > 128 && b > 128 && mag > 45) {
      p[i + 3] = 0; // fully transparent
    } else if (r > 110 && b > 110 && mag > 22) {
      p[i + 3] = 80; // soft anti-aliased edge
      // de-spill: pull the magenta tint out of the kept edge pixel
      p[i] = Math.round((r + g) / 2);
      p[i + 2] = Math.round((b + g) / 2);
    }
  }
  ctx.putImageData(data, 0, 0);
  return { canvas: c, ctx, data };
}

/** Bounding box of pixels with meaningful alpha. */
function opaqueBounds(data: ImageData) {
  const { width, height } = data;
  const p = data.data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (p[(y * width + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Chroma-key, crop to content, and scale to a target height (keeps aspect). */
function processSprite(img: HTMLImageElement, targetH: number): Sprite {
  const { canvas: keyed, data } = chromaKey(img);
  const b = opaqueBounds(data);
  return drawScaled(keyed, b, targetH / b.h);
}

interface FrameMetrics {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centroidX: number; // alpha-weighted horizontal centre of mass
  bottomY: number; // lowest opaque row (ground-contact line)
  w: number;
  h: number;
}

/** Measure the opaque content: bounds, ground line, and body centre. */
function spriteMetrics(data: ImageData): FrameMetrics {
  const { width, height } = data;
  const p = data.data;
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0,
    sumA = 0,
    sumAX = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = p[(y * width + x) * 4 + 3];
      if (a > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sumA += a;
        sumAX += a * x;
      }
    }
  }
  const centroidX = sumA ? sumAX / sumA : (minX + maxX) / 2;
  return {
    minX,
    minY,
    maxX,
    maxY,
    centroidX,
    bottomY: maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

/**
 * The 2.5D "sprite-atlas" trick: bake every hero pose onto ONE common canvas
 * size, registered by body centre (X) and ground line (bottom). All frames
 * share a single scale derived from the base run frame, so swapping frames only
 * swaps the picture - the billboard's size/anchor never move, killing jitter.
 */
function bakeHeroFrames(
  images: Record<string, HTMLImageElement>,
  names: string[],
  baseHeight: number,
): Record<string, Sprite> {
  const keyed: Record<string, HTMLCanvasElement> = {};
  const metrics: Record<string, FrameMetrics> = {};
  for (const n of names) {
    const { canvas, data } = chromaKey(images[n]);
    keyed[n] = canvas;
    metrics[n] = spriteMetrics(data);
  }

  // One shared scale (from the base/contact frame) so the character never
  // changes size between poses.
  const scale = baseHeight / metrics[names[0]].h;

  // Common cell big enough for the widest reach and tallest pose.
  let maxHalf = 0;
  let maxTop = 0;
  for (const n of names) {
    const m = metrics[n];
    maxHalf = Math.max(
      maxHalf,
      (m.centroidX - m.minX) * scale,
      (m.maxX - m.centroidX) * scale,
    );
    maxTop = Math.max(maxTop, (m.bottomY - m.minY) * scale);
  }
  const padX = 4;
  const padTop = 6;
  const padBottom = 1;
  const W = Math.ceil(maxHalf * 2) + padX * 2;
  const H = Math.ceil(maxTop) + padTop + padBottom;

  const out: Record<string, Sprite> = {};
  for (const n of names) {
    const m = metrics[n];
    const c = canvasOf(W, H);
    const cx = c.getContext("2d")!;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = "high";
    const src = keyed[n];
    // Map source point (centroidX, bottomY) -> (W/2, H - padBottom).
    const dx = W / 2 - m.centroidX * scale;
    const dy = H - padBottom - m.bottomY * scale;
    cx.drawImage(
      src,
      0,
      0,
      src.width,
      src.height,
      dx,
      dy,
      src.width * scale,
      src.height * scale,
    );
    out[n] = { canvas: c, w: W, h: H };
  }
  return out;
}

function drawScaled(
  keyed: HTMLCanvasElement,
  b: { x: number; y: number; w: number; h: number },
  scale: number,
): Sprite {
  const w = Math.max(1, Math.round(b.w * scale));
  const h = Math.max(1, Math.round(b.h * scale));
  const out = canvasOf(w, h);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(keyed, b.x, b.y, b.w, b.h, 0, 0, w, h);
  return { canvas: out, w, h };
}

// Tiles are used as 3D block textures, so keep them higher-res than one tile.
const TILE_TEX = 128;

/** Scale an opaque image to a square tile texture. */
function processTile(img: HTMLImageElement): HTMLCanvasElement {
  const out = canvasOf(TILE_TEX, TILE_TEX);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(img, 0, 0, img.width, img.height, 0, 0, TILE_TEX, TILE_TEX);
  return out;
}

export interface LoadedAssets {
  assets: Assets;
  tileset: Tileset;
}

export async function loadAll(
  onProgress?: (fraction: number) => void,
): Promise<LoadedAssets> {
  const sources = {
    scene: "/assets/bg/scene.png",
    hero: "/assets/sprites/hero.png",
    heroIdle: "/assets/sprites/hero_idle.png",
    heroRun2: "/assets/sprites/hero_run2.png",
    heroRun3: "/assets/sprites/hero_run3.png",
    heroRun4: "/assets/sprites/hero_run4.png",
    heroJump: "/assets/sprites/hero_jump.png",
    snail: "/assets/sprites/snail.png",
    coin: "/assets/sprites/coin.png",
    star: "/assets/sprites/star.png",
    cloud: "/assets/sprites/cloud.png",
    grass: "/assets/tiles/tile_grass.png",
    dirt: "/assets/tiles/tile_dirt.png",
    stone: "/assets/tiles/tile_stone.png",
    crate: "/assets/tiles/tile_crate.png",
  } as const;

  const keys = Object.keys(sources) as (keyof typeof sources)[];
  const images = {} as Record<keyof typeof sources, HTMLImageElement>;
  let done = 0;
  for (const k of keys) {
    images[k] = await loadImage(sources[k]);
    done += 1;
    onProgress?.((done / keys.length) * 0.85);
  }

  // yield once so the loader UI can paint before the (sync) processing pass
  await new Promise((r) => setTimeout(r, 0));

  // Bake all hero poses onto a single common cell, registered by body centre
  // and ground line. Every frame becomes the exact same size with the same
  // anchor, so frame swaps animate the limbs without moving/resizing the
  // billboard (this is what removes the "jitter").
  const heroNames = [
    "hero",
    "heroRun2",
    "heroRun3",
    "heroRun4",
    "heroIdle",
    "heroJump",
  ];
  const baked = bakeHeroFrames(images, heroNames, 120);
  const hero = baked.hero;
  const assets: Assets = {
    scene: images.scene,
    // High-res textures: the 3D renderer sets world size separately, so we keep
    // these crisp for the billboards rather than tiny in-game pixels.
    hero,
    heroIdle: baked.heroIdle,
    heroRun: [hero, baked.heroRun2, baked.heroRun3, baked.heroRun4],
    heroJump: baked.heroJump,
    snail: processSprite(images.snail, 96),
    coin: processSprite(images.coin, 80),
    star: processSprite(images.star, 96),
    cloud: processSprite(images.cloud, 128),
  };
  const tileset: Tileset = {
    grassTop: processTile(images.grass),
    dirt: processTile(images.dirt),
    stone: processTile(images.stone),
    crate: processTile(images.crate),
  };

  onProgress?.(1);
  return { assets, tileset };
}
