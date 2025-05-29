import type { Item, PumHighlight } from "@shougo/ddc-vim/types";
import type { Denops } from "@denops/std";
import {
  append,
  getline,
  mode,
  type Position,
  printf,
  setcmdline,
  setline,
  setpos,
} from "@denops/std/function";
import { batch } from "@denops/std/batch";
import { vim } from "@denops/std/variable";
import { accumulate } from "@milly/denops-batch-accumulate";
import {
  byteLength,
  getUnprintableChars,
  makeCharCodeRangeRegExp,
  makeId,
  textToCmdline,
  textToRegContents,
  unprintableCharToDisplay,
} from "./helper.ts";
import {
  ensureInternalUserData,
  type InternalUserData,
} from "./internal_type.ts";
import type {
  UnprintableOnCompleteDoneArguments,
  UnprintableOnInitArguments,
  UnprintableOptions,
  UnprintableParameters,
  UnprintableUserData,
} from "./type.ts";

// deno-fmt-ignore
const UNPRINTABLE_CHARS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
] as const;
const UNPRINTABLE_CHAR_LENGTH = 2; // "^@".length
const UNPRINTABLE_BYTE_LENGTH = 2; // strlen("^@")

/**
 * Provides utilities for handling and displaying unprintable characters
 * in completion items for _ddc.vim_ sources.
 *
 * The `Unprintable` class is designed to be used in custom _ddc.vim_ sources
 * to automatically detect, highlight, and safely display unprintable
 * (non-printable ASCII or Vim `'isprint'`-excluded) characters within
 * completion candidates.
 * Furthermore, when completion is done, it correctly inserts the original text
 * (including the unprintable characters) into the buffer or command line.
 *
 * @typeParam UserData - The type of `Item.user_data` used in completion items.
 *
 * @example
 * 1. Instantiate `Unprintable` class in your ddc source.
 * 2. Call `onInit()` in your `Source.onInit()` method to initialize instance.
 * 3. Call `convertItems()` in your `Source.gather()` method to process completion items.
 * 4. Call `onCompleteDone()` in your `Source.onCompleteDone()` method to restore the original text.
 *
 * ```ts
 * import { Unprintable, UnprintableUserData } from "jsr:@milly/ddc-unprintable";
 * import {
 *   BaseSource,
 *   type GatherArguments,
 *   type OnCompleteDoneArguments,
 *   type OnInitArguments,
 * } from "jsr:@shougo/ddc-vim/source";
 * import type { Item } from "jsr:@shougo/ddc-vim/types";
 *
 * interface MyParams extends Record<string, unknown> {
 *   // Add your source parameters here
 * }
 *
 * interface MyUserData extends UnprintableUserData {
 *   // Add your user data properties here
 * }
 *
 * type MyItem = Item<MyUserData>;
 *
 * export class Source extends BaseSource<MyParams, MyUserData> {
 *   // 1. Instantiate this class.
 *   #unprintable = new Unprintable<MyUserData>();
 *
 *   override params(): MyParams {
 *     return {};
 *   }
 *
 *   override async onInit(args: OnInitArguments<MyParams>): Promise<void> {
 *     // 2. Call `onInit()`.
 *     await this.#unprintable.onInit(args);
 *   }
 *
 *   override async gather(
 *     args: GatherArguments<MyParams>,
 *   ): Promise<MyItem[]> {
 *     const myItems: MyItem[] = [
 *       // Generate your items here.
 *     ];
 *
 *     // 3. Call `convertItems()`.
 *     const convertedItems = await this.#unprintable!.convertItems(
 *       args.denops,
 *       myItems,
 *       args.context.nextInput,
 *     );
 *
 *     return convertedItems;
 *   }
 *
 *   override async onCompleteDone(
 *     args: OnCompleteDoneArguments<MyParams, MyUserData>,
 *   ): Promise<void> {
 *     // 4. Call `onCompleteDone()`.
 *     await this.#unprintable.onCompleteDone(args);
 *   }
 * }
 * ```
 */
export class Unprintable<
  UserData extends UnprintableUserData = UnprintableUserData,
