#!/usr/bin/env node
import { parseArgs } from "node:util";
import packageConfig from "../../package.json" with { type: "json" };
import build from "../build/index.js";

const [bin] = Object.keys(packageConfig.bin);

const { values, positionals } = parseArgs({
  options: {
    version: {
      short: "v",
      type: "boolean",
    },
    help: {
      short: "h",
      type: "boolean",
    },
    "output-dir": {
      short: "o",
      type: "string",
    },
  },
  allowPositionals: true,
});

const help = `Usage: ${bin} [options] <command>

${packageConfig.description}

Options:
  -v, --version            output the version number
  -h, --help               display help for command

Commands:
  build                    build the Designbook project

Run "${bin} <command> --help" for command options.`;

const buildHelp = `Usage: ${bin} build [options]

Build the Designbook project

Options:
  -o, --output-dir <dir>   output directory for MDX files (default: "content/docs/components")
  -h, --help               display help for command`;

const command = positionals[0];

if (values.version) console.log(packageConfig.version);
else if (values.help)
  switch (command) {
    case "build":
      console.log(buildHelp);
      break;

    default:
      console.log(help);
  }
else if (command === "build")
  await build({ outputDir: values["output-dir"] ?? "content/docs/components" });
else if (command === undefined) {
  console.error(help);
  process.exitCode = 1;
} else {
  console.error(`Unknown command: ${command}`);
  console.error();
  console.error(help);
  process.exitCode = 1;
}
