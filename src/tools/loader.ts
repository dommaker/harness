import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ToolDefinition, ToolCategory } from './types';

// Maps the type strings found in tool YAMLs to JSON Schema types
const TYPE_MAP: Record<string, string> = {
  string: 'string',
  path: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
};

interface RawToolYaml {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  stage?: string;
  input?: Record<string, {
    type?: string;
    required?: boolean;
    description?: string;
    default?: unknown;
    items?: unknown;
    enum?: unknown[];
  }>;
  inputs?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
    default?: unknown;
  }> | Record<string, {
    type?: string;
    required?: boolean;
    description?: string;
    default?: unknown;
  }>;
  output?: unknown;
  outputs?: unknown;
  script?: string;
  prompt?: string;
  agent?: string;
  tools?: unknown;
  execute?: unknown;
  handler?: string;
  temperature?: number;
  timeout?: number;
}

function buildJsonSchema(params: Record<string, { type?: string; required?: boolean; description?: string; default?: unknown; items?: unknown; enum?: unknown[] }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(params)) {
    const prop: Record<string, unknown> = {};
    const schemaType = TYPE_MAP[def.type ?? 'string'] ?? 'string';
    prop.type = schemaType;
    if (def.description) prop.description = def.description;
    if (def.default !== undefined) prop.default = def.default;
    if (def.items) prop.items = def.items;
    if (def.enum) prop.enum = def.enum;
    properties[key] = prop;
    if (def.required) required.push(key);
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

function normalizeInputs(raw: RawToolYaml): Record<string, { type?: string; required?: boolean; description?: string; default?: unknown; items?: unknown; enum?: unknown[] }> {
  // Pattern A: `input` is a map (core/ext tools)
  if (raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)) {
    return raw.input;
  }

  // Pattern B: `inputs` is a list (some std tools)
  if (Array.isArray(raw.inputs)) {
    const result: Record<string, { type?: string; required?: boolean; description?: string; default?: unknown }> = {};
    for (const item of raw.inputs) {
      if (item.name) {
        result[item.name] = {
          type: item.type,
          required: item.required,
          description: item.description,
          default: item.default,
        };
      }
    }
    return result;
  }

  // Pattern C: `inputs` is a map (some std tools)
  if (raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs)) {
    return raw.inputs as Record<string, { type?: string; required?: boolean; description?: string; default?: unknown }>;
  }

  return {};
}

function deriveToolId(filePath: string, definitionsDir: string): string {
  // Convert file path to ID: definitions/std/quick/implement.yml → std/quick/implement
  const relative = path.relative(definitionsDir, filePath);
  const withoutExt = relative.replace(/\.yml$/, '').replace(/\.yaml$/, '');
  return withoutExt;
}

function detectCategory(filePath: string, definitionsDir: string): ToolCategory {
  const relative = path.relative(definitionsDir, filePath);
  const topDir = relative.split(path.sep)[0];
  if (topDir === 'core') return 'core';
  if (topDir === 'ext') return 'ext';
  return 'std';
}

/**
 * Parse a single YAML file into a ToolDefinition.
 */
export function parseToolYaml(yamlContent: string, filePath: string, definitionsDir: string): ToolDefinition {
  const raw = yaml.load(yamlContent) as RawToolYaml;

  const id = raw.id || deriveToolId(filePath, definitionsDir);
  const name = raw.name || id;
  const description = raw.description || '';
  const category = detectCategory(filePath, definitionsDir);
  const params = normalizeInputs(raw);
  const parameters = buildJsonSchema(params);

  const def: ToolDefinition = {
    id,
    name,
    description,
    category,
    parameters,
  };

  return def;
}

/**
 * Scan a directory recursively for .yml/.yaml files and return all file paths.
 */
function findYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Load all tool definitions from the definitions directory (core/, std/, ext/).
 */
export function loadToolsFromDir(definitionsDir: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const category of ['core', 'std', 'ext'] as ToolCategory[]) {
    const categoryDir = path.join(definitionsDir, category);
    const yamlFiles = findYamlFiles(categoryDir);

    for (const filePath of yamlFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const tool = parseToolYaml(content, filePath, definitionsDir);
        tools.push(tool);
      } catch (err) {
        // Skip files that fail to parse
        console.warn(`[harness] Failed to load tool YAML: ${filePath}`, err);
      }
    }
  }

  return tools;
}

/**
 * Load the registry.json and fix absolute paths to relative (from definitions dir).
 * Filters out workflow entries, keeping only tool entries.
 */
export function loadRegistry(registryPath: string): Array<{
  name: string;
  category: string;
  type: string;
  description: string;
  path: string;
}> {
  const content = fs.readFileSync(registryPath, 'utf-8');
  const registry = JSON.parse(content);
  const definitionsDir = path.dirname(registryPath);

  if (!Array.isArray(registry.tools)) return [];

  return registry.tools
    .filter((entry: { type?: string }) => entry.type === 'tool')
    .map((entry: { name: string; category: string; type: string; description: string; path: string }) => ({
      ...entry,
      // Fix absolute paths to relative (from definitions dir); keep already-relative paths as-is
      path: path.isAbsolute(entry.path) ? path.relative(definitionsDir, entry.path) : entry.path,
    }));
}