> implements UnprintableParameters {
  static #DEFAULT_UNPRINTABLE_CHARS_REGEX: RegExp | undefined;

  #reUnprintableChar: RegExp = new RegExp(
    Unprintable.#DEFAULT_UNPRINTABLE_CHARS_REGEX ??= makeCharCodeRangeRegExp(
      UNPRINTABLE_CHARS,
    ),
    "g",
  );
  #highlightName: string;
  #highlightGroup: string;
  #placeholder = "?";
  #abbrWidth = 0;
  #callbackId: string;
  #completeDoneCount = 0;

  /**
   * Creates an instance of the Unprintable class.
   *
   * @param opts - Optional parameters to configure the instance.
   * @returns A new instance of the Unprintable class.
   * @throws {TypeError} If the `opts` contains invalid values.
   */
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

  /**
   * Call this method in your `BaseSource.gather()` implementation to process
   * completion items.
   *
   * If an `Item.word` contains unprintable characters, those characters will
   * be replaced with `UnprintableParameters.placeholder`.  The `Item.abbr` and
   * `Item.highlights` properties will be generated and set accordingly.
   * Additionally, the `Item.user_data` property will be extended to include
   * internal data required by _ddc-unprintable_ library.
   *
   * @param denops - The Denops instance.
   * @param items - The array of completion items to process.
   * @param nextInput - The next input string after the completion.
   * @returns A Promise that resolves to the processed array of items.
   */
  async convertItems(
    denops: Denops,
    items: readonly Item<UserData>[],
    nextInput: string,
  ): Promise<Item<UserData>[]> {
    const abbrWidth = Math.max(0, this.#abbrWidth);
    const abbrFormat = `%.${abbrWidth}S`;

    return await accumulate(denops, (helper) => {
      return Promise.all(items.map(async (item) => {
        const origWord = item.word;
        const word = this.#makeWord(origWord);
        const longAbbr = this.#makeAbbr(origWord);
        const abbr = abbrWidth
          ? await printf(helper, abbrFormat, longAbbr)
          : longAbbr;
        const slices = (abbrWidth ? origWord.slice(0, abbrWidth) : origWord)
          .split(this.#reUnprintableChar).slice(0, -1)
          .map((slice) => ({
            chars: slice.length,
            bytes: byteLength(slice),
          }));
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
            },
          } satisfies InternalUserData as unknown as UserData,
        };
      }));
    });
  }

  /**
   * Call this method in your `BaseSource.onInit()` implementation to
   * initialize this instance.
   *
   * This method retrieves the set of unprintable characters (referring to
   * Vim's `'isprint'` option) and updates the internal state accordingly.
   *
   * @param args - The arguments passed to `BaseSource.onInit()`.
   * @returns A Promise that resolves when initialization is complete.
   */
  async onInit(args: UnprintableOnInitArguments): Promise<void> {
    const chars = [
      ...UNPRINTABLE_CHARS,
      ...(await getUnprintableChars(args.denops)),
    ];
    this.#reUnprintableChar = makeCharCodeRangeRegExp(chars);
  }

  /**
   * Call this method in your `BaseSource.onCompleteDone()` implementation.
   *
   * This method restores the original word and input after a completion item
   * containing unprintable characters is selected.  If the selected item does
   * not contain unprintable characters, this method does nothing.
   *
   * @param args - The arguments passed to `BaseSource.onCompleteDone()`.
   * @returns A Promise that resolves when the operation is complete.
   * @throws {UnprintableError} If the `args.userData` is not valid.
   */
  async onCompleteDone(
    args: UnprintableOnCompleteDoneArguments<UserData>,
  ): Promise<void> {
    this.#completeDoneCount++;
    const { denops, onCallback, userData, context } = args;
    const { nextInput } = context;
    let { input, lineNr } = context;

    // If userData is not valid, throw an error.
    const {
      unprintable: { origWord, origNextInput },
    } = ensureInternalUserData(userData);

    // If no unprintable contains, do nothing.
    if (!this.#reUnprintableChar.test(origWord)) return;

    const [vimMode, vchar] = await accumulate(denops, (helper) =>
      Promise.all(
        [
          mode(helper),
          vim.get(helper, "char") as Promise<string>,
        ] as const,
      ));
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
      const pos = byteLength(cmdHead) + 1;
      await setcmdline(denops, cmdLine, pos);
    } else {
      // Replace buffer
      const lines = textToRegContents(lineHead + userInput + lineTail);
      const linesHead = textToRegContents(lineHead + userInput);
      const cursorLN = lineNr + linesHead.length - 1;
      const cursorCol = byteLength(linesHead.at(-1) ?? "") + 1;
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

  #makeWord(word: string): string {
    return word.replaceAll(this.#reUnprintableChar, this.#placeholder);
  }

  #makeAbbr(word: string): string {
    return word.replaceAll(this.#reUnprintableChar, unprintableCharToDisplay);
  }

  #generateHighlights(
    abbr: string,
    abbrSlices: readonly Readonly<{ chars: number; bytes: number }>[],
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
