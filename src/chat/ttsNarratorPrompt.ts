import type { ConnectionPreset } from '../types';

export function ttsNarratorPrompt(connection: ConnectionPreset, transcript: string) {
  if (!connection.model.startsWith('google/gemini-')) {
    return transcript;
  }
  const sections = [
    connection.ttsAudioProfile
      ? `# AUDIO PROFILE\n${connection.ttsAudioProfile.trim()}`
      : '',
  ];
  const directorNotes = [
    connection.ttsStyle ? `Style: ${connection.ttsStyle.trim()}` : '',
    connection.ttsAccent ? `Accent: ${connection.ttsAccent.trim()}` : '',
    connection.ttsPace ? `Pace: ${connection.ttsPace.trim()}` : '',
  ].filter(Boolean);
  if (directorNotes.length > 0) {
    sections.push(`### DIRECTOR'S NOTES\n${directorNotes.join('\n')}`);
  }
  sections.push(`#### TRANSCRIPT\n${transcript}`);
  return sections.filter(Boolean).join('\n\n');
}
