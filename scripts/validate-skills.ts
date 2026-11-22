import { validateSkillsDir } from "../src/skills.js";

const dir = process.argv[2] ?? "skills";
const reports = validateSkillsDir(dir);
let failed = 0;
for (const r of reports) {
  if (r.errors.length === 0) {
    console.log(`ok    ${r.skill}  [${r.classification}]  tools: ${r.tools.join(", ")}`);
  } else {
    failed++;
    console.log(`FAIL  ${r.skill}`);
    for (const e of r.errors) console.log(`      - ${e}`);
  }
}
if (reports.length === 0) {
  console.log(`no skills found in ${dir}`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);
