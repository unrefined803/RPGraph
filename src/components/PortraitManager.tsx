import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PortraitId } from '../characters/character';
import { characterPortrait, characterPortraitUrl, portraitIds, portraitLabels, withPortraitSlot, type PortraitOwner } from '../characters/portraits';
import type { RpStorybookCharacterImage } from '../nodes/rp-storybook/model';
import { ProfilePickDialog } from './ProfilePickDialog';
import { useBackdropDismiss } from './useBackdropDismiss';

const shortPortraitLabels: Record<PortraitId, string> = { character: 'Character', custom1: 'Custom 1', custom2: 'Custom 2' };
const appLabels = { whatsup: 'WhatsUp', fotogram: 'Photogram', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' } as const;

/** Enabled accounts showing a slot; an unset selection means the character portrait. */
function portraitUses(owner: PortraitOwner, id: PortraitId) {
  return Object.entries(owner.apps ?? {}).flatMap(([app, account]) => account?.enabled ? [
    ...((account.portraitId ?? 'character') === id ? [appLabels[app as keyof typeof appLabels]] : []),
    ...(app === 'whatsup' && owner.apps?.whatsup?.alias && (owner.apps.whatsup.alias.portraitId ?? 'character') === id ? ['WhatsUp second account'] : []),
  ] : []);
}

/** Apps choose only prepared portraits. Gallery editing lives in PortraitManager. */
export function PortraitSelector({ owner, value = 'character', onChange }: {
  owner: PortraitOwner; value?: PortraitId; onChange: (id: PortraitId) => void;
}) {
  return <div className="portrait-slot-grid compact" role="group" aria-label="Profile portrait">
    {portraitIds.map((id) => {
      const url = characterPortraitUrl(owner, id);
      const missing = id !== 'character' && !characterPortrait(owner, id);
      return <button key={id} type="button" className="portrait-slot" aria-pressed={value === id} title={portraitLabels[id]}
        disabled={missing} onClick={() => onChange(id)}>
        {url ? <img src={url} alt="" /> : <span className="portrait-slot-empty" aria-hidden="true" />}
        <strong>{shortPortraitLabels[id]}</strong>
        {!url && <small>{missing ? 'Not created' : 'No portrait'}</small>}
      </button>;
    })}
  </div>;
}

export function PortraitManager<T extends PortraitOwner & { name: string; images: RpStorybookCharacterImage[] }>({ owner, initialImageId, onChange, onClose }: {
  owner: T; initialImageId?: string; onChange: (next: T) => void; onClose: () => void;
}) {
  const [slot, setSlot] = useState<PortraitId>();
  const [imageId, setImageId] = useState<string>();
  const [error, setError] = useState('');
  const images: RpStorybookCharacterImage[] = owner.images;
  const image = images.find((entry) => entry.id === imageId);
  useEffect(() => {
    if (image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (slot) setSlot(undefined); else onClose();
    };
    window.addEventListener('keydown', close, { capture: true });
    return () => window.removeEventListener('keydown', close, { capture: true });
  }, [image, slot, onClose]);
  const dismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  return createPortal(<div className="profile-pick-backdrop" {...dismiss}>
    <section className="portrait-manager deep-dialog" role="dialog" aria-modal="true" aria-label="Manage portraits">
      <header className="portrait-manager-header">
        <div><span className="portrait-manager-eyebrow">Portraits</span><h4>{owner.name}</h4>
          <p>The character portrait shows the real character. Up to two custom portraits serve other identities. Every app account selects one of them.</p></div>
        <button type="button" className="close-button" autoFocus onClick={onClose}>Close</button>
      </header>
      {!slot ? <div className="portrait-slot-grid">{portraitIds.map((id) => {
        const url = characterPortraitUrl(owner, id);
        const locked = id !== 'character' && !owner.profileImage;
        const uses = portraitUses(owner, id);
        return <div className="portrait-slot" key={id}>
          {/* An existing portrait reopens its framing; closing that leads to the gallery. */}
          <button type="button" className="portrait-slot-main" disabled={locked || !images.length}
            onClick={() => { setSlot(id); setImageId(initialImageId ?? characterPortrait(owner, id)?.imageId); setError(''); }}>
            {url ? <img src={url} alt="" /> : <span className="portrait-slot-empty" aria-hidden="true">+</span>}
            <strong>{portraitLabels[id]}</strong>
            <small>{url ? 'Change image or framing' : locked ? 'Create the character portrait first' : images.length ? 'Create portrait' : 'Add a gallery image first'}</small>
            {characterPortrait(owner, id) && <small className="portrait-slot-uses">{uses.length ? `Used by ${uses.join(', ')}` : 'Not used by any account'}</small>}
          </button>
          {characterPortrait(owner, id) && <button type="button" className="portrait-slot-clear" onClick={() => {
            try { onChange(withPortraitSlot(owner, id)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}>Clear</button>}
        </div>;
      })}</div> : <>
        <div className="portrait-manager-toolbar">
          <button type="button" className="portrait-manager-button" onClick={() => { setSlot(undefined); setImageId(undefined); }}>← Portraits</button>
          <span>Choose a gallery image for {portraitLabels[slot]}.</span>
        </div>
        {images.length ? <div className="portrait-gallery">{images.map((entry) => <button type="button" key={entry.id}
          aria-pressed={characterPortrait(owner, slot)?.imageId === entry.id} title={entry.description || entry.name} onClick={() => setImageId(entry.id)}>
          <img src={entry.dataUrl} alt={entry.description || entry.name} loading="lazy" /><span>{entry.name}</span>
        </button>)}</div> : <p className="portrait-manager-empty">Add an image to the gallery first.</p>}
      </>}
      {error && <p className="portrait-manager-error" role="alert">{error}</p>}
    </section>
    {slot && image && <ProfilePickDialog key={`${slot}:${image.id}`} characterName={portraitLabels[slot]} image={image}
      currentProfileImage={characterPortrait(owner, slot)} onClose={() => setImageId(undefined)}
      onApply={(portrait) => {
        try { onChange(withPortraitSlot(owner, slot, portrait)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        setImageId(undefined); setSlot(undefined);
      }} />}
  </div>, document.body);
}
