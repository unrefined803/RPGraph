import { useEffect, useRef, useState } from 'react';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { ConnectionPreset, SavedFileSummary } from '../types';
import { validateCharacterContainer, type Character } from '../characters/character';
import type { NpcLibrarySnapshot } from '../characters/npcLibrary';
import { assignCharacterImage, characterAssistantProjection, characterAssistantPrompt, copyAssistantCharacter,
  newAssistantCharacter, parseCharacterAssistantResult, validateAssistantCharacter,
  type CharacterAssistantMessage, type CharacterDestination } from '../characters/assistant';
import { normalizeCharacterImage } from '../characters/assistantMedia';
import { appAvatarDataUrl } from '../characters/portrait';
import { CharacterAppProfiles } from './CharacterAppProfiles';
import { CharacterAvatar } from './CharacterAvatar';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { StorybookInlineEditor } from '../storybook/StorybookInlineEditor';
import { JsonSyntaxTextarea } from '../nodes/shared/JsonSyntaxTextarea';
import { CharacterSaveOptions } from './CharacterSaveOptions';
import { createCharacterContainer } from '../characters/creator';
import './characterAssistant.css';

type Props = {
  nodeLlm: NodeLlmApi;
  connections: ConnectionPreset[];
  defaultConnectionId: string;
  snapshot: NpcLibrarySnapshot | null;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
};
type Source = { destination: CharacterDestination; fileName: string; bundled?: boolean };
type LoadChoice = { key: string; label: string; source: Source; character?: Character; file?: SavedFileSummary };

