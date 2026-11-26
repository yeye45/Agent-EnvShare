#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
