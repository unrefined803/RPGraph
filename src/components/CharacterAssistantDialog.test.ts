import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ComponentProps, type ReactNode, type SetStateAction } from 'react';
import { CharacterAssistantDialog } from './CharacterAssistantDialog';
import { newAssistantCharacter } from '../characters/assistant';
import { createCharacterContainer } from '../characters/creator';
import { setAccountSession } from '../accounts/accountSession';

vi.mock('../navigation/usePanelNavigation', () => ({ usePanelNavigationOverlay: () => {} }));
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (value: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect: () => {},
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; });
afterEach(() => { setAccountSession(''); vi.unstubAllGlobals(); });

// Inspect event callbacks only; no DOM, effects, or child components are mounted.
type ElementProps = { children?: ReactNode; onClick?: () => void; role?: string };
function elements(node: ReactNode): ElementProps[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node.props, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<ElementProps>(node) ? text(node.props.children) : '';
}

function harness(accountPassword = 'account-secret') {
  setAccountSession(accountPassword);
  const character = { ...newAssistantCharacter(), name: 'Alex' };
  const loaded = { fileName: 'alex.json', name: 'Alex', filePath: '/characters/alex.json',
    type: 'character-card' as const, protection: 'encrypted' as const, value: createCharacterContainer(character, true) };
  const bridge = {
    listCharacterFiles: vi.fn(async () => [{ ...loaded, storage: 'characters', compatible: true }]),
    tryLoadFile: vi.fn(async (): Promise<typeof loaded | null> => loaded),
    loadFile: vi.fn(async () => loaded),
    reloadNpcLibrary: vi.fn(async () => ({ entries: [] })),
    saveCharacter: vi.fn(async () => ({ fileName: 'alex.json' })),
  };
  vi.stubGlobal('window', { rpgraph: bridge });
  const props = { connections: [], providerHealthById: {}, defaultConnectionId: '', snapshot: null,
    defaultExportDestination: 'account-npc-characters', onSaved: async () => {}, onClose: () => {},
  } as unknown as ComponentProps<typeof CharacterAssistantDialog>;
  function render() {
    hooks.index = 0;
    return elements(CharacterAssistantDialog(props));
  }
  function click(label: string) {
    const button = render().find(element => element.onClick && text(element.children).trim() === label);
    expect(button, label).toBeDefined();
    button!.onClick!();
  }
  async function load() {
    click('+ Load Character');
    await vi.waitFor(() => expect(render().some(element => element.onClick && text(element.children) === 'Load')).toBe(true));
    click('Load');
  }
  return { render, click, load, bridge };
}

it('automatically unlocks account characters and preserves encrypted private export defaults after loading', async () => {
  const state = harness();
  await state.load();
  await vi.waitFor(() => expect(state.render().some(element => element.role === 'status' && text(element.children).startsWith('Loaded alex.json'))).toBe(true));
  expect(state.bridge.tryLoadFile).toHaveBeenCalledWith('alex.json', 'account-secret', 'characters');
  expect(state.bridge.loadFile).not.toHaveBeenCalled();
  state.click('Save Character File…');
  state.click('Save Character File');
  await vi.waitFor(() => expect(state.bridge.saveCharacter).toHaveBeenCalledWith(
    'Alex', expect.anything(), 'encrypted', 'account-secret', false, 'account-npc-characters',
  ));
});

it('keeps the manual password flow available when the account password does not match', async () => {
  const state = harness();
  state.bridge.tryLoadFile.mockResolvedValueOnce(null);
  await state.load();
  await vi.waitFor(() => expect(state.render().some(element => element.role === 'status' && text(element.children) === 'Enter the password used to encrypt this character.')).toBe(true));
  expect(state.bridge.loadFile).not.toHaveBeenCalled();
  expect(state.render().some(element => element.onClick && text(element.children) === 'Load')).toBe(true);
});
