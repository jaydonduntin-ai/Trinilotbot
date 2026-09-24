import { limitedOwnersCommand } from "./limitedowners.js";
import { rbx2dcCommand } from "./rbx2dc.js";
import { scanCommand } from "./scan.js";
import { targetsCommand } from "./targets.js";

export const commandModules = [
  rbx2dcCommand,
  targetsCommand,
  scanCommand,
  limitedOwnersCommand,
];
