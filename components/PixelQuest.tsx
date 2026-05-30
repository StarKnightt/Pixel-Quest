"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VIEW_W, VIEW_H, POWER_DURATION } from "@/lib/game/constants";
import type { HudSnapshot } from "@/lib/game/types";
import { Game } from "@/lib/game/game";
import { Renderer3D } from "@/lib/game/renderer3d";
import { AudioEngine } from "@/lib/game/audio";
import { InputManager } from "@/lib/game/input";
import { loadAll } from "@/lib/game/assets";
import { useGameLoop } from "@/hooks/useGameLoop";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INITIAL_HUD: HudSnapshot = {
  score: 0,
  coins: 0,
  time: 240,
  lives: 3,
  status: "ready",
  loseReason: null,
  power: 0,
};

export default function PixelQuest() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<Renderer3D | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const gradeRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const inputRef = useRef<InputManager | null>(null);

  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [god, setGod] = useState(false);
  const godRef = useRef(false);
  const [best, setBest] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const s = Number(localStorage.getItem("pq_highscore") || 0);
    return Number.isNaN(s) ? 0 : s;
  });
  const bestRef = useRef(best);

  // Mobile orientation handling: gate portrait with a "rotate" prompt and let
  // landscape go edge-to-edge fullscreen for a comfortable touch experience.
  const [isTouch, setIsTouch] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const touchMq = window.matchMedia("(pointer: coarse)");
    const portraitMq = window.matchMedia("(orientation: portrait)");
    const update = () => {
      setIsTouch(touchMq.matches);
      setIsPortrait(portraitMq.matches);
    };
    update();
    touchMq.addEventListener("change", update);
    portraitMq.addEventListener("change", update);
    return () => {
      touchMq.removeEventListener("change", update);
      portraitMq.removeEventListener("change", update);
    };
  }, []);
  const mobileLandscape = isTouch && !isPortrait;

  // PWA: register the service worker + capture the install prompt so we can
  // surface our own "Install" button (opens the web app as a standalone app).
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const reg = () =>
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      if (document.readyState === "complete") reg();
      else window.addEventListener("load", reg, { once: true });
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const evt = installEvt;
    if (!evt) return;
    await evt.prompt();
    try {
      await evt.userChoice;
    } finally {
      setInstallEvt(null);
    }
  }, [installEvt]);

  useEffect(() => {
    const audio = new AudioEngine();
    audioRef.current = audio;
    const input = new InputManager(() => setPaused((p) => !p));
    inputRef.current = input;

    // Cheat codes (handy for recording): type "god" to toggle invincibility +
    // infinite time, "win" to instantly clear the stage.
    let buf = "";
    const onCheat = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-8);
      if (buf.endsWith("god")) {
        buf = "";
        const v = !godRef.current;
        godRef.current = v;
        gameRef.current?.setGodMode(v);
        setGod(v);
      } else if (buf.endsWith("win")) {
        buf = "";
        gameRef.current?.forceWin();
      }
    };
    window.addEventListener("keydown", onCheat);

    let cancelled = false;
    loadAll(setProgress).then(({ assets, tileset }) => {
      if (cancelled || !canvasRef.current) return;
      const game = new Game(assets, tileset, audio);
      gameRef.current = game;
      // HUD updates are pushed from the game loop (not during render), so it's
      // also the right place to persist a new high score.
      game.onHud((snap) => {
        setHud(snap);
        if (
          (snap.status === "won" || snap.status === "lost") &&
          snap.score > bestRef.current
        ) {
          bestRef.current = snap.score;
          localStorage.setItem("pq_highscore", String(snap.score));
          setBest(snap.score);
        }
      });
      rendererRef.current = new Renderer3D(
        canvasRef.current,
        assets,
        tileset,
        game,
      );
      input.attach();
      setLoaded(true);
    });

    return () => {
      cancelled = true;
      input.detach();
      window.removeEventListener("keydown", onCheat);
      audio.stopMusic();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // pause/resume the music (and all audio) alongside the game
  useEffect(() => {
    if (loaded) audioRef.current?.setPaused(paused);
  }, [paused, loaded]);

  useGameLoop(
    {
      update: (dt) => {
        const g = gameRef.current;
        const i = inputRef.current;
        if (g && i) g.update(dt, i.read());
      },
      render: () => {
        const g = gameRef.current;
        const r = rendererRef.current;
        if (!g || !r) return;
        r.sync(g);
        const f = flashRef.current;
        if (f) {
          const fl = g.getFlash();
          f.style.opacity = String(fl.alpha);
          f.style.backgroundColor = fl.color;
        }
        const grade = gradeRef.current;
        if (grade) {
          const sc = g.getScenery();
          const [gr, gg, gb] = sc.grade;
          grade.style.backgroundColor = `rgb(${Math.round(gr)},${Math.round(gg)},${Math.round(gb)})`;
          grade.style.opacity = String(sc.gradeAlpha);
        }
      },
    },
    loaded,
    paused,
  );

  const start = () => {
    audioRef.current?.ensure();
    if (!muted) audioRef.current?.setMuted(false);
    gameRef.current?.start();
  };

  const restart = () => {
    audioRef.current?.ensure();
    gameRef.current?.restart();
    setPaused(false);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audioRef.current?.setMuted(m);
  };

  const setVirtual = useCallback(
    (action: "left" | "right" | "jump", down: boolean) => {
      if (down) audioRef.current?.ensure();
      inputRef.current?.setVirtual(action, down);
    },
    [],
  );

  const bindTouch = (action: "left" | "right" | "jump") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      setVirtual(action, true);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      setVirtual(action, false);
    },
    onPointerLeave: () => setVirtual(action, false),
    onPointerCancel: () => setVirtual(action, false),
  });

  const score = hud.score.toString().padStart(6, "0");
  const coins = hud.coins.toString().padStart(2, "0");

  return (
    <div
      className={
        mobileLandscape
          ? "fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-black"
          : "flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-linear-to-b from-[#1a1230] via-[#120c24] to-[#07060d] p-2 sm:p-6"
      }
    >
      {!mobileLandscape && (
        <>
          <h1 className="font-pixel title-glow mb-2 text-center text-sm leading-relaxed tracking-wide text-amber-300 sm:mb-3 sm:text-2xl">
            PIXEL&nbsp;QUEST
          </h1>
          <div className="mb-3 flex items-center gap-2 sm:mb-5 sm:gap-3">
            <GithubStars />
            {installEvt && <InstallButton onClick={promptInstall} />}
          </div>
        </>
      )}

      <div
        className={mobileLandscape ? "relative h-full w-full" : "relative w-full max-w-5xl"}
        style={
          mobileLandscape
            ? undefined
            : { maxWidth: "min(64rem, calc((100dvh - 160px) * 1.7778))" }
        }
      >
        <div
          className={
            mobileLandscape
              ? "relative h-full w-full overflow-hidden bg-black"
              : "relative aspect-video w-full overflow-hidden rounded-xl border-4 border-[#2a2348] bg-black shadow-[0_0_0_4px_#0d0a1a,0_18px_50px_rgba(0,0,0,0.7)]"
          }
          style={{ touchAction: "none" }}
        >
          <canvas
            ref={canvasRef}
            width={VIEW_W}
            height={VIEW_H}
            className="absolute inset-0 block h-full w-full"
          />

          {/* biome colour grade (crossfades by camera position) */}
          <div
            ref={gradeRef}
            className="pointer-events-none absolute inset-0 z-5 opacity-0 transition-opacity duration-300"
            style={{ mixBlendMode: "soft-light" }}
          />

          {/* hit flash (driven imperatively from the game loop) */}
          <div
            ref={flashRef}
            className="pointer-events-none absolute inset-0 z-10 opacity-0"
          />

          {/* CRT post effect */}
          <div className="crt-flicker pointer-events-none absolute inset-0 z-20" />
          <div className="crt-scanlines pointer-events-none absolute inset-0 z-20" />
          <div className="crt-vignette pointer-events-none absolute inset-0 z-20 rounded-xl" />

          {/* HUD */}
          {loaded && (
            <Hud
              score={score}
              coins={coins}
              time={hud.time}
              lives={hud.lives}
              power={hud.power}
              muted={muted}
              paused={paused}
              onToggleMute={toggleMute}
              onTogglePause={() => setPaused((p) => !p)}
            />
          )}

          {/* cheat indicator */}
          {loaded && god && (
            <div className="font-pixel pointer-events-none absolute left-1/2 top-9 z-20 -translate-x-1/2 animate-pulse rounded border border-emerald-300/60 bg-emerald-400/90 px-2 py-1 text-[7px] text-emerald-950 sm:top-12 sm:text-[9px]">
              ★ GOD MODE ★
            </div>
          )}

          {/* Loading */}
          {!loaded && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#0b0820] text-center">
              <p className="font-pixel animate-pulse text-xs text-amber-300 sm:text-sm">
                LOADING…
              </p>
              <div className="h-3 w-48 overflow-hidden rounded-full border-2 border-[#3a2f5a] bg-[#1a1430]">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Start / Win / Lose / Pause overlays */}
          {loaded && hud.status === "ready" && (
            <Overlay>
              <OverlayTitle className="text-amber-300 title-glow">
                PIXEL QUEST
              </OverlayTitle>
              <Legend />
              <Controls />
              {best > 0 && (
                <p className="font-pixel text-[9px] text-violet-300/80">
                  BEST {best.toString().padStart(6, "0")}
                </p>
              )}
              <PixelButton onClick={start}>▶ START</PixelButton>
              {installEvt && <InstallButton onClick={promptInstall} />}
            </Overlay>
          )}

          {loaded && hud.status === "won" && (
            <Overlay>
              <OverlayTitle className="text-emerald-300 title-glow">
                YOU WIN!
              </OverlayTitle>
              <ResultStats score={score} best={best} record={hud.score >= best} />
              <PixelButton onClick={restart}>↻ PLAY AGAIN</PixelButton>
            </Overlay>
          )}

          {loaded && hud.status === "lost" && (
            <Overlay>
              <OverlayTitle className="text-rose-400 title-glow">
                {hud.loseReason === "time" ? "TIME UP!" : "GAME OVER"}
              </OverlayTitle>
              {hud.loseReason === "time" && (
                <p className="font-pixel text-[10px] tracking-widest text-amber-200/90 sm:text-xs">
                  THE CLOCK RAN OUT
                </p>
              )}
              <ResultStats score={score} best={best} record={hud.score >= best} />
              <PixelButton onClick={restart}>↻ TRY AGAIN</PixelButton>
            </Overlay>
          )}

          {loaded && paused && hud.status === "playing" && (
            <Overlay>
              <OverlayTitle className="text-violet-200 title-glow">
                PAUSED
              </OverlayTitle>
              <PixelButton onClick={() => setPaused(false)}>▶ RESUME</PixelButton>
            </Overlay>
          )}
          {/* Touch controls — overlaid on the canvas for touch devices */}
          {loaded && isTouch && hud.status === "playing" && !paused && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-3 sm:p-5">
              <div className="pointer-events-auto flex gap-3">
                <TouchButton {...bindTouch("left")}>◀</TouchButton>
                <TouchButton {...bindTouch("right")}>▶</TouchButton>
              </div>
              <TouchButton className="pointer-events-auto" {...bindTouch("jump")}>
                JUMP
              </TouchButton>
            </div>
          )}
        </div>
      </div>

      {/* Rotate-to-landscape gate (phones in portrait) */}
      {isTouch && isPortrait && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#07060d] px-8 text-center">
          <RotatePhoneIcon />
          <h2 className="font-pixel title-glow text-base leading-relaxed text-amber-300">
            ROTATE YOUR DEVICE
          </h2>
          <p className="font-pixel text-[10px] leading-5 text-violet-200/80">
            Pixel Quest plays best in landscape.
            <br />
            Turn your phone sideways to play.
          </p>
        </div>
      )}

      <p className="font-pixel mt-5 hidden text-center text-[10px] leading-5 text-violet-300/70 md:block">
        ← → / A D MOVE&nbsp;&nbsp;·&nbsp;&nbsp;SPACE / W / ↑ JUMP&nbsp;&nbsp;·&nbsp;&nbsp;P PAUSE
      </p>
    </div>
  );
}

