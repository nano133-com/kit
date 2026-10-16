// "Coin Run": the rule of the small runner on /build/three/run, and nothing else. No three.js, no React, no
// clock and no random call: the course is data, the player's jumps are a list of step numbers, and the two give
// the result. So the game in the browser and a server can run the SAME file, and a server can play a run again
// before it believes its count of coins.
export const RUN = {
    /** Change it when a number below changes: a run is played again with the rules it started with. */
    version: 1,
    /** Steps a second. Every number of time in a run is a count of these steps. */
    hz: 60,
    /** The runner's speed (units a second), and its speed for a moment after it hits a block. */
    speed: 4,
    slow: 2,
    slowSteps: 36,
    /** A jump: its start speed up, and the pull down (units a second, and a second squared). */
    jump: 6.5,
    gravity: 18,
    /** The runner is a box this wide and this high; its feet are at its height `y`. */
    wide: 0.6,
    tall: 1,
    /** A coin is taken when the runner's middle is this near it. */
    reach: 0.62,
    /** Where the course ends. */
    end: 104,
};
/** The 10 coins: where each one is (x along the course, y above the ground). A coin at 0.5 is on the way; one at 1.7 needs a jump. */
export const COINS = [
    { x: 8, y: 0.5 }, { x: 14, y: 0.5 }, { x: 20, y: 1.7 }, { x: 30, y: 0.5 }, { x: 40, y: 1.7 },
    { x: 52, y: 0.5 }, { x: 62, y: 1.7 }, { x: 70, y: 0.5 }, { x: 84, y: 1.7 }, { x: 96, y: 0.5 },
];
/** The 6 low blocks: where each one stands, and its size. Two of them have a coin over them. */
export const BLOCKS = [
    { x: 26, wide: 0.6, tall: 0.6 }, { x: 40, wide: 0.6, tall: 0.6 }, { x: 46, wide: 0.6, tall: 0.6 },
    { x: 62, wide: 0.6, tall: 0.6 }, { x: 76, wide: 0.6, tall: 0.6 }, { x: 90, wide: 0.6, tall: 0.6 },
];
export const start = () => ({ step: 0, x: 0, y: 0, vy: 0, slow: 0, coins: COINS.map(() => false), hits: BLOCKS.map(() => false), done: false });
export const count = (s) => s.coins.filter(Boolean).length;
/**
 * One step. `jump`: the player pressed jump at this step; it counts only when the runner is on the ground.
 * A block that the runner touches is hit one time: the runner slows for a moment and goes on (a hit is no end).
 */
export function step(s, jump) {
    if (s.done)
        return s;
    const dt = 1 / RUN.hz;
    if (jump && s.y === 0 && s.vy === 0)
        s.vy = RUN.jump;
    s.x += (s.slow > 0 ? RUN.slow : RUN.speed) * dt;
    if (s.slow > 0)
        s.slow--;
    if (s.vy !== 0 || s.y > 0) {
        s.y += s.vy * dt;
        s.vy -= RUN.gravity * dt;
        if (s.y <= 0) {
            s.y = 0;
            s.vy = 0;
        }
    }
    BLOCKS.forEach((b, i) => {
        if (s.hits[i] || Math.abs(s.x - b.x) > (b.wide + RUN.wide) / 2 || s.y >= b.tall)
            return;
        s.hits[i] = true;
        s.slow = RUN.slowSteps;
    });
    COINS.forEach((c, i) => {
        if (!s.coins[i] && near(s.x - c.x, s.y + RUN.tall / 2 - c.y, RUN.reach))
            s.coins[i] = true;
    });
    s.step++;
    if (s.x >= RUN.end)
        s.done = true;
    return s;
}
/** Within reach, by squared distance: only + and *, which every JavaScript engine computes the same (no hypot, no **). */
const near = (dx, dy, r) => dx * dx + dy * dy <= r * r;
/** The longest run there is, in steps: every block hit. No run goes on for longer. */
export const MOST_STEPS = Math.ceil((RUN.end / RUN.speed) * RUN.hz) + BLOCKS.length * RUN.slowSteps + 2;

// Keep the course data fixed for both the browser and the server.
Object.freeze(RUN);
COINS.forEach(Object.freeze);
Object.freeze(COINS);
BLOCKS.forEach(Object.freeze);
Object.freeze(BLOCKS);

// Pass this shape to defineRules() in both the browser and the server.
export const rules = {
  version: 'coin-run:' + RUN.version,
  hz: RUN.hz,
  maxSteps: MOST_STEPS,
  maxInputs: MOST_STEPS,
  start,
  step,
  valid: (state, jump) => !jump || (state.y === 0 && state.vy === 0),
  done: (state) => state.done ? {
    won: count(state) === COINS.length,
    coins: count(state),
    hits: state.hits.filter(Boolean).length,
  } : null,
};
