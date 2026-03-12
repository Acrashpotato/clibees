#!/usr/bin/env node

import process from "node:process";
import { createApp } from "../app/create-app.js";

async function main(): Promise<void> {
  const app = createApp();
  const result = await app.entrypoint.handle(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
