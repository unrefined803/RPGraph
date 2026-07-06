import defaultNarratorVoiceDataUrl from '../assets/sounds/narrator-default.mp3?inline';
import type { ComfyNarratorVoice } from '../types';

export const defaultComfyNarratorVoice: ComfyNarratorVoice = {
  name: 'RPGraph Default Narrator.mp3',
  dataUrl: defaultNarratorVoiceDataUrl,
};

export function bundledComfyNarratorVoice(): ComfyNarratorVoice {
  return { ...defaultComfyNarratorVoice };
}
