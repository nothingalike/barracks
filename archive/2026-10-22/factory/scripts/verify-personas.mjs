import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { LocalSkillSource } from '@mastra/core/workspace';
import { FactorySkillSource } from '../node_modules/@mastra/factory/dist/workspace.js';

const skills = resolve('src/mastra/public/factory-skills');
const mount = resolve(parse(process.cwd()).root, '__mastracode_factory_skills__');
const source = new FactorySkillSource(new LocalSkillSource({ basePath: skills }), [], skills, async () => true);
const names = readdirSync(skills);
const discovered = new Set((await source.readdir(mount)).map(entry => entry.name));
for (const name of names) {
  const path = join(skills, name, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  assert.match(text, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
  assert.match(text, /\ndescription: .+/);
  assert.ok(discovered.has(name), `Factory did not discover ${name}`);
  assert.equal(String(await source.readFile(join(mount, name, 'SKILL.md'))), text,
    `Factory did not select the local instructions for ${name}`);
}
for (const name of ['barracks-team','barracks-lead','barracks-ba','barracks-builder','factory-triage','factory-plan','factory-review','factory-rereview','factory-self-review','factory-complete-issue']) {
  assert.ok(names.includes(name), `Missing persona or lifecycle mapping: ${name}`);
}
console.log(`PASS: ${names.length} persona/lifecycle skills discovered and selected by Factory's actual skill source.`);
console.log('This verifies instruction loading; authenticated worker behavior and slot enforcement remain untested.');
