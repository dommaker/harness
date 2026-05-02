import * as path from 'path';

/**
 * Returns the absolute path to the bundled tool definitions directory.
 */
export function getToolsDir(): string {
  return path.join(__dirname, 'definitions');
}

/**
 * Returns the absolute path to the tool registry.json.
 */
export function getRegistryPath(): string {
  return path.join(__dirname, 'definitions', 'registry.json');
}
