import { input } from "@inquirer/prompts";

export async function callDeltaEndpoint(endpoint, init) {
  try {
    const response = await fetch(endpoint, init);
    const result = await response.json();
    if (!response.ok) {
      console.error(
        `Calling ${init.method ?? ""} ${endpoint} failed - HTTP status ${response.status} - ${result.msg}`,
      );
      process.exit(1);
    }
    
    console.log(
      `Calling POST ${endpoint} successful - HTTP status ${response.status} - ${result.msg}`,
    );
    process.exit(0);
  } catch (e) {
    console.error(`Calling POST ${endpoint} failed - ${e.message}`);
    process.exit(1);
  }
}

export const YARGS_BASE_URL_COMMAND = {
  command: "$0",
  builder: (yargs) => {
    return yargs.option("base_url", {
      alias: "b",
      type: "string",
      description: "Base URL of the delta-consumer service",
    });
  },
  handler: async (argv) => {
    if (!argv.base_url) {
      argv.base_url = await input({
        message: "Enter delta-consumer service base URL",
        default: "http://delta-consumer/",
      });
    }
  },
};


