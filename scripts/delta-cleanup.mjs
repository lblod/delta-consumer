#!/bin/env node

import { callDeltaEndpoint } from "./helpers.mjs";

await callDeltaEndpoint("/delta-cleanup-jobs", { method: "POST" });