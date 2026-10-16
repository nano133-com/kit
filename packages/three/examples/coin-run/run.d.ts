import type { Rules } from "@nano133/three";

export const RUN: Readonly<{
  version: 1; hz: 60; speed: 4; slow: 2; slowSteps: 36; jump: 6.5; gravity: 18;
  wide: 0.6; tall: 1; reach: 0.62; end: 104;
}>;
export const COINS: readonly Readonly<{ x: number; y: number }>[];
export const BLOCKS: readonly Readonly<{ x: number; wide: number; tall: number }>[];
export type State = {
  step: number; x: number; y: number; vy: number; slow: number;
  coins: boolean[]; hits: boolean[]; done: boolean;
};
export function start(): State;
export function count(state: State): number;
export function step(state: State, jump: boolean): State;
export const MOST_STEPS: number;
export const rules: Rules<State, { won: boolean; coins: number; hits: number }>;
