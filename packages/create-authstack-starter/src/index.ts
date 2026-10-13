#!/usr/bin/env node
import { CommanderError } from 'commander';
import { main } from './cli.js';
import { USAGE_EXIT_CODE } from './constants/index.js';

try {
  // The installer's name and version come from main's single read of the
  // package's own package.json; nothing here reads it a second time.
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode === 0 ? 0 : USAGE_EXIT_CODE;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
