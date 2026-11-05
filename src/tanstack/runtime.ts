/**
 * The process's one `QeetIDAuth`, made from the environment the first time it
 * is needed. Server-only.
 */

import { QeetIDAuth } from "../core/auth.js";
import { loadConfig } from "../core/config.js";

let instance: QeetIDAuth | undefined;

/**
 * The configured `QeetIDAuth`.
 *
 * @throws {ConfigurationError} until the QEET_ID_* variables are right; it is asked again on the next call.
 */
export function getQeetIDAuth(): QeetIDAuth {
  instance ??= new QeetIDAuth(loadConfig());
  return instance;
}

/** Replaces the instance (tests), or forgets it so the next call reads the environment again. */
export function setQeetIDAuth(next: QeetIDAuth | undefined): void {
  instance = next;
}
