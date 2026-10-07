import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PortraitChoice, PortraitId } from '../characters/character';
import { characterPortrait, characterPortraitUrl, portraitIds, portraitLabels, withPortraitSlot, type PortraitOwner } from '../characters/portraits';
import type { RpStorybookCharacterImage, RpStorybookCharacterProfileImage } from '../nodes/rp-storybook/model';
import { usePortraitCrop } from './usePortraitCrop';
import { useBackdropDismiss } from './useBackdropDismiss';

const shortPortraitLabels: Record<PortraitChoice, string> = { character: 'Character', custom1: 'Custom 1', custom2: 'Custom 2', none: 'No portrait' };
const appLabels = { whatsup: 'WhatsUp', fotogram: 'Photogram', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' } as const;

/** Enabled accounts showing a slot; an unset selection means the character portrait. */
function portraitUses(owner: PortraitOwner, id: PortraitId) {
  return Object.entries(owner.apps ?? {}).flatMap(([app, account]) => account?.enabled ? [
    ...((account.portraitId ?? 'character') === id ? [appLabels[app as keyof typeof appLabels]] : []),
    ...(app === 'whatsup' && owner.apps?.whatsup?.alias && (owner.apps.whatsup.alias.portraitId ?? 'character') === id ? ['WhatsUp second account'] : []),
  ] : []);
}

/**
 * Apps choose only prepared portraits. Gallery editing lives in PortraitManager.
 * `allowNone` adds the choice to show no portrait at all.
 */
export function PortraitSelector({ owner, value = 'character', allowNone = false, onChange }: {
  owner: PortraitOwner; value?: PortraitChoice; allowNone?: boolean; onChange: (id: PortraitChoice) => void;
}) {
  const choices: PortraitChoice[] = allowNone ? [...portraitIds, 'none'] : [...portraitIds];
  return <div className={`portrait-slot-grid compact${allowNone ? ' with-none' : ''}`} role="group" aria-label="Profile portrait">
    {choices.map((id) => {
      const url = characterPortraitUrl(owner, id);
      const missing = id !== 'character' && id !== 'none' && !characterPortrait(owner, id);
      return <button key={id} type="button" className="portrait-slot" aria-pressed={value === id} title={id === 'none' ? 'Show no portrait' : portraitLabels[id]}
        disabled={missing} onClick={() => onChange(id)}>
        {url ? <img src={url} alt="" /> : <span className={`portrait-slot-empty${id === 'none' ? ' none' : ''}`} aria-hidden="true" />}
        <strong>{shortPortraitLabels[id]}</strong>
        {!url && id !== 'none' && <small>{missing ? 'Not created' : 'No portrait'}</small>}
      </button>;
    })}
  </div>;
}

type ManagedOwner = Omit<PortraitOwner, 'images'> & { name: string; images: RpStorybookCharacterImage[] };
type PortraitManagerProps<T extends ManagedOwner> = { owner: T; initialImageId?: string; onChange: (next: T) => void; onClose: () => void };

/** Slot, gallery image and framing steps shared by the dialog and the phone screen. */
function usePortraitFlow<T extends ManagedOwner>({ owner, onChange, onClose }: PortraitManagerProps<T>) {
  const [slot, setSlot] = useState<PortraitId>();
  const [imageId, setImageId] = useState<string>();
  const [error, setError] = useState('');
  const image = owner.images.find((entry) => entry.id === imageId);
  const attempt = (change: () => T) => {
    try { onChange(change()); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  // Framing steps back to the gallery, the gallery to the slots, the slots close.
  const back = () => {
    if (image) setImageId(undefined);
    else if (slot) setSlot(undefined);
    else onClose();
  };
  const backRef = useRef(back);
  useEffect(() => { backRef.current = back; });
  // Capture phase: the dialogs and phone screens underneath must not close as well.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); backRef.current();
    };
    window.addEventListener('keydown', onEscape, { capture: true });
    return () => window.removeEventListener('keydown', onEscape, { capture: true });
  }, []);
  return {
    slot, image, error, back,
    selectSlot: (id: PortraitId, imageId?: string) => { setSlot(id); setImageId(imageId); setError(''); },
    selectImage: setImageId,
    clear: (id: PortraitId) => attempt(() => withPortraitSlot(owner, id)),
    apply: (portrait: RpStorybookCharacterProfileImage) => {
      if (slot) attempt(() => withPortraitSlot(owner, slot, portrait));
      setImageId(undefined); setSlot(undefined);
    },
  };
}

