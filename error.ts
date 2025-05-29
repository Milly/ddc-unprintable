/**
 * Custom error class for errors thrown by the _ddc-unprintable_ library.
 *
 * This error is thrown when invalid or unexpected data is encountered
 * during processing of unprintable characters.
 */
export class UnprintableError extends Error {
  /**
   * Create a new UnprintableError instance.
   *
   * @param message - The error message.
   */
  constructor(message: string) {
    super(message);
    this.name = "UnprintableError";
  }
}
