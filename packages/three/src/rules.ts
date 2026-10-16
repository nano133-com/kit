export type RuleResult = { won: boolean };

/** One pure file shared by the browser and server. Inputs are the steps with a button press. */
export type Rules<State, Result extends RuleResult = RuleResult> = Readonly<{
  version: string;
  hz: number;
  maxSteps: number;
  maxInputs: number;
  start(seed: string): State;
  /** May return the next state, or change the supplied state in place. */
  step(state: State, pressed: boolean): State | void;
  /** Return null until the round ends, then a result with `won`. Use plain JSON data. No arrays inside arrays. */
  done(state: State): Result | null;
  /** Refuse an impossible input, such as a jump while in the air. Called before each step. */
  valid(state: State, pressed: boolean): boolean;
}>;

export type Replay<Result extends RuleResult = RuleResult> =
  | { valid: false; won: false; steps: 0; durationMs: 0 }
  | { valid: true; won: boolean; steps: number; durationMs: number; result: Result };

export function defineRules<State, Result extends RuleResult>(rules: Rules<State, Result>): Rules<State, Result> {
  if (typeof rules.version !== "string" || !rules.version.length || rules.version.length > 128) throw new Error("rules need a version");
  if (!Number.isFinite(rules.hz) || rules.hz <= 0 || rules.hz > 1000) throw new Error("hz must be positive and at most 1000");
  if (!Number.isSafeInteger(rules.maxSteps) || rules.maxSteps < 1 || rules.maxSteps > 1_000_000) throw new Error("maxSteps must be 1 to 1000000");
  if (!Number.isSafeInteger(rules.maxInputs) || rules.maxInputs < 0 || rules.maxInputs > rules.maxSteps) throw new Error("maxInputs must be 0 to maxSteps");
  if (!Number.isSafeInteger(Math.ceil(rules.maxSteps * 1000 / rules.hz))) throw new Error("round duration is too large");
  for (const name of ["start", "step", "done", "valid"] as const) {
    if (typeof rules[name] !== "function") throw new Error(`rules need ${name}`);
  }
  // Purity is the rule author's contract. A helper cannot inspect a function's hidden dependencies.
  return Object.freeze({ ...rules });
}

/** Replay every step. Refuse malformed lists, unused inputs and rounds that do not end. */
export function play<State, Result extends RuleResult>(rules: Rules<State, Result>, seed: string, inputs: unknown): Replay<Result> {
  const none = { valid: false, won: false, steps: 0, durationMs: 0 } as const;
  if (!Array.isArray(inputs) || inputs.length > rules.maxInputs) return none;
  for (let i = 0; i < inputs.length; i++) {
    if (!Number.isSafeInteger(inputs[i]) || inputs[i] < 0 || inputs[i] >= rules.maxSteps || (i > 0 && inputs[i] <= inputs[i - 1])) return none;
  }
  let state = rules.start(seed);
  let next = 0;
  for (let steps = 0; steps <= rules.maxSteps; steps++) {
    const result = rules.done(state);
    if (result !== null) {
      if (next !== inputs.length || typeof result.won !== "boolean") return none;
      return { valid: true, won: result.won, steps, durationMs: Math.ceil(steps * 1000 / rules.hz), result };
    }
    if (steps === rules.maxSteps) return none;
    const pressed = next < inputs.length && inputs[next] === steps;
    if (!rules.valid(state, pressed)) return none;
    if (pressed) next++;
    state = rules.step(state, pressed) ?? state;
  }
  return none;
}
