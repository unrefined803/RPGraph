import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EffectCallback } from 'react';
import { useSliderPreview } from './useSliderPreview';

const hooks = vi.hoisted(() => ({ active: false, effect: undefined as EffectCallback | undefined }));
vi.mock('react', () => ({
  useState: () => [hooks.active, (value: boolean) => { hooks.active = value; }],
  useEffect: (effect: EffectCallback) => { hooks.effect = effect; },
}));

class Input {
  type = 'range';
  disabled = false;
  previewEnabled = true;
  matches() { return this.previewEnabled; }
}
let events: EventTarget;
let cleanup: (() => void) | undefined;
beforeEach(() => {
  hooks.active = false;
  events = new EventTarget();
  vi.stubGlobal('window', events);
  vi.stubGlobal('HTMLInputElement', Input);
  useSliderPreview(true);
  cleanup = hooks.effect?.() as (() => void) | undefined;
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });

function send(type: string, target: unknown, props: Record<string, unknown> = {}) {
  const event = new Event(type);
  Object.defineProperty(event, 'target', { value: target });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
  events.dispatchEvent(event);
}

it('previews every consecutive slider drag without waiting for a second click', () => {
  const first = new Input();
  const second = new Input();
  send('pointerdown', first, { button: 0 });
  expect(hooks.active).toBe(true);
  send('pointerup', first);
  expect(hooks.active).toBe(false);
  send('pointerdown', second, { button: 0 });
  // The previous input loses focus after the next pointerdown. Only window blur ends a gesture.
  expect(hooks.active).toBe(true);
  send('pointerup', second);
  expect(hooks.active).toBe(false);
});

it('handles all enabled options ranges, keyboard gestures and cancellation', () => {
  const input = new Input();
  send('keydown', input, { key: 'ArrowRight' });
  expect(hooks.active).toBe(true);
  send('keyup', input);
  expect(hooks.active).toBe(false);
  send('pointerdown', input, { button: 0 });
  send('pointercancel', input);
  expect(hooks.active).toBe(false);
  send('pointerdown', input, { button: 0 });
  events.dispatchEvent(new Event('blur'));
  expect(hooks.active).toBe(false);
});

it('ignores disabled controls and controls outside the preview allowlist', () => {
  const input = new Input();
  input.disabled = true;
  send('pointerdown', input, { button: 0 });
  expect(hooks.active).toBe(false);
  input.disabled = false;
  input.previewEnabled = false;
  send('keydown', input, { key: 'ArrowLeft' });
  expect(hooks.active).toBe(false);
});

it('clears the preview and removes listeners when Options closes', () => {
  const input = new Input();
  send('pointerdown', input, { button: 0 });
  cleanup?.();
  expect(hooks.active).toBe(false);
  send('pointerdown', input, { button: 0 });
  expect(hooks.active).toBe(false);
  expect(useSliderPreview(false)).toBe(false);
});
