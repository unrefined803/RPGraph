import { useEffect, useState } from 'react';
import type { RpDateTimeFormat, RpWeekdayLanguage } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { formatRpDayLabel } from '../workflow';
import {
  phoneNoteColors,
  type PhoneNoteColor,
  type PhoneNoteRecord,
} from '../chat/phoneAppsSessions';

type PhoneNotesScreenProps = {
  owner?: StorybookCharacter;
  notes: PhoneNoteRecord[];
  onNotesChange: (notes: PhoneNoteRecord[]) => void;
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
  onNotesChange,
  clockDateTime,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  onBack,
}: PhoneNotesScreenProps) {
  const [editingNoteId, setEditingNoteId] = useState<string>();

  function addNote() {
    const note: PhoneNoteRecord = {
      id: nextNoteId(),
      title: '',
      text: '',
      dayLabel: formatRpDayLabel(clockDateTime, rpDateTimeFormat, rpWeekdayLanguage) || '',
      color: randomNoteColor(),
    };
    onNotesChange([note, ...notes]);
    setEditingNoteId(note.id);
  }

  function changeNote(id: string, change: Partial<Pick<PhoneNoteRecord, 'title' | 'text' | 'color'>>) {
    onNotesChange(notes.map((note) => (note.id === id ? { ...note, ...change } : note)));
  }

  function removeNote(id: string) {
    onNotesChange(notes.filter((note) => note.id !== id));
    if (editingNoteId === id) {
      setEditingNoteId(undefined);
    }
  }

  function closeEditor() {
    const note = notes.find((entry) => entry.id === editingNoteId);
    if (note && !note.title.trim() && !note.text.trim()) {
      removeNote(note.id);
    }
    setEditingNoteId(undefined);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (!editingNoteId) {
        onBack();
        return;
      }
      const note = notes.find((entry) => entry.id === editingNoteId);
      if (note && !note.title.trim() && !note.text.trim()) {
        onNotesChange(notes.filter((entry) => entry.id !== note.id));
      }
      setEditingNoteId(undefined);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingNoteId, notes, onBack, onNotesChange]);

  const editingNote = notes.find((note) => note.id === editingNoteId);

  if (editingNote) {
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
            <strong>{editingNote.dayLabel || 'New note'}</strong>
          </div>
          <button
            type="button"
            className="phone-notes-delete-button"
            onClick={() => removeNote(editingNote.id)}
            aria-label="Delete note"
            title="Delete note"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        </header>
        <div className={`phone-notes-editor color-${editingNote.color}`}>
          <input
            type="text"
            className="phone-notes-editor-title"
            placeholder="Title"
            value={editingNote.title}
            onChange={(event) => changeNote(editingNote.id, { title: event.target.value })}
          />
          <textarea
            className="phone-notes-editor-text"
            placeholder="Write a note..."
            value={editingNote.text}
            onChange={(event) => changeNote(editingNote.id, { text: event.target.value })}
            autoFocus
          />
          <div className="phone-notes-color-picker" aria-label="Note color">
            {noteColors.map((color) => (
              <button
                type="button"
                className={`phone-notes-color-option color-${color.id}`}
                key={color.id}
                onClick={() => changeNote(editingNote.id, { color: color.id })}
                aria-label={color.label}
                aria-pressed={editingNote.color === color.id}
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
                onClick={() => setEditingNoteId(note.id)}
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
        aria-label="New note"
        title="New note"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
