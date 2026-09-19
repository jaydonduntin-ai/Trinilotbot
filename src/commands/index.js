import { alertsCommand } from "./alerts.js";
import { dc2rbCommand } from "./dc2rb.js";
import { pingCommand } from "./ping.js";
import { limitedOwnersCommand } from "./limitedowners.js";
import { rbx2dcCommand } from "./rbx2dc.js";
import { robloxCommand } from "./roblox.js";
import { targetsCommand } from "./targets.js";
import { scanCommand } from "./scan.js";

export const commandModules = [
  pingCommand,
  robloxCommand,
  limitedOwnersCommand,
  rbx2dcCommand,
  dc2rbCommand,
  alertsCommand,
  targetsCommand,
  scanCommand,
];
