import { alertsCommand } from "./alerts.js";
import { dc2rbCommand } from "./dc2rb.js";
import { pingCommand } from "./ping.js";
import { limitedOwnersCommand } from "./limitedowners.js";
import { rbx2dcCommand } from "./rbx2dc.js";
import { rbx2mm2Command } from "./rbx2mm2.js";
import { rbx2mm2ValueCommand } from "./rbx2mm2value.js";
import { robloxCommand } from "./roblox.js";
import { targetsCommand } from "./targets.js";
import { scanCommand } from "./scan.js";

export const commandModules = [
  pingCommand,
  robloxCommand,
  limitedOwnersCommand,
  rbx2dcCommand,
  rbx2mm2Command,
  rbx2mm2ValueCommand,
  dc2rbCommand,
  alertsCommand,
  targetsCommand,
  scanCommand,
];
