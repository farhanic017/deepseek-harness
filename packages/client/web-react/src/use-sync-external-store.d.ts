declare module 'use-sync-external-store/shim/with-selector.js' {
  export function useSyncExternalStoreWithSelector<T, S>(
    subscribe: (callback: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot: (() => T) | undefined,
    selector: (snapshot: T) => S,
    isEqual?: (a: S, b: S) => boolean,
  ): S
}

