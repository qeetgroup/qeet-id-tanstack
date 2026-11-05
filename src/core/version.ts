declare const __QEET_ID_TANSTACK_VERSION__: string | undefined;

/** This package's version, written in from package.json when it is built. */
export const VERSION: string = typeof __QEET_ID_TANSTACK_VERSION__ === "string" ? __QEET_ID_TANSTACK_VERSION__ : "0.0.0-development";
