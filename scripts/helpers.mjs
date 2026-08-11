import readline from "node:readline/promises";

const DEFAULT_BASE_URL = "http://delta-consumer";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function callDeltaEndpoint(endpoint, init) {
  let baseUrl = process.argv[2];
  if (!baseUrl) { 
    const answer = await rl.question(`Enter base URL [${DEFAULT_BASE_URL}]: `);
    baseUrl = answer ?? DEFAULT_BASE_URL;
  }
  try {
    const response = await fetch(new URL(endpoint, baseUrl), init);
    if(!response.ok){
      console.error(`Calling ${init.method ?? ''} ${endpoint} failed - HTTP status ${response.status}`)
      process.exit(1);
    }
    const result = await response.json();
    console.log(`Calling POST ${endpoint} successful - HTTP status ${response.status} - ${result.msg}`);
    process.exit(0);
  }
  catch (e){
    console.error(`Calling POST ${endpoint} failed - ${e.message}`);
    process.exit(1);
  }
}

