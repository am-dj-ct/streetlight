import { readFile } from "node:fs/promises";

export async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read JSON file ${filePath}: ${detail}`);
  }
}
