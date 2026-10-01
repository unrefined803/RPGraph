import { useState, useSyncExternalStore } from 'react';
import {
  isUiPerformanceRecording, markUiEvent, startUiPerformance, stopUiPerformance,
  subscribeUiPerformance, uiPerformanceReport,
} from '../diagnostics/uiPerformance';

/** Marks when React reaches this position: earlier siblings have finished rendering. */
export function UiRenderMark({ name }: { name: string }) {
  markUiEvent('render.mark', { name });
  return null;
}

export function UiPerformanceDiagnostics() {
  const recording = useSyncExternalStore(subscribeUiPerformance, isUiPerformanceRecording);
  const [exported, setExported] = useState(false);
  function exportReport() {
    stopUiPerformance();
    const url = URL.createObjectURL(new Blob([JSON.stringify(uiPerformanceReport(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `rpgraph-ui-performance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    setExported(true);
  }
  return (
    <div className="option-info">
      <strong>UI performance diagnostics</strong>
      <p>Start recording, close Options, and reproduce a few chat stutters. Return here to stop and export the report. Recording continues while Options is closed.</p>
      <p>Collects timing and update-field names, without chat text or images. A new recording replaces the previous report. Recording is off after restarting the app.</p>
      <div className="storybook-confirm-actions">
        <button type="button" className="inspect-button" disabled={recording} onClick={() => { setExported(false); startUiPerformance(); }}>Start recording</button>
        <button type="button" className="inspect-button" disabled={!recording} onClick={stopUiPerformance}>Stop recording</button>
        <button type="button" className="inspect-button" onClick={exportReport}>Stop and export report</button>
      </div>
      <p role="status">{recording ? 'Recording UI performance…' : exported ? 'Report exported.' : 'Recording is off.'}</p>
    </div>
  );
}