function PortraitSlots({ owner, selected, onSelect, onClear }: {
  owner: ManagedOwner; selected?: PortraitId; onSelect: (id: PortraitId) => void; onClear: (id: PortraitId) => void;
}) {
  return <div className="portrait-slot-grid">{portraitIds.map((id) => {
    const url = characterPortraitUrl(owner, id);
    const locked = id !== 'character' && !owner.profileImage;
    const uses = portraitUses(owner, id);
    return <div className={`portrait-slot${selected === id ? ' selected' : ''}`} key={id}>
      <button type="button" className="portrait-slot-main" aria-pressed={selected === id} disabled={locked || !owner.images.length} onClick={() => onSelect(id)}>
        {url ? <img src={url} alt="" /> : <span className="portrait-slot-empty" aria-hidden="true">+</span>}
        <strong>{portraitLabels[id]}</strong>
        <small>{url ? 'Change image or framing' : locked ? 'Create the character portrait first' : owner.images.length ? 'Create portrait' : 'Add a gallery image first'}</small>
        {characterPortrait(owner, id) && <small className="portrait-slot-uses">{uses.length ? `Used by ${uses.join(', ')}` : 'Not used by any account'}</small>}
      </button>
      {characterPortrait(owner, id) && <button type="button" className="portrait-slot-clear" onClick={() => onClear(id)}>Clear</button>}
    </div>;
  })}</div>;
}

function PortraitGallery({ owner, slot, onSelect }: { owner: ManagedOwner; slot: PortraitId; onSelect: (imageId: string) => void }) {
  if (!owner.images.length) return <p className="portrait-manager-empty">Add an image to the gallery first.</p>;
  return <div className="portrait-gallery">{owner.images.map((entry) => <button type="button" key={entry.id}
    aria-pressed={characterPortrait(owner, slot)?.imageId === entry.id} title={entry.description || entry.name} onClick={() => onSelect(entry.id)}>
    <img src={entry.dataUrl} alt={entry.description || entry.name} loading="lazy" /><span>{entry.name}</span>
  </button>)}</div>;
}

/** Framing dialog of the portrait manager; the phone embeds the same stage in its own screen. */
function ProfilePickDialog({ characterName, image, currentProfileImage, onApply, onClose }: {
  characterName: string;
  image: RpStorybookCharacterImage;
  currentProfileImage?: RpStorybookCharacterProfileImage;
  onApply: (profileImage: RpStorybookCharacterProfileImage) => void;
  onClose: () => void;
}) {
  const { stage, status, apply } = usePortraitCrop({ image, currentProfileImage, onApply });
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  return (
    <div className="profile-pick-backdrop" role="presentation" {...backdropDismiss}>
      <section className="profile-pick-dialog" role="dialog" aria-modal="true" aria-label={`Frame ${characterName}`}>
        <div className="profile-pick-header">
          <div>
            <h4>Frame {characterName}</h4>
            <p>{image.name} · Drag the circle over the face. Drag its handle to resize.</p>
          </div>
        </div>
        {status && <span className="run-note storybook-image-status">{status}</span>}
        {stage}
        <div className="profile-pick-actions">
          <button className="profile-pick-button" type="button" onClick={onClose}>Close</button>
          <button className="profile-pick-button primary" type="button" onClick={apply}>Apply</button>
        </div>
      </section>
    </div>
  );
}