function Hud({
  score,
  coins,
  time,
  lives,
  power,
  muted,
  paused,
  onToggleMute,
  onTogglePause,
}: {
  score: string;
  coins: string;
  time: number;
  lives: number;
  power: number;
  muted: boolean;
  paused: boolean;
  onToggleMute: () => void;
  onTogglePause: () => void;
}) {
  return (
    <div className="font-pixel pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2 text-[8px] text-white drop-shadow-[2px_2px_0_rgba(0,0,0,0.9)] sm:p-4 sm:text-[11px]">
      <div className="flex flex-wrap items-center gap-2 sm:gap-5">
        <span>
          <span className="text-amber-200">SCORE</span> {score}
        </span>
        <span className="flex items-center gap-1">
          <CoinIcon />×{coins}
        </span>
        <span>
          <span className="text-amber-200">TIME</span>{" "}
          <span className={time <= 30 ? "text-rose-400" : ""}>{time}</span>
        </span>
        {power > 0 && <SuperMeter power={power} />}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="flex items-center gap-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <HeartIcon key={i} filled={i < lives} />
          ))}
        </span>
        <button
          onClick={onToggleMute}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md border-2 border-[#4b3d7a] bg-[#2a2150]/90 text-amber-200 transition hover:bg-[#39306a] sm:h-9 sm:w-9"
          aria-label="Toggle music"
        >
          {muted ? "🔇" : "♪"}
        </button>
        <button
          onClick={onTogglePause}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md border-2 border-[#4b3d7a] bg-[#2a2150]/90 text-amber-200 transition hover:bg-[#39306a] sm:h-9 sm:w-9"
          aria-label="Pause"
        >
          {paused ? "▶" : "II"}
        </button>
      </div>
    </div>
  );
}

