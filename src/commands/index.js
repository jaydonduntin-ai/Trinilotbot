import { dc2robloxCommand } from "./dc2roblox.js";
import { devCommand } from "./dev.js";
import { rbx2dcCommand } from "./rbx2dc.js";
import { rbx2admCommand } from "./game-targets.js";
import { rbx2mm2Command } from "./rbx2mm2.js";
import { targetsCommand } from "./targets.js";

export const commandModules = [
  targetsCommand,
  rbx2mm2Command,
  rbx2admCommand,
  devCommand,
  dc2robloxCommand,
  rbx2dcCommand,
];
