import { spawn } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (separatorIndex === -1) {
  fail("Usage: node scripts/run-with-env.mjs KEY=value [KEY=value ...] -- command [args ...]");
}

const env = { ...process.env };

for (const assignment of args.slice(0, separatorIndex)) {
  const equalsIndex = assignment.indexOf("=");

  if (equalsIndex <= 0) {
    fail(`Invalid environment assignment: ${assignment}`);
  }

  env[assignment.slice(0, equalsIndex)] = assignment.slice(equalsIndex + 1);
}

const [command, ...commandArgs] = args.slice(separatorIndex + 1);

if (!command) {
  fail("Missing command after --.");
}

function resolveCommand(value) {
  if (process.platform !== "win32") {
    return value;
  }

  if (value === "node") {
    return process.execPath;
  }

  if (/\.(?:cmd|exe)$/i.test(value)) {
    return value;
  }

  return `${value}.cmd`;
}

const resolvedCommand = resolveCommand(command);
let spawnCommand = resolvedCommand;
let spawnArgs = commandArgs;

function quoteWindowsArgument(value) {
  if (value.length > 0 && !/[\s"&()^|<>]/.test(value)) {
    return value;
  }

  let quoted = "\"";
  let backslashCount = 0;

  for (const character of value) {
    if (character === "\\") {
      backslashCount += 1;
      continue;
    }

    if (character === "\"") {
      quoted += "\\".repeat(backslashCount * 2 + 1);
      quoted += character;
      backslashCount = 0;
      continue;
    }

    quoted += "\\".repeat(backslashCount);
    quoted += character;
    backslashCount = 0;
  }

  quoted += "\\".repeat(backslashCount * 2);
  quoted += "\"";

  return quoted;
}

if (process.platform === "win32" && /\.cmd$/i.test(resolvedCommand)) {
  spawnCommand = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe";
  spawnArgs = [
    "/d",
    "/s",
    "/c",
    [resolvedCommand, ...commandArgs].map(quoteWindowsArgument).join(" "),
  ];
}

const child = spawn(spawnCommand, spawnArgs, {
  env,
  shell: false,
  stdio: "inherit",
});

child.on("error", (error) => {
  fail(`Failed to run ${command}: ${error.message}`);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`${command} exited from signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
