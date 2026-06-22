/** Shared viewport helpers for responsive layout. */

export const MOBILE_MAX_WIDTH = 768;

export function isMobileViewport() {
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

export function onViewportChange(callback) {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const handler = () => callback(isMobileViewport());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
}
