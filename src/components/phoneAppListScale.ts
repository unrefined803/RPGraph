import { createContext, useContext, type CSSProperties } from 'react';
import type { PhoneAppListId, PhoneAppListScales } from '../types';

type PhoneAppListScaleContextValue = {
  scales: PhoneAppListScales;
  onScaleChange: (app: PhoneAppListId, scale: number) => void;
};

export const PhoneAppListScaleContext = createContext<PhoneAppListScaleContextValue>({
  scales: {},
  onScaleChange: () => {},
});

/** Style for the app surface; CSS multiplies the default list width with `--phone-app-list-scale`. */
export function usePhoneAppListScaleStyle(app: PhoneAppListId): CSSProperties {
  const { scales } = useContext(PhoneAppListScaleContext);
  return { '--phone-app-list-scale': scales[app] ?? 1 } as CSSProperties;
}
