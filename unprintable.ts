import type {
  Context,
  Item,
  OnCallback,
  PumHighlight,
} from "https://deno.land/x/ddc_vim@v5.0.0/types.ts";
import type { Denops } from "https://deno.land/x/denops_std@v6.5.0/mod.ts";
import {
  append,
  getline,
  mode,
  type Position,
  printf,
  setcmdline,
  setline,
  setpos,
  strlen,
} from "https://deno.land/x/denops_std@v6.5.0/function/mod.ts";
import { batch } from "https://deno.land/x/denops_std@v6.5.0/batch/mod.ts";
import { vim } from "https://deno.land/x/denops_std@v6.5.0/variable/mod.ts";
import { defer } from "https://deno.land/x/denops_defer@v1.0.0/batch/defer.ts";

// deno-fmt-ignore
const UNPRINTABLE_CHARS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
] as const;
const UNPRINTABLE_CHAR_LENGTH = 2; // "^@".length
const UNPRINTABLE_BYTE_LENGTH = 2; // strlen("^@")

type UnprintableData = {
  origWord: string;
  origNextInput: string;
};

export type UnprintableUserData = {
  unprintable?: never;
};

export type UnprintableOptions = {
  /** Highlight name for unprintable chars.
   *
   * Default is "ddc_unprintable".
   */
  highlightName?: string;
  /** Highlight group for unprintable chars.
   *
   * Default is "SpecialKey".
   */
  highlightGroup?: string;
  /** Placeholder text for unprintable char.
   *
   * Must be a single character.
   * Default is "?".
   */
  placeholder?: string;
  /** Max width of the abbreviates column.
   *
   * If 0 is specified, be unlimited.
   * Default is 0.
   */
  abbrWidth?: number;
  /** Callback Id base string.
   *
   * If empty, use random id.
   */
  callbackId?: string;
};

export class Unprintable<
  UserData extends UnprintableUserData = UnprintableUserData,
