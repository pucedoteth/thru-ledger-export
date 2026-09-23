/**
 * Decode binary payloads (events) using a program's published ABI.
 *
 * Thru ABIs describe packed, little-endian layouts: primitives, structs,
 * fixed or computed-length arrays, tagged enums and size-discriminated unions,
 * with references to other types. This decoder follows those rules. Anything it
 * does not understand raises an AbiDecodeError so the caller can leave the event
 * undecoded instead of guessing.
 */
import { parseYaml, type YamlValue } from './yaml.js';
import { bytesToHex, encodeAddress } from './address.js';

type Obj = { [key: string]: YamlValue };

export class AbiDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbiDecodeError';
  }
}

/** The chosen variant of an enum or size-discriminated union. */
export class EnumValue {
  constructor(readonly variant: string, readonly value: DecodedValue) {}
  toJSON(): { variant: string; value: DecodedValue } {
    return { variant: this.variant, value: this.value };
  }
}

/**
 * Decoded values. 64-bit integers are decimal strings so nothing is rounded;
 * addresses are Thru "ta…" strings; other byte arrays are hex strings.
 */
export type DecodedValue = string | number | EnumValue | DecodedValue[] | { [key: string]: DecodedValue };

export interface ProgramAbi {
  programName?: string;
  package?: string;
  eventsRoot?: string;
  types: Map<string, Obj>;
}

const isObj = (value: YamlValue | undefined): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function asObj(value: YamlValue | undefined, what: string): Obj {
  if (!isObj(value)) throw new AbiDecodeError(`Malformed ABI: expected ${what}`);
  return value;
}

/** Parse ABI YAML text as served by /api/abi/{program}. */
export function parseAbi(source: string, programName?: string): ProgramAbi {
  const doc = asObj(parseYaml(source), 'a document');
  const header = isObj(doc.abi) ? doc.abi : {};
  const options = isObj(header.options) ? header.options : {};
  const metadata = isObj(options['program-metadata']) ? options['program-metadata'] : {};
  const roots = isObj(metadata['root-types']) ? metadata['root-types'] : {};
  const types = new Map<string, Obj>();
  for (const entry of Array.isArray(doc.types) ? doc.types : []) {
    if (isObj(entry) && typeof entry.name === 'string') types.set(entry.name, entry);
  }
  return {
    programName: programName ?? (typeof header.name === 'string' ? header.name : undefined),
    package: typeof header.package === 'string' ? header.package : undefined,
    eventsRoot: typeof roots.events === 'string' ? roots.events : undefined,
    types,
  };
}

const PRIMITIVE_SIZES: Record<string, number> = {
  u8: 1, u16: 2, u32: 4, u64: 8, i8: 1, i16: 2, i32: 4, i64: 8, f32: 4, f64: 8,
};

/** Types from the shared thru.common.primitives package, which ABIs import. */
const WELL_KNOWN_BYTES: Record<string, number> = { Pubkey: 32, Hash: 32, Signature: 64 };

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array, readonly end = bytes.length) {}

  get remaining(): number {
    return this.end - this.offset;
  }

  take(size: number): Uint8Array {
    if (size < 0 || this.offset + size > this.end) {
      throw new AbiDecodeError(`Payload too short: needed ${size} bytes at offset ${this.offset}`);
    }
    const slice = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return slice;
  }
}

type Scope = Map<string, DecodedValue>;

export class AbiDecoder {
  constructor(private readonly abi: ProgramAbi) {}

  /** Decode a full payload as `typeName`, requiring every byte to be used. */
  decode(typeName: string, bytes: Uint8Array): DecodedValue {
    const reader = new Reader(bytes);
    const value = this.decodeNamed(typeName, reader, []);
    if (reader.remaining !== 0) {
      throw new AbiDecodeError(`${reader.remaining} unexpected trailing bytes after ${typeName}`);
    }
    return value;
  }

  private decodeNamed(name: string, reader: Reader, scopes: Scope[], pkg?: string): DecodedValue {
    const local = pkg === undefined || pkg === this.abi.package ? this.abi.types.get(name) : undefined;
    if (!local) {
      const size = WELL_KNOWN_BYTES[name];
      if (size === undefined) throw new AbiDecodeError(`Unknown type ${pkg ? `${pkg}.` : ''}${name}`);
      return this.wellKnown(name, reader.take(size));
    }
    // Programs sometimes declare their own Pubkey/Hash with the same 32-byte layout.
    const knownSize = WELL_KNOWN_BYTES[name];
    if (knownSize !== undefined && this.isByteWrapper(local, knownSize)) {
      return this.wellKnown(name, reader.take(knownSize));
    }
    const value = this.decodeKind(asObj(local.kind, `a kind for ${name}`), reader, scopes);
    return local.format === 'text' ? toText(value) : value;
  }

