import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const EXECUTE_WRAPPED = Symbol.for(
  "trinilotbot.command-telemetry.execute-wrapped",
);
const EMIT_PATCHED = Symbol.for(
  "trinilotbot.command-telemetry.emit-patched",
);

export function redactSensitiveText(value, maxLength = 2_400) {
  let text = String(value ?? "");

  text = text
    .replace(/\bBot\s+[A-Za-z0-9._~-]+/gi, "Bot [REDACTED]")
    .replace(
      /\b(authorization|token|api[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /([?&](?:token|key|api_key|authorization)=)[^&\s]+/gi,
      "$1[REDACTED]",
    );

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
  }

  return text;
}

export function classifyCommandError(error) {
  const status = Number(
    error?.status ?? error?.statusCode ?? error?.response?.status,
  );
  const message = [error?.name, error?.message, error?.cause?.message]
    .filter(Boolean)
    .join(" ");

  if (status === 429 || /\b429\b|rate.?limit|too many requests/i.test(message)) {
    return {
      kind: "rate-limit",
      recoverable: true,
      action: "backoff-and-retry-upstream",
    };
  }

  if (
    status === 408 ||
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|AbortError/i.test(
      message,
    )
  ) {
    return {
      kind: "transient-network",
      recoverable: true,
      action: "retry-after-backoff",
    };
  }

  if (Number.isFinite(status) && status >= 500 && status <= 599) {
    return {
      kind: "upstream-5xx",
      recoverable: true,
      action: "retry-after-backoff",
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "auth-or-permission",
      recoverable: false,
      action: "check-credentials-or-permissions",
    };
  }

  if (/association|bloxlink|rover|verified link/i.test(message)) {
    return {
      kind: "association-provider",
      recoverable: false,
      action: "inspect-association-provider",
    };
  }

  return {
    kind: "unknown",
    recoverable: false,
    action: "inspect-error-context",
  };
}

export function installCommandTelemetry({
  commandModules,
  Client,
  Events,
  logger = console,
  logPath =
    process.env.COMMAND_TELEMETRY_PATH?.trim() ||
    "/data/command-events.jsonl",
  blockedAfterMs = 5_000,
} = {}) {
  if (!Array.isArray(commandModules)) {
    throw new TypeError("commandModules must be an array");
  }

  const pendingInteractions = new Map();
  const sink = createEventSink({ logger, logPath });
  let wrappedCount = 0;

  for (const command of commandModules) {
    if (typeof command?.execute !== "function") continue;
    if (command.execute[EXECUTE_WRAPPED]) continue;

    const originalExecute = command.execute.bind(command);
    const commandName = command.definition?.name ?? "unknown";

    const wrappedExecute = async (interaction) => {
      const interactionId = String(interaction?.id ?? "unknown");
      clearPendingInteraction(pendingInteractions, interactionId);
      const startedAt = Date.now();

      sink({
        phase: "started",
        command: commandName,
        interactionId,
        guildId: interaction?.guildId ?? null,
        channelId: interaction?.channelId ?? null,
        userId: interaction?.user?.id ?? null,
      });

      try {
        const result = await originalExecute(interaction);
        sink({
          phase: "succeeded",
          command: commandName,
          interactionId,
          durationMs: Date.now() - startedAt,
          deferred: Boolean(interaction?.deferred),
          replied: Boolean(interaction?.replied),
        });
        return result;
      } catch (error) {
        const diagnosis = classifyCommandError(error);
        sink({
          phase: "failed",
          command: commandName,
          interactionId,
          durationMs: Date.now() - startedAt,
          diagnosis: diagnosis.kind,
          recoverable: diagnosis.recoverable,
          action: diagnosis.action,
          errorName: redactSensitiveText(error?.name ?? "Error", 120),
          errorMessage: redactSensitiveText(error?.message ?? error, 1_000),
          stack: redactSensitiveText(error?.stack ?? "", 2_400),
        });
        throw error;
      }
    };

    Object.defineProperty(wrappedExecute, EXECUTE_WRAPPED, {
      value: true,
      enumerable: false,
    });

    command.execute = wrappedExecute;
    wrappedCount += 1;
  }

  if (
    Client?.prototype &&
    typeof Client.prototype.emit === "function" &&
    Events?.InteractionCreate &&
    !Client.prototype[EMIT_PATCHED]
  ) {
    const originalEmit = Client.prototype.emit;

    Client.prototype.emit = function patchedEmit(eventName, ...args) {
      if (eventName === Events.InteractionCreate) {
        const interaction = args[0];
        if (interaction?.isChatInputCommand?.()) {
          const interactionId = String(interaction?.id ?? "unknown");
          sink({
            phase: "received",
            command: interaction?.commandName ?? "unknown",
            interactionId,
            guildId: interaction?.guildId ?? null,
            channelId: interaction?.channelId ?? null,
            userId: interaction?.user?.id ?? null,
          });

          if (interactionId !== "unknown") {
            clearPendingInteraction(pendingInteractions, interactionId);
            const timer = setTimeout(() => {
              pendingInteractions.delete(interactionId);
              sink({
                phase: "not-dispatched",
                command: interaction?.commandName ?? "unknown",
                interactionId,
                note:
                  "The interaction was received but command.execute did not begin. Check guild lock, command rate limit, or heavy-command concurrency.",
              });
            }, blockedAfterMs);
            timer.unref?.();
            pendingInteractions.set(interactionId, timer);
          }
        }
      }

      return originalEmit.call(this, eventName, ...args);
    };

    Object.defineProperty(Client.prototype, EMIT_PATCHED, {
      value: true,
      enumerable: false,
    });
  }

  logger.info?.(
    `[command-monitor] active · wrapped=${wrappedCount} · persistentLog=${logPath || "disabled"}`,
  );

  return { wrappedCount };
}

function clearPendingInteraction(pendingInteractions, interactionId) {
  const timer = pendingInteractions.get(interactionId);
  if (timer) clearTimeout(timer);
  pendingInteractions.delete(interactionId);
}

function createEventSink({ logger, logPath }) {
  let storageReadyPromise = null;

  return (event) => {
    const payload = {
      ts: new Date().toISOString(),
      ...event,
    };
    const line = JSON.stringify(payload);

    if (event.phase === "failed" || event.phase === "not-dispatched") {
      logger.error?.(`[command-monitor] ${line}`);
    } else {
      logger.info?.(`[command-monitor] ${line}`);
    }

    if (!logPath) return;

    storageReadyPromise ??= mkdir(dirname(logPath), { recursive: true });
    void storageReadyPromise
      .then(() => appendFile(logPath, `${line}\n`, "utf8"))
      .catch((error) => {
        logger.warn?.(
          `[command-monitor] persistent log write failed: ${redactSensitiveText(error?.message ?? error, 400)}`,
        );
      });
  };
}