> implements Required<Omit<UnprintableOptions, "callbackId">> {
  // deno-lint-ignore no-control-regex
  #reUnprintableChar = /[\x00-\x1f]/g;
  #highlightName: string;
  #highlightGroup: string;
  #placeholder = "?";
  #abbrWidth = 0;
  #callbackId: string;
  #completeDoneCount = 0;

  constructor(opts: UnprintableOptions = {}) {
    this.#highlightName = opts.highlightName ?? "ddc_unprintable";
    this.#highlightGroup = opts.highlightGroup ?? "SpecialKey";
    if (opts.placeholder !== undefined) this.placeholder = opts.placeholder;
    if (opts.abbrWidth !== undefined) this.abbrWidth = opts.abbrWidth;
    this.#callbackId = opts.callbackId ?? `unprintable/${makeId()}`;
  }

  get highlightName(): string {
    return this.#highlightName;
  }
  set highlightName(value: string) {
    this.#highlightName = value;
  }

  get highlightGroup(): string {
    return this.#highlightGroup;
  }
  set highlightGroup(value: string) {
    this.#highlightGroup = value;
  }

  get placeholder(): string {
    return this.#placeholder;
  }
  set placeholder(value: string) {
    if (value.length !== 1) {
      throw new TypeError("placeholder must be a single character.");
    }
    this.#placeholder = value;
  }

  get abbrWidth(): number {
    return this.#abbrWidth;
  }
  set abbrWidth(value: number) {
    if (value < 0 || value !== (value | 0)) {
      throw new TypeError(
        "abbrWidth must be an interger greater than or equal to 0.",
      );
    }
    this.#abbrWidth = value | 0;
  }

  /** Should convert items by this in `BaseSource.gather()`.
   *
   * If `Item.word` contains unprintable characters, it will be converted to
   * `UnprintableOptions.placeholder`.
   * `Item.abbr` and `Item.highlights` are generated and added.
   */
  async convertItems(
    denops: Denops,
    items: Item<UserData>[],
    nextInput: string,
  ): Promise<Item<UserData>[]> {
    const abbrWidth = Math.max(0, this.#abbrWidth);
    const abbrFormat = `%.${abbrWidth}S`;

    const itemSlices = await defer(denops, (helper) =>
      items.map((item) => {
        const origWord = item.word;
        const word = this.#makeWord(origWord);
        const longAbbr = this.#makeAbbr(origWord);
        const abbr = abbrWidth
          ? printf(helper, abbrFormat, longAbbr) as Promise<string>
          : longAbbr;
        const slices = (abbrWidth ? origWord.slice(0, abbrWidth) : origWord)
          .split(this.#reUnprintableChar).slice(0, -1)
          .map((slice) => ({
            chars: slice.length,
            bytes: strlen(helper, slice) as Promise<number>,
          }));
        return { origWord, word, abbr, slices };
      }));

    return items.map((item, index) => {
      const { origWord, word, abbr, slices } = itemSlices[index];
      return {
        ...item,
        word,
        abbr,
        highlights: [
          ...(item.highlights ?? []),
          ...this.#generateHighlights(abbr, slices),
        ],
        user_data: {
          ...item.user_data,
          unprintable: {
            origWord,
            origNextInput: nextInput,
          } as UnprintableData,
        } as unknown as UserData,
      };
    });
  }

  /** Should call this in `BaseSource.onInit()`. */
  async onInit(args: { denops: Denops }): Promise<void> {
    const chars = [
      ...UNPRINTABLE_CHARS,
      ...(await this.#getUnprintableChars(args.denops)),
    ];
    this.#reUnprintableChar = this.#makeUnprintableRegExp(chars);
  }

  /** Should call this in `BaseSource.onCompleteDone()`. */
  async onCompleteDone(
    args: {
      denops: Denops;
      onCallback: OnCallback;
      userData: UserData;
      context: Context;
    },
  ): Promise<void> {
    this.#completeDoneCount++;
    const { denops, onCallback, userData } = args;
    const { origWord, origNextInput } = userData
      .unprintable as unknown as UnprintableData;
    let { input, nextInput, lineNr } = args.context;

    // If no unprintable contains, do nothing.
    if (!this.#reUnprintableChar.test(origWord)) return;

    const [vimMode, vchar] = await defer(denops, (helper) => ([
      mode(helper),
      vim.get(helper, "char") as Promise<string>,
    ] as const));
    const tail = this.#makeWord(origWord) + origNextInput;
    const head = nextInput ? tail.slice(0, -nextInput.length) : tail;

    let replaceLastLine = false;
    if (tail.length > input.length + nextInput.length) {
      --lineNr;
      input = await getline(denops, lineNr) + input;
      replaceLastLine = true;
    }

    let userInput: string;
    let prefix: string;
    if (tail.length > nextInput.length) {
      userInput = head && input.endsWith(head) ? "" : input.at(-1) ?? "";
      prefix = input.slice(0, -head.length - userInput.length);
    } else {
      userInput = "";
      prefix = (input + nextInput).slice(0, -tail.length);
    }
    userInput += vchar;

    const line = prefix + origWord + origNextInput;
    const [lineHead, lineTail] = nextInput
      ? [line.slice(0, -nextInput.length), line.slice(-nextInput.length)]
      : [line, ""];

    if (vimMode === "c") {
      // Replace cmdline
      const cmdHead = textToCmdline(lineHead + userInput);
      const cmdLine = cmdHead + textToCmdline(lineTail);
      const pos = await strlen(denops, cmdHead) as number + 1;
      await setcmdline(denops, cmdLine, pos);
    } else {
      // Replace buffer
      const lines = textToRegContents(lineHead + userInput + lineTail);
      const linesHead = textToRegContents(lineHead + userInput);
      const cursorLN = lineNr + linesHead.length - 1;
      const cursorCol = await strlen(denops, linesHead.at(-1)) as number + 1;
      const pos: Position = [0, cursorLN, cursorCol, 0];

      const [firstLine, middleLines, lastLine] = replaceLastLine
        ? [lines[0], lines.slice(1, -1), lines.at(-1)]
        : [lines[0], lines.slice(1), undefined];

      const setBuffer = (): Promise<void> =>
        batch(denops, async (helper) => {
          await setline(helper, lineNr, firstLine);
          if (middleLines.length > 0) {
            await append(helper, lineNr, middleLines);
          }
          if (lastLine !== undefined) {
            await setline(helper, lineNr + middleLines.length + 1, lastLine);
          }
          await setpos(helper, ".", pos);
        });

      try {
        await setBuffer();
      } catch (e: unknown) {
        if (!/:E565:/.test(`${e}`)) {
          throw e;
        }
        // Fallback: While completion is active buffer text cannot be changed.
        const id = `${this.#callbackId}/complete/${this.#completeDoneCount}`;
        onCallback(id).then(setBuffer);
        await denops.cmd(
          `call feedkeys("\\<Cmd>call ddc#callback('${id}')\\<CR>", 'in')`,
        );
      }
    }
  }

  #getUnprintableChars(denops: Denops): Promise<number[]> {
    return denops.eval(
      "range(0x100)->filter({ _, n -> nr2char(n) !~# '\\p' })",
    ) as Promise<number[]>;
  }

  #makeUnprintableRegExp(unprintableChars: number[]): RegExp {
    // generate RegExp e.g.: /[\x00-\x1f\x7f-\x9f]/g
    const unprintableSet = new Set(unprintableChars);
    const lastGuard = 0x100;
    unprintableSet.delete(lastGuard);
    const xhh = (n: number) => "\\x" + `0${n.toString(16)}`.slice(-2);
    const range: string[] = [];
    for (let start = -1, code = 0; code <= lastGuard; ++code) {
      if (start < 0 && unprintableSet.has(code)) {
        start = code;
      } else if (start >= 0 && !unprintableSet.has(code)) {
        const end = code - 1;
        range.push(start === end ? xhh(start) : xhh(start) + "-" + xhh(end));
        start = -1;
      }
    }
    return new RegExp(`[${range.join("")}]`, "g");
  }

  #makeWord(word: string): string {
    return word.replaceAll(this.#reUnprintableChar, this.#placeholder);
  }

  #makeAbbr(word: string): string {
    return word.replaceAll(this.#reUnprintableChar, unpritableCharToDisplay);
  }

  #generateHighlights(
    abbr: string,
    abbrSlices: { chars: number; bytes: number }[],
  ): PumHighlight[] {
    const highlights: PumHighlight[] = [];
    let lastHighlight: PumHighlight | undefined;
    let len = 0; // [chars]
    let col = 1; // [bytes]

    for (const { chars, bytes } of abbrSlices) {
      if (bytes === 0 && lastHighlight) {
        // increase width
        lastHighlight.width += UNPRINTABLE_BYTE_LENGTH;
      } else {
        len += chars;
        col += bytes;
        if (len >= abbr.length) {
          break;
        }

        // add new highlight
        lastHighlight = {
          name: this.#highlightName,
          type: "abbr",
          hl_group: this.#highlightGroup,
          col,
          width: UNPRINTABLE_BYTE_LENGTH,
        };
        highlights.push(lastHighlight);
      }

      len += UNPRINTABLE_CHAR_LENGTH;
      col += UNPRINTABLE_BYTE_LENGTH;
      if (len >= abbr.length) {
        lastHighlight.width -= len - abbr.length;
        break;
      }
    }

    return highlights;
  }
}

function makeId(): string {
  return ("0000000" + Math.floor(Math.random() * 0xffffffff).toString(16))
    .slice(-8);
}

function textToRegContents(text: string): string[] {
  return text.split("\n").map((s) => s.replaceAll("\0", "\n"));
}

function textToCmdline(text: string): string {
  return text.replaceAll("\n", "\r").replaceAll("\x00", "\n");
}

function unpritableCharToDisplay(c: string): string {
  const code = c.charCodeAt(0);
  if (code <= 0x1f) return "^" + String.fromCharCode(code + 0x40);
  if (code === 0x7f) return "^?";
  if (code <= 0x9f) return "~" + String.fromCharCode(code - 0x40);
  if (code <= 0xfe) return "|" + String.fromCharCode(code - 0x80);
  return "~?";
}
