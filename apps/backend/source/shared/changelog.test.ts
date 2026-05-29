import { parseChangelog } from './changelog.js';

describe('parseChangelog', () => {
  it('parses a single tagged section with one group and multiple bullets', () => {
    const raw = `# Changelog\n\n## [26.05] - 2026-05-30\n### Added\n- foo\n- bar\n`;
    const sections = parseChangelog(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0].version).toBe('26.05');
    expect(sections[0].date).toBe('2026-05-30');
    expect(sections[0].groups).toHaveLength(1);
    expect(sections[0].groups[0].name).toBe('Added');
    expect(sections[0].groups[0].items).toEqual(['foo', 'bar']);
  });

  it('parses multiple sections in order', () => {
    const raw = `## [26.06] - 2026-06-01\n### Added\n- new feature\n\n## [26.05] - 2026-05-29\n### Fixed\n- old bug\n`;
    const sections = parseChangelog(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0].version).toBe('26.06');
    expect(sections[1].version).toBe('26.05');
  });

  it('parses multiple groups within one section', () => {
    const raw = `## [26.05] - 2026-05-29\n### Added\n- a\n### Fixed\n- b\n### Changed\n- c\n`;
    const sections = parseChangelog(raw);
    expect(sections[0].groups.map(g => g.name)).toEqual(['Added', 'Fixed', 'Changed']);
    expect(sections[0].groups[0].items).toEqual(['a']);
    expect(sections[0].groups[1].items).toEqual(['b']);
    expect(sections[0].groups[2].items).toEqual(['c']);
  });

  it('handles Unreleased section with no date', () => {
    const raw = `## [Unreleased]\n### Added\n- pending feature\n`;
    const sections = parseChangelog(raw);
    expect(sections[0].version).toBe('Unreleased');
    expect(sections[0].date).toBeUndefined();
  });

  it('filters out sections whose groups are all empty', () => {
    const raw = `## [Unreleased]\n### Added\n\n### Fixed\n\n## [26.05] - 2026-05-29\n### Added\n- real entry\n`;
    const sections = parseChangelog(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0].version).toBe('26.05');
  });

  it('supports both * and - as bullet markers', () => {
    const raw = `## [26.05] - 2026-05-29\n### Added\n- dash bullet\n* star bullet\n`;
    const sections = parseChangelog(raw);
    expect(sections[0].groups[0].items).toEqual(['dash bullet', 'star bullet']);
  });

  it('preserves bullet text verbatim (markdown not unwrapped)', () => {
    const raw = `## [26.05] - 2026-05-29\n### Added\n- **R7.4** Wallet-side metrics endpoint with \`prom-client\`-free emitter.\n`;
    const sections = parseChangelog(raw);
    expect(sections[0].groups[0].items[0]).toBe('**R7.4** Wallet-side metrics endpoint with `prom-client`-free emitter.');
  });

  it('ignores preamble before the first ## section', () => {
    const raw = `# Changelog\n\nThis project follows Keep-a-Changelog.\nVersioning is calver.\n\n## [26.05]\n### Added\n- foo\n`;
    const sections = parseChangelog(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0].version).toBe('26.05');
  });

  it('returns empty array when input has no ## sections', () => {
    const raw = `# Changelog\n\nNo sections yet.\n`;
    const sections = parseChangelog(raw);
    expect(sections).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const raw = `## [26.05] - 2026-05-29\r\n### Added\r\n- foo\r\n`;
    const sections = parseChangelog(raw);
    expect(sections[0].groups[0].items).toEqual(['foo']);
  });
});
