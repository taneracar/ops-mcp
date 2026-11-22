import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateSkillsDir, validateSkillText } from "../src/skills.js";

const skill = (front: string, body = "# Title\n\nCall `list_orgs`.\n") => `---\n${front.trim()}\n---\n\n${body}`;

const GOOD = `
name: org-list
description: Lists orgs. Use when someone asks which orgs exist.
allowed-tools: mcp__ops__list_orgs
metadata:
  owner: spg
  data-classification: internal
  version: "1.0.0"
`;

const errorsOf = (folder: string, text: string) => validateSkillText(folder, text).errors;

describe("skill validator", () => {
  it("passes the skills shipped in this repo", () => {
    const reports = validateSkillsDir("skills");
    expect(reports.map((r) => r.skill)).toEqual(["headcount-snapshot", "vendor-cost-review"]);
    for (const r of reports) expect(r.errors, r.skill).toEqual([]);
  });

  it("passes a minimal good skill, with either tool naming", () => {
    expect(errorsOf("org-list", skill(GOOD))).toEqual([]);
    expect(errorsOf("org-list", skill(GOOD.replace("mcp__ops__", "mcp__plugin_ops-mcp_ops__")))).toEqual([]);
  });

  it("the shipped skills use the plugin tool names Claude Code assigns", () => {
    for (const f of ["vendor-cost-review", "headcount-snapshot"]) {
      const text = readFileSync(`skills/${f}/SKILL.md`, "utf8");
      expect(text).toMatch(/allowed-tools: (mcp__plugin_ops-mcp_ops__\w+ ?)+\n/);
    }
  });

  it.each([
    ["no frontmatter", "org-list", "# just markdown", /frontmatter/],
    ["name differs from folder", "other-folder", skill(GOOD), /must match its folder/],
    ["name not kebab-case", "Org_List", skill(GOOD.replace("name: org-list", "name: Org_List")), /kebab-case/],
    ["reserved word", "claude-helper", skill(GOOD.replace("name: org-list", "name: claude-helper")), /reserved/],
    ["no 'Use when'", "org-list", skill(GOOD.replace(" Use when someone asks which orgs exist.", "")), /Use when/],
    ["tool from another server", "org-list", skill(GOOD.replace("mcp__ops__list_orgs", "mcp__slack__post")), /not a ops MCP tool/],
    ["tool from another plugin", "org-list", skill(GOOD.replace("mcp__ops__list_orgs", "mcp__plugin_other_ops__list_orgs")), /not a ops MCP tool/],
    ["tool that does not exist", "org-list", skill(GOOD.replace("list_orgs", "drop_tables")), /does not exist/],
    ["classification lower than its tools", "org-list", skill(GOOD.replace("mcp__ops__list_orgs", "mcp__ops__vendor_cost_split"), "# T\n\nCall vendor_cost_split.\n"), /lower than what its tools can return \("confidential"\)/],
    ["unknown classification", "org-list", skill(GOOD.replace("internal", "secret")), /data-classification must be one of/],
    ["unquoted or bad version", "org-list", skill(GOOD.replace('"1.0.0"', "v1")), /semver/],
    ["no owner", "org-list", skill(GOOD.replace("owner: spg", "owner: ''")), /owner/],
    ["body uses a tool it may not call", "org-list", skill(GOOD, "# T\n\nThen call org_change_brief.\n"), /mentions org_change_brief/],
    ["empty body", "org-list", skill(GOOD, ""), /body is empty/],
    ["broken YAML", "org-list", "---\nname: [unclosed\n---\nbody", /not valid YAML/],
  ])("rejects: %s", (_label, folder, text, pattern) => {
    const errors = errorsOf(folder, text);
    expect(errors.join("\n")).toMatch(pattern);
  });
});