  private wellKnown(name: string, bytes: Uint8Array): string {
    return name === 'Pubkey' ? encodeAddress(bytes) : bytesToHex(bytes);
  }

  private isByteWrapper(def: Obj, size: number): boolean {
    const struct = isObj(def.kind) && isObj(def.kind.struct) ? def.kind.struct : undefined;
    const fields = struct && Array.isArray(struct.fields) ? struct.fields : [];
    if (fields.length !== 1 || !isObj(fields[0])) return false;
    const type = fields[0]['field-type'];
    if (!isObj(type) || !isObj(type.array)) return false;
    const element = type.array['element-type'];
    const literal = isObj(type.array.size) && isObj(type.array.size.literal) ? type.array.size.literal : undefined;
    const count = literal ? Object.values(literal)[0] : undefined;
    return isObj(element) && element.primitive === 'u8' && count === size;
  }

  private decodeKind(kind: Obj, reader: Reader, scopes: Scope[]): DecodedValue {
    if (typeof kind.primitive === 'string') return this.primitive(kind.primitive, reader);
    if (isObj(kind['type-ref'])) {
      const ref = kind['type-ref'];
      if (typeof ref.name !== 'string') throw new AbiDecodeError('type-ref without a name');
      return this.decodeNamed(ref.name, reader, scopes, typeof ref.package === 'string' ? ref.package : undefined);
    }
    if (isObj(kind.struct)) return this.struct(kind.struct, reader, scopes);
    if (isObj(kind.array)) return this.array(kind.array, reader, scopes);
    if (isObj(kind.enum)) return this.enumeration(kind.enum, reader, scopes);
    if (isObj(kind['size-discriminated-union'])) return this.sizeUnion(kind['size-discriminated-union'], reader, scopes);
    throw new AbiDecodeError(`Unsupported ABI kind: ${Object.keys(kind).join(', ')}`);
  }

