// Sentry wrapper for pusher. Re-exports @sentry/node when ENABLE_SENTRY is true,
// otherwise exports no-op stubs. This allows the Sentry packages to be
// stripped without breaking server-side code.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop: AnyFn = (..._args: any[]) => {};
const noopPassthrough: AnyFn = (fn) => fn;

interface SentryLike {
    init: AnyFn;
    captureException: AnyFn;
    captureMessage: AnyFn;
    setUser: AnyFn;
    setContext: AnyFn;
    setTag: AnyFn;
    withScope: AnyFn;
    startSpan: AnyFn;
    addBreadcrumb: AnyFn;
    [key: string]: AnyFn;
}

let sentryModule: SentryLike;

if (process.env.ENABLE_SENTRY === "true") {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        sentryModule = require("@sentry/node");
    } catch {
        console.warn("[Sentry] ENABLE_SENTRY is true but @sentry/node is not installed. Using no-op stubs.");
        sentryModule = new Proxy({} as SentryLike, {
            get: (_, prop) => (prop === "withScope" || prop === "startSpan" ? noopPassthrough : noop),
        });
    }
} else {
    sentryModule = new Proxy({} as SentryLike, {
        get: (_, prop) => (prop === "withScope" || prop === "startSpan" ? noopPassthrough : noop),
    });
}

export default sentryModule;
export const {
    init,
    captureException,
    captureMessage,
    setUser,
    setContext,
    setTag,
    withScope,
    startSpan,
    addBreadcrumb,
} = sentryModule;
