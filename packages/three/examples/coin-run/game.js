// Use a bundler that resolves `three` and `@nano133/three`. Supply a canvas#game and output#result.
import * as THREE from "three";
import { defineRules } from "@nano133/three";
import { BLOCKS, COINS, RUN, rules as shape } from "./run.js";

const rules = defineRules(shape);
const canvas = document.querySelector("#game");
const output = document.querySelector("#result");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(800, 450);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-4, 4, 3.4, -1.1, 0.1, 20);
camera.position.z = 10;
scene.add(new THREE.AmbientLight(0xffffff, 0.8), new THREE.DirectionalLight(0xffffff, 1.4));
const box = (w, h, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), new THREE.MeshStandardMaterial({ color }));
const floor = box(RUN.end + 20, 0.1, 0x35a8ff);
floor.position.set(RUN.end / 2, -0.05, 0);
const runner = box(RUN.wide, RUN.tall, 0xe9e9ee);
const coins = COINS.map((coin) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x209ce9 }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(coin.x, coin.y, 0);
  return mesh;
});
const blocks = BLOCKS.map((block) => {
  const mesh = box(block.wide, block.tall, 0xff6bd6);
  mesh.position.set(block.x, block.tall / 2, 0);
  return mesh;
});
scene.add(floor, runner, ...coins, ...blocks);

async function post(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("The server cannot check this round now.");
  return response.json();
}
// The server authenticates the player, binds the address and makes the seed.
const round = await post("/api/round", {});
if (round.rulesVersion !== rules.version) throw new Error("Reload the game for the new rules.");
const state = rules.start(round.seed);
const inputs = [];
let pressed = false;
addEventListener("pointerdown", () => { pressed = true; });
addEventListener("keydown", (event) => {
  if (event.code === "Space") { event.preventDefault(); pressed = true; }
});
const stepMs = 1000 / rules.hz;
let last = performance.now();
let owed = 0;

renderer.setAnimationLoop(async () => {
  const now = performance.now();
  owed += Math.min(now - last, 100);
  last = now;
  while (owed >= stepMs && !state.done) {
    owed -= stepMs;
    const jump = pressed && rules.valid(state, true);
    pressed = false;
    if (jump) inputs.push(state.step);
    rules.step(state, jump);
  }
  runner.position.set(state.x, state.y + RUN.tall / 2, 0);
  coins.forEach((mesh, i) => { mesh.visible = !state.coins[i]; });
  camera.position.x = state.x + 2;
  renderer.render(scene, camera);
  if (!state.done) return;
  renderer.setAnimationLoop(null);
  // The server replays inputs. The browser never submits an address, amount, seed, time or score.
  try {
    let answer;
    do {
      answer = await post("/api/round/" + round.roundId, { inputs });
      if (answer.state === "soon") await new Promise((resolve) => setTimeout(resolve, answer.waitMs));
    } while (answer.state === "soon");
    output.textContent = answer.state === "paid" ? "You won. The prize was sent."
      : answer.state === "no-prize" && answer.won ? "You won. No prize is available."
      : answer.state === "pending" ? "You won. The prize is waiting."
      : "The round has no prize.";
  } catch {
    output.textContent = "The server cannot check this round now. Try this round again later.";
  }
});
