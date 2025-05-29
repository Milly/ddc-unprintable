import type { Denops } from "@denops/std";

export function getUnprintableChars(denops: Denops): Promise<number[]> {
  return denops.eval(
    "range(0x100)->filter({ _, n -> nr2char(n) !~# '\\p' })",
  ) as Promise<number[]>;
}

/**
 * Generate RegExp e.g.: /[\x00-\x1f\x7f-\x9f]/g
 */
export function makeCharCodeRangeRegExp(charCodes: readonly number[]): RegExp {
  const charCodeSet = new Set(charCodes);
  const lastGuard = 0x100;
  charCodeSet.delete(lastGuard);
  const xhh = (n: number) => "\\x" + `0${n.toString(16)}`.slice(-2);
  const range: string[] = [];
  for (let start = -1, code = 0; code <= lastGuard; ++code) {
    if (start < 0 && charCodeSet.has(code)) {
      start = code;
    } else if (start >= 0 && !charCodeSet.has(code)) {
      const end = code - 1;
      range.push(start === end ? xhh(start) : xhh(start) + "-" + xhh(end));
      start = -1;
    }
  }
  return new RegExp(`[${range.join("")}]`, "g");
}

export function makeId(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

export function textToRegContents(text: string): string[] {
  return text.split("\n").map((s) => s.replaceAll("\0", "\n"));
}

export function textToCmdline(text: string): string {
  return text.replaceAll("\n", "\r").replaceAll("\x00", "\n");
}

export function unprintableCharToDisplay(c: string): string {
  // See: :help 'isprint'
  const code = c.charCodeAt(0);
  if (code <= 0x1f) return "^" + String.fromCharCode(code + 0x40);
  if (code === 0x7f) return "^?";
  if (code <= 0x9f) return "~" + String.fromCharCode(code - 0x40);
  if (code <= 0xfe) return "|" + String.fromCharCode(code - 0x80);
  return "~?";
}

const encoder = new TextEncoder();
export function byteLength(str: string): number {
  return encoder.encode(str).length;
}
