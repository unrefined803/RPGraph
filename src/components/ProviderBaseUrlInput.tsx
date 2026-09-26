import { useEffect, useRef } from 'react';

export function ProviderBaseUrlInput({ value, onChange, onCheck }: {
  value: string;
  onChange: (value: string) => void;
  onCheck: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pasted = useRef(false);
  const latest = useRef({ value, onCheck });
  useEffect(() => { latest.current = { value, onCheck }; }, [value, onCheck]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function check() {
    clearTimeout(timer.current);
    try {
      const url = new URL(latest.current.value.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') latest.current.onCheck();
    } catch {
      // Incomplete URLs stay editable without sending a request.
    }
  }

  return <input
    id="base-url"
    value={value}
    onPaste={() => { pasted.current = true; }}
    onChange={(event) => {
      clearTimeout(timer.current);
      onChange(event.target.value);
      if (pasted.current) timer.current = setTimeout(check, 450);
      pasted.current = false;
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        check();
      }
    }}
  />;
}
