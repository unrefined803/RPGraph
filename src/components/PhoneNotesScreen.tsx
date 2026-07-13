import { useEffect, useState } from 'react';
import type { RpDateTimeFormat, RpWeekdayLanguage } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { formatRpDayLabel } from '../workflow';
import {
  phoneNoteContentMatches,
  phoneNoteColors,
  type PhoneNoteColor,
  type PhoneNoteRecord,
} from '../chat/phoneAppsSessions';

type PhoneNotesScreenProps = {
  owner?: StorybookCharacter;
  notes: PhoneNoteRecord[];
  /**
   * Persists the edited note through the workflow as a direct app action.
   * Returns false when the commit could not start (for example while a graph
   * run is active); the editor then stays open so the draft is not lost.
   */
  onCommitNote: (note: PhoneNoteRecord) => boolean;
  onDeleteNote: (noteId: string) => boolean;
  onChangeNoteColor: (noteId: string, color: PhoneNoteColor) => void;
  clockDateTime: string;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  onBack: () => void;
};

const noteColors: readonly { id: PhoneNoteColor; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'sand', label: 'Sand' },
  { id: 'coral', label: 'Coral' },
  { id: 'peach', label: 'Peach' },
  { id: 'mint', label: 'Mint' },
  { id: 'sky', label: 'Sky' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'rose', label: 'Rose' },
] as const;

// Keep neutral notes common while still giving new notes some gentle variety.
const randomNoteColors: readonly PhoneNoteColor[] = [
  'neutral',
  'neutral',
  'neutral',
  ...phoneNoteColors.filter((color) => color !== 'neutral'),
];

function nextNoteId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function randomNoteColor() {
  return randomNoteColors[Math.floor(Math.random() * randomNoteColors.length)];
}

export function PhoneNotesScreen({
  owner,
  notes,
  onCommitNote,
  onDeleteNote,
  onChangeNoteColor,
  clockDateTime,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  onBack,
}: PhoneNotesScreenProps) {
  // The open editor works on a local draft. Content is committed on close;
  // a color-only change is persisted locally because it is presentation data.
  const [draftNote, setDraftNote] = useState<PhoneNoteRecord>();

  function addNote() {
    if (!owner) {
      return;
    }
    setDraftNote({
      id: nextNoteId(),
      title: '',
      text: '',
      dayLabel: formatRpDayLabel(clockDateTime, rpDateTimeFormat, rpWeekdayLanguage) || '',
      color: randomNoteColor(),
    });
  }

  function changeDraft(change: Partial<Pick<PhoneNoteRecord, 'title' | 'text' | 'color'>>) {
    setDraftNote((current) => (current ? { ...current, ...change } : current));
  }

  function deleteDraftNote() {
    if (!draftNote) {
      return;
    }
    if (notes.some((note) => note.id === draftNote.id)) {
      if (!onDeleteNote(draftNote.id)) {
        return;
      }
    }
    setDraftNote(undefined);
  }

  function closeEditor() {
    if (!draftNote) {
      return;
    }
    const storedNote = notes.find((note) => note.id === draftNote.id);
    if (!draftNote.title.trim() && !draftNote.text.trim()) {
      // An emptied note disappears like a deleted one.
      if (storedNote) {
        if (!onDeleteNote(draftNote.id)) {
          return;
        }
      }
      setDraftNote(undefined);
      return;
    }
    if (storedNote && phoneNoteContentMatches(storedNote, draftNote)) {
      if (storedNote.color !== draftNote.color) {
        onChangeNoteColor(draftNote.id, draftNote.color);
      }
      setDraftNote(undefined);
      return;
    }
    if (onCommitNote(draftNote)) {
      setDraftNote(undefined);
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (!draftNote) {
        onBack();
        return;
      }
      closeEditor();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  if (draftNote) {
    return (
      <div className="phone-notes-screen" aria-label="Notes">
        <header className="phone-gallery-header">
          <button type="button" onClick={closeEditor} aria-label="Back" title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <span>Notes</span>
            <strong>{draftNote.dayLabel || 'New note'}</strong>
          </div>
          <button
            type="button"
            className="phone-notes-delete-button"
            onClick={deleteDraftNote}
            aria-label="Delete note"
            title="Delete note"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        </header>
        <div className={`phone-notes-editor color-${draftNote.color}`}>
          <input
            type="text"
            className="phone-notes-editor-title"
            placeholder="Title"
            value={draftNote.title}
            onChange={(event) => changeDraft({ title: event.target.value })}
          />
          <textarea
            className="phone-notes-editor-text"
            placeholder="Write a note..."
            value={draftNote.text}
            onChange={(event) => changeDraft({ text: event.target.value })}
            autoFocus
          />
          <div className="phone-notes-color-picker" aria-label="Note color">
            {noteColors.map((color) => (
              <button
                type="button"
                className={`phone-notes-color-option color-${color.id}`}
                key={color.id}
                onClick={() => changeDraft({ color: color.id })}
                aria-label={color.label}
                aria-pressed={draftNote.color === color.id}
                title={color.label}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-notes-screen" aria-label="Notes">
      <header className="phone-gallery-header">
        <button type="button" onClick={onBack} aria-label="Back" title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <span>Notes</span>
          <strong>{owner ? `${owner.name}'s Notes` : 'No Character'}</strong>
        </div>
      </header>
      <div className="phone-notes-scroll">
        {notes.length > 0 ? (
          <div className="phone-notes-masonry">
            {notes.map((note) => (
              <button
                type="button"
                className={`phone-notes-card color-${note.color}`}
                key={note.id}
                onClick={() => setDraftNote(structuredClone(note))}
              >
                {note.title.trim() && <strong>{note.title}</strong>}
                {note.text.trim() && <span>{note.text}</span>}
                {!note.title.trim() && !note.text.trim() && <span className="empty">Empty note</span>}
                {note.dayLabel && <small>{note.dayLabel}</small>}
              </button>
            ))}
          </div>
        ) : (
          <div className="phone-notes-empty">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
              <path d="M15 3v4h4" />
              <path d="M8 11h8M8 15h8M8 19h5" />
            </svg>
            <span>No notes yet.</span>
          </div>
        )}
      </div>
      <button
        type="button"
        className="phone-notes-add-button"
        onClick={addNote}
        disabled={!owner}
        aria-label="New note"
        title={owner ? 'New note' : 'Select a phone character first'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
