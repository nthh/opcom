// TUI Component Model — Reusable, self-contained panel components
// See docs/spec/tui.md#component-model

import type { ScreenBuffer } from "../renderer.js";
import type { Panel } from "../layout.js";

/**
 * A self-contained TUI panel component. Components own their rendering,
 * state slice, scrolling, and keybindings. Views compose components into
 * layouts rather than owning panel logic directly.
 */
export interface TuiComponent<S> {
  /** Unique component id (used for focus routing) */
  readonly id: string;
  /** Initialize default state */
  init(): S;
  /** Render into a panel rect on the screen buffer */
  render(buf: ScreenBuffer, panel: Panel, state: S, focused: boolean): void;
  /** Handle a keypress when focused. Returns whether handled + updated state. */
  handleKey(key: string, state: S): { handled: boolean; state: S };
}
