#!/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { input } from "@inquirer/prompts";
import { callDeltaEndpoint, YARGS_BASE_URL_COMMAND } from "./helpers.mjs";

const argv = await yargs(hideBin(process.argv))
  .command(YARGS_BASE_URL_COMMAND)
  .example('$0 --base_url http://delta-consumer')
  .alias('h', 'help')
  .strict()
  .parseAsync();
  
const endpoint = new URL("/delta-sync-jobs", argv.base_url);
await callDeltaEndpoint(endpoint, { method: "POST" });