const REPO_URL = "https://github.com/StarKnightt/Pixel-Quest";

function GithubStars({ className = "" }: { className?: string }) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("https://api.github.com/repos/StarKnightt/Pixel-Quest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.stargazers_count === "number") {
          setStars(d.stargazers_count);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-pixel group inline-flex items-center gap-2 rounded-lg border-2 border-[#4b3d7a] bg-[#2a2150]/90 px-3 py-1.5 text-[8px] text-violet-100 shadow-[0_2px_0_#160f2e] transition hover:-translate-y-0.5 hover:border-amber-300/70 hover:bg-[#39306a] sm:text-[10px] ${className}`}
      aria-label="Star Pixel Quest on GitHub"
    >
      <GitHubIcon />
      <span className="hidden sm:inline">STAR ON GITHUB</span>
      <span className="sm:hidden">GITHUB</span>
      <span className="inline-flex items-center gap-1 rounded bg-[#160f2e] px-1.5 py-0.5 text-amber-300">
        <StarBadgeIcon />
        {stars ?? "★"}
      </span>
    </a>
  );
}

function InstallButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="font-pixel pointer-events-auto inline-flex items-center gap-2 rounded-lg border-2 border-amber-400/70 bg-amber-400/90 px-3 py-1.5 text-[8px] text-[#3a2400] shadow-[0_2px_0_#6b4a12] transition hover:-translate-y-0.5 hover:bg-amber-300 sm:text-[10px]"
      aria-label="Install Pixel Quest as an app"
    >
      <DownloadIcon />
      <span>INSTALL APP</span>
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" className="inline-block fill-current" aria-hidden="true">
      <path d="M7 1h2v6h3l-4 5-4-5h3V1zM2 13h12v2H2v-2z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className="inline-block fill-current" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function StarBadgeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" className="inline-block fill-current" aria-hidden="true">
      <path d="M8 1 L9.6 6 L14.5 6 L10.5 9 L12 14 L8 11 L4 14 L5.5 9 L1.5 6 L6.4 6 Z" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" className="inline-block">
      <circle cx="5.5" cy="5.5" r="5" fill="#e0a21c" />
      <circle cx="5.5" cy="5.5" r="3.4" fill="#ffd23f" />
      <rect x="4.6" y="3" width="1.8" height="5" fill="#e0a21c" />
    </svg>
  );
}

