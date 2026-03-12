export type ParsedCliCommand =
  | { kind: "run"; goal: string; configPath?: string }
  | { kind: "resume"; runId: string; configPath?: string }
  | { kind: "inspect"; runId: string; configPath?: string }
  | { kind: "approvals"; runId: string; configPath?: string }
  | {
      kind: "approve" | "reject";
      runId: string;
      requestId: string;
      actor: string;
      note?: string;
      configPath?: string;
    };

export function parseCommand(argv: string[]): ParsedCliCommand {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error(
      "Missing command. Expected run, resume, inspect, approvals, approve, or reject.",
    );
  }
  const { positionals, configPath, actor, note } = parseArguments(rest);

  switch (command) {
    case "run":
      if (positionals.length === 0) {
        throw new Error('Missing goal for command "run".');
      }
      ensureNoApprovalOptions(command, actor, note);
      return { kind: "run", goal: positionals.join(" "), configPath };
    case "resume":
      if (positionals.length !== 1) {
        throw new Error('Command "resume" expects exactly one runId.');
      }
      ensureNoApprovalOptions(command, actor, note);
      return { kind: "resume", runId: positionals[0], configPath };
    case "inspect":
      if (positionals.length !== 1) {
        throw new Error('Command "inspect" expects exactly one runId.');
      }
      ensureNoApprovalOptions(command, actor, note);
      return { kind: "inspect", runId: positionals[0], configPath };
    case "approvals":
      if (positionals.length !== 1) {
        throw new Error('Command "approvals" expects exactly one runId.');
      }
      ensureNoApprovalOptions(command, actor, note);
      return { kind: "approvals", runId: positionals[0], configPath };
    case "approve":
    case "reject":
      if (positionals.length !== 2) {
        throw new Error(`Command "${command}" expects exactly one runId and one requestId.`);
      }
      return {
        kind: command,
        runId: positionals[0],
        requestId: positionals[1],
        actor: actor ?? "cli-user",
        ...(note ? { note } : {}),
        configPath,
      };
    default:
      throw new Error(`Unsupported command "${command}".`);
  }
}

function parseArguments(argv: string[]): {
  positionals: string[];
  configPath?: string;
  actor?: string;
  note?: string;
} {
  const positionals: string[] = [];
  let configPath: string | undefined;
  let actor: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--config" || token === "--actor" || token === "--note") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Option "${token}" requires a value.`);
      }

      if (token === "--config") {
        if (configPath) {
          throw new Error('Option "--config" can only be provided once.');
        }
        configPath = value;
      }

      if (token === "--actor") {
        if (actor) {
          throw new Error('Option "--actor" can only be provided once.');
        }
        actor = value;
      }

      if (token === "--note") {
        if (note) {
          throw new Error('Option "--note" can only be provided once.');
        }
        note = value;
      }

      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option "${token}".`);
    }

    positionals.push(token);
  }

  return { positionals, configPath, actor, note };
}

function ensureNoApprovalOptions(
  command: string,
  actor?: string,
  note?: string,
): void {
  if (actor) {
    throw new Error(`Option "--actor" is only valid for approval commands, not "${command}".`);
  }

  if (note) {
    throw new Error(`Option "--note" is only valid for approval commands, not "${command}".`);
  }
}
