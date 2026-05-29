/* CHANGELOG.md parser.
 *
 * The wallet's CHANGELOG follows Keep-a-Changelog:
 *
 *   # Changelog
 *   ## [Unreleased]
 *   ### Added
 *   - bullet
 *   ## [26.05] - 2026-05-29
 *   ### Added
 *   - bullet
 *
 * We extract the sections (one per `## [version]` heading) so the
 * "What's new" UI can render structured entries instead of just a
 * raw blob. Anything between `# Changelog` and the first `## [` is
 * the preamble — ignored. */

export interface ChangelogSection {
  version: string;
  date?: string;
  groups: { name: string; items: string[] }[];
}

export function parseChangelog(raw: string): ChangelogSection[] {
  const lines = raw.split(/\r?\n/);
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let currentGroup: { name: string; items: string[] } | null = null;

  for (const line of lines) {
    const sectionMatch = /^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/.exec(line);
    if (sectionMatch) {
      if (current) sections.push(current);
      current = { version: sectionMatch[1].trim(), date: sectionMatch[2]?.trim(), groups: [] };
      currentGroup = null;
      continue;
    }
    const groupMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (groupMatch && current) {
      currentGroup = { name: groupMatch[1].trim(), items: [] };
      current.groups.push(currentGroup);
      continue;
    }
    const itemMatch = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (itemMatch && currentGroup) {
      currentGroup.items.push(itemMatch[1]);
      continue;
    }
    /* Continuation of a bullet on the next line — append with a space. */
    if (currentGroup && currentGroup.items.length > 0 && /^\s{2,}\S/.test(line)) {
      const last = currentGroup.items[currentGroup.items.length - 1];
      currentGroup.items[currentGroup.items.length - 1] = last + ' ' + line.trim();
    }
  }
  if (current) sections.push(current);
  /* Drop sections whose groups are all empty (typical for a freshly
   * created [Unreleased] section with no bullets yet). */
  return sections.filter(s => s.groups.some(g => g.items.length > 0));
}