export function CharacterAssistantDialog({ nodeLlm, connections, defaultConnectionId, snapshot, onSaved, onClose }: Props) {
  const [character, setCharacter] = useState<Character>(newAssistantCharacter);
  const current = useRef(character);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<CharacterAssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [connectionId, setConnectionId] = useState(defaultConnectionId);
  const [destination, setDestination] = useState<CharacterDestination>('characters');
  const [source, setSource] = useState<Source>();
  const [fileName, setFileName] = useState('');
  const [savedCharacter, setSavedCharacter] = useState(character);
  const [undo, setUndo] = useState<Character[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ioBusy, setIoBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [choices, setChoices] = useState<LoadChoice[] | null>(null);
  const [choiceKey, setChoiceKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState<{ message: string; label: string; action: () => void } | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editSettings, setEditSettings] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [includePosts, setIncludePosts] = useState(true);
  const imageInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dirty = character !== savedCharacter;
  const llmConnections = connections.filter((entry) => entry.kind !== 'comfyui');
  const selectedConnection = llmConnections.find((entry) => entry.id === connectionId);
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  function change(next: Character, remember = true) {
    if (remember) setUndo((history) => [...history.slice(-19), current.current]);
    current.current = next;
    revision.current += 1;
    setCharacter(next);
    setStatus('');
  }
  function guard(action: () => void) {
    if (dirty) setConfirm({ message: 'Discard unsaved character changes?', label: 'Discard changes', action });
    else action();
  }
  function close() {
    if (ioBusy) return;
    guard(() => { request.current?.abort(); onClose(); });
  }
  function loadDraft(next: Character, nextSource?: Source) {
    request.current?.abort();
    change(next, false);
    setSavedCharacter(next);
    setUndo([]); setMessages([]); setDraft(''); setAttachments([]);
    setSource(nextSource); setFileName(nextSource?.fileName.replace(/\.json$/i, '') ?? '');
    if (nextSource) setDestination(nextSource.destination);
    setChoices(null); setPassword(''); setEditSettings(false);
  }
  async function showLoad(target: CharacterDestination) {
    setIoBusy(true); setStatus('');
    try {
      let available: LoadChoice[];
      if (target === 'characters') {
        if (!window.rpgraph?.listCharacterFiles) throw new Error('The Characters Folder is available in the desktop application.');
        const files = await window.rpgraph.listCharacterFiles();
        available = files.filter((file) => file.storage === 'characters' && file.type === 'character-card').map((file) => ({
          key: file.fileName, label: `${file.characterName || file.name} · ${file.fileName}${file.protection === 'encrypted' ? ' · Encrypted' : ''}`,
          source: { destination: target, fileName: file.fileName }, file,
        }));
      } else {
        const library = window.rpgraph?.reloadNpcLibrary ? await window.rpgraph.reloadNpcLibrary() : snapshot;
        if (!library) throw new Error('The NPC library has not loaded yet.');
        const localIds = new Set(library.entries.filter((entry) => entry.tier === 'user').map((entry) => entry.character.id));
        available = library.entries.filter((entry) => entry.tier === 'user' || !localIds.has(entry.character.id)).map((entry) => ({
          key: `${entry.tier}:${entry.fileName}`, label: `${entry.character.name} · ${entry.tier === 'bundled' ? 'Built-in' : 'Local'} · ${entry.fileName}`,
          source: { destination: target, fileName: entry.fileName, bundled: entry.tier === 'bundled' }, character: entry.character,
        }));
      }
      available.sort((a, b) => a.label.localeCompare(b.label));
      setChoices(available); setChoiceKey(available[0]?.key ?? ''); setPassword('');
    } catch (error) { setStatus(errorText(error)); }
    finally { setIoBusy(false); }
  }
  async function loadSelected() {
    const choice = choices?.find((entry) => entry.key === choiceKey);
    if (!choice) return;
    setIoBusy(true);
    try {
      let next = choice.character;
      if (!next) {
        const file = await window.rpgraph.loadFile(choice.source.fileName, password, 'characters');
        validateCharacterContainer(file.value);
        next = (file.value as { character: Character }).character;
      }
      loadDraft(structuredClone(next), choice.source);
      setStatus(`Loaded ${choice.source.fileName}. Saving writes to local application data.`);
    } catch (error) { setStatus(errorText(error)); }
    finally { setIoBusy(false); }
  }
  async function save(asCopy = false, overwrite = false, prepared?: { character: Character; name: string }) {
    if (!window.rpgraph?.saveCharacter) { setStatus('Saving to application folders requires the desktop application.'); return; }
    setIoBusy(true); setStatus('');
    try {
      const next = prepared?.character ?? (asCopy ? copyAssistantCharacter(character) : character);
      validateAssistantCharacter(next);
      const container = createCharacterContainer(next, includePosts);
      let name = prepared?.name ?? (!asCopy && source?.destination === destination && !source.bundled
        ? source.fileName.replace(/\.json$/i, '') : fileName.trim() || character.name);
      if (asCopy && !prepared) name += ' Copy';
      if (destination === 'npc-characters' && !asCopy && !prepared) {
        const library = await window.rpgraph.reloadNpcLibrary();
        const matches = library.entries.filter((entry) => entry.tier === 'user' && entry.character.id === next.id);
        if (matches.length > 1) throw new Error('Multiple local NPC files have this identity. Resolve the duplicate files before saving.');
        if (matches[0]) name = matches[0].fileName.replace(/\.json$/i, '');
      }
      const result = await window.rpgraph.saveCharacter(name, container, 'plain', '', overwrite, destination);
      if (result.conflict) {
        setConfirm({ message: `${result.fileName} already exists in the selected folder. Replace it with this character?`, label: 'Replace file',
          action: () => { void save(asCopy, true, { character: next, name }); } });
        return;
      }
      change(next, false); setSavedCharacter(next); setFileName(result.name);
      setShowSave(false);
      setSource({ destination, fileName: result.fileName });
      if (asCopy) { setUndo([]); setAttachments([]); setMessages([]); }
      setStatus(`Saved to ${result.filePath}`);
      try { await onSaved(); } catch (error) { setStatus(`Saved to ${result.filePath}. Library refresh failed: ${errorText(error)}`); }
    } catch (error) { setStatus(errorText(error)); }
    finally { setIoBusy(false); }
  }
  async function addImages(files: File[]) {
    setIoBusy(true);
    const startRevision = revision.current;
    try {
      const images: Character['images'] = [];
      for (const file of files) images.push(await normalizeCharacterImage(file));
      if (startRevision !== revision.current) throw new Error('The draft changed during image import. Please add the images again.');
      change({ ...current.current, images: [...current.current.images, ...images] });
      setAttachments((ids) => [...ids, ...images.map((image) => image.id)]);
      setStatus(`Added ${images.length} image(s). Selected images will accompany your next message.`);
    } catch (error) { setStatus(errorText(error)); }
    finally { setIoBusy(false); }
  }
  async function send(message = draft.trim()) {
    if (!message || request.current || ioBusy) return;
    if (!selectedConnection) { setStatus('Select an LLM provider first.'); return; }
    const selectedImages = character.images.filter((image) => attachments.includes(image.id));
    if (selectedImages.length && !selectedConnection.vision) {
      setStatus('This provider is not configured for vision. Select a vision provider or uncheck image attachments and describe them in text.'); return;
    }
    const controller = new AbortController(); request.current = controller;
    const startRevision = revision.current;
    const original = character;
    setBusy(true); setDraft(''); setStatus('');
    setMessages((history) => [...history, { role: 'user', text: message }]);
    try {
      const response = await nodeLlm.complete({ connectionId, label: 'Character Assistant', signal: controller.signal,
        prompt: characterAssistantPrompt(original, messages, message, selectedImages.map((image) => image.id), destination),
        images: selectedImages });
      if (controller.signal.aborted) return;
      if (startRevision !== revision.current) throw new Error('The character changed during the request. The response was not applied. Send your request again.');
      const result = parseCharacterAssistantResult(response.text, original);
      if (JSON.stringify(characterAssistantProjection(result.character)) !== JSON.stringify(characterAssistantProjection(original))) change(result.character);
      setMessages((history) => [...history, { role: 'assistant', text: result.reply }]);
      setAttachments([]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages((history) => [...history, { role: 'error', text: `${errorText(error)} No changes were applied.` }]);
        setDraft(message);
      }
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const portrait = character.images.find((image) => image.id === character.profileImage?.imageId);
  return <div className="dialog-backdrop character-assistant-backdrop">
    <section ref={dialogRef} tabIndex={-1} className="storybook-creator-dialog character-assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="character-assistant-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (ioBusy) return; if (confirm) setConfirm(null); else if (choices) setChoices(null); else if (showSave) setShowSave(false); else close(); }
        if (event.key === 'Tab') {
          const overlays = dialogRef.current?.querySelectorAll('.storybook-confirm-backdrop');
          const overlay = overlays?.[overlays.length - 1];
          const focusRoot = overlay ?? dialogRef.current;
          const focusable = Array.from(focusRoot?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length);
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header inert={showSave || !!choices || !!confirm} className="dialog-header storybook-creator-header">
        <div className="storybook-title-row"><h2 id="character-assistant-title">Character Assistant</h2><p>{dirty ? 'Unsaved changes' : 'Ready'} · {source ? `${source.bundled ? 'Built-in' : 'Local'} · ${source.fileName}` : 'New character'}</p></div>
        <div className="storybook-header-actions">
          <button className="inspect-button nodrag" type="button" disabled={ioBusy || busy} onClick={() => { setStatus(''); setShowSave(true); }}>Save Character</button>
          <button className="close-button danger" type="button" disabled={ioBusy} onClick={close}>Close</button>
        </div>
      </header>
      <div inert={showSave || !!choices || !!confirm} className="character-assistant-toolbar">
        <button className="contextual-action-button nodrag" type="button" disabled={ioBusy || busy} onClick={() => guard(() => loadDraft(newAssistantCharacter()))}><span className="button-icon">+</span> New Character</button>
        <button className="contextual-action-button nodrag" type="button" disabled={ioBusy || busy} onClick={() => guard(() => { void showLoad('characters'); })}><span className="button-icon">+</span> Load Character</button>
        <button className="contextual-action-button nodrag" type="button" disabled={ioBusy || busy} onClick={() => guard(() => { void showLoad('npc-characters'); })}><span className="button-icon">+</span> Load NPC</button>
        <button className="contextual-action-button nodrag" type="button" disabled={!undo.length || ioBusy} onClick={() => {
          const previous = undo[undo.length - 1]; if (previous) { change(previous, false); setUndo((history) => history.slice(0, -1)); }
        }}>Undo</button>
        <span className="character-assistant-source">{source ? `${source.bundled ? 'Built-in' : 'Local'} · ${source.fileName}` : 'New container'}</span>
      </div>
      <div inert={showSave || !!choices || !!confirm} className="storybook-creator-body"><div className="storybook-main-workspace character-assistant-workspace">
        <div className="storybook-document-panel">
          <div className="storybook-panel-header"><span className="panel-title">Character</span><div className="storybook-tabs">
            <button type="button" className={`tab-button ${!showJson ? 'active' : ''}`} onClick={() => setShowJson(false)}>UI Preview</button>
            <button type="button" className={`tab-button ${showJson ? 'active' : ''}`} onClick={() => setShowJson(true)}>Raw JSON</button>
          </div></div>
          <div className="storybook-panel-content character-assistant-preview">
          {showJson ? <div className="storybook-json-panel"><JsonSyntaxTextarea id="character-json-preview" readOnly value={JSON.stringify(characterAssistantProjection(character), null, 2)} /></div> : <div className="storybook-ui-view">
          <article className="storybook-actor-card">
            <StorybookInlineEditor key={character.id} label={character.name || 'Character'} disabled={ioBusy}
              fields={(['name', 'role', 'description', 'personality', 'speechStyle', 'hiddenAgency'] as const).map((field) => ({
                key: field, label: { name: 'Name', role: 'Role', description: 'Description', personality: 'Personality', speechStyle: 'Speech Style', hiddenAgency: 'Hidden Agency' }[field],
                value: character[field] ?? '', multiline: field !== 'name' && field !== 'role',
              }))}
              onSave={(values) => { change({ ...character, ...values }); return true; }}>
              <div className="character-card-header">
                <CharacterAvatar className="avatar-circle actor-avatar" name={character.name} fallback={character.name.slice(0, 2).toUpperCase()} profileImageDataUrl={appAvatarDataUrl(character, portrait)} />
                <div className="character-card-title-side"><h5 className="character-name">{character.name || 'Unnamed Character'}</h5><p className="character-subrole">{character.role || 'Character draft'}</p></div>
              </div>
              <div className="character-fields">
                {(['description', 'personality', 'speechStyle', 'hiddenAgency'] as const).map((field) => <div className="character-field" key={field}>
                  <span className="field-label">{{ description: 'Description', personality: 'Personality', speechStyle: 'Speech Style', hiddenAgency: 'Hidden Agency' }[field]}</span>
                  <p>{character[field] || 'Not defined yet.'}</p>
                </div>)}
                <div className="character-field"><span className="field-label">Character Details</span><p>{character.age ? `${character.age} years · ` : ''}{character.gender || 'Gender unspecified'} · {character.playable !== false ? 'Playable' : 'NPC'}</p></div>
              </div>
            </StorybookInlineEditor>
            <div className="section-header"><h4>Accounts & Settings</h4><button className="storybook-inline-action nodrag" type="button" onClick={() => setEditSettings(!editSettings)}>{editSettings ? 'Done' : 'Edit'}</button></div>
            {!editSettings && <div className="character-fields"><div className="character-field"><span className="field-label">Accounts</span><p>{Object.entries(character.apps ?? {}).filter(([, account]) => account.enabled).map(([app, account]) => `${{ whatsup: 'WhatsUp', fotogram: 'Fotogram', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' }[app] || app}: ${account.displayName || account.username}`).join(' · ') || 'No active accounts'}</p></div><div className="character-field"><span className="field-label">Starting Posts</span><p>{Object.values(character.apps ?? {}).reduce((total, account) => total + (account.initialPosts?.length ?? 0), 0)} posts</p></div></div>}
            {editSettings && <fieldset disabled={ioBusy} className="character-assistant-fields">
              <div className="character-assistant-inline">
                <label><span>Age</span><input type="number" value={character.age ?? ''} onChange={(event) => change({ ...character, age: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
                <label><span>Gender</span><select value={character.gender ?? ''} onChange={(event) => change({ ...character, gender: event.target.value as Character['gender'] || undefined })}>
                  <option value="">Unspecified</option><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Nonbinary</option>
                </select></label>
              </div>
              <label className="character-assistant-check"><input type="checkbox" checked={character.playable !== false} onChange={(event) => change({ ...character, playable: event.target.checked })} />Playable after Storybook import</label>
              <CharacterAppProfiles key={character.id} character={character} characters={[character]} locked={false} onChange={(next) => { change(next); return true; }} />
              <details><summary>WhatsUp account</summary>{(['username', 'displayName', 'bio'] as const).map((field) => <label key={field}><span>{field}</span><input value={character.apps?.whatsup?.[field] ?? ''} onChange={(event) => {
                const account = character.apps?.whatsup; if (account) change({ ...character, apps: { ...character.apps, whatsup: { ...account, [field]: event.target.value } } });
              }} /></label>)}</details>
              <details><summary>Banking</summary><label><span>Starting balance (USD)</span><input type="number" value={character.banking?.startBalance ?? 0} onChange={(event) => change({ ...character, banking: { ...character.banking, fixedExpenses: character.banking?.fixedExpenses ?? [], startBalance: Number(event.target.value) } })} /></label>
                {(character.banking?.fixedExpenses ?? []).map((expense, index) => <div key={index} className="character-assistant-inline"><label><span>Expense</span><input value={expense.label} onChange={(event) => change({ ...character, banking: { ...character.banking!, fixedExpenses: character.banking!.fixedExpenses.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry) } })} /></label><label><span>Amount (USD)</span><input type="number" value={expense.amount} onChange={(event) => change({ ...character, banking: { ...character.banking!, fixedExpenses: character.banking!.fixedExpenses.map((entry, i) => i === index ? { ...entry, amount: Number(event.target.value) } : entry) } })} /></label><button className="contextual-action-button nodrag" type="button" onClick={() => change({ ...character, banking: { ...character.banking!, fixedExpenses: character.banking!.fixedExpenses.filter((_, i) => i !== index) } })}>Remove</button></div>)}
                <button className="contextual-action-button nodrag" type="button" onClick={() => change({ ...character, banking: { startBalance: character.banking?.startBalance ?? 0, fixedExpenses: [...character.banking?.fixedExpenses ?? [], { label: 'Mobile plan', amount: 24.99 }] } })}>Add expense</button>
              </details>
              <details><summary>Image generation settings</summary>{(['loraName', 'loraUrl', 'appearance'] as const).map((field) => <label key={field}><span>{{ loraName: 'LoRA file name', loraUrl: 'LoRA source URL', appearance: 'Appearance' }[field]}</span><textarea rows={field === 'appearance' ? 3 : 1} value={character.comfyConfig?.[field] ?? ''} onChange={(event) => change({ ...character, comfyConfig: { loraName: '', appearance: '', ...character.comfyConfig, [field]: event.target.value } })} /></label>)}</details>
              <details><summary>Starting posts</summary>{(['fotogram', 'onlyfriends'] as const).map((app) => <div key={app}><h4>{app === 'fotogram' ? 'Fotogram' : 'OnlyFriends'}</h4>
                {(character.apps?.[app]?.initialPosts ?? []).map((post) => <label key={post.id}><span>{character.images.find((image) => image.id === post.imageId)?.name ?? 'Text post'}</span><textarea value={post.text} onChange={(event) => {
                  const account = character.apps![app]!; change({ ...character, apps: { ...character.apps, [app]: { ...account, initialPosts: account.initialPosts!.map((entry) => entry.id === post.id ? { ...entry, text: event.target.value } : entry) } } });
                }} /><button className="contextual-action-button nodrag" type="button" onClick={() => { const account = character.apps![app]!; change({ ...character, apps: { ...character.apps, [app]: { ...account, initialPosts: account.initialPosts!.filter((entry) => entry.id !== post.id) } } }); }}>Remove post</button></label>)}
                <button className="contextual-action-button nodrag" type="button" disabled={!character.apps?.[app]} onClick={() => { const account = character.apps![app]!; change({ ...character, apps: { ...character.apps, [app]: { ...account, initialPosts: [...account.initialPosts ?? [], { id: crypto.randomUUID(), text: '' }] } } }); }}>Add text post</button>
              </div>)}</details>
            </fieldset>}
          </article>
          <section className="character-assistant-gallery"><div className="character-assistant-inline"><h3>Gallery · {character.images.length}</h3><button className="contextual-action-button nodrag" type="button" disabled={ioBusy} onClick={() => imageInput.current?.click()}>Add Images</button></div>
            <p>F: Fotogram · O: OnlyFriends · M: MatchMe · P: Portrait. Select “Attach” to show an image to the assistant.</p>
            {character.images.map((image) => <article key={image.id} className="character-assistant-image">
              <img src={image.dataUrl} alt={image.description || image.name} loading="lazy" />
              <fieldset disabled={ioBusy}>
                <StorybookInlineEditor label={image.name || 'Image'} disabled={ioBusy} fields={[
                  { key: 'name', label: 'Image Name', value: image.name },
                  { key: 'description', label: 'Description', value: image.description, multiline: true },
                ]} onSave={(values) => { change({ ...character, images: character.images.map((entry) => entry.id === image.id ? { ...entry, name: values.name, description: values.description } : entry) }); return true; }}>
                  <div className="character-field"><span className="field-label">{image.name}</span><p>{image.description || 'Ask the assistant to describe this image.'}</p></div>
                </StorybookInlineEditor>
                <div className="character-assistant-image-uses">{(['F', 'O', 'M', 'P'] as const).map((use) => {
                  const checked = use === 'P' ? character.profileImage?.imageId === image.id : use === 'M' ? character.apps?.matchme?.profile?.photoIds.includes(image.id)
                    : character.apps?.[use === 'F' ? 'fotogram' : 'onlyfriends']?.initialPosts?.some((post) => post.imageId === image.id);
                  return <label key={use}><input type="checkbox" checked={!!checked} onChange={(event) => { try { change(assignCharacterImage(character, image.id, use, event.target.checked)); } catch (error) { setStatus(errorText(error)); } }} />{use}</label>;
                })}<label><input type="checkbox" checked={attachments.includes(image.id)} disabled={busy} onChange={(event) => setAttachments((ids) => event.target.checked ? [...ids, image.id] : ids.filter((id) => id !== image.id))} />Attach</label></div>
                {character.profileImage?.imageId === image.id && <details><summary>Portrait crop</summary>{(['x', 'y', 'size'] as const).map((field) => <label key={field}><span>{field} (%)</span><input type="number" min={field === 'size' ? 1 : 0} max={100} value={character.profileImage?.crop?.[field] ?? (field === 'size' ? 100 : 0)} onChange={(event) => change({ ...character, profileImage: { ...character.profileImage!, crop: { x: 0, y: 0, size: 100, ...character.profileImage?.crop, [field]: Number(event.target.value) } } })} /></label>)}</details>}
                <button className="contextual-action-button nodrag" type="button" onClick={() => {
                  const used = character.profileImage?.imageId === image.id || Object.values(character.apps ?? {}).some((account) => account.avatarImageId === image.id || account.initialPosts?.some((post) => post.imageId === image.id)) || character.apps?.matchme?.profile?.photoIds.includes(image.id);
                  if (used) { setStatus('Remove this image’s portrait, avatar, post and MatchMe assignments before deleting it.'); return; }
                  change({ ...character, images: character.images.filter((entry) => entry.id !== image.id) }); setAttachments((ids) => ids.filter((id) => id !== image.id));
                }}>Remove image</button>
              </fieldset>
            </article>)}
          </section>
          </div>}
          </div>
        </div>
        <div className="storybook-chat-panel">
          <div className="storybook-chat-header"><span className="panel-title">AI Character Assistant</span><span className="panel-subtitle">Create, describe and refine your character and images.</span>
            <label className="character-assistant-provider"><span>Provider Preset</span><NodeCustomSelect value={connectionId} onChange={setConnectionId} disabled={busy}
              options={llmConnections.length ? llmConnections.map((entry) => ({ value: entry.id, label: entry.label })) : [{ value: '', label: 'Configure a provider in Providers', disabled: true }]} /></label>
          </div>
          <div className="storybook-chat-log" aria-live="polite">
            {!messages.length && <div className="chat-empty-state"><div className="assistant-avatar-large">AI</div><p className="empty-title">Welcome to Character Assistant</p><p className="empty-description">Describe your character or choose a starting point.</p>
              <ul className="prompt-suggestions">{[
                'Help me create a character. Ask me about the details you need.',
                'Expand this character’s personality and speech style.',
                'Describe the attached images and suggest profile photos and captions.',
              ].map((suggestion) => <li key={suggestion}><button className="character-assistant-suggestion" type="button" onClick={() => setDraft(suggestion)}>{suggestion}</button></li>)}</ul>
            </div>}
            {messages.map((message, index) => <div className={`chat-message-row ${message.role}`} key={index}><div className="message-sender-avatar">{message.role === 'user' ? 'U' : message.role === 'assistant' ? 'AI' : '!'}</div><div className="chat-message-bubble"><p>{message.text}</p></div></div>)}
            {busy && <div className="chat-message-row assistant thinking"><div className="message-sender-avatar">AI</div><div className="chat-message-bubble typing-bubble" aria-label="Working on your character"><div className="typing-indicator"><span></span><span></span><span></span></div></div></div>}<div ref={chatEnd} />
          </div>
          <form className="storybook-chat-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className="character-assistant-attachments"><button className="contextual-action-button nodrag" type="button" disabled={ioBusy || busy} onClick={() => imageInput.current?.click()}>Attach Images</button><span>{attachments.length} selected{attachments.length && !selectedConnection?.vision ? ' · Vision provider required' : ''}</span></div>
            <textarea rows={5} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Describe a character, ask a question, or request changes…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            {busy ? <button className="contextual-action-button nodrag" type="button" onClick={() => { request.current?.abort(); setStatus('Request cancelled. No assistant changes were applied.'); }}>Cancel request</button>
              : <button type="submit" className="send-message-button" disabled={ioBusy || !draft.trim() || !selectedConnection}>Send</button>}
          </form>
        </div>
      </div>
      </div>
      {showSave && <div className="storybook-confirm-backdrop"><section inert={!!confirm} className="chat-password-dialog" role="dialog" aria-modal="true" aria-labelledby="character-save-title">
        <div className="dialog-header"><div><h2 id="character-save-title">Save Character</h2><p>Choose where the complete character should be stored</p></div><button type="button" className="close-button" disabled={ioBusy} onClick={() => setShowSave(false)}>Close</button></div>
        <div className="chat-password-form">
          <label className="chat-file-field">CHARACTER NAME<input autoFocus value={fileName} placeholder={character.name} disabled={ioBusy || (!!source && !source.bundled && source.destination === destination)} onChange={(event) => setFileName(event.target.value)} /></label>
          <div className="chat-security-info"><strong>Plain JSON</strong><p>Save the complete character, including images and app profiles, in your local character collection.</p></div>
          <CharacterSaveOptions action="Save" includePosts={includePosts} onIncludePostsChange={setIncludePosts} destination={destination} onDestinationChange={setDestination} disabled={ioBusy}
            destinations={[{ value: 'characters', label: 'Characters Folder' }, { value: 'npc-characters', label: 'NPC Library Folder' }]} />
          <p className="chat-storage-status">{destination === 'npc-characters' ? snapshot?.roots.user || 'Local application data / npc-characters' : 'Local application data / characters'}</p>
          {status && <p className="chat-storage-status" role="status">{status}</p>}
        </div>
        <div className="dialog-actions"><button type="button" className="secondary" disabled={ioBusy} onClick={() => setShowSave(false)}>Cancel</button><button type="button" className="secondary" disabled={ioBusy || busy} onClick={() => void save(true)}>Save as Copy</button><button type="button" disabled={ioBusy || busy} onClick={() => void save()}>Save Character</button></div>
      </section></div>}
      {status && <p className="character-assistant-status" role="status">{status}</p>}
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addImages(files); }} />
      {choices && <div className="storybook-confirm-backdrop"><section className="storybook-confirm-dialog" role="dialog" aria-label="Load character container"><h3>Load Character Container</h3>
        {choices.length ? <><label>Character<select autoFocus value={choiceKey} disabled={ioBusy} onChange={(event) => { setChoiceKey(event.target.value); setPassword(''); }}>{choices.map((choice) => <option value={choice.key} key={choice.key}>{choice.label}</option>)}</select></label>
          {choices.find((choice) => choice.key === choiceKey)?.file?.protection === 'encrypted' && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}</> : <p>No character containers found in this folder.</p>}
        {status && <p role="status">{status}</p>}<div className="storybook-confirm-actions"><button className="contextual-action-button nodrag" type="button" disabled={ioBusy} onClick={() => setChoices(null)}>Cancel</button><button className="contextual-action-button nodrag" type="button" disabled={ioBusy || !choiceKey} onClick={() => void loadSelected()}>Load</button></div>
      </section></div>}
      {confirm && <div className="storybook-confirm-backdrop"><section className="storybook-confirm-dialog" role="alertdialog" aria-label="Confirm character action"><p>{confirm.message}</p><div className="storybook-confirm-actions"><button className="contextual-action-button nodrag" type="button" autoFocus onClick={() => setConfirm(null)}>Cancel</button><button className="contextual-action-button nodrag" type="button" onClick={() => { const action = confirm.action; setConfirm(null); action(); }}>{confirm.label}</button></div></section></div>}
    </section>
  </div>;
}