  private primitive(name: string, reader: Reader): DecodedValue {
    const size = PRIMITIVE_SIZES[name];
    if (size === undefined) throw new AbiDecodeError(`Unsupported primitive ${name}`);
    const bytes = reader.take(size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    switch (name) {
      case 'u8': return view.getUint8(0);
      case 'i8': return view.getInt8(0);
      case 'u16': return view.getUint16(0, true);
      case 'i16': return view.getInt16(0, true);
      case 'u32': return view.getUint32(0, true);
      case 'i32': return view.getInt32(0, true);
      case 'u64': return view.getBigUint64(0, true).toString();
      case 'i64': return view.getBigInt64(0, true).toString();
      case 'f32': return view.getFloat32(0, true);
      default: return view.getFloat64(0, true);
    }
  }

  private struct(struct: Obj, reader: Reader, scopes: Scope[]): DecodedValue {
    if (struct.packed !== true) throw new AbiDecodeError('Only packed structs are supported');
    const scope: Scope = new Map();
    const inner = [...scopes, scope];
    const result: { [key: string]: DecodedValue } = {};
    for (const field of Array.isArray(struct.fields) ? struct.fields : []) {
      if (!isObj(field) || typeof field.name !== 'string') throw new AbiDecodeError('Malformed struct field');
      const value = this.decodeKind(asObj(field['field-type'], `a type for ${field.name}`), reader, inner);
      scope.set(field.name, value);
      result[field.name] = value;
    }
    return result;
  }

  private array(array: Obj, reader: Reader, scopes: Scope[]): DecodedValue {
    const count = Number(this.evaluate(array.size, scopes));
    if (!Number.isSafeInteger(count) || count < 0) throw new AbiDecodeError(`Invalid array length ${count}`);
    const element = asObj(array['element-type'], 'an array element type');
    if (element.primitive === 'u8') return bytesToHex(reader.take(count));
    const items: DecodedValue[] = [];
    for (let i = 0; i < count; i++) items.push(this.decodeKind(element, reader, scopes));
    return items;
  }

  private enumeration(enumeration: Obj, reader: Reader, scopes: Scope[]): DecodedValue {
    const tagRef = asObj(enumeration['tag-ref'], 'an enum tag-ref');
    const tag = this.evaluate(tagRef, scopes);
    for (const variant of Array.isArray(enumeration.variants) ? enumeration.variants : []) {
      if (!isObj(variant) || variant['tag-value'] === undefined) continue;
      if (BigInt(String(variant['tag-value'])) !== tag) continue;
      const value = this.decodeKind(asObj(variant['variant-type'], 'a variant type'), reader, scopes);
      return new EnumValue(String(variant.name), value);
    }
    throw new AbiDecodeError(`No enum variant for tag ${tag}`);
  }

  private sizeUnion(union: Obj, reader: Reader, scopes: Scope[]): DecodedValue {
    for (const variant of Array.isArray(union.variants) ? union.variants : []) {
      if (!isObj(variant) || variant['expected-size'] !== reader.remaining) continue;
      const value = this.decodeKind(asObj(variant['variant-type'], 'a variant type'), reader, scopes);
      return new EnumValue(String(variant.name), value);
    }
    throw new AbiDecodeError(`No union variant is ${reader.remaining} bytes long`);
  }

  /** Evaluate a size or tag expression: literals, field references and arithmetic. */
  private evaluate(expr: YamlValue | undefined, scopes: Scope[]): bigint {
    if (!isObj(expr)) throw new AbiDecodeError('Malformed expression');
    if (isObj(expr.literal)) {
      const value = Object.values(expr.literal)[0];
      return BigInt(String(value));
    }
    if (isObj(expr['field-ref'])) return this.fieldRef(expr['field-ref'], scopes);
    const binary = (name: string, op: (a: bigint, b: bigint) => bigint): bigint | undefined => {
      const node = expr[name];
      if (!isObj(node)) return undefined;
      return op(this.evaluate(node.left, scopes), this.evaluate(node.right, scopes));
    };
    const result =
      binary('add', (a, b) => a + b) ??
      binary('sub', (a, b) => a - b) ??
      binary('mul', (a, b) => a * b) ??
      binary('div', (a, b) => {
        if (b === 0n) throw new AbiDecodeError('Division by zero in size expression');
        return a / b;
      }) ??
      binary('bit-and', (a, b) => a & b) ??
      binary('bit-or', (a, b) => a | b) ??
      binary('left-shift', (a, b) => a << b) ??
      binary('right-shift', (a, b) => a >> b);
    if (result !== undefined) return result;
    if (isObj(expr.popcount)) {
      let value = this.evaluate(expr.popcount.operand, scopes);
      let count = 0n;
      while (value > 0n) {
        count += value & 1n;
        value >>= 1n;
      }
      return count;
    }
    throw new AbiDecodeError(`Unsupported expression: ${Object.keys(expr).join(', ')}`);
  }

  private fieldRef(ref: Obj, scopes: Scope[]): bigint {
    const path = Array.isArray(ref.path) ? ref.path.map(String) : [];
    const [head, ...rest] = path;
    if (head === undefined) throw new AbiDecodeError('Empty field-ref path');
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (!scopes[i]!.has(head)) continue;
      let value: DecodedValue | undefined = scopes[i]!.get(head);
      for (const part of rest) {
        if (value instanceof EnumValue) value = value.value;
        value = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, DecodedValue>)[part] : undefined;
      }
      if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value))) return BigInt(value);
      throw new AbiDecodeError(`Field ${path.join('.')} is not a number`);
    }
    throw new AbiDecodeError(`Field ${path.join('.')} is not decoded yet`);
  }
}

/** Turn a decoded `format: text` value into a string (NUL-terminated or length-prefixed). */
function toText(value: DecodedValue): DecodedValue {
  const fromHex = (hex: string, length?: number): string => {
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    let used = length === undefined ? bytes : bytes.slice(0, length);
    const nul = used.indexOf(0);
    if (nul >= 0) used = used.slice(0, nul);
    return new TextDecoder().decode(Uint8Array.from(used));
  };
  if (typeof value === 'string' && /^[0-9a-f]*$/.test(value)) return fromHex(value);
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof EnumValue)) {
    const record = value as Record<string, DecodedValue>;
    const length = record.length ?? record.len;
    const data = Object.values(record).find((field) => typeof field === 'string' && /^[0-9a-f]+$/.test(field));
    if (typeof length === 'number' && typeof data === 'string') return fromHex(data, length);
  }
  return value;
}
