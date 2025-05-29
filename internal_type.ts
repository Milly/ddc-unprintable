import { ensure, is, type Predicate } from "@core/unknownutil";
import { UnprintableError } from "./error.ts";

/**
 * @internal
 */
export type UnprintableData = {
  origWord: string;
  origNextInput: string;
};

/**
 * @internal
 */
export type InternalUserData = {
  unprintable: UnprintableData;
};

/**
 * Return true if the typeof `x` is `UnprintableData`.
 */
const isUnprintableData = is.ObjectOf({
  origWord: is.String,
  origNextInput: is.String,
}) satisfies Predicate<UnprintableData>;

/**
 * Return true if the typeof `x` is `InternalUserData`.
 */
const isInternalUserData = is.ObjectOf({
  unprintable: isUnprintableData,
}) satisfies Predicate<InternalUserData>;

/**
 * Ensure that the given `userData` is of type `InternalUserData`.
 *
 * @internal
 * @param userData - The user data to validate.
 * @returns The validated `InternalUserData`.
 * @throws {UnprintableError} if the userData is not valid.
 */
export function ensureInternalUserData(userData: unknown): InternalUserData {
  try {
    return ensure(userData, isInternalUserData);
  } catch (e: unknown) {
    throw new UnprintableError(`userData is not valid: ${e}`);
  }
}
