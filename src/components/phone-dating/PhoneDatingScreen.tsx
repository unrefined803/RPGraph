import { CharacterAvatar } from '../CharacterAvatar';
import { datingAccountId, resolveDatingAccount, datingFirstName, datingAvatarDataUrl } from '../../chat/datingAccounts';
import { matchMeDecision, matchMeLikePolicy, matchMeState, canSendMatchMeMessage, incomingMatchMeMessage } from '../../chat/matchMe';
import type { MessageRecord, RpDateTimeFormat, RpWeekdayLanguage, SocialDirectMessageRecord, SocialDmUnreadByHandle, SocialDirectMessageOpenRequest } from '../../types';
import { MatchMeConversation } from './MatchMeConversation';
import { useEffect, useRef, useState } from 'react';
import type { ChatImageAttachment } from '../../types';
import type { StorybookCharacter } from '../../storybook/runtime';
import { datingSeekingOrder, datingPhotoLimit, datingGenders, datingGenderLabels, datingSeekingLabels, normalizeDatingProfile, resetDatingPasses, type DatingGender, type DatingProfile } from '../../chat/datingProfile';
import { PhoneGalleryScreen } from '../PhoneGalleryScreen';
import { NodeCustomSelect } from '../../nodes/shared/NodeCustomSelect';
import './phoneDating.css';

type Props = {
  profileOnly?: boolean;
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
  rpTimeTrackingEnabled?: boolean;
  rpDateTimeFormat?: RpDateTimeFormat;
  rpWeekdayLanguage?: RpWeekdayLanguage;
  images: ChatImageAttachment[];
  onImportImage: (request: { owner: StorybookCharacter; image: ChatImageAttachment }) => Promise<ChatImageAttachment | undefined>;
  onSave: (owner: StorybookCharacter, profile: DatingProfile) => boolean;
  onBack: () => void;
};

