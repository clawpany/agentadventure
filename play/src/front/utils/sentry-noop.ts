// No-op Sentry shim used when ENABLE_SENTRY is false.
// Vite resolve.alias maps @sentry/svelte and @sentry/browser to this file.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = (..._args: any[]): any => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopPassthrough = (fn: any) => fn;

export const init = noop;
export const captureException = noop;
export const captureMessage = noop;
export const setUser = noop;
export const setContext = noop;
export const setTag = noop;
export const withScope = noopPassthrough;
export const startSpan = noopPassthrough;
export const addBreadcrumb = noop;
export const configureScope = noopPassthrough;
export const getCurrentHub = () => ({ getClient: () => null });
export default {
    init,
    captureException,
    captureMessage,
    setUser,
    setContext,
    setTag,
    withScope,
    startSpan,
    addBreadcrumb,
    configureScope,
    getCurrentHub,
};
