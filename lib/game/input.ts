// Keyboard + virtual (on-screen / touch) input. Tracks held-key state and
// exposes a per-frame jump edge so the game can buffer jumps.

import type { InputState } from "./types";

type Action = "left" | "right" | "jump";

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "jump",
  ArrowUp: "jump",
  KeyW: "jump",
};

export class InputManager {
  private held: Record<Action, boolean> = { left: false, right: false, jump: false };
  private virtual: Record<Action, boolean> = { left: false, right: false, jump: false };
  private jumpWasDown = false;
  private onPause?: () => void;

  constructor(onPause?: () => void) {
    this.onPause = onPause;
  }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyP" || e.code === "Escape") {
      this.onPause?.();
      return;
    }
    const action = KEY_MAP[e.code];
    if (action) {
      this.held[action] = true;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "ArrowDown")
        e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (action) this.held[action] = false;
  };

  private onBlur = () => {
    this.held = { left: false, right: false, jump: false };
    this.virtual = { left: false, right: false, jump: false };
  };

  /** For on-screen touch buttons. */
  setVirtual(action: Action, down: boolean) {
    this.virtual[action] = down;
  }

  /** Read + consume the current input, computing the jump-pressed edge. */
  read(): InputState {
    const left = this.held.left || this.virtual.left;
    const right = this.held.right || this.virtual.right;
    const jump = this.held.jump || this.virtual.jump;
    const jumpPressed = jump && !this.jumpWasDown;
    this.jumpWasDown = jump;
    return { left, right, jump, jumpPressed };
  }
}
