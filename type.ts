/**
 * Internal user data type reserved for _ddc-unprintable_ library.
 *
 * This type is used to extend the `user_data` property of completion items
 * with internal information required by _ddc-unprintable_ library.
 */
export type UnprintableUserData = {
  /**
   * Reserved for internal data of _ddc-unprintable_ library.
   *
   * This property is for internal use only and should not be set by users.
   */
  unprintable?: never;
};

/**
 * Parameters to control the behavior of `Unprintable` class.
 */
export interface UnprintableParameters {
  /**
   * Highlight name to be applied to unprintable characters in completion items.
   *
   * @default "ddc_unprintable"
   */
  highlightName: string;

  /**
   * Vim highlight group name to be used for unprintable characters.
   *
   * @default "SpecialKey"
   */
  highlightGroup: string;

  /**
   * Placeholder character to display in place of unprintable characters.
   *
   * Must be a single character.
   *
   * @default "?"
   */
  placeholder: string;

  /**
   * Maximum width of the abbreviation (abbr) column, in display width.
   *
   * If set to 0, the width is unlimited.
   *
   * @default 0
   */
  abbrWidth: number;
}

/**
 * Options for the `Unprintable` class.
 *
 * These parameters are used customize how unprintable characters are handled
 * and displayed.
 */
export interface UnprintableOptions extends Partial<UnprintableParameters> {
  /**
   * Base string for the callback ID.
   *
   * If empty, a random ID will be generated and used.
   *
   * @default undefined
   */
  callbackId?: string;
}
