import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'docs');
const required = [
  'README.md',
  'PROJECT.md',
  'CURRENT_STATE.md',
  'CHANGELOG.md',
  'ROADMAP.md',
  'DECISIONS.md',
  'design/VISUAL_SYSTEM.md',
  'design/ICONOGRAPHY.md',
  'design/IMAGE_STYLE_GUIDE.md',
  'design/VISUAL_QA_CHECKLIST.md',
];

for (const relative of required) {
  if (!fs.existsSync(path.join(docsRoot, relative))) throw new Error(`Missing canonical document: docs/${relative}`);
}

const markdownFiles = [];
const collect = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (entry.name.endsWith('.md')) markdownFiles.push(absolute);
  }
};
collect(docsRoot);
markdownFiles.push(path.join(root, 'README.md'), path.join(root, 'supabase', 'README.md'));

const missing = [];
for (const file of markdownFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const target = decodeURI(rawTarget.split('#')[0]);
    const absolute = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(absolute)) missing.push(`${path.relative(root, file)} -> ${rawTarget}`);
  }
}

if (missing.length) throw new Error(`Broken documentation links:\n${missing.join('\n')}`);

console.log(`Documentation topology passed: ${markdownFiles.length} Markdown files and ${required.length} canonical documents.`);
