import { useCallback, useEffect, useRef, useState } from 'react';
import { browserNpcLibrarySnapshot, type NpcLibrarySnapshot } from './npcLibrary';

export function useNpcLibrary() {
  const [snapshot, setSnapshot] = useState<NpcLibrarySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const transition = useRef(0);
  const transitioning = useRef(false);

  const load = useCallback(async (reload = false) => {
    const revision = transition.current;
    setLoading(true);
    setStatus('');
    try {
      const bridge = window.rpgraph;
      const next = await (bridge?.getNpcLibrary
        ? (reload ? bridge.reloadNpcLibrary() : bridge.getNpcLibrary())
        : browserNpcLibrarySnapshot());
      if (!transitioning.current && revision === transition.current) setSnapshot(next);
      if (reload) setStatus(`Reloaded ${next.entries.length} NPC container${next.entries.length === 1 ? '' : 's'}.`);
      return next;
    } catch (error) {
      setStatus(`Unable to load NPC library: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
    return undefined;
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.rpgraph?.onNpcLibraryChanged?.(() => {
      const revision = transition.current;
      void window.rpgraph.getNpcLibrary().then((next) => { if (active && !transitioning.current && revision === transition.current) setSnapshot(next); }).catch((error) => {
        if (active) setStatus(`Unable to refresh NPC library: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    const initial = window.rpgraph?.getNpcLibrary
      ? window.rpgraph.getNpcLibrary()
      : browserNpcLibrarySnapshot();
    void initial.then((next) => {
      if (active && !transitioning.current && transition.current === 0) setSnapshot(next);
    }).catch((error) => {
      if (active) setStatus(`Unable to load NPC library: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const setGamePassword = useCallback(async (password: string) => {
    const revision = ++transition.current;
    transitioning.current = true;
    setLoading(true);
    setStatus('');
    setSnapshot((current) => current ? { ...current,
      entries: current.entries.filter((entry) => !current.files.some((file) => file.tier === entry.tier && file.fileName === entry.fileName && file.protection === 'encrypted')),
      files: current.files.map((file) => ({ ...file, unlocked: false })),
    } : current);
    try {
      const next = await window.rpgraph.setWorkspaceProtection(password);
      if (revision !== transition.current) return;
      setSnapshot(next);
      const unlocked = next.files.filter((file) => file.protection === 'encrypted' && file.unlocked).length;
      const locked = next.files.filter((file) => file.protection === 'encrypted' && !file.unlocked).length;
      setStatus(unlocked > 0 || locked > 0
        ? `${unlocked} encrypted character file(s) unlocked for the protected game. ${locked} remain locked.`
        : '');
    } catch (error) {
      setStatus(`Unable to unlock NPC library: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (revision === transition.current) { transitioning.current = false; setLoading(false); } }
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    void load(true);
  }, [load]);

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
    reload: () => load(true), openFolder, setGamePassword };
}
