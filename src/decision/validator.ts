import { access } from "node:fs/promises";
import { spawn, type SpawnOptions } from "node:child_process";
import { resolvePath } from "../shared/runtime.js";
import type {
  ArtifactRecord,
  InvocationPlan,
  TaskSpec,
  ValidationResult,
  ValidatorSpec,
} from "../domain/models.js";

export interface ValidationInput {
  task: TaskSpec;
  invocation: InvocationPlan;
  artifacts: ArtifactRecord[];
}

export interface Validator {
  validate(input: ValidationInput): Promise<ValidationResult>;
}

export interface DefaultValidatorDependencies {
  defaultTimeoutMs?: number;
  spawnProcess?: typeof spawn;
}

interface CommandExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export class DefaultValidator implements Validator {
  private readonly defaultTimeoutMs: number;
  private readonly spawnProcess: typeof spawn;

  constructor(dependencies: DefaultValidatorDependencies = {}) {
    this.defaultTimeoutMs = dependencies.defaultTimeoutMs ?? 60_000;
    this.spawnProcess = dependencies.spawnProcess ?? spawn;
  }

  async validate(input: ValidationInput): Promise<ValidationResult> {
    return this.validateSpec(input.task.validator, input);
  }

  private async validateSpec(
    spec: ValidatorSpec,
    input: ValidationInput,
  ): Promise<ValidationResult> {
    switch (spec.mode) {
      case "none":
        return {
          outcome: "pass",
          summary: "Validation skipped.",
          details: [],
          createdArtifacts: [],
        };
      case "files":
        return this.validateFiles(spec, input);
      case "command":
        return this.validateCommands(spec, input);
      case "schema":
        return this.validateSchema(spec, input);
      case "composite":
        return this.validateComposite(spec, input);
      default:
        return {
          outcome: "blocked",
          summary: `Validator mode "${String((spec as { mode?: unknown }).mode)}" is not supported.`,
          details: [],
          createdArtifacts: [],
        };
    }
  }

  private async validateFiles(
    spec: ValidatorSpec,
    input: ValidationInput,
  ): Promise<ValidationResult> {
    const requiredFiles = spec.requiredFiles ?? [];
    if (requiredFiles.length === 0) {
      return {
        outcome: "blocked",
        summary: "Files validator is missing requiredFiles.",
        details: [],
        createdArtifacts: [],
      };
    }

    const missingFiles: string[] = [];
    for (const filePath of requiredFiles) {
      const resolvedPath = resolvePath(filePath, input.task.workingDirectory);
      try {
        await access(resolvedPath);
      } catch {
        missingFiles.push(filePath);
      }
    }

    if (missingFiles.length > 0) {
      return {
        outcome: "fail_retryable",
        summary: `Missing required files: ${missingFiles.join(", ")}.`,
        details: missingFiles.map((filePath) => `Required file was not produced: ${filePath}`),
        createdArtifacts: [],
      };
    }

    return {
      outcome: "pass",
      summary: `Validated ${requiredFiles.length} required file(s).`,
      details: requiredFiles.map((filePath) => `Found ${filePath}`),
      createdArtifacts: [],
    };
  }

  private async validateCommands(
    spec: ValidatorSpec,
    input: ValidationInput,
  ): Promise<ValidationResult> {
    const commands = spec.commands ?? [];
    if (commands.length === 0) {
      return {
        outcome: "blocked",
        summary: "Command validator is missing commands.",
        details: [],
        createdArtifacts: [],
      };
    }

    const details: string[] = [];
    for (const command of commands) {
      const parsedCommand = parseCommand(command);
      const result = await this.runCommand(parsedCommand.command, parsedCommand.args, {
        cwd: input.task.workingDirectory,
        shell: false,
      });
      const exitCode = result.exitCode ?? -1;
      details.push(`"${command}" exited with ${exitCode}.`);
      if (result.stdout.trim()) {
        details.push(`stdout: ${truncate(result.stdout.trim(), 240)}`);
      }
      if (result.stderr.trim()) {
        details.push(`stderr: ${truncate(result.stderr.trim(), 240)}`);
      }

      if (result.timedOut) {
        return {
          outcome: "fail_retryable",
          summary: `Validation command timed out: ${command}.`,
          details,
          createdArtifacts: [],
        };
      }

      if (result.exitCode !== 0) {
        return {
          outcome: "fail_retryable",
          summary: `Validation command failed: ${command}.`,
          details,
          createdArtifacts: [],
        };
      }
    }

    return {
      outcome: "pass",
      summary: `Validated ${commands.length} command check(s).`,
      details,
      createdArtifacts: [],
    };
  }

  private async validateSchema(
    spec: ValidatorSpec,
    input: ValidationInput,
  ): Promise<ValidationResult> {
    if (!spec.outputSchemaId) {
      return {
        outcome: "blocked",
        summary: "Schema validator is missing outputSchemaId.",
        details: [],
        createdArtifacts: [],
      };
    }

    const artifact = input.artifacts.find((candidate) => candidate.kind === "structured_output");
    if (!artifact) {
      return {
        outcome: "fail_replan_needed",
        summary: `Structured output artifact is missing for schema "${spec.outputSchemaId}".`,
        details: ["No structured_output artifact was recorded for this task."],
        createdArtifacts: [],
      };
    }

    const output = extractStructuredOutput(artifact);
    const valid = validateStructuredOutput(spec.outputSchemaId, output);
    if (!valid.ok) {
      return {
        outcome: "fail_replan_needed",
        summary: valid.summary,
        details: [`Artifact: ${artifact.id}`, `Schema: ${spec.outputSchemaId}`, ...valid.details],
        createdArtifacts: [],
      };
    }

    return {
      outcome: "pass",
      summary: `Structured output matches schema "${spec.outputSchemaId}".`,
      details: [`Artifact: ${artifact.id}`],
      createdArtifacts: [],
    };
  }

  private async validateComposite(
    spec: ValidatorSpec,
    input: ValidationInput,
  ): Promise<ValidationResult> {
    const children = spec.children ?? [];
    if (children.length === 0) {
      return {
        outcome: "blocked",
        summary: "Composite validator is missing child validators.",
        details: [],
        createdArtifacts: [],
      };
    }

    const childResults: ValidationResult[] = [];
    for (const child of children) {
      childResults.push(await this.validateSpec(child, input));
    }

    const outcome = aggregateValidationOutcome(childResults);
    const summary =
      outcome === "pass"
        ? `Composite validation passed (${childResults.length} checks).`
        : `Composite validation returned ${outcome}.`;

    return {
      outcome,
      summary,
      details: childResults.flatMap((result) => [result.summary, ...result.details]),
      createdArtifacts: childResults.flatMap((result) => result.createdArtifacts),
    };
  }

  private runCommand(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): Promise<CommandExecutionResult> {
    return new Promise<CommandExecutionResult>((resolve) => {
      const child = this.spawnProcess(command, args, options);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeoutHandle =
        this.defaultTimeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill();
            }, this.defaultTimeoutMs)
          : undefined;

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.once("error", (error: Error) => {
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: -1,
          stdout,
          stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
          signal: null,
          timedOut,
        });
      });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timeoutHandle);
        resolve({
          exitCode,
          stdout,
          stderr,
          signal,
          timedOut,
        });
      });
    });
  }
}

function aggregateValidationOutcome(
  results: ValidationResult[],
): ValidationResult["outcome"] {
  if (results.some((result) => result.outcome === "blocked")) {
    return "blocked";
  }
  if (results.some((result) => result.outcome === "fail_replan_needed")) {
    return "fail_replan_needed";
  }
  if (results.some((result) => result.outcome === "fail_retryable")) {
    return "fail_retryable";
  }
  return "pass";
}

function extractStructuredOutput(artifact: ArtifactRecord): unknown {
  const metadata = artifact.metadata as Record<string, unknown>;
  if ("output" in metadata) {
    return metadata.output;
  }
  if ("structuredOutput" in metadata) {
    return metadata.structuredOutput;
  }
  return undefined;
}

function validateStructuredOutput(
  schemaId: string,
  output: unknown,
): { ok: true } | { ok: false; summary: string; details: string[] } {
  switch (schemaId) {
    case "json_object":
      if (isPlainObject(output)) {
        return { ok: true };
      }
      return {
        ok: false,
        summary: `Structured output does not match schema "${schemaId}".`,
        details: ["Expected a JSON object."],
      };
    case "json_array":
      if (Array.isArray(output)) {
        return { ok: true };
      }
      return {
        ok: false,
        summary: `Structured output does not match schema "${schemaId}".`,
        details: ["Expected a JSON array."],
      };
    case "string":
      if (typeof output === "string") {
        return { ok: true };
      }
      return {
        ok: false,
        summary: `Structured output does not match schema "${schemaId}".`,
        details: ["Expected a string."],
      };
    case "number":
      if (typeof output === "number" && Number.isFinite(output)) {
        return { ok: true };
      }
      return {
        ok: false,
        summary: `Structured output does not match schema "${schemaId}".`,
        details: ["Expected a finite number."],
      };
    case "boolean":
      if (typeof output === "boolean") {
        return { ok: true };
      }
      return {
        ok: false,
        summary: `Structured output does not match schema "${schemaId}".`,
        details: ["Expected a boolean."],
      };
    default:
      return {
        ok: false,
        summary: `Structured output schema "${schemaId}" is not supported.`,
        details: ["Supported schema ids: json_object, json_array, string, number, boolean."],
      };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


function parseCommand(command: string): { command: string; args: string[] } {
  const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) ?? [];
  if (parts.length === 0) {
    return {
      command,
      args: [],
    };
  }

  return {
    command: stripQuotes(parts[0]!),
    args: parts.slice(1).map((part) => stripQuotes(part)),
  };
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}





