import { useLayoutEffect, useRef, useState } from 'react';
import type { NodeActions } from '../nodes/types';

/** Node actions have fixed keys; their handlers must see the latest committed state. */
export function useStableNodeActions(actions: NodeActions): NodeActions {
  const latest = useRef(actions);
  useLayoutEffect(() => { latest.current = actions; });
  // Initialization only creates event handlers; the ref is read when an action
  // is invoked after commit, never while this component renders.
  // eslint-disable-next-line react-hooks/refs
  const [stable] = useState(() => Object.fromEntries(
    Object.keys(actions).map((key) => [key, (...args: unknown[]) =>
      Reflect.apply(latest.current[key as keyof NodeActions], undefined, args)]),
  ) as NodeActions);
  return stable;
}
