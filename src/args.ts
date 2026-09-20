/** Command line parsing, kept separate from the CLI entry point so it can be tested. */

export interface ParsedArgs {
  address?: string;
  out?: string;
  format: 'csv' | 'json';
  from?: string;
  to?: string;
  limit?: number;
  successOnly: boolean;
  baseUrl?: string;
  concurrency?: number;
  quiet: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { format: 'csv', successOnly: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '-h': case '--help': parsed.help = true; break;
      case '-q': case '--quiet': parsed.quiet = true; break;
      case '--success-only': parsed.successOnly = true; break;
      case '-o': case '--out': parsed.out = next(); break;
      case '--from': parsed.from = next(); break;
      case '--to': parsed.to = next(); break;
      case '--base-url': parsed.baseUrl = next(); break;
      case '--limit': parsed.limit = Number(next()); break;
      case '--concurrency': parsed.concurrency = Number(next()); break;
      case '-f': case '--format': {
        const value = next();
        if (value !== 'csv' && value !== 'json') throw new Error(`Unknown format: ${value}`);
        parsed.format = value;
        break;
      }
      default:
        if (arg === undefined) break;
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (parsed.address === undefined) parsed.address = arg;
        else throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  for (const [name, value] of [['--from', parsed.from], ['--to', parsed.to]] as const) {
    if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`${name} must be a date as YYYY-MM-DD`);
    }
  }
  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error('--limit must be a positive whole number');
  }
  return parsed;
}
