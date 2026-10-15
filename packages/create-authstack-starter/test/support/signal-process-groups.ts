interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
}

function parseRow(line: string): ProcessRow | undefined {
  if (!/^\s*\d+\s+\d+\s+\d+\s*$/.test(line)) return undefined;
  const [pid = 0, ppid = -1, pgid = 0] = line.trim().split(/\s+/).map(Number);
  if (![pid, ppid, pgid].every(Number.isSafeInteger) || pid <= 1 || pgid <= 1) {
    return undefined;
  }
  return { pid, ppid, pgid };
}

export function parseProcessRows(table: string): ProcessRow[] {
  return table.split('\n').flatMap((line) => {
    const row = parseRow(line);
    return row === undefined ? [] : [row];
  });
}

function indexRows(rows: readonly ProcessRow[], key: 'ppid' | 'pgid'): Map<number, ProcessRow[]> {
  const index = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    const bucket = index.get(row[key]) ?? [];
    bucket.push(row);
    index.set(row[key], bucket);
  }
  return index;
}

export function descendantGroups(
  rows: readonly ProcessRow[],
  leaders: readonly number[],
  selfPid: number,
): Set<number> {
  const ownGroup = rows.find((row) => row.pid === selfPid)?.pgid;
  const safeGroup = (pid: number): boolean =>
    Number.isSafeInteger(pid) && pid > 1 && pid !== selfPid && pid !== ownGroup;
  const leaderGroups = new Set(leaders.filter(safeGroup));
  const children = indexRows(rows, 'ppid');
  const members = indexRows(rows, 'pgid');
  const claimed = new Set<number>();
  const visited = new Set<number>();
  const queue: number[] = [];
  const enqueue = (pid: number): void => {
    if (pid === selfPid || visited.has(pid)) return;
    visited.add(pid);
    queue.push(pid);
  };
  const claim = (group: number): void => {
    if (!safeGroup(group) || claimed.has(group)) return;
    claimed.add(group);
    for (const member of members.get(group) ?? []) enqueue(member.pid);
  };
  for (const leader of leaderGroups) {
    enqueue(leader);
    claim(leader);
  }
  for (const pid of queue) {
    if (members.has(pid)) claim(pid);
    for (const child of children.get(pid) ?? []) enqueue(child.pid);
  }
  const escaped = [...claimed].filter((group) => !leaderGroups.has(group));
  return new Set([...escaped, ...leaderGroups]);
}