/** Portrait authoring as a dialog, used by the Storybook and character editors. */
export function PortraitManager<T extends ManagedOwner>(props: PortraitManagerProps<T>) {
  const { owner, initialImageId, onClose } = props;
  const flow = usePortraitFlow(props);
  const dismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  return createPortal(<div className="profile-pick-backdrop" {...dismiss}>
    <section className="portrait-manager deep-dialog" role="dialog" aria-modal="true" aria-label="Manage portraits">
      <header className="portrait-manager-header">
        <div><span className="portrait-manager-eyebrow">Portraits</span><h4>{owner.name}</h4>
          <p>The character portrait shows the real character. Up to two custom portraits serve other identities. Every app account selects one of them.</p></div>
        <button type="button" className="close-button" autoFocus onClick={onClose}>Close</button>
      </header>
      {!flow.slot
        // An existing portrait reopens its framing; closing that leads to the gallery.
        ? <PortraitSlots owner={owner} onClear={flow.clear} onSelect={(id) => flow.selectSlot(id, initialImageId ?? characterPortrait(owner, id)?.imageId)} />
        : <>
          <div className="portrait-manager-toolbar">
            <button type="button" className="portrait-manager-button" onClick={flow.back}>← Portraits</button>
            <span>Choose a gallery image for {portraitLabels[flow.slot]}.</span>
          </div>
          <PortraitGallery owner={owner} slot={flow.slot} onSelect={flow.selectImage} />
        </>}
      {flow.error && <p className="portrait-manager-error" role="alert">{flow.error}</p>}
    </section>
    {flow.slot && flow.image && <ProfilePickDialog key={`${flow.slot}:${flow.image.id}`} characterName={portraitLabels[flow.slot]} image={flow.image}
      currentProfileImage={characterPortrait(owner, flow.slot)} onClose={flow.back} onApply={flow.apply} />}
  </div>, document.body);
}

function PhoneBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>;
}

function PhonePortraitFraming({ slot, image, current, onApply, onBack }: {
  slot: PortraitId; image: RpStorybookCharacterImage; current?: RpStorybookCharacterProfileImage;
  onApply: (portrait: RpStorybookCharacterProfileImage) => void; onBack: () => void;
}) {
  const { stage, status, apply } = usePortraitCrop({ image, currentProfileImage: current, onApply });
  return <>
    <header className="phone-gallery-header">
      <PhoneBackButton label="Back to portraits" onClick={onBack} />
      <div><span>Frame portrait</span><strong>{portraitLabels[slot]}</strong></div>
      <button type="button" className="phone-gallery-header-button primary" onClick={apply}>Apply</button>
    </header>
    <div className="phone-portrait-framing">
      <p>{status || 'Drag the circle over the face. Drag its handle to resize.'}</p>
      {stage}
    </div>
  </>;
}

/** The same authoring steps as screens inside the phone gallery, without a dialog. */
export function PhonePortraits<T extends ManagedOwner>(props: PortraitManagerProps<T>) {
  const { owner, initialImageId } = props;
  const flow = usePortraitFlow(props);
  if (flow.slot && flow.image) {
    return <PhonePortraitFraming key={`${flow.slot}:${flow.image.id}`} slot={flow.slot} image={flow.image}
      current={characterPortrait(owner, flow.slot)} onApply={flow.apply} onBack={flow.back} />;
  }
  const preselected = owner.images.find((entry) => entry.id === initialImageId);
  return <>
    <header className="phone-gallery-header">
      <PhoneBackButton label={flow.slot ? 'Back to portraits' : 'Back to gallery'} onClick={flow.back} />
      <div><span>Portraits</span><strong>{owner.name}</strong></div>
    </header>
    <div className="phone-portraits">
      <PortraitSlots owner={owner} selected={flow.slot} onClear={flow.clear} onSelect={(id) => flow.selectSlot(id, preselected?.id)} />
      {flow.error && <p className="portrait-manager-error" role="alert">{flow.error}</p>}
      {flow.slot ? <>
        <p className="phone-portraits-hint">Choose an image for {portraitLabels[flow.slot]}.</p>
        <PortraitGallery owner={owner} slot={flow.slot} onSelect={flow.selectImage} />
      </> : <p className="phone-portraits-hint">{preselected
        ? `Choose the portrait that should use ${preselected.name}.`
        : 'The character portrait shows the real character. Custom portraits serve other identities. Every app account selects one of them.'}</p>}
    </div>
  </>;
}
