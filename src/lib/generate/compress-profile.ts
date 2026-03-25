/**
 * compress-profile.ts - Compress a full voice profile into ~1.2K tokens.
 *
 * Ported from CLI (src/generate/compress-profile.ts) with simplifications:
 * - No VoiceMetadata/BaselineRhythm (extension doesn't have this data)
 * - extractAntiPatterns inlined (no output-checks.ts dependency)
 * - compressProfileExamples dropped (not used for quick actions)
 *
 * Pure markdown parsing, no LLM calls.
 */

// ---------------------------------------------------------------------------
// Anti-pattern extraction (inlined from output-checks.ts)
// ---------------------------------------------------------------------------

const QUOTED_TERM_RE = /[""\u201c](.+?)[""\u201d]/g;
const PAREN_EXAMPLES_RE = /\(e\.g\.,?\s*(.+?)\)/gi;

interface AntiPatternEntry {
  terms: string[];
  category: string;
}

function extractAntiPatterns(md: string): AntiPatternEntry[] {
  const entries: AntiPatternEntry[] = [];
  const lines = md.split("\n");
  let inTable = false;
  let avoidedColIdx = -1;
  let categoryColIdx = -1;

  for (const line of lines) {
    const stripped = line.trim();

    if (/^###\s+Anti-Patterns/i.test(stripped)) continue;

    // Table header detection
    if (stripped.includes("|") && !inTable) {
      const cells = stripped.split("|").map((c) => c.trim());
      for (let i = 0; i < cells.length; i++) {
        const lower = cells[i].toLowerCase();
        if (lower === "avoided") avoidedColIdx = i;
        if (lower === "category") categoryColIdx = i;
      }
      if (avoidedColIdx >= 0) {
        inTable = true;
        continue;
      }
    }

    // Skip separator row
    if (inTable && /^\|[\s\-|]+\|$/.test(stripped)) continue;

    // Data rows
    if (inTable && stripped.startsWith("|")) {
      const cells = stripped.split("|").map((c) => c.trim());
      if (avoidedColIdx >= cells.length) continue;

      const avoidedCell = cells[avoidedColIdx];
      const category =
        categoryColIdx >= 0 && categoryColIdx < cells.length
          ? cells[categoryColIdx]
          : "";

      const terms: string[] = [];

      QUOTED_TERM_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = QUOTED_TERM_RE.exec(avoidedCell)) !== null) {
        const raw = m[1].trim();
        for (const part of raw.split(/\s*\/\s*/)) {
          const cleaned = part
            .replace(/^[""\u201c]+|[""\u201d]+$/g, "")
            .replace(/[,;.]+$/g, "")
            .trim();
          if (cleaned) terms.push(cleaned);
        }
      }

      PAREN_EXAMPLES_RE.lastIndex = 0;
      while ((m = PAREN_EXAMPLES_RE.exec(avoidedCell)) !== null) {
        const examples = m[1].split(",").map((s) => s.trim());
        for (const ex of examples) {
          if (ex && !terms.some((t) => t.toLowerCase() === ex.toLowerCase())) {
            terms.push(ex);
          }
        }
      }

      if (terms.length > 0) entries.push({ terms, category });
      continue;
    }

    // End table on non-table line
    if (inTable && !stripped.startsWith("|") && stripped !== "") {
      if (stripped.startsWith("#")) {
        inTable = false;
        avoidedColIdx = -1;
        categoryColIdx = -1;
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

function extractH2Section(md: string, sectionName: RegExp): string | null {
  const re = new RegExp(`^##\\s+${sectionName.source}[^\\n]*`, "im");
  const match = re.exec(md);
  if (!match) return null;

  const rest = md.slice(match.index + match[0].length);
  const nextH2 = /^##\s+(?!#)/m.exec(rest);
  return nextH2 ? rest.slice(0, nextH2.index).trim() : rest.trim();
}

function parseH3Entries(
  sectionBody: string
): { name: string; confidence: string; body: string }[] {
  const entries: { name: string; confidence: string; body: string }[] = [];
  const h3Re = /^###\s+(.+)/gm;
  const h3List: { raw: string; index: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = h3Re.exec(sectionBody)) !== null) {
    h3List.push({ raw: m[1], index: m.index });
  }

  for (let i = 0; i < h3List.length; i++) {
    const start = h3List[i].index + h3List[i].raw.length + 4;
    const end = i + 1 < h3List.length ? h3List[i + 1].index : sectionBody.length;
    const body = sectionBody.slice(start, end).trim();

    const confMatch = h3List[i].raw.match(/\[confidence:\s*(strong|moderate|tentative)\]/i);
    const confidence = confMatch ? confMatch[1].toLowerCase() : "unknown";
    const name = h3List[i].raw.replace(/\s*\[confidence:.*?\]\s*$/, "").trim();

    entries.push({ name, confidence, body });
  }

  return entries;
}

function parseTable(section: string): { headers: string[]; rows: string[][] } {
  const lines = section.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string) =>
    line.split("|").map((c) => c.trim()).filter(Boolean);

  const headers = parseLine(lines[0]);
  const rows = lines.slice(2).map(parseLine);
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Section compressors
// ---------------------------------------------------------------------------

function compressVoiceIdentity(coreIdentity: string): string {
  const section = extractH2Section(coreIdentity, /Emotional\s+Register/);
  if (!section) return "";

  const entries = parseH3Entries(section);
  const names = entries
    .filter((e) => e.confidence !== "tentative")
    .map((e) => {
      const colonIdx = e.name.indexOf(":");
      return colonIdx > 0 ? e.name.slice(0, colonIdx).trim() : e.name;
    });

  return `## Voice Identity\n${names.join(", ")}`;
}

function compressWordRules(coreIdentity: string): string {
  const lines: string[] = ["## Word Rules"];

  const prefSection = extractH2Section(coreIdentity, /Word-Level\s+Preferences/);
  if (prefSection) {
    const antiStart = prefSection.search(/^###\s+Anti-Patterns/im);
    const prefOnly = antiStart > 0 ? prefSection.slice(0, antiStart) : prefSection;
    const { rows } = parseTable(prefOnly);
    const prefLines: string[] = [];
    for (const row of rows) {
      if (row.length >= 2) {
        const preferred = row[0].replace(/[""\u201c\u201d]/g, "").trim();
        const over = row[1].replace(/[""\u201c\u201d]/g, "").trim();
        if (preferred && over) prefLines.push(`${preferred} > ${over}`);
      }
    }
    if (prefLines.length > 0) {
      lines.push("**Prefer:**");
      lines.push(...prefLines);
    }
  }

  const antiPatterns = extractAntiPatterns(coreIdentity);
  if (antiPatterns.length > 0) {
    const allTerms = antiPatterns.flatMap((ap) => ap.terms);
    lines.push(`**Never use:** ${allTerms.join(", ")}`);
  }

  return lines.join("\n");
}

function compressMicroConstructions(coreIdentity: string): string {
  const section = extractH2Section(coreIdentity, /Micro-Constructions\s+and\s+Cadence/);
  if (!section) return "";

  const entries = parseH3Entries(section);
  const lines: string[] = ["## Sentence Constructions"];

  const baselineIdx = entries.findIndex((e) => /baseline\s+sentence/i.test(e.name));
  if (baselineIdx > 0) {
    const [baseline] = entries.splice(baselineIdx, 1);
    entries.unshift(baseline);
  }

  for (const entry of entries) {
    if (entry.confidence === "tentative") continue;

    const bodyLines = entry.body.split("\n").filter((l) => l.trim());
    const description = bodyLines[0]?.trim() || "";

    let example = "";
    for (const line of bodyLines) {
      const exMatch = line.match(/\*\*Examples?:\*\*\s*(.+)/);
      if (exMatch) { example = exMatch[1].trim(); break; }
      const bulletMatch = line.match(/^[-*]\s+[""\u201c](.+?)[""\u201d]/);
      if (bulletMatch) { example = bulletMatch[1].trim(); break; }
    }

    if (example.length > 100) example = example.slice(0, 97) + "...";

    let line = `- **${entry.name}:** ${description}`;
    if (example) line += ` e.g. "${example}"`;
    lines.push(line);
  }

  return lines.join("\n");
}

function compressEmotionalRegister(coreIdentity: string): string {
  const section = extractH2Section(coreIdentity, /Emotional\s+Register/);
  if (!section) return "";

  const entries = parseH3Entries(section);
  const lines: string[] = ["## Emotional Register"];

  for (const entry of entries) {
    const colonIdx = entry.name.indexOf(":");
    const registerName = colonIdx > 0 ? entry.name.slice(0, colonIdx).trim() : entry.name;

    const bodyLines = entry.body.split("\n").filter((l) => l.trim());
    let firstSentence = "";
    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("**") && !trimmed.startsWith("-")) {
        const periodIdx = trimmed.indexOf(". ");
        firstSentence = periodIdx > 0 ? trimmed.slice(0, periodIdx + 1) : trimmed;
        break;
      }
    }

    lines.push(`- **${registerName}:** ${firstSentence}`);
  }

  return lines.join("\n");
}

function compressFormatSurface(contextLayer: string | undefined): string {
  if (!contextLayer) return "";

  const section = extractH2Section(contextLayer, /Surface\s+Patterns/);
  if (!section) return "";

  const entries = parseH3Entries(section);
  const lines: string[] = ["## Format Rules"];

  for (const entry of entries) {
    const bodyLines = entry.body.split("\n").filter((l) => l.trim());
    let summary = "";
    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("|") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("-") &&
        !/^-{2,}$/.test(trimmed) &&
        trimmed.length > 10
      ) {
        const periodIdx = trimmed.indexOf(". ");
        summary = periodIdx > 0 ? trimmed.slice(0, periodIdx + 1) : trimmed;
        break;
      }
    }
    if (summary) lines.push(`- **${entry.name}:** ${summary}`);
  }

  const sigSection = extractH2Section(contextLayer, /Signature\s+Phrases/);
  if (sigSection) {
    const { rows } = parseTable(sigSection);
    if (rows.length > 0) {
      lines.push("**Key phrases:**");
      for (const row of rows) {
        if (row.length >= 3) {
          const phrase = row[0].replace(/[""\u201c\u201d]/g, "").trim();
          const position = row[2]?.trim() || "";
          if (phrase) lines.push(`- "${phrase}" (${position})`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compressProfile(input: { coreIdentity: string; contextLayer?: string }): string {
  const { coreIdentity, contextLayer } = input;

  const sections = [
    compressVoiceIdentity(coreIdentity),
    compressWordRules(coreIdentity),
    compressMicroConstructions(coreIdentity),
    compressEmotionalRegister(coreIdentity),
    compressFormatSurface(contextLayer),
  ].filter(Boolean);

  return sections.join("\n\n");
}
