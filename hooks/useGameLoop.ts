"use client";

// Fixed-timestep game loop. Real elapsed time is accumulated and the simulation
// advances in constant FIXED_DT slices (deterministic physics), while render is
// called once per animation frame. The loop only runs once `active` is true so
// nothing draws before assets finish preloading.

import { useEffect, useRef } from "react";
import { FIXED_DT, MAX_FRAME_DT } from "@/lib/game/constants";

interface LoopCallbacks {
  update: (dt: number) => void;
  render: () => void;
}

export function useGameLoop(callbacks: LoopCallbacks, active: boolean, paused: boolean) {
  const cbRef = useRef(callbacks);
  const pausedRef = useRef(paused);

  // Keep the loop's mutable view of callbacks/paused in sync without
  // re-subscribing the animation frame each render.
  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!active) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let elapsed = (now - last) / 1000;
      last = now;
      if (elapsed > MAX_FRAME_DT) elapsed = MAX_FRAME_DT;

      if (!pausedRef.current) {
        acc += elapsed;
        let steps = 0;
        while (acc >= FIXED_DT && steps < 8) {
          cbRef.current.update(FIXED_DT);
          acc -= FIXED_DT;
          steps += 1;
        }
      }
      cbRef.current.render();
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
