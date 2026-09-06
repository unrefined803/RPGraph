import { datingAccountId } from '../../chat/datingAccounts';
import { matchMeState, canSendMatchMeMessage, incomingMatchMeMessage } from '../../chat/matchMe';
import type { MessageRecord, SocialDirectMessageRecord, SocialDmUnreadByHandle, SocialDirectMessageOpenRequest } from '../../types';
import { MatchMeConversation } from './MatchMeConversation';
import { useEffect, useRef, useState } from 'react';
import type { ChatImageAttachment } from '../../types';
import type { StorybookCharacter } from '../../storybook/runtime';
import { datingSeekingOrder, datingPhotoLimit, datingGenders, datingGenderLabels, datingSeekingLabels, normalizeDatingProfile, type DatingGender, type DatingProfile } from '../../chat/datingProfile';
import { PhoneGalleryScreen } from '../PhoneGalleryScreen';
import { NodeCustomSelect } from '../../nodes/shared/NodeCustomSelect';
import './phoneDating.css';

type Props = {
  owner?: StorybookCharacter;
  characters: StorybookCharacter[];
  unread: SocialDmUnreadByHandle;
  onMarkSeen: (id: string) => void;
  openRequest?: SocialDirectMessageOpenRequest;
  history: MessageRecord[];
  isRunning: boolean;
  onSendMessage: (message: SocialDirectMessageRecord, characterId: string) => Promise<boolean>;
  emojiOptions: string[];
  recentlyUsedEmojis: string[];
  images: ChatImageAttachment[];
  onImportImage: (request: { owner: StorybookCharacter; image: ChatImageAttachment }) => Promise<ChatImageAttachment | undefined>;
  onSave: (owner: StorybookCharacter, profile: DatingProfile) => boolean;
  onBack: () => void;
};

