import { useCallback, useEffect, useState } from 'react';
import { browserNpcLibrarySnapshot, type NpcLibrarySnapshot } from './npcLibrary';

export function useNpcLibrary() {
  const [snapshot, setSnapshot] = useState<NpcLibrarySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async (reload = false) => {
    setLoading(true);
    setStatus('');
    try {
      const bridge = window.rpgraph;
      const next = bridge?.getNpcLibrary
        ? await (reload ? bridge.reloadNpcLibrary() : bridge.getNpcLibrary())
        : browserNpcLibrarySnapshot();
      setSnapshot(next);
      if (reload) setStatus(`Reloaded ${next.entries.length} NPC container${next.entries.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(`Unable to load NPC library: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initial = window.rpgraph?.getNpcLibrary
      ? window.rpgraph.getNpcLibrary()
      : Promise.resolve(browserNpcLibrarySnapshot());
    void initial.then((next) => {
      if (active) setSnapshot(next);
    }).catch((error) => {
      if (active) setStatus(`Unable to load NPC library: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { active = false; };
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    if (!snapshot) void load();
  }, [load, snapshot]);

  const openFolder = useCallback(async () => {
    try {
      if (!window.rpgraph?.openNpcLibraryFolder) {
        setStatus('The user NPC folder is unavailable in browser mode.');
        return;
      }
      const result = await window.rpgraph.openNpcLibraryFolder();
      setStatus(`Opened ${result.path}`);
    } catch (error) {
      setStatus(`Unable to open NPC folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  return { snapshot, open, loading, status, show, close: () => setOpen(false),
    reload: () => load(true), openFolder };
}
