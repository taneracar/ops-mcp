import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { LEVELS, type Level, rank } from "./policy.js";
import { maxLevelOf, SERVER_NAME, TOOL_POLICY, type ToolName } from "./server.js";

// Certification check for skills before they are published to a registry: metadata, naming,
// tool scoping, and a data-classification label that is at least as high as the most sensitive
// data the skill's tools can return. Runs in CI (`npm run validate-skills`).

export type SkillReport = { skill: string; errors: string[]; tools: ToolName[]; classification?: Level };

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
// Claude Code names MCP tools mcp__<server>__<tool> when the server is configured directly, and
// mcp__plugin_<plugin>_<server>__<tool> when it comes from a plugin. Skills here ship in the plugin.
export const PLUGIN_NAME = "ops-mcp";
const TOOL_PREFIXES = [`mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}__`, `mcp__${SERVER_NAME}__`];

export function splitFrontmatter(text: string): { front: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  return m ? { front: m[1]!, body: m[2]! } : null;
}

export function validateSkillText(folder: string, text: string): SkillReport {
  const errors: string[] = [];
  const report: SkillReport = { skill: folder, errors, tools: [] };
  const parts = splitFrontmatter(text);
  if (!parts) {
    errors.push("SKILL.md must start with a --- frontmatter block");
    return report;
  }
  let meta: Record<string, unknown>;
  try {
    meta = (parseYaml(parts.front) ?? {}) as Record<string, unknown>;
  } catch (e) {
    errors.push(`frontmatter is not valid YAML: ${(e as Error).message}`);
    return report;
  }

  const name = meta.name;
  if (typeof name !== "string" || !NAME_RE.test(name) || name.length > 64) errors.push("name must be kebab-case, at most 64 characters");
  else {
    if (name !== folder) errors.push(`name "${name}" must match its folder "${folder}"`);
    if (/anthropic|claude/.test(name)) errors.push("name must not contain reserved words (anthropic, claude)");
  }

  const description = meta.description;
  if (typeof description !== "string" || description.trim().length === 0) errors.push("description is required");
  else {
    if (description.length > 1024) errors.push("description must be at most 1024 characters");
    if (!/\bUse when\b/i.test(description)) errors.push('description must say when to use the skill ("Use when ...")');
  }

  const rawTools = meta["allowed-tools"];
  const toolList = typeof rawTools === "string" ? rawTools.split(/[\s,]+/).filter(Boolean) : Array.isArray(rawTools) ? rawTools.map(String) : null;
  if (!toolList || toolList.length === 0) errors.push("allowed-tools must list the MCP tools the skill may call");
  else {
    for (const t of toolList) {
      const prefix = TOOL_PREFIXES.find((p) => t.startsWith(p));
      if (!prefix) {
        errors.push(`allowed-tools: ${t} is not a ${SERVER_NAME} MCP tool (expected ${TOOL_PREFIXES[0]}<tool>)`);
        continue;
      }
      const short = t.slice(prefix.length);
      if (!(short in TOOL_POLICY)) errors.push(`allowed-tools: ${short} does not exist on the server`);
      else report.tools.push(short as ToolName);
    }
  }

  const md = meta.metadata as Record<string, unknown> | undefined;
  if (!md || typeof md !== "object") errors.push("metadata block is required (owner, data-classification, version)");
  else {
    if (typeof md.owner !== "string" || !md.owner.trim()) errors.push("metadata.owner is required");
    if (typeof md.version !== "string" || !SEMVER_RE.test(md.version)) errors.push('metadata.version must be a quoted semver string like "1.0.0"');
    const cls = md["data-classification"];
    if (typeof cls !== "string" || !(LEVELS as readonly string[]).includes(cls))
      errors.push(`metadata.data-classification must be one of ${LEVELS.join(", ")}`);
    else {
      report.classification = cls as Level;
      const needed = maxLevelOf(report.tools);
      if (rank(cls as Level) < rank(needed))
        errors.push(`data-classification "${cls}" is lower than what its tools can return ("${needed}")`);
    }
  }

  const body = parts.body.trim();
  if (body.length === 0) errors.push("body is empty");
  if (body.split("\n").length > 500) errors.push("body is over 500 lines; move detail into referenced files");
  // A skill must not tell the model to call a tool it is not allowed to use.
  for (const tool of Object.keys(TOOL_POLICY)) {
    if (new RegExp(`\\b${tool}\\b`).test(body) && !report.tools.includes(tool as ToolName))
      errors.push(`body mentions ${tool} but allowed-tools does not include it`);
  }
  return report;
}

export function validateSkillsDir(dir: string): SkillReport[] {
  return readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort()
    .map((folder) => {
      const file = join(dir, folder, "SKILL.md");
      if (!existsSync(file)) return { skill: basename(folder), errors: ["missing SKILL.md"], tools: [] };
      return validateSkillText(folder, readFileSync(file, "utf8"));
    });
}