export function PhoneDatingScreen({ unread, onMarkSeen, openRequest, characters, history, isRunning, onSendMessage, owner, images, onImportImage, onSave, onBack, emojiOptions, recentlyUsedEmojis }: Props) {
  const [profile, setProfile] = useState(normalizeDatingProfile(owner?.social.plotTwist));
  const [editing, setEditing] = useState(!profile);
  const [tab, setTab] = useState<'discover' | 'likes' | 'profile'>('discover');
  const [draft, setDraft] = useState<DatingProfile>(profile ?? { name: owner?.name ?? '', age: 18, seeking: [], bio: '', interests: '', photoIds: [], decisions: {} });
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [recentEmojis, setRecentEmojis] = useState(recentlyUsedEmojis);
  const [gallery, setGallery] = useState(false);
  const [imported, setImported] = useState<ChatImageAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [photo, setPhoto] = useState(0);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(openRequest?.participantHandle);
  const [seenOpenRequest, setSeenOpenRequest] = useState(openRequest?.requestId);
  if (openRequest && seenOpenRequest !== openRequest.requestId) {
    setSeenOpenRequest(openRequest.requestId); setSelectedMatchId(openRequest.participantHandle); setEditing(false); setTab('discover');
  }
  useEffect(() => { if (selectedMatchId && !editing && tab === 'discover') onMarkSeen(selectedMatchId); }, [selectedMatchId, editing, tab, history, onMarkSeen]);
  const state = matchMeState(characters, history);
  const ownerId = owner ? datingAccountId(owner.id) : '';
  const availableProfiles = state.accounts.filter((account) => account.id !== ownerId);
  const matches = availableProfiles.filter((entry) => canSendMatchMeMessage(ownerId, entry.id, state));
  const [failedMessages, setFailedMessages] = useState<Record<string, SocialDirectMessageRecord>>({});
  const sending = useRef(false);
  const conversationMessages = (id: string) => history.flatMap((entry) => {
    const message = entry.socialDirectMessage;
    if (message?.app !== 'matchme' || !((message.fromAccountId === ownerId && message.toAccountId === id) ||
      (message.toAccountId === ownerId && message.fromAccountId === id))) return [];
    return [{ id: message.messageId, matchId: id, sender: message.fromAccountId === ownerId ? 'owner' as const : 'match' as const,
      text: message.displayText ?? message.text, sentAt: message.sentAt, demo: message.demo }];
  });
  async function send(id: string, retry = false) {
    if (!owner || isRunning || sending.current) return;
    const message = retry ? failedMessages[id] : incomingMatchMeMessage(ownerId, id, (chatDrafts[id] ?? '').trim(), state,
      `matchme-outgoing-${crypto.randomUUID()}`, new Date().toISOString());
    if (!message || !message.text) { setError('This conversation needs an active match.'); return; }
    sending.current = true; setBusy(true); setError('');
    setChatDrafts((current) => ({ ...current, [id]: '' }));
    try {
      const success = await onSendMessage(message, owner.id);
      setFailedMessages((current) => { const next = { ...current }; if (success) delete next[id]; else next[id] = message; return next; });
      if (!success) setError('No reply was delivered. Check the workflow diagnostics and retry.');
    } catch { setFailedMessages((current) => ({ ...current, [id]: message })); setError('Message failed. You can retry.'); }
    finally { sending.current = false; setBusy(false); }
  }
  const selectedMatch = matches.find((entry) => entry.id === selectedMatchId);
  const candidate = availableProfiles.find((entry) => !profile?.decisions[entry.id]);
  const allImages = [...images, ...imported];

  function save(next: DatingProfile) {
    if (!owner || !onSave(owner, next)) { setError('Could not save your profile. Please try again.'); return false; }
    setProfile(next); setDraft(next); setError(''); return true;
  }
  function decide(decision: 'like' | 'pass') {
    if (!profile || !candidate || selectedMatch || isRunning || busy) return;
    if (save({ ...profile, decisions: { ...profile.decisions, [candidate.id]: decision } })) {
      setPhoto(0); setNotice(decision === 'like' ? `You liked ${candidate.name}.` : `Passed on ${candidate.name}.`);
    }
  }
  function addPhoto(image: ChatImageAttachment) {
    setDraft((current) => ({ ...current, photoIds: [...new Set([...current.photoIds, image.id])].slice(0, datingPhotoLimit) }));
  }
  async function upload(file?: File) {
    if (!file || !owner) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    setBusy(true); setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const image = await onImportImage({ owner, image: { id: `upload-${Date.now()}`, name: file.name, mimeType: file.type, size: file.size, dataUrl } });
      if (!image) throw new Error('Import failed');
      setImported((current) => [...current, image]); addPhoto(image);
    } catch { setError('Could not import this photo. Please try another image.'); }
    finally { setBusy(false); }
  }

  if (gallery) return <PhoneGalleryScreen title={`${owner?.name ?? 'Character'}’s photos`} images={images} action="select"
    onBack={() => setGallery(false)} onSelectImage={(image) => { addPhoto(image); setGallery(false); }} />;

  return <div className="pt-app">
    <header className="pt-header"><button type="button" onClick={onBack} aria-label="Back to phone">‹</button>
      <strong><svg className="pt-brand-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 13.5c1.2-1.3 1.8-2.7 1.8-3.9A4.1 4.1 0 0 0 12 6.9a4.1 4.1 0 0 0-8.8 2.7c0 1.2.6 2.6 1.8 3.9l7 6.8Z" /></svg>MatchMe</strong></header>
    <div className="pt-layout">
      {profile && <aside className="pt-matches" aria-label="Matches">
        <h2>Matches <span>{matches.length}</span></h2>
        <p className="pt-subtle">Your mutual connections</p>
        <div className="pt-match-list">
          {matches.map((match) => <button type="button" key={match.id} className={`pt-match${selectedMatchId === match.id && tab === 'discover' && !editing ? ' active' : ''}`}
            onClick={() => { setSelectedMatchId(match.id); setPhoto(0); setTab('discover'); setEditing(false); }}>
            <span className="pt-match-avatar" aria-hidden="true">{match.name[0]}</span>
            <span><strong>{match.name}<span className="pt-match-age">, {match.age}</span>{unread[match.id]?.count ? ` · ${unread[match.id].count} new` : ''}</strong><small>{conversationMessages(match.id).slice(-1)[0]?.text ?? 'Say hello'}</small></span>
          </button>)}
          {!matches.length && <p className="pt-subtle pt-match-empty">Like a profile to create a match and start a conversation.</p>}
        </div>
      </aside>}
    <main className={`pt-main${selectedMatch && !editing ? ' pt-chat-main' : ''}`}>
      {!owner ? <div className="pt-empty"><h2>Who’s holding the phone?</h2><p>Select a Storybook character to create a profile.</p></div> : editing ?
        <form className="pt-form" onSubmit={(event) => {
          event.preventDefault();
          if (!draft.gender || !draft.seeking?.length) {
            setError('Choose your gender and at least one gender you would like to meet.'); return;
          }
          const normalized = normalizeDatingProfile(draft);
          if (!normalized) { setError('Add a name, age (18–120), bio, and at least one photo.'); return; }
          if (save(normalized)) { setEditing(false); setTab('discover'); }
        }}>
          <div className="pt-intro"><span className="pt-eyebrow">A NEW CHAPTER STARTS HERE</span>
            <h2>{profile ? 'Make it you.' : 'Find your match.'}</h2></div>
          <div className="pt-field-row"><label>Display name<input required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Age<input required type="number" min={18} max={120} value={draft.age || ''} onChange={(e) => setDraft({ ...draft, age: Number(e.target.value) })} /></label></div>
          <div className="pt-gender-field"><label htmlFor="matchme-gender">I am</label>
            <NodeCustomSelect<DatingGender | ''> id="matchme-gender" value={draft.gender ?? ''}
              onChange={(gender) => { if (gender) setDraft({ ...draft, gender, seeking: [datingSeekingOrder(gender)[0]] }); }}
              options={[{ value: '', label: 'Select your gender', disabled: true }, ...datingGenders.map((gender) => ({ value: gender, label: datingGenderLabels[gender] }))]} />
          </div>
          <fieldset className="pt-seeking"><legend>I would like to meet</legend>
            <p className="pt-subtle">Choose one or more. Select all for everyone.</p>
            <div className="pt-seeking-options">{datingSeekingOrder(draft.gender).map((gender) => <label key={gender} className={draft.seeking?.includes(gender) ? 'selected' : ''}>
              <input type="checkbox" checked={draft.seeking?.includes(gender) ?? false}
                onChange={(event) => setDraft({ ...draft, seeking: event.target.checked
                  ? [...(draft.seeking ?? []), gender] : (draft.seeking ?? []).filter((entry) => entry !== gender) })} />
              {datingSeekingLabels[gender]}
            </label>)}</div>
          </fieldset>
          <label>About you<textarea required maxLength={500} rows={3} placeholder="A little about your character…" value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></label>
          <label>Interests<input maxLength={150} placeholder="Coffee, late-night walks, side quests" value={draft.interests} onChange={(e) => setDraft({ ...draft, interests: e.target.value })} /></label>
          <div><div className="pt-photo-heading"><strong>Your photos</strong><small>{draft.photoIds.length}/{datingPhotoLimit} · At least one required</small></div>
            <div className="pt-photos">{draft.photoIds.map((id, index) => {
              const image = allImages.find((entry) => entry.id === id);
              return <div className="pt-photo" key={id}>{image ? <img src={image.dataUrl} alt={`Profile photo ${index + 1}`} /> : <span>Photo unavailable</span>}
                {index === 0 ? <small>MAIN</small> : <button className="pt-set-main" type="button" onClick={() => setDraft({ ...draft, photoIds: [id, ...draft.photoIds.filter((entry) => entry !== id)] })}>Make main</button>}<button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setDraft({ ...draft, photoIds: draft.photoIds.filter((entry) => entry !== id) })}>×</button></div>;
            })}</div>
            <div className="pt-photo-actions"><button type="button" disabled={busy || draft.photoIds.length >= datingPhotoLimit} onClick={() => uploadRef.current?.click()}>{busy ? 'Importing…' : '↑ Upload photo'}</button>
              <button type="button" disabled={busy || draft.photoIds.length >= datingPhotoLimit} onClick={() => setGallery(true)}>▧ Character album</button></div>
            <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <p className="pt-subtle">A local character account. No email or password needed. Uploaded photos are saved to the character’s album.</p>
          <button className="pt-primary" disabled={busy} type="submit">{profile ? 'Save profile' : 'Create account & explore'} <span aria-hidden="true">→</span></button>
          {profile && <button type="button" disabled={busy} onClick={() => { setDraft(profile); setEditing(false); }}>Cancel</button>}
        </form> : selectedMatch && profile ? <MatchMeConversation key={selectedMatch.id}
          name={selectedMatch.name} age={selectedMatch.age} messages={conversationMessages(selectedMatch.id)}
          busy={busy || isRunning}
          draft={chatDrafts[selectedMatch.id] ?? ''}
          onDraftChange={(text) => setChatDrafts((current) => ({ ...current, [selectedMatch.id]: text }))}
          emojiOptions={emojiOptions} recentEmojis={recentEmojis}
          onUseEmoji={(emoji) => setRecentEmojis((current) => [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, 8))}
          onBack={() => { setSelectedMatchId(undefined); setPhoto(0); }}
          onSend={() => { void send(selectedMatch.id); }} /> : tab === 'discover' ? <div className="pt-discover">
          <div className="pt-section-heading"><div><span className="pt-eyebrow">A LITTLE CHEMISTRY?</span><h2>Discover</h2></div><span className="pt-preview">Available profiles</span></div>
          {candidate ? <>
            <article className={`pt-card pt-${candidate.color}`} style={{ transform: `translateX(${drag}px) rotate(${drag / 22}deg)` }}
              onPointerDown={(event) => { if (selectedMatch || (event.target instanceof Element && event.target.closest('button'))) return; start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (start.current) setDrag(Math.max(-130, Math.min(130, event.clientX - start.current.x))); }}
              onPointerUp={(event) => { const origin = start.current; start.current = null; setDrag(0); if (origin && Math.abs(event.clientY - origin.y) < 90 && Math.abs(event.clientX - origin.x) > 65) decide(event.clientX > origin.x ? 'like' : 'pass'); }}
              onPointerCancel={() => { start.current = null; setDrag(0); }}>
              <div className="pt-photo-progress">{[0, 1, 2].map((index) => <button key={index} type="button" aria-label={`Show image ${index + 1}`} aria-pressed={photo === index} className={photo === index ? 'active' : ''} onClick={() => setPhoto(index)} />)}</div>
              <div className="pt-placeholder"><span aria-hidden="true">✧</span><strong>Image {photo + 1}</strong><small>A face for this story, coming soon.</small></div>
              <div className="pt-image-nav"><button type="button" aria-label="Previous image" onClick={() => setPhoto((photo + 2) % 3)}>‹</button><button type="button" aria-label="Next image" onClick={() => setPhoto((photo + 1) % 3)}>›</button></div>
              {!!drag && <span className="pt-swipe-label">{drag > 0 ? 'LIKE' : 'PASS'}</span>}
              <div className="pt-card-info"><small>{candidate.characterId ? 'STORYBOOK CHARACTER' : 'FICTIONAL NPC'}</small><h3>{candidate.name} <span>{candidate.age}</span></h3><p>{candidate.bio}</p><div className="pt-tags">{candidate.interests.map((interest) => <span key={interest}>{interest}</span>)}</div></div>
            </article>
            <div className="pt-decisions"><button type="button" aria-label={`Pass on ${candidate.name}`} onClick={() => decide('pass')}>×</button><span>Swipe to find your story</span><button type="button" aria-label={`Like ${candidate.name}`} onClick={() => decide('like')}>♥</button></div>
          </> : <div className="pt-empty"><span className="pt-empty-heart">✧</span><h2>You’re all caught up.</h2><p>You have seen all available profiles. You can explore them again.</p><button type="button" className="pt-primary" onClick={() => { if (profile) save({ ...profile, decisions: {} }); setPhoto(0); }}>Explore again</button></div>}
        </div> : tab === 'likes' ? <div className="pt-list"><span className="pt-eyebrow">YOUR MAYBES & WHAT-IFS</span><h2>People you like</h2><p className="pt-subtle">Likes are saved for this character. Every like creates a mutual match. Open a match to start chatting.</p>
          {availableProfiles.filter((entry) => profile?.decisions[entry.id] === 'like').map((entry) => <div className="pt-like" key={entry.id}><span aria-hidden="true">♥</span><div><strong>{entry.name}, {entry.age}</strong><small>Liked by you</small></div></div>)}
          {!Object.values(profile?.decisions ?? {}).includes('like') && <div className="pt-empty"><h3>A little spark starts here.</h3><p>Like someone in Discover to see them here.</p></div>}
        </div> : <div className="pt-list"><span className="pt-eyebrow">THE MAIN CHARACTER</span><h2>{profile?.name}, {profile?.age}</h2><div className="pt-profile-photos">{profile?.photoIds.map((id, index) => { const image = allImages.find((entry) => entry.id === id); return image ? <img key={id} src={image.dataUrl} alt={`Your profile photo ${index + 1}`} /> : <span key={id}>Photo unavailable</span>; })}</div><dl className="pt-profile-details"><div><dt>I am</dt><dd>{profile?.gender ? datingGenderLabels[profile.gender] : 'Not specified'}</dd></div>
          <div><dt>I would like to meet</dt><dd>{profile?.seeking?.length ? profile.seeking.map((gender) => datingSeekingLabels[gender]).join(', ') : 'Not specified'}</dd></div></dl>
          <p>{profile?.bio}</p><p className="pt-subtle">{profile?.interests}</p><button type="button" className="pt-primary" onClick={() => { if (profile) setDraft(profile); setEditing(true); }}>Edit profile</button><p className="pt-subtle">Saved in {owner.name}’s Storybook profile.</p></div>}
      {selectedMatch && failedMessages[selectedMatch.id] && <button type="button" disabled={busy || isRunning} onClick={() => { void send(selectedMatch.id, true); }}>Retry reply</button>}
      {error && <p className="pt-error" role="alert">{error}</p>}
      <span className="pt-sr-only" role="status">{notice}</span>
    </main>
    </div>
    {profile && !editing && <nav className="pt-tabs" aria-label="MatchMe navigation">{(['discover', 'likes', 'profile'] as const).map((item) => <button type="button" key={item} className={tab === item ? 'active' : ''} aria-current={tab === item ? 'page' : undefined} onClick={() => { setTab(item); setSelectedMatchId(undefined); setPhoto(0); }}><span aria-hidden="true">{item === 'discover' ? '✧' : item === 'likes' ? '♡' : '◎'}</span>{item === 'discover' ? 'Discover' : item === 'likes' ? 'Likes' : 'My profile'}</button>)}</nav>}
  </div>;
}
