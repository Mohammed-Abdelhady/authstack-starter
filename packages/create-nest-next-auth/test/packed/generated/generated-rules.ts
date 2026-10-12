import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { renderRulesText } from '../../../src/scaffold/rules-text.js';
import {
  LEGACY_PACKAGE_MANAGER_COMMANDS,
  findForbiddenContent,
} from '../../support/reference-content.js';
import { scaffold, type Packed } from '../packed-cli.js';

interface MarkdownTable {
  header: string[];
  rows: string[][];
}

interface MarkdownSection {
  tables: MarkdownTable[];
  lists: string[][];
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function parseMarkdownSections(markdown: string): Map<string, MarkdownSection> {
  const sections = new Map<string, MarkdownSection>();
  const lines = markdown.split('\n');
  let sectionName = '';
  let index = 0;

  while (index < lines.length) {
    const heading = /^## (.+)$/.exec(lines[index]);
    if (heading !== null) {
      sectionName = heading[1];
      sections.set(sectionName, { tables: [], lists: [] });
      index += 1;
      continue;
    }

    const section = sections.get(sectionName);
    if (section === undefined || lines[index] === '') {
      index += 1;
      continue;
    }

    if (lines[index].startsWith('|')) {
      const tableLines: string[] = [];
      while (lines[index]?.startsWith('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const hasHeaderAndDivider = tableLines.length >= 2 && /^\|[-| :]+\|$/.test(tableLines[1]);
      if (hasHeaderAndDivider) {
        section.tables.push({
          header: tableCells(tableLines[0]),
          rows: tableLines.slice(2).map(tableCells),
        });
      }
      continue;
    }

    if (lines[index].startsWith('- ')) {
      const items: string[] = [];
      while (lines[index]?.startsWith('- ')) {
        items.push(lines[index].slice(2));
        index += 1;
      }
      section.lists.push(items);
      continue;
    }

    index += 1;
  }

  return sections;
}

function renderedStructure(markdown: string): Record<string, number> {
  const sections = parseMarkdownSections(markdown);
  return {
    checkRows: sections.get('Checks')?.tables[0]?.rows.length ?? 0,
    commitItems: sections.get('Commit messages')?.lists[0]?.length ?? 0,
    enforcementItems: sections.get('What enforces this')?.lists[0]?.length ?? 0,
    locationItems: sections.get('Where things are')?.lists[0]?.length ?? 0,
  };
}

export async function checkGeneratedRules(packed: Packed): Promise<void> {
  const defaultProject = join(packed.workspace, 'rules-default');
  const defaultResult = scaffold(packed, 'rules-default');
  expect(defaultResult.status, `${defaultResult.stdout}\n${defaultResult.stderr}`).toBe(0);

  const agentsBytes = readFileSync(join(defaultProject, 'AGENTS.md'));
  const claudeBytes = readFileSync(join(defaultProject, 'CLAUDE.md'));
  const agents = agentsBytes.toString('utf8');
  const claude = claudeBytes.toString('utf8');
  const sections = parseMarkdownSections(agents);
  const fresh = await renderRulesText({
    projectRoot: defaultProject,
    level: 'strict',
    delivery: { hooks: true, actions: true },
  });
  expect({
    agentsHasCarriageReturn: agents.includes('\r'),
    claudeHasCarriageReturn: claude.includes('\r'),
    claude,
    legacyCommands: findForbiddenContent(defaultProject, LEGACY_PACKAGE_MANAGER_COMMANDS),
  }).toEqual({
    agentsHasCarriageReturn: false,
    claudeHasCarriageReturn: false,
    claude: 'See AGENTS.md for project rules.\n',
    legacyCommands: [],
  });
  expect({ agentsBytes, claudeBytes }).toEqual({
    agentsBytes: Buffer.from(fresh.agents, 'utf8'),
    claudeBytes: Buffer.from(fresh.claude, 'utf8'),
  });
  expect(sections.get('Checks')?.tables[0]?.header).toEqual(['Check', 'Command']);
  expect(renderedStructure(agents)).toEqual({
    checkRows: 9,
    commitItems: 3,
    enforcementItems: 3,
    locationItems: 5,
  });

  const minimalProject = join(packed.workspace, 'rules-minimal');
  const minimalResult = scaffold(packed, 'rules-minimal', undefined, {
    flags: ['--preset', 'minimal'],
  });
  expect(minimalResult.status, `${minimalResult.stdout}\n${minimalResult.stderr}`).toBe(0);
  const minimalRules = readFileSync(join(minimalProject, 'AGENTS.md'), 'utf8');
  expect(renderedStructure(minimalRules)).toEqual({
    checkRows: 9,
    commitItems: 3,
    enforcementItems: 3,
    locationItems: 5,
  });
  expect(/\b(?:docker|arabic|mobile|installer)\b/i.test(minimalRules)).toBe(false);
}
