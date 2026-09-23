/**
 * A small YAML reader for Thru ABI documents.
 *
 * The explorer serves each program's ABI as YAML text. Rather than add a
 * runtime dependency, this handles the subset those documents use: block
 * mappings and sequences, plain / single / double quoted scalars, plain
 * scalars folded over several lines, flow sequences like [a, b], and comments.
 * Anchors, tags, block scalars (| and >) and flow mappings are not supported
 * and raise an error rather than being misread.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export class YamlError extends Error {
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = 'YamlError';
  }
}

interface Line {
  indent: number;
  text: string;
  number: number;
}

/** Remove a trailing comment, ignoring # inside quotes. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    if (raw.includes('\t') && /^\s*\t/.test(raw)) throw new YamlError('Tabs are not allowed for indentation', index + 1);
    const text = stripComment(raw).replace(/\s+$/, '');
    if (text.trim() === '' || text.trim() === '---') return;
    const indent = text.length - text.trimStart().length;
    lines.push({ indent, text: text.trimStart(), number: index + 1 });
  });
  return lines;
}

const KEY_PATTERN = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'[\]{},#&*!|>%@`-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+|$)/;

function splitKey(text: string): { key: string; rest: string } | undefined {
  const match = KEY_PATTERN.exec(text);
  if (!match || match[1] === undefined) return undefined;
  return { key: String(parseScalar(match[1])), rest: text.slice(match[0].length) };
}

function splitFlow(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

function parseScalar(text: string, lineNumber?: number): YamlValue {
  const value = text.trim();
  if (value === '') return null;
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new YamlError('Unterminated string', lineNumber);
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new YamlError('Unterminated string', lineNumber);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new YamlError('Unterminated flow sequence', lineNumber);
    return splitFlow(value.slice(1, -1)).map((item) => parseScalar(item, lineNumber));
  }
  if (/^[{&*!|>%@`]/.test(value)) throw new YamlError(`Unsupported YAML syntax: ${value}`, lineNumber);
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

class Parser {
  private index = 0;

  constructor(private readonly lines: Line[]) {}

  parseDocument(): YamlValue {
    if (this.lines.length === 0) return null;
    const first = this.lines[0]!;
    const value = this.parseBlock(first.indent);
    if (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      throw new YamlError('Unexpected indentation', line.number);
    }
    return value;
  }

  private peek(): Line | undefined {
    return this.lines[this.index];
  }

  private parseBlock(indent: number): YamlValue {
    const line = this.peek();
    if (!line) return null;
    if (line.text === '-' || line.text.startsWith('- ')) return this.parseSequence(indent);
    if (splitKey(line.text)) return this.parseMapping(indent);
    this.index++;
    return this.foldScalar(line.text, indent, line.number);
  }

  /** A plain scalar may continue on following, more indented lines. */
  private foldScalar(first: string, parentIndent: number, lineNumber: number): YamlValue {
    const trimmed = first.trim();
    const block = /^([|>])([-+]?)$/.exec(trimmed);
    if (block) return this.blockScalar(block[1] === '>', block[2] ?? '', parentIndent);
    if (trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith('[')) {
      return parseScalar(trimmed, lineNumber);
    }
    const parts = [trimmed];
    while (true) {
      const next = this.peek();
      if (!next || next.indent <= parentIndent) break;
      parts.push(next.text.trim());
      this.index++;
    }
    return parts.length === 1 ? parseScalar(trimmed, lineNumber) : parts.join(' ');
  }

  /**
   * Literal (|) and folded (>) block scalars. Comments and blank lines were
   * dropped while tokenizing, so this suits the short prose comments found in
   * ABIs, not text whose blank lines matter.
   */
  private blockScalar(folded: boolean, chomp: string, parentIndent: number): string {
    const parts: string[] = [];
    let blockIndent: number | undefined;
    while (true) {
      const next = this.peek();
      if (!next || next.indent <= parentIndent) break;
      blockIndent ??= next.indent;
      parts.push(' '.repeat(Math.max(0, next.indent - blockIndent)) + next.text);
      this.index++;
    }
    const body = folded ? parts.join(' ') : parts.join('\n');
    if (chomp === '-') return body;
    return body + '\n';
  }

  private parseMapping(indent: number): YamlValue {
    const result: { [key: string]: YamlValue } = {};
    while (true) {
      const line = this.peek();
      if (!line || line.indent < indent) break;
      if (line.indent > indent) throw new YamlError('Unexpected indentation', line.number);
      if (line.text === '-' || line.text.startsWith('- ')) break;
      const split = splitKey(line.text);
      if (!split) throw new YamlError(`Expected "key: value", got "${line.text}"`, line.number);
      this.index++;
      if (Object.prototype.hasOwnProperty.call(result, split.key)) {
        throw new YamlError(`Duplicate key "${split.key}"`, line.number);
      }
      if (split.rest.trim() !== '') {
        result[split.key] = this.foldScalar(split.rest, indent, line.number);
        continue;
      }
      const next = this.peek();
      if (next && next.indent > indent) {
        result[split.key] = this.parseBlock(next.indent);
      } else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) {
        // A sequence may sit at the same indentation as its key.
        result[split.key] = this.parseSequence(indent);
      } else {
        result[split.key] = null;
      }
    }
    return result;
  }

  private parseSequence(indent: number): YamlValue {
    const result: YamlValue[] = [];
    while (true) {
      const line = this.peek();
      if (!line || line.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) break;
      const rest = line.text === '-' ? '' : line.text.slice(2);
      const restTrimmed = rest.trimStart();
      if (restTrimmed === '') {
        this.index++;
        const next = this.peek();
        result.push(next && next.indent > indent ? this.parseBlock(next.indent) : null);
        continue;
      }
      // Re-read "- key: value" as a mapping starting at the column after the dash.
      const column = indent + 2 + (rest.length - restTrimmed.length);
      this.lines[this.index] = { indent: column, text: restTrimmed, number: line.number };
      if (restTrimmed === '-' || restTrimmed.startsWith('- ') || splitKey(restTrimmed)) {
        result.push(this.parseBlock(column));
      } else {
        this.index++;
        result.push(this.foldScalar(restTrimmed, column - 1, line.number));
      }
    }
    return result;
  }
}

/** Parse the YAML subset used by Thru ABI documents. */
export function parseYaml(source: string): YamlValue {
  return new Parser(tokenize(source)).parseDocument();
}