function SuperMeter({ power }: { power: number }) {
  const pct = Math.max(0, Math.min(1, power / POWER_DURATION));
  const low = power <= 2.5;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 ${low ? "animate-pulse" : ""}`}
        style={{ color: "#ffe14d", textShadow: "0 0 6px rgba(255,123,229,0.9)" }}
      >
        <StarBadgeIcon />
        SUPER
      </span>
      <span className="h-2 w-12 overflow-hidden rounded-full border border-[#7a3cff]/70 bg-[#160f2e] sm:w-16">
        <span
          className="block h-full rounded-full transition-[width] duration-150 ease-linear"
          style={{
            width: `${pct * 100}%`,
            background: "linear-gradient(90deg,#9bf6ff,#ffe14d,#ff7be5)",
          }}
        />
      </span>
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="inline-block">
      <path
        d="M8 14 L2 8 A3.2 3.2 0 0 1 8 4 A3.2 3.2 0 0 1 14 8 Z"
        fill={filled ? "#ff5d6c" : "#3a2f3a"}
        stroke={filled ? "#c43d52" : "#2a222e"}
        strokeWidth="1"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" className="inline-block">
      <path
        d="M8 1 L9.6 6 L14.5 6 L10.5 9 L12 14 L8 11 L4 14 L5.5 9 L1.5 6 L6.4 6 Z"
        fill="#ff7a3c"
        stroke="#b53c16"
        strokeWidth="0.8"
      />
      <circle cx="8" cy="8" r="1.6" fill="#ffd089" />
    </svg>
  );
}

function SnailIcon() {
  return (
    <svg width="15" height="13" viewBox="0 0 18 14" className="inline-block">
      <ellipse cx="11" cy="9" rx="6" ry="5" fill="#e06b3a" stroke="#a8431f" strokeWidth="0.8" />
      <ellipse cx="11" cy="7.5" rx="2.4" ry="2" fill="#9c3f1d" />
      <rect x="1" y="9" width="7" height="3" rx="1.5" fill="#9ad36b" />
      <rect x="2" y="3" width="1" height="4" fill="#9ad36b" />
      <rect x="1.5" y="2.5" width="1.8" height="1.8" rx="0.9" fill="#2a2230" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 12 16" className="inline-block">
      <rect x="2" y="1" width="1.5" height="14" fill="#d8d8e0" />
      <path d="M3.5 2 L11 4 L3.5 7 Z" fill="#e2543e" />
    </svg>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/60 px-6 backdrop-blur-[2px]">
      {children}
    </div>
  );
}

function OverlayTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`font-pixel animate-float text-xl leading-relaxed sm:text-4xl ${className}`}
    >
      {children}
    </h2>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-pixel inline-flex min-w-6 items-center justify-center rounded border-b-2 border-[#1c1530] bg-[#3a2f5a] px-1.5 py-1 text-[8px] text-violet-100 shadow-[0_1px_0_#0d0a1a]">
      {children}
    </span>
  );
}

function Controls() {
  return (
    <div className="font-pixel flex flex-col items-center gap-2 text-[9px] text-violet-200/90">
      <div className="flex items-center gap-1.5">
        <Key>←</Key>
        <Key>→</Key>
        <span className="px-1 text-violet-300/70">/</span>
        <Key>A</Key>
        <Key>D</Key>
        <span className="ml-1 text-violet-300/80">MOVE</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Key>SPACE</Key>
        <Key>W</Key>
        <Key>↑</Key>
        <span className="ml-1 text-violet-300/80">JUMP</span>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="font-pixel flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[8px] text-violet-200/90 sm:text-[9px]">
      <span className="flex items-center gap-1.5">
        <CoinIcon /> COLLECT
      </span>
      <span className="flex items-center gap-1.5">
        <StarIcon /> BONUS
      </span>
      <span className="flex items-center gap-1.5">
        <span style={{ color: "#ffe14d" }}>
          <StarBadgeIcon />
        </span>{" "}
        SUPER
      </span>
      <span className="flex items-center gap-1.5">
        <SnailIcon /> STOMP
      </span>
      <span className="flex items-center gap-1.5">
        <FlagIcon /> REACH
      </span>
    </div>
  );
}

function ResultStats({
  score,
  best,
  record,
}: {
  score: string;
  best: number;
  record: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      {record && best > 0 && (
        <span className="font-pixel animate-pulse rounded bg-amber-400 px-2 py-1 text-[8px] text-[#3a2400]">
          ★ NEW RECORD ★
        </span>
      )}
      <p className="font-pixel text-sm text-amber-300">SCORE {score}</p>
      <p className="font-pixel text-[10px] text-violet-300/80">
        BEST {best.toString().padStart(6, "0")}
      </p>
    </div>
  );
}

function PixelButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="font-pixel rounded-md border-b-4 border-[#9a6b1a] bg-amber-400 px-6 py-3 text-xs text-[#3a2400] shadow-[0_4px_0_#6b4a12] transition active:translate-y-1 active:border-b-0 active:shadow-none sm:text-sm"
    >
      {children}
    </button>
  );
}

function TouchButton({
  children,
  className = "",
  ...handlers
}: {
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...handlers}
      className={`font-pixel flex h-14 min-w-14 select-none items-center justify-center rounded-xl border-2 border-[#4b3d7a] bg-[#2a2150]/70 px-5 text-sm text-amber-200 backdrop-blur-sm active:bg-[#39306a] sm:h-16 sm:min-w-16 ${className}`}
    >
      {children}
    </button>
  );
}

function RotatePhoneIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      className="animate-rotate-hint text-amber-300"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
      <path d="M3 12a9 9 0 0 1 4-7.5" />
      <polyline points="3 9 3 12 6 12" />
    </svg>
  );
}
