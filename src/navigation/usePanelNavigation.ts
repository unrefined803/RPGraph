import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { PanelHistory } from './panelHistory';

export const NavigationContext = createContext<PanelHistory | null>(null);

// Only navigation belongs here: edits, messages and transactions are never undone.
export function usePanelNavigationState<T>(key: string, initial: T | (() => T), track?: boolean): readonly [T, Dispatch<SetStateAction<T>>];
export function usePanelNavigationState<T = undefined>(key: string): readonly [T | undefined, Dispatch<SetStateAction<T | undefined>>];
export function usePanelNavigationState<T = undefined>(key: string, initial?: T | (() => T), track = true) {
  const history = useContext(NavigationContext);
  const [value, setValue] = useState<T>(() => history?.values.has(key)
    ? history.values.get(key) as T
    : typeof initial === 'function' ? (initial as () => T)() : initial as T);
  useLayoutEffect(() => history?.register(key, (next) => setValue(() => next as T)), [history, key]);
  useLayoutEffect(() => { history?.write(key, value, track); }, [history, key, value, track]);
  return [value, setValue] as const;
}

export function usePanelNavigationOverlay(close: () => void, enabled = true) {
  const history = useContext(NavigationContext);
  const closeRef = useRef(close);
  useLayoutEffect(() => { closeRef.current = close; });
  useLayoutEffect(() => {
    if (enabled) return history?.registerOverlay(() => closeRef.current());
  }, [history, enabled]);
}

export function usePanelNavigationReset(revision: number) {
  const history = useContext(NavigationContext);
  useEffect(() => { history?.reset(); }, [history, revision]);
  return () => history?.reset(true);
}
