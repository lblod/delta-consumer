#!/bin/env node

import { callDeltaEndpoint } from "./helpers.mjs";

await callDeltaEndpoint("/delta-sync-jobs", { method: "POST" });