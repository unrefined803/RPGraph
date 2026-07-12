import type { SimulatedAiChatCommit } from '../chat/phoneAppsSessions';

type SimulatedAiChatCardProps = {
  entry: SimulatedAiChatCommit;
  fontSize?: number;
};

export function SimulatedAiChatCard({ entry, fontSize }: SimulatedAiChatCardProps) {
  return (
    <section
      className="chat-simulated-ai-card"
      style={fontSize ? { fontSize } : undefined}
      aria-label={`${entry.characterName} used ChatGPD`}
    >
      <header>
        <span className="chat-simulated-ai-icon" aria-hidden="true">AI</span>
        <span>
          <strong>ChatGPD</strong>
          <small>{entry.characterName} used the AI assistant</small>
        </span>
      </header>
      <div className="chat-simulated-ai-thread">
        {entry.chat.messages.map((message, index) => (
          <div className={`chat-simulated-ai-message ${message.role}`} key={`${message.role}-${index}`}>
            <small>{message.role === 'user' ? entry.characterName : 'ChatGPD'}</small>
            <span>{message.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
