import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const ENV_FILE = path.join(process.cwd(), '.env');

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  let content: string;
  try {
    content = fs.readFileSync(ENV_FILE, 'utf-8');
  } catch (err) {
    logger.debug({ err }, '.env file not found, using defaults');
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}

/**
 * Update one or more key-value pairs in the .env file.
 * Creates the file if it doesn't exist.
 */
export function updateEnvFile(updates: Record<string, string>): void {
  let content: string;
  try {
    content = fs.readFileSync(ENV_FILE, 'utf-8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const updatedKeys = new Set(Object.keys(updates));
  const newLines: string[] = [];
  let foundKeys = new Set<string>();

  // Update existing keys
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      newLines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    if (updatedKeys.has(key)) {
      const newValue = updates[key];
      newLines.push(`${key}=${newValue}`);
      foundKeys.add(key);
      logger.info({ key, value: newValue }, 'Updated .env file');
    } else {
      newLines.push(line);
    }
  }

  // Add new keys that weren't found
  for (const [key, value] of Object.entries(updates)) {
    if (!foundKeys.has(key)) {
      newLines.push(`${key}=${value}`);
      logger.info({ key, value }, 'Added new key to .env file');
    }
  }

  fs.writeFileSync(ENV_FILE, newLines.join('\n') + '\n', 'utf-8');
}
