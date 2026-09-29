#!/usr/bin/env node
import {
  DEFAULT_SUSTAINED_OVERLOAD_MINUTES,
  isHostOverloaded,
  nextHostOverloadEpisode,
  readHostLoad,
} from "./host-overload.mjs";

const command = process.argv[2];

if (command === "sample") {
  const sample = readHostLoad();
  process.stdout.write(`${JSON.stringify({ sample, overloaded: isHostOverloaded([sample]) })}\n`);
} else if (command === "episode") {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const result = nextHostOverloadEpisode({
    previous: input.previous,
    now: input.now,
    overloadedFailure: input.overloadedFailure === true,
    success: input.success === true,
    thresholdMinutes: input.thresholdMinutes ?? DEFAULT_SUSTAINED_OVERLOAD_MINUTES,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  process.stderr.write("usage: host-overload-cli.mjs <sample|episode>\n");
  process.exitCode = 2;
}
