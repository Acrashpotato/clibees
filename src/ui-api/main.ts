#!/usr/bin/env node

import process from "node:process";
import { createUiApiServer } from "./server.js";

async function main(): Promise<void> {
  const server = createUiApiServer();
  await server.listen();
  process.stdout.write("AgentsBees UI API listening on http://127.0.0.1:4318\n");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
