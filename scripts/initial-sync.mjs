#!/bin/env node

import { callDeltaEndpoint } from "./helpers.mjs";

await callDeltaEndpoint("/initial-sync-jobs", { method: "POST" });
