import type { BaseId } from "../lists.js";
import { bee } from "./bee.js";
import { classic } from "./classic.js";
import { critter } from "./critter.js";
import { pineapple } from "./pineapple.js";
import { robot } from "./robot.js";
import { round } from "./round.js";
import type { BaseSpec } from "./spec.js";

/** Every base by id (lists.ts BASE_IDS). A host that wants only some imports their files, not this one. */
export const BASE_SPECS: Record<BaseId, BaseSpec> = { classic, round, critter, bee, robot, pineapple };
export type { BaseSpec };
