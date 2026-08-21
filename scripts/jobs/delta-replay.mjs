#!/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { input } from "@inquirer/prompts";
import { callDeltaEndpoint, YARGS_BASE_URL_COMMAND } from "./helpers.mjs";

const argv = await yargs(hideBin(process.argv))
  .command({
    ...YARGS_BASE_URL_COMMAND,
    builder: (yargs) => {
      YARGS_BASE_URL_COMMAND.builder(yargs)
        .option("since", {
          alias: "s",
          type: "string",
          description:
            `Date and time from which to start replaying the delta files. 
            Datetimes following following the ecma date-time-string-format are accepted.`,
          coerce: (val) => {
            const date = new Date(val);
            if (isNaN(date)) {
              throw new Error(
                'Option "since" should represent a valid datetime string.',
              );
            }
            return date;
          },
        });
    },
    handler: async (argv) => {
      await YARGS_BASE_URL_COMMAND.handler(argv);
      if (!argv.since) {
        const answer = await input({
          message:
            "Enter date and time from which to start replaying the delta files (date-time-string-format)",
          required: true,
          validate: (value) => {
            if (isNaN(new Date(value))) {
              return "Input should represent a valid datetime. Input should follow the ecma date-time-string-format.";
            }
            return true;
          },
        });
        argv.since = new Date(answer);
      }
    },
  })
  .example('$0 --base_url http://delta-consumer --since 2026-08-15')
  .alias('h', 'help')
  .strict()
  .parseAsync();

const endpoint = new URL("/delta-replay-jobs", argv.base_url);
await callDeltaEndpoint(endpoint, {
  method: "POST",
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    since: argv.since,
  }),
});