export function PhoneDatingScreen({ profileOnly = false, unread, onMarkSeen, openRequest, characters, history, isRunning, onSendMessage, owner, images, onImportImage, onSave, onBack, emojiOptions, recentlyUsedEmojis, rpTimeTrackingEnabled = false, rpDateTimeFormat = 'eu', rpWeekdayLanguage = 'system' }: Props) {
  const [profile, setProfile] = useState(normalizeDatingProfile(owner?.social.plotTwist));
  const [editing, setEditing] = useState(profileOnly || !profile);
  const [tab, setTab] = useState<'discover' | 'likes' | 'profile'>('discover');
  const [draft, setDraft] = useState<DatingProfile>(profile ?? normalizeDatingProfile({ ...owner?.apps?.matchme?.profile, name: owner?.apps?.matchme?.profileName ?? owner?.apps?.matchme?.profile?.name ?? owner?.name }, true) ?? { name: owner?.name ?? '', age: owner?.age && owner.age >= 18 && owner.age <= 120 ? owner.age : 18, gender: owner?.gender, seeking: [], bio: '', interests: '', photoIds: [], decisions: {} });
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [recentEmojis, setRecentEmojis] = useState(recentlyUsedEmojis);
  const [gallery, setGallery] = useState(false);
  const [imported, setImported] = useState<ChatImageAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [celebration, setCelebration] = useState<{ id: string; name: string; superlike: boolean }>();
  const [photo, setPhoto] = useState(0);
  const [drag, setDrag] = useState(0);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | undefined>();
  const [previewPhoto, setPreviewPhoto] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const discoverRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const decisionsRef = useRef<HTMLDivElement>(null);
  const [discoverScale, setDiscoverScale] = useState(1);
  const [isScrollMode, setIsScrollMode] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(openRequest?.participantHandle);
  const [seenOpenRequest, setSeenOpenRequest] = useState(openRequest?.requestId);
  if (openRequest && seenOpenRequest !== openRequest.requestId) {
    setSeenOpenRequest(openRequest.requestId); setSelectedMatchId(openRequest.participantHandle); setEditing(false); setTab('discover');
  }
  useEffect(() => { if (selectedMatchId && !editing && tab === 'discover') onMarkSeen(selectedMatchId); }, [selectedMatchId, editing, tab, history, onMarkSeen]);
  useEffect(() => {
    if (editing || selectedMatchId || (tab !== 'discover' && !previewCandidateId)) return;
    const el = mainRef.current;
    if (!el) return;

    function evaluateScale() {
      if (!el) return;
      const style = window.getComputedStyle(el);
      const paddingTop = parseFloat(style.paddingTop) || 14;
      const paddingBottom = parseFloat(style.paddingBottom) || 14;
      const availContentHeight = el.clientHeight - paddingTop - paddingBottom;

      const headingH = headingRef.current ? headingRef.current.offsetHeight + (parseFloat(window.getComputedStyle(headingRef.current).marginBottom) || 0) : 46;
      const decisionsH = decisionsRef.current ? decisionsRef.current.offsetHeight : 76;
      const discoverP = discoverRef.current ? (parseFloat(window.getComputedStyle(discoverRef.current).paddingTop) || 0) + (parseFloat(window.getComputedStyle(discoverRef.current).paddingBottom) || 0) : 12;

      const nonCardHeight = headingH + decisionsH + discoverP;
      const baseCardHeight = 420 * 1.5; // 630px

      // Available height specifically for the card
      const availForCard = availContentHeight - nonCardHeight - 2;

      if (availForCard >= baseCardHeight) {
        setDiscoverScale(1);
        setIsScrollMode(false);
      } else {
        const scaleNeeded = availForCard / baseCardHeight;
        if (scaleNeeded >= 0.88) {
          setDiscoverScale(Math.min(1, Math.max(0.88, scaleNeeded)));
          setIsScrollMode(false);
        } else {
          setDiscoverScale(1);
          setIsScrollMode(true);
        }
      }
    }

    evaluateScale();
    const ro = new ResizeObserver(evaluateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab, editing, selectedMatchId, previewCandidateId]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      if (celebration) {
        event.preventDefault();
        setCelebration(undefined);
        return;
      }
      if (gallery) {
        event.preventDefault();
        setGallery(false);
        return;
      }
      if (previewCandidateId) {
        event.preventDefault();
        setPreviewCandidateId(undefined);
        setPreviewPhoto(0);
        return;
      }
      if (editing) {
        event.preventDefault();
        if (profile) {
          setDraft(profile);
          setEditing(false);
        } else {
          onBack();
        }
        return;
      }
      if (selectedMatchId) {
        event.preventDefault();
        setSelectedMatchId(undefined);
        setPhoto(0);
        setTab('discover');
        return;
      }
      if (tab === 'likes' || tab === 'profile') {
        event.preventDefault();
        setTab('discover');
        setPhoto(0);
        return;
      }
      if (tab === 'discover') {
        event.preventDefault();
        onBack();
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [celebration, gallery, previewCandidateId, editing, profile, selectedMatchId, tab, onBack]);
  const state = matchMeState(characters, history);
  const ownerId = owner ? datingAccountId(owner) : '';
  const availableProfiles = state.accounts.filter((account) => account.id !== ownerId);
  const matches = availableProfiles.filter((entry) => canSendMatchMeMessage(ownerId, entry.id, state));
  const [failedMessages, setFailedMessages] = useState<Record<string, SocialDirectMessageRecord>>({});
  const sending = useRef(false);
  const conversationMessages = (id: string) => history.flatMap((entry) => {
    const original = entry.socialDirectMessage;
    const message = original?.app === 'matchme' ? { ...original,
      fromAccountId: resolveDatingAccount(original.fromAccountId ?? '', state.accounts)?.id,
      toAccountId: resolveDatingAccount(original.toAccountId ?? '', state.accounts)?.id } : original;
    if (message?.app !== 'matchme' || !((message.fromAccountId === ownerId && message.toAccountId === id) ||
      (message.toAccountId === ownerId && message.fromAccountId === id))) return [];
    return [{ id: message.messageId, matchId: id, sender: message.fromAccountId === ownerId ? 'owner' as const : 'match' as const,
      text: message.displayText ?? message.text, accountLinks: message.accountLinks, sentAt: message.sentAt,
      rpDateTime: entry.rpDateTime, demo: message.demo }];
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
  const selectedMatch = matches.find((entry) => entry.id === resolveDatingAccount(selectedMatchId ?? '', state.accounts)?.id);
  const decisionFor = (id: string) => matchMeDecision(profile?.decisions, id, state);
  const likedProfiles = availableProfiles.filter((entry) => ['like', 'superlike'].includes(decisionFor(entry.id) ?? ''));
  const linkedCandidate = availableProfiles.find((entry) => entry.id === selectedMatchId && !decisionFor(entry.id) && !canSendMatchMeMessage(ownerId, entry.id, state));
  const candidate = linkedCandidate ?? availableProfiles.find((entry) =>
    (!profile?.seeking?.length || !!entry.gender && profile.seeking.includes(entry.gender)) &&
    !decisionFor(entry.id) && !canSendMatchMeMessage(ownerId, entry.id, state));
  const candidatePhotoCount = candidate?.photos?.length ?? 0;
  const previewCandidate = previewCandidateId ? availableProfiles.find((entry) => entry.id === previewCandidateId) : undefined;
  const previewPhotoCount = previewCandidate?.photos?.length ?? 0;
  const allImages = [...images, ...imported];
  const ownerAvatarDataUrl = datingAvatarDataUrl(owner, allImages, profile);

  function save(next: DatingProfile) {
    if (!owner || !onSave(owner, next)) { setError('Could not save your profile. Please try again.'); return false; }
    setProfile(next); setDraft(next); setError(''); return true;
  }
  function decide(decision: 'like' | 'superlike' | 'pass', target = candidate) {
    if (!profile || !target || isRunning || busy || celebration) return;
    const previous = decisionFor(target.id);
    if (canSendMatchMeMessage(ownerId, target.id, state) ||
      (previous && !(previous === 'like' && decision === 'superlike'))) return;
    const match = decision !== 'pass' && matchMeLikePolicy(ownerId, target.id, state, new Date().toISOString(), decision);
    if (save({ ...profile, decisions: { ...profile.decisions, [target.id]: decision } })) {
      setSelectedMatchId(undefined); setPreviewCandidateId(undefined); setPhoto(0);
      if (match) setCelebration({ id: target.id, name: target.name, superlike: decision === 'superlike' });
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
    <header className="pt-header">
      <button type="button" className="pt-back-btn" onClick={() => {
        if (previewCandidate) {
          setPreviewCandidateId(undefined);
          setPreviewPhoto(0);
        } else {
          onBack();
        }
      }} aria-label={previewCandidate ? 'Back to Likes' : 'Back to phone'}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <strong>
        <svg className="pt-brand-heart" viewBox="0 0 24 24" fill="url(#pt-brand-grad)" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <defs>
            <linearGradient id="pt-brand-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f43f6e" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <path d="M19 13.5c1.2-1.3 1.8-2.7 1.8-3.9A4.1 4.1 0 0 0 12 6.9a4.1 4.1 0 0 0-8.8 2.7c0 1.2.6 2.6 1.8 3.9l7 6.8Z" />
        </svg>
        <span>MatchMe</span>
      </strong>
    </header>
    <div className="pt-layout">
      {profile && !profileOnly && <aside className="pt-matches" aria-label="Matches">
        <h2>Matches <span>{matches.length}</span></h2>
        <p className="pt-subtle">Your connections</p>
        <div className="pt-match-list">
          {matches.map((match) => <button type="button" key={match.id} className={`pt-match${selectedMatchId === match.id && tab === 'discover' && !editing ? ' active' : ''}`}
            onClick={() => { setSelectedMatchId(match.id); setPreviewCandidateId(undefined); setPreviewPhoto(0); setPhoto(0); setTab('discover'); setEditing(false); }}>
            <CharacterAvatar className="pt-match-avatar" name={datingFirstName(match.name)} profileImageDataUrl={match.avatarDataUrl} fallback={datingFirstName(match.name).slice(0, 1)} />
            <span><strong>{datingFirstName(match.name)}<span className="pt-match-age">, {match.age}</span></strong>
              {unread[match.id]?.count ? <small className="pt-match-unread"><span>New Message</span><span className="pt-match-unread-badge" aria-label={`${unread[match.id].count} unread messages`}>{unread[match.id].count}</span></small>
                : <small>{conversationMessages(match.id).slice(-1)[0]?.text ?? 'Say hello'}</small>}
            </span>
          </button>)}
          {!matches.length && <p className="pt-subtle pt-match-empty">Match through mutual likes, or send a Superlike to chat immediately.</p>}
        </div>
      </aside>}
    <main ref={mainRef} className={`pt-main${selectedMatch && !editing ? ' pt-chat-main' : !editing && tab === 'discover' ? ` pt-discover-main${isScrollMode ? ' pt-scroll-mode' : ''}` : ''}`}>
      {!owner ? <div className="pt-empty"><h2>Who’s holding the phone?</h2><p>Select a Storybook character to create a profile.</p></div> : editing ?
        <form className="pt-form pt-form-compact" onSubmit={(event) => {
          event.preventDefault();
          if (!draft.gender || !draft.seeking?.length) {
            setError('Choose your gender and at least one gender you would like to meet.'); return;
          }
          const normalized = normalizeDatingProfile(draft);
          if (!normalized) { setError('Add a name, age (18–120), bio, and at least one photo.'); return; }
          if (save(normalized)) { setEditing(false); setTab('discover'); }
        }}>
          <div className="pt-intro pt-intro-compact">
            <h2>{profile ? 'Make it you.' : 'Find your match.'}</h2>
            <span className="pt-eyebrow">A NEW CHAPTER</span>
          </div>
          <div className="pt-form-section">
            <div className="pt-trio-row">
              <div className="pt-gender-field">
                <label htmlFor="matchme-gender">I am</label>
                <NodeCustomSelect<DatingGender | ''> id="matchme-gender" value={draft.gender ?? ''}
                  onChange={(gender) => { if (gender) setDraft({ ...draft, gender, seeking: [datingSeekingOrder(gender)[0]] }); }}
                  options={[{ value: '', label: 'Select…', disabled: true }, ...datingGenders.map((gender) => ({ value: gender, label: datingGenderLabels[gender] }))]} />
              </div>
              <label className="pt-name-label">Name<input required maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label>Age<input required type="number" min={18} max={120} value={draft.age || ''} onChange={(e) => setDraft({ ...draft, age: Number(e.target.value) })} /></label>
            </div>
            <fieldset className="pt-seeking pt-seeking-compact"><legend>I would like to meet</legend>
              <div className="pt-seeking-options">{datingSeekingOrder(draft.gender).map((gender) => <label key={gender} className={draft.seeking?.includes(gender) ? 'selected' : ''}>
                <input type="checkbox" checked={draft.seeking?.includes(gender) ?? false}
                  onChange={(event) => setDraft({ ...draft, seeking: event.target.checked
                    ? [...(draft.seeking ?? []), gender] : (draft.seeking ?? []).filter((entry) => entry !== gender) })} />
                {datingSeekingLabels[gender]}
              </label>)}</div>
            </fieldset>
          </div>

          <hr className="pt-form-divider" />

          <div className="pt-form-section">
            <label>About you<textarea required maxLength={500} rows={2} placeholder="A little about your character…" value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></label>
            <label>Interests<input maxLength={150} placeholder="Coffee, late-night walks, side quests" value={draft.interests} onChange={(e) => setDraft({ ...draft, interests: e.target.value })} /></label>
          </div>

          <hr className="pt-form-divider" />

          <div className="pt-form-section">
            <div className="pt-photo-section"><div className="pt-photo-heading"><strong>Your photos</strong><small>{draft.photoIds.length}/{datingPhotoLimit} · Min. 1 photo</small></div>
              <div className="pt-photos">{draft.photoIds.map((id, index) => {
                const image = allImages.find((entry) => entry.id === id);
                return <div className="pt-photo" key={id}>{image ? <img src={image.dataUrl} alt={`Profile photo ${index + 1}`} /> : <span>Photo unavailable</span>}
                  {index === 0 ? <small>MAIN</small> : <button className="pt-set-main" type="button" onClick={() => setDraft({ ...draft, photoIds: [id, ...draft.photoIds.filter((entry) => entry !== id)] })}>Make main</button>}
                  <button type="button" className="pt-photo-remove" aria-label={`Remove photo ${index + 1}`} onClick={() => setDraft({ ...draft, photoIds: draft.photoIds.filter((entry) => entry !== id) })}>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>;
              })}</div>
              <div className="pt-photo-actions"><button type="button" disabled={profileOnly || busy || draft.photoIds.length >= datingPhotoLimit} onClick={() => uploadRef.current?.click()}>{busy ? 'Importing…' : '↑ Upload'}</button>
                <button type="button" disabled={busy || draft.photoIds.length >= datingPhotoLimit} onClick={() => setGallery(true)}>▧ Character album</button></div>
              <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>

          <hr className="pt-form-divider" />

          <div className="pt-form-spacer" />

          <div className="pt-form-actions">
            <button className="pt-primary pt-save-btn" disabled={busy} type="submit">{profile ? 'Save profile' : 'Create account & explore'} <span aria-hidden="true">→</span></button>
            {profile && <button type="button" className="pt-cancel-btn" disabled={busy} onClick={() => { setDraft(profile); setEditing(false); }}>Cancel</button>}
          </div>
        </form> : selectedMatch && profile ? <MatchMeConversation key={selectedMatch.id} owner={owner} partner={characters.find((character) => character.id === selectedMatch.characterId)}
          name={datingFirstName(selectedMatch.name)} avatarDataUrl={selectedMatch.avatarDataUrl} age={selectedMatch.age} messages={conversationMessages(selectedMatch.id)}
          busy={busy || isRunning}
          draft={chatDrafts[selectedMatch.id] ?? ''}
          onDraftChange={(text) => setChatDrafts((current) => ({ ...current, [selectedMatch.id]: text }))}
          emojiOptions={emojiOptions} recentEmojis={recentEmojis}
          rpTimeTrackingEnabled={rpTimeTrackingEnabled} rpDateTimeFormat={rpDateTimeFormat} rpWeekdayLanguage={rpWeekdayLanguage}
          onUseEmoji={(emoji) => setRecentEmojis((current) => [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, 8))}
          onBack={() => { setSelectedMatchId(undefined); setPhoto(0); }}
          onSend={() => { void send(selectedMatch.id); }} /> : tab === 'discover' ? <div ref={discoverRef} className="pt-discover" style={{ maxWidth: `${Math.round(420 * discoverScale)}px` }}>
          <div ref={headingRef} className="pt-section-heading"><div><span className="pt-eyebrow">A LITTLE CHEMISTRY?</span><h2>Discover</h2></div><span className="pt-preview">Available profiles</span></div>
          {candidate ? <>
            <article className={`pt-card pt-${candidate.color}`} style={{ transform: `translateX(${drag}px) rotate(${drag / 22}deg)` }}
              onPointerDown={(event) => { if (selectedMatch || (event.target instanceof Element && event.target.closest('button'))) return; start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { if (start.current) setDrag(Math.max(-130, Math.min(130, event.clientX - start.current.x))); }}
              onPointerUp={(event) => { const origin = start.current; start.current = null; setDrag(0); if (origin && Math.abs(event.clientY - origin.y) < 90 && Math.abs(event.clientX - origin.x) > 65) decide(event.clientX > origin.x ? 'like' : 'pass'); }}
              onPointerCancel={() => { start.current = null; setDrag(0); }}>
              {candidatePhotoCount > 1 && <div className="pt-photo-progress">{(candidate.photos ?? []).map((_, index) => <button key={index} type="button" aria-label={`Show image ${index + 1}`} aria-pressed={photo === index} className={photo === index ? 'active' : ''} onClick={() => setPhoto(index)} />)}</div>}
              <div className="pt-placeholder">{candidate.photos?.length ? <img className="pt-discovery-photo" src={candidate.photos[photo % candidate.photos.length].dataUrl} alt={candidate.photos[photo % candidate.photos.length].description || `${datingFirstName(candidate.name)}, photo ${photo + 1}`} /> : <><span aria-hidden="true">✧</span><small>Photo unavailable</small></>}</div>
              {candidatePhotoCount > 1 && <div className="pt-image-nav"><button type="button" aria-label="Previous image" onClick={() => setPhoto((photo + candidatePhotoCount - 1) % candidatePhotoCount)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button><button type="button" aria-label="Next image" onClick={() => setPhoto((photo + 1) % candidatePhotoCount)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button></div>}
              {Math.abs(drag) >= 8 && <span className={`pt-swipe-label ${drag > 0 ? 'like' : 'pass'}`} style={{ opacity: Math.min(1, Math.abs(drag) / 35) }}>{drag > 0 ? 'LIKE' : 'PASS'}</span>}
              <div className="pt-card-info"><h3>{datingFirstName(candidate.name)}<span>, {candidate.age}</span></h3><p>{candidate.bio}</p><div className="pt-tags">{candidate.interests.map((interest) => <span key={interest}>{interest}</span>)}</div></div>
            </article>
            <div ref={decisionsRef} className="pt-decisions">
              <button className="pt-pass" type="button" disabled={busy || isRunning} aria-label={`Pass on ${datingFirstName(candidate.name)}`} title="Pass" onClick={() => decide('pass')}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button className="pt-like-action" type="button" disabled={busy || isRunning} aria-label={`Like ${datingFirstName(candidate.name)}`} title="Like · Chat when they like you back" onClick={() => decide('like')}>
                <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" stroke="none" aria-hidden="true">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </button>
              <button className="pt-superlike-action" type="button" disabled={busy || isRunning} aria-label={`Superlike ${datingFirstName(candidate.name)}`} title="Superlike · Chat immediately" onClick={() => decide('superlike')}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="none" aria-hidden="true">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            </div>
          </> : <div className="pt-empty"><span className="pt-empty-heart">✧</span><h2>You’re all caught up.</h2><p>You have seen all available profiles. Explore passed profiles again; your likes stay saved.</p><button type="button" className="pt-primary" onClick={() => { if (profile) save({ ...profile, decisions: resetDatingPasses(profile.decisions) }); setSelectedMatchId(undefined); setPhoto(0); }}>Explore again</button></div>}
        </div> : tab === 'likes' ? (
          previewCandidate ? (
            <div className="pt-discover pt-candidate-preview" style={{ maxWidth: `${Math.round(420 * discoverScale)}px` }}>
              <div className="pt-section-heading">
                <div>
                  <span className="pt-eyebrow">PROFILE PREVIEW</span>
                  <h2>{datingFirstName(previewCandidate.name)}</h2>
                </div>
                <span className="pt-preview">{canSendMatchMeMessage(ownerId, previewCandidate.id, state) ? 'Active Match' : 'Liked Profile'}</span>
              </div>
              <article className={`pt-card pt-${previewCandidate.color}`}>
                {previewPhotoCount > 1 && (
                  <div className="pt-photo-progress">
                    {(previewCandidate.photos ?? []).map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={`Show image ${index + 1}`}
                        aria-pressed={previewPhoto === index}
                        className={previewPhoto === index ? 'active' : ''}
                        onClick={() => setPreviewPhoto(index)}
                      />
                    ))}
                  </div>
                )}
                <div className="pt-placeholder">
                  {previewCandidate.photos?.length ? (
                    <img
                      className="pt-discovery-photo"
                      src={previewCandidate.photos[previewPhoto % previewCandidate.photos.length].dataUrl}
                      alt={previewCandidate.photos[previewPhoto % previewCandidate.photos.length].description || `${datingFirstName(previewCandidate.name)}, photo ${previewPhoto + 1}`}
                    />
                  ) : (
                    <>
                      <span aria-hidden="true">✧</span>
                      <small>Photo unavailable</small>
                    </>
                  )}
                </div>
                {previewPhotoCount > 1 && (
                  <div className="pt-image-nav">
                    <button type="button" aria-label="Previous image" onClick={() => setPreviewPhoto((previewPhoto + previewPhotoCount - 1) % previewPhotoCount)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
                    </button>
                    <button type="button" aria-label="Next image" onClick={() => setPreviewPhoto((previewPhoto + 1) % previewPhotoCount)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
                    </button>
                  </div>
                )}
                <div className="pt-card-info">
                  <h3>{datingFirstName(previewCandidate.name)}<span>, {previewCandidate.age}</span></h3>
                  <p>{previewCandidate.bio}</p>
                  <div className="pt-tags">
                    {previewCandidate.interests.map((interest) => <span key={interest}>{interest}</span>)}
                  </div>
                </div>
              </article>
              <div className="pt-preview-actions">
                <button
                  type="button"
                  className="pt-preview-back-btn"
                  onClick={() => { setPreviewCandidateId(undefined); setPreviewPhoto(0); }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  <span>Back to Likes</span>
                </button>
                {canSendMatchMeMessage(ownerId, previewCandidate.id, state) && (
                  <button
                    type="button"
                    className="pt-preview-chat-btn"
                    onClick={() => {
                      setSelectedMatchId(previewCandidate.id);
                      setPreviewCandidateId(undefined);
                      setPreviewPhoto(0);
                      setTab('discover');
                    }}
                  >
                    <span>Chat with {datingFirstName(previewCandidate.name)}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="pt-list">
              <span className="pt-eyebrow">YOUR MAYBES & WHAT-IFS</span>
              <h2>People you like</h2>
              <p className="pt-subtle">Likes wait for a like back. Send a Superlike to start chatting immediately.</p>
              {likedProfiles.map((entry) => {
                const isMatch = canSendMatchMeMessage(ownerId, entry.id, state);
                const decision = decisionFor(entry.id);
                const entryAvatar = entry.avatarDataUrl;

                return (
                  <div className="pt-like" key={entry.id}>
                    <button
                      type="button"
                      className="pt-like-profile-btn"
                      onClick={() => { setPreviewCandidateId(entry.id); setPreviewPhoto(0); }}
                      aria-label={`View ${datingFirstName(entry.name)}’s profile`}
                    >
                      <div className="pt-like-avatar-wrap">
                        <CharacterAvatar
                          className={`pt-like-avatar${isMatch ? ' match-border' : ''}`}
                          name={datingFirstName(entry.name)}
                          profileImageDataUrl={entryAvatar}
                          fallback={datingFirstName(entry.name).slice(0, 1)}
                        />
                        <span className={`pt-like-type-badge ${isMatch ? 'match' : decision}`} aria-hidden="true">
                          {decision === 'superlike' ? '★' : '♥'}
                        </span>
                      </div>
                      <div className="pt-like-info">
                        <strong>{datingFirstName(entry.name)}<span className="pt-like-age">, {entry.age}</span></strong>
                        <small className={`pt-like-status${isMatch ? ' match' : ''}`}>
                          {isMatch ? (
                            <>
                              <span className="pt-like-match-pill">Match</span>
                              <span>Ready to chat</span>
                            </>
                          ) : (
                            'Waiting for a like back'
                          )}
                        </small>
                      </div>
                    </button>
                    <div className="pt-like-action-slot">
                      {isMatch ? (
                        <button
                          type="button"
                          className="pt-like-chat-btn"
                          onClick={() => { setSelectedMatchId(entry.id); setTab('discover'); }}
                        >
                          Chat
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="pt-like-superlike-btn"
                          disabled={busy || isRunning}
                          onClick={() => decide('superlike', entry)}
                        >
                          ★ Superlike
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!likedProfiles.length && (
                <div className="pt-empty">
                  <h3>A little spark starts here.</h3>
                  <p>Like someone in Discover to see them here.</p>
                </div>
              )}
            </div>
          )
        ) : <div className="pt-profile-view">
          <div className="pt-profile-hero">
            <CharacterAvatar className="pt-profile-avatar-large" name={datingFirstName(profile?.name ?? owner.name)}
              profileImageDataUrl={ownerAvatarDataUrl}
              fallback={datingFirstName(profile?.name ?? owner.name).slice(0, 1)} />
            <div className="pt-profile-hero-meta">
              <span className="pt-eyebrow">YOUR PROFILE</span>
              <h2>{datingFirstName(profile?.name ?? owner.name)}<span className="pt-profile-hero-age">, {profile?.age}</span></h2>
              <div className="pt-profile-badges">
                <span className="pt-profile-badge">{profile?.gender ? datingGenderLabels[profile.gender] : 'Not specified'}</span>
                <span className="pt-profile-badge">Seeking: {profile?.seeking?.length ? profile.seeking.map((gender) => datingSeekingLabels[gender]).join(', ') : 'Everyone'}</span>
              </div>
            </div>
          </div>

          {!!profile?.photoIds?.length && (
            <div className="pt-profile-card">
              <div className="pt-profile-card-title"><strong>Photos</strong><small>{profile.photoIds.length}/{datingPhotoLimit}</small></div>
              <div className="pt-profile-photos">
                {profile.photoIds.map((id, index) => {
                  const image = allImages.find((entry) => entry.id === id);
                  return image ? (
                    <div key={id} className="pt-profile-photo-item">
                      <img src={image.dataUrl} alt={`Your profile photo ${index + 1}`} />
                      {index === 0 && <span className="pt-profile-photo-main">Main</span>}
                    </div>
                  ) : <div key={id} className="pt-profile-photo-item pt-profile-photo-fallback"><span>Photo</span></div>;
                })}
              </div>
            </div>
          )}

          <div className="pt-profile-card">
            <div className="pt-profile-card-title"><strong>About Me</strong></div>
            <p className="pt-profile-bio">{profile?.bio || 'No bio provided yet.'}</p>
          </div>

          {!!profile?.interests && (
            <div className="pt-profile-card">
              <div className="pt-profile-card-title"><strong>Interests</strong></div>
              <div className="pt-tags">
                {profile.interests.split(',').map((interest) => interest.trim()).filter(Boolean).map((interest) => (
                  <span key={interest}>{interest}</span>
                ))}
              </div>
            </div>
          )}

          <div className="pt-profile-actions">
            <button type="button" className="pt-primary pt-profile-edit-btn" onClick={() => { if (profile) setDraft(profile); setEditing(true); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Edit profile
            </button>
            <p className="pt-subtle">Saved in {owner.name}’s Storybook profile.</p>
          </div>
        </div>}
      {selectedMatch && failedMessages[selectedMatch.id] && <button type="button" disabled={busy || isRunning} onClick={() => { void send(selectedMatch.id, true); }}>Retry reply</button>}
      {error && <p className="pt-error" role="alert">{error}</p>}
      {celebration && <section className="pt-match-celebration" role="status" aria-label="New connection">
        <div className="pt-celebration-particles" aria-hidden="true">
          <span className="pt-sparkle s1">✨</span>
          <span className="pt-sparkle s2">💖</span>
          <span className="pt-sparkle s3">⚡</span>
          <span className="pt-sparkle s4">✨</span>
        </div>
        <div className="pt-celebration-duo">
          <div className="pt-celebration-avatar-ring">
            <CharacterAvatar className="pt-celebration-avatar" name={datingFirstName(profile?.name ?? owner?.name ?? 'You')}
              profileImageDataUrl={ownerAvatarDataUrl}
              fallback={datingFirstName(profile?.name ?? owner?.name ?? 'You').slice(0, 1)} />
          </div>
          <div className="pt-celebration-center-badge">
            {celebration.superlike ? (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#38bdf8" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#f43f6e" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
            )}
          </div>
          <div className="pt-celebration-avatar-ring">
            <CharacterAvatar className="pt-celebration-avatar" name={datingFirstName(celebration.name)}
              profileImageDataUrl={state.accounts.find((acc) => acc.id === celebration.id)?.avatarDataUrl}
              fallback={datingFirstName(celebration.name).slice(0, 1)} />
          </div>
        </div>
        <div className="pt-celebration-text">
          <span className="pt-celebration-pill">{celebration.superlike ? 'SUPERLIKE' : 'NEW MATCH'}</span>
          <h2 className="pt-celebration-heading">{celebration.superlike ? 'Superlike Sent!' : 'It’s a Match!'}</h2>
          <p>{celebration.superlike ? `You can now chat with ${datingFirstName(celebration.name)}.` : `You and ${datingFirstName(celebration.name)} liked each other.`}</p>
        </div>
        <div className="pt-celebration-buttons">
          <button type="button" className="pt-primary pt-celebration-primary" autoFocus onClick={() => { setSelectedMatchId(celebration.id); setTab('discover'); setCelebration(undefined); }}>Say hello <span aria-hidden="true">→</span></button>
          <button type="button" className="pt-celebration-ghost" onClick={() => setCelebration(undefined)}>Keep exploring</button>
        </div>
      </section>}
    </main>
    </div>
    {profile && !editing && <nav className="pt-tabs" aria-label="MatchMe navigation">
      <button type="button" className={`pt-tab-btn${tab === 'discover' ? ' active' : ''}`} aria-current={tab === 'discover' ? 'page' : undefined} onClick={() => { setTab('discover'); setSelectedMatchId(undefined); setPreviewCandidateId(undefined); setPreviewPhoto(0); setPhoto(0); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill={tab === 'discover' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2c.5 3 2.5 5 4.5 7 2 2 3.5 4.5 3.5 7.5a8 8 0 1 1-16 0c0-3.5 2-6.5 5-9 0 2 1.5 3 3 3.5-1-2.5 0-5.5 0-9z"/>
        </svg>
        <span>Discover</span>
      </button>
      <button type="button" className={`pt-tab-btn${tab === 'likes' ? ' active' : ''}`} aria-current={tab === 'likes' ? 'page' : undefined} onClick={() => { setTab('likes'); setSelectedMatchId(undefined); setPreviewCandidateId(undefined); setPreviewPhoto(0); setPhoto(0); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill={tab === 'likes' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
        </svg>
        <span>Likes</span>
      </button>
      <button type="button" className={`pt-tab-btn${tab === 'profile' ? ' active' : ''}`} aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => { setTab('profile'); setSelectedMatchId(undefined); setPreviewCandidateId(undefined); setPreviewPhoto(0); setPhoto(0); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4"/>
          <path d="M20 21a8 8 0 0 0-16 0"/>
        </svg>
        <span>My profile</span>
      </button>
    </nav>}
  </div>;
}
