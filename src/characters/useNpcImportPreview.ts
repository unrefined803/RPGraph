import { useEffect, useState } from 'react';
import type { NpcImportPreviewIndex } from '../../shared/npcSourceSelection.cjs';
import { mainCharacterCount, npcImportPreview, npcSourceSwitches } from './npcImportPreview';

export function useNpcImportPreview(open: boolean, targetFileName: string | null) {
  const [index, setIndex] = useState<NpcImportPreviewIndex | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    let request = 0;
    const refresh = async () => {
      const sequence = ++request;
      setIndex(null);
      if (!window.rpgraph?.getNpcImportPreview) {
        setStatus('NPC source preview is unavailable.');
        return;
      }
      setStatus('Checking NPC sources…');
      try {
        const next = await window.rpgraph.getNpcImportPreview();
        if (active && sequence === request) { setIndex(next); setStatus(''); }
      } catch {
        if (active && sequence === request) setStatus('Unable to check NPC sources.');
      }
    };
    void refresh();
    const unsubscribe = window.rpgraph?.onNpcLibraryChanged?.(() => { void refresh(); });
    return () => { active = false; unsubscribe?.(); };
  }, [open]);
  const rows = index && targetFileName ? npcImportPreview(index, targetFileName) : null;
  const mainCharacters = index && targetFileName ? mainCharacterCount(index, targetFileName) : 0;
  const switches = index && targetFileName ? npcSourceSwitches(index, targetFileName) : {};
  /** Let this file share its whole cast; the library change refreshes the preview. */
  const switchSource = async (fileName: string) => {
    try {
      await window.rpgraph.preferNpcSource(fileName);
    } catch {
      setStatus('Unable to switch NPC sharing.');
    }
  };
  return { rows, mainCharacters, switches, switchSource, status: status || (index && targetFileName && !rows
    ? 'NPC source preview is unavailable for this file.' : '') };
}
