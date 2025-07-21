# ddc-unprintable

[![license:MIT](https://img.shields.io/github/license/Milly/ddc-unprintable?style=flat-square)](LICENSE)
[![jsr](https://jsr.io/badges/@milly/ddc-unprintable)](https://jsr.io/@milly/ddc-unprintable)

_ddc-unprintable_ is helper library for [ddc.vim] sources in [Denops]. This
module contains helpers that allow you to paste word-kind sources gathering
unprintable characters.

[ddc.vim]: https://github.com/Shougo/ddc.vim
[Denops]: https://github.com/vim-denops/denops.vim

## Usage

1. Instantiate `Unprintable` class in your ddc source.
2. Call `onInit()` in your `Source.onInit()` method to initialize instance.
3. Call `convertItems()` in your `Source.gather()` method to process completion
   items.
4. Call `onCompleteDone()` in your `Source.onCompleteDone()` method to restore
   the original text.

Example of using this module in your source:

```ts
import { Unprintable, UnprintableUserData } from "jsr:@milly/ddc-unprintable";
import {
  BaseSource,
  type GatherArguments,
  type OnCompleteDoneArguments,
  type OnInitArguments,
} from "jsr:@shougo/ddc-vim/source";
import type { Item } from "jsr:@shougo/ddc-vim/types";

interface MyParams extends Record<string, unknown> {
  // Add your source parameters here
}

interface MyUserData extends UnprintableUserData {
  // Add your user data properties here
}

type MyItem = Item<MyUserData>;

export class Source extends BaseSource<MyParams, MyUserData> {
  // 1. Instantiate this class.
  #unprintable = new Unprintable<MyUserData>();

  override params(): MyParams {
    return {};
  }

  override async onInit(args: OnInitArguments<MyParams>): Promise<void> {
    // 2. Call `onInit()`.
    await this.#unprintable.onInit(args);
  }

  override async gather(
    args: GatherArguments<MyParams>,
  ): Promise<MyItem[]> {
    const myItems: MyItem[] = [
      // Generate your items here.
    ];

    // 3. Call `convertItems()`.
    const convertedItems = await this.#unprintable!.convertItems(
      args.denops,
      myItems,
      args.context.nextInput,
    );

    return convertedItems;
  }

  override async onCompleteDone(
    args: OnCompleteDoneArguments<MyParams, MyUserData>,
  ): Promise<void> {
    // 4. Call `onCompleteDone()`.
    await this.#unprintable.onCompleteDone(args);
  }
}
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file
for details.
