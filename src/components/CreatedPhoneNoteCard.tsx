import {
  createdPhoneNoteActionVerb,
  type CreatedPhoneNoteCommit,
} from '../chat/phoneAppsSessions';

type CreatedPhoneNoteCardProps = {
  entry: CreatedPhoneNoteCommit;
  fontSize?: number;
};

export function CreatedPhoneNoteCard({ entry, fontSize }: CreatedPhoneNoteCardProps) {
  const actionVerb = createdPhoneNoteActionVerb(entry);
  return (
    <section
      className="chat-created-note-card"
      style={fontSize ? { fontSize } : undefined}
      aria-label={`${entry.characterName} ${actionVerb} the note ${entry.note.title}`}
    >
      <header>
        <span className="chat-created-note-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
            <path d="M15 3v4h4" />
            <path d="M8 11h8M8 15h8M8 19h5" />
          </svg>
        </span>
        <span>
          <strong>Notes</strong>
          <small>{entry.characterName} {actionVerb} a note</small>
        </span>
        {entry.note.dayLabel && <time>{entry.note.dayLabel}</time>}
      </header>
      <div className={`chat-created-note-paper color-${entry.note.color}`}>
        <strong>{entry.note.title}</strong>
        <p>{entry.note.text}</p>
      </div>
    </section>
  );
}
