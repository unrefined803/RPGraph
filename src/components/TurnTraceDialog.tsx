import { formatContextValue } from '../data-management/formatters';
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  turnTraceCopyPayload,
  type TurnTrace,
  type TurnTraceLlmCall,
  type TurnTraceMessage,
  type TurnTracePromptPass,
  type TurnTracePromptSection,
} from '../app/turnTrace';
import { TextMetricsApi } from '../llm/tokenMetrics';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { copyTextToClipboard } from '../utils/clipboard';
import { JsonSyntaxTextarea } from '../nodes/shared/JsonSyntaxTextarea';
import { HighlightedPreviewText } from '../nodes/shared/HighlightedPreviewText';
import { useBackdropDismiss } from './useBackdropDismiss';

type TurnTraceDialogProps = {
  traces: TurnTrace[];
  estimatedTokenBytesPerToken: number;
  onClose: () => void;
};

const collapsiblePromptCharacters = 420;

function traceTurnNumbers(traces: TurnTrace[]) {
  return Array.from(new Set(traces.map((trace) => trace.turnNumber))).sort(
    (left, right) => left - right,
  );
}

function messageHeading(message: TurnTraceMessage) {
  if (message.channel === 'phone') {
    return [message.from, message.to].filter(Boolean).join(' → ') || message.speaker || message.role;
  }
  return message.speaker || message.role;
}

function TraceMessages({
  title,
  messages,
  graphText,
}: {
  title: string;
  messages: TurnTraceMessage[];
  graphText?: string;
}) {
  return (
    <section className="turn-trace-message-group">
      <h5>{title}</h5>
      {messages.length > 0 ? (
        messages.map((message) => (
          <div className="turn-trace-message" key={message.id}>
            <strong>{messageHeading(message)}</strong>
            {message.text && <p>{message.text}</p>}
            {message.translatedText && <small>Translated: {message.translatedText}</small>}
            {message.imageCount && <small>{message.imageCount} image attachment(s)</small>}
          </div>
        ))
      ) : !graphText ? <p className="turn-trace-empty">No stored text.</p> : null}
      {graphText && <details><summary>Graph text</summary><HighlightedPreviewText text={graphText} /></details>}
    </section>
  );
}

function stepHasExpandableText(step: TurnTraceLlmCall) {
  return (
    (step.promptBefore?.length ?? 0) > collapsiblePromptCharacters ||
    (step.promptAfter?.length ?? 0) > collapsiblePromptCharacters ||
    (step.promptPasses ?? []).some((pass) =>
      (pass.prompt?.length ?? 0) > collapsiblePromptCharacters ||
      (pass.sections ?? []).some((section) =>
        section.text.length > collapsiblePromptCharacters ||
        (section.parts ?? []).some((part) => part.text.length > collapsiblePromptCharacters),
      ),
    ) ||
    (step.outputPasses ?? []).some((pass) => pass.text.length > collapsiblePromptCharacters) ||
    (step.formatResults ?? []).some((result) => (result.preview?.length ?? 0) > collapsiblePromptCharacters)
  );
}

function tracePromptImagesText(images: TurnTracePromptPass['images']) {
  if (!images?.length) {
    return 'No images supplied to the bridge for this pass.';
  }
  return images
    .map((image) => `Image ${image.index} = ${image.id}${image.name && image.name !== image.id ? ` (${image.name})` : ''}${image.source ? ` · ${image.source}` : ''}`)
    .join('\n');
}

function isTextInputSection(label: string) {
  return label.trim().toLocaleLowerCase() === 'text input';
}

function readableStepName(name: string) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function TracePromptSection({ section }: { section: TurnTracePromptSection }) {
  return (
    <div className={`turn-trace-prompt-section${isTextInputSection(section.label) ? '' : ' prompt'}`}>
      <strong>{section.label}</strong>
      {section.parts?.length ? (
        section.parts.map((part, partIndex) => part.stepOutputInserted ? (
          <div className="turn-trace-step-output-insertion" key={`${section.label}-${partIndex}`}>
            <strong>Add Output {readableStepName(part.stepOutputInserted)}:</strong>
            <HighlightedPreviewText text={part.text} />
          </div>
        ) : (
            <HighlightedPreviewText
              chatHistory={isTextInputSection(section.label) ? 'auto' : 'none'}
              className={part.actionInserted ? 'action-inserted' : ''}
              historySegments={part.historySegments ?? section.historySegments}
              key={`${section.label}-${partIndex}`}
              text={part.text}
            />
          ))
      ) : (
        <HighlightedPreviewText
          chatHistory={isTextInputSection(section.label) ? 'auto' : 'none'}
          historySegments={section.historySegments}
          text={section.text || 'Empty'}
        />
      )}
    </div>
  );
}

function TracePromptPasses({ passes }: { passes: TurnTracePromptPass[] }) {
  return (
    <div className="turn-trace-prompt-passes">
      {passes.map((pass, passIndex) => (
        <section className="turn-trace-prompt-pass" key={`${pass.label}-${passIndex}`}>
          <header>
            <strong>{passIndex + 1}. {pass.label}</strong>
            <span>Captured prompt content</span>
          </header>
          {pass.images !== undefined && (
            <div className="turn-trace-prompt-section images">
              <strong>Images supplied to bridge</strong>
              <pre>{tracePromptImagesText(pass.images)}</pre>
            </div>
          )}
          {pass.sections?.length ? (
            pass.sections
              .map((section) => (
                <TracePromptSection key={`${pass.label}-${section.label}`} section={section} />
              ))
          ) : (
            <div className="turn-trace-prompt-section prompt">
              <strong>Prompt</strong>
              <HighlightedPreviewText chatHistory="auto" text={pass.prompt ?? ''} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function TurnTraceStep({
  step,
  stepId,
  expanded,
  onToggle,
}: {
  step: TurnTraceLlmCall;
  stepId: string;
  expanded: boolean;
  onToggle: (stepId: string, expanded: boolean) => void;
}) {
  const expandable = stepHasExpandableText(step);
  const toggle = () => {
    if (expandable) {
      onToggle(stepId, expanded);
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(stepId, expanded);
    }
  };

  return (
    <div
      className={`turn-trace-step${expandable ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <div className="turn-trace-step-heading">
        <div>
          <strong>{step.order}. {step.nodeLabel}</strong>
          <span>{step.nodeType ?? 'LLM'} · {step.prompt}</span>
        </div>
        {expandable && <span className="turn-trace-step-chevron" aria-hidden="true">▾</span>}
      </div>
      <div className="turn-trace-step-body">
        <small>{step.capture} · {step.phase ?? 'response'} · {step.status ?? 'recorded'}
          {step.dispatched !== undefined && (step.dispatched ? ' · bridge invoked' : ' · not dispatched')}
        </small>
        {step.partialResponse && <div><strong>Partial streamed response</strong><HighlightedPreviewText text={step.partialResponse} /></div>}
        {step.error && <p className="turn-trace-step-warning">{step.error}</p>}
        {step.usage && <small>Provider usage: {step.usage.inputTokens ?? '–'} input / {step.usage.outputTokens ?? '–'} output / {step.usage.reasoningTokens ?? '–'} reasoning tokens · {step.usage.durationMs} ms</small>}
        {step.requestSettings && <pre>{JSON.stringify(step.requestSettings, null, 2)}</pre>}
        {step.stage && <pre>{JSON.stringify(step.stage, null, 2)}</pre>}
        {step.routing && <pre>{JSON.stringify(step.routing, null, 2)}</pre>}
        {(step.selectedOutputChannel !== undefined || step.selectedPromptSlot !== undefined) && (
          <small>
            Output {step.selectedOutputChannel ?? '–'} / Prompt {step.selectedPromptSlot ?? '–'}
          </small>
        )}
        {step.promptPasses?.length ? (
          <TracePromptPasses passes={step.promptPasses} />
        ) : (
          <>
            {step.promptBefore && (
              <p><b>Before:</b> {step.promptBefore}</p>
            )}
            {step.promptAfter && (
              <p><b>After:</b> {step.promptAfter}</p>
            )}
          </>
        )}
        {step.outputPasses?.map((pass, index) => (
          <div className="turn-trace-output-pass" key={`${pass.label}-${index}`}>
            <strong>{pass.label}</strong>
            <HighlightedPreviewText text={pass.text} />
          </div>
        ))}
        {step.formatResults?.map((result, index) => (
          <div
            className={`turn-trace-format-result ${result.status}`}
            key={`${result.name}-${index}`}
          >
            <strong>{result.name}</strong>
            <span>{result.status}</span>
            {result.detail && <p>{result.detail}</p>}
            {result.preview && <HighlightedPreviewText text={result.preview} />}
          </div>
        ))}
        {step.actionResults?.map((text, index) => <HighlightedPreviewText key={`action-${index}`} text={text} />)}
        {step.generatedText && <HighlightedPreviewText text={step.generatedText} />}
        {step.warnings?.map((warning) => (
          <p className="turn-trace-step-warning" key={warning}>{warning}</p>
        ))}
      </div>
      {expandable && (
        <div className="turn-trace-step-expand-hint" aria-hidden="true">
          <span>{expanded ? 'Collapse' : 'Expand'}</span>
          <span>▾</span>
        </div>
      )}
    </div>
  );
}

export function TurnTraceDialog({
  traces,
  estimatedTokenBytesPerToken,
  onClose,
}: TurnTraceDialogProps) {
  const turnNumbers = useMemo(() => traceTurnNumbers(traces), [traces]);
  const initialFromTurn = turnNumbers[Math.max(0, turnNumbers.length - 3)] ?? 0;
  const initialToTurn = turnNumbers[turnNumbers.length - 1] ?? 0;
  const [fromTurn, setFromTurn] = useState(initialFromTurn);
  const [toTurn, setToTurn] = useState(initialToTurn);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [viewMode, setViewMode] = useState<'ui' | 'json'>('ui');
  const [exportFormat, setExportFormat] = useState<'json' | 'toon'>('json');
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const timelineRef = useRef<HTMLElement>(null);
  const turnListRef = useRef<HTMLDivElement>(null);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const textMetrics = useMemo(
    () => new TextMetricsApi(estimatedTokenBytesPerToken),
    [estimatedTokenBytesPerToken],
  );

  const effectiveFromTurn = turnNumbers.includes(fromTurn) ? fromTurn : initialFromTurn;
  const effectiveToTurn = turnNumbers.includes(toTurn) ? toTurn : initialToTurn;

  const selectedTraces = useMemo(
    () =>
      traces
        .filter((trace) => trace.turnNumber >= effectiveFromTurn && trace.turnNumber <= effectiveToTurn)
        .sort(
          (left, right) =>
            left.turnNumber - right.turnNumber ||
            left.startedAt.localeCompare(right.startedAt),
        ),
    [effectiveFromTurn, effectiveToTurn, traces],
  );
  const payload = useMemo(() => turnTraceCopyPayload(selectedTraces, textMetrics), [selectedTraces, textMetrics]);
  const payloadText = useMemo(() => exportFormat === 'json' ? JSON.stringify(payload, null, 2) : formatContextValue(payload, 'toon'), [payload, exportFormat]);
  const copied = copiedText === payloadText;
  const selectedTokenEstimate = useMemo(
    () => textMetrics.measure(payloadText).tokens,
    [payloadText, textMetrics],
  );
  const turnTokenEstimates = useMemo(() => {
    return new Map(turnNumbers.map((turnNumber) => {
      const turnPayload = turnTraceCopyPayload(traces.filter((trace) => trace.turnNumber === turnNumber), textMetrics, payload.createdAt);
      return [turnNumber, textMetrics.measure(exportFormat === 'json' ? JSON.stringify(turnPayload, null, 2) : formatContextValue(turnPayload, 'toon')).tokens];
    }));
  }, [textMetrics, traces, turnNumbers, exportFormat, payload.createdAt]);
  const selectOptions = turnNumbers.map((turnNumber) => ({
    value: turnNumber,
    label: `Turn ${turnNumber}`,
  }));

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (timeline) {
      timeline.scrollTop = timeline.scrollHeight;
    }
    const turnList = turnListRef.current;
    if (turnList) {
      turnList.scrollTop = turnList.scrollHeight;
    }
  }, [effectiveFromTurn, effectiveToTurn, viewMode]);

  function changeFromTurn(value: number) {
    setCopiedText(null);
    setFromTurn(value);
    if (value > effectiveToTurn) {
      setToTurn(value);
    }
  }

  function changeToTurn(value: number) {
    setCopiedText(null);
    setToTurn(value);
    if (value < effectiveFromTurn) {
      setFromTurn(value);
    }
  }

  function copyTrace() {
    void copyTextToClipboard(payloadText)
      .then(() => {
        setCopiedText(payloadText);
        setCopyError('');
      })
      .catch((error) => {
        setCopiedText(null);
        setCopyError(error instanceof Error ? error.message : String(error));
      });
  }

  function toggleStep(stepId: string, expanded: boolean) {
    setExpandedSteps((current) => ({
      ...current,
      [stepId]: !expanded,
    }));
  }

  return (
    <div
      className="turn-trace-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="turn-trace-dialog" role="dialog" aria-modal="true" aria-label="Turn Trace">
        <header className="turn-trace-header">
          <div>
            <h3>Turn Trace</h3>
            <p>
              RAM only · {selectedTraces.length} trace(s) · ~{selectedTokenEstimate.toLocaleString()} tokens
            </p>
          </div>
          <button className="close-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="turn-trace-layout">
          <aside className="turn-trace-range-panel">
            <div>
              <h4>Observed turns</h4>
              <p>RAM only: up to 90 attempts across the latest 30 turn numbers. Loading or resetting clears traces; undo removes that turn's attempts.</p>
            </div>
            {turnNumbers.length > 0 ? (
              <>
                <label>
                  <span>FROM</span>
                  <NodeCustomSelect
                    value={effectiveFromTurn}
                    options={selectOptions}
                    onChange={(value) => changeFromTurn(Number(value))}
                  />
                </label>
                <label>
                  <span>TO</span>
                  <NodeCustomSelect
                    value={effectiveToTurn}
                    options={selectOptions}
                    onChange={(value) => changeToTurn(Number(value))}
                  />
                </label>
                <div className="turn-trace-turn-list" ref={turnListRef}>
                  {turnNumbers.map((turnNumber) => {
                    const inRange = turnNumber >= effectiveFromTurn && turnNumber <= effectiveToTurn;
                    const turnTraces = traces.filter((trace) => trace.turnNumber === turnNumber);
                    const hasError = turnTraces.some((trace) => trace.status === 'error');
                    const hasCancelled = turnTraces.some((trace) => trace.status === 'cancelled');
                    const tokenEstimate = turnTokenEstimates.get(turnNumber) ?? 0;
                    return (
                      <button
                        type="button"
                        className={inRange ? 'selected' : ''}
                        key={turnNumber}
                        onClick={() => {
                          setCopiedText(null);
                          setFromTurn(turnNumber);
                          setToTurn(turnNumber);
                        }}
                      >
                        <span>Turn {turnNumber}</span>
                        <em>
                          {hasError ? 'error' : hasCancelled ? 'cancelled' : turnTraces[0]?.channel ?? 'run'} · ~{tokenEstimate.toLocaleString()}
                        </em>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="turn-trace-empty">Play a turn to begin the in-memory trace.</p>
            )}
          </aside>

          <main
            className={`turn-trace-timeline${viewMode === 'json' ? ' json-mode' : ''}`}
            ref={timelineRef}
          >
            {viewMode === 'json' ? (
              <div className="turn-trace-json-view">
                {exportFormat === 'json' ? <JsonSyntaxTextarea readOnly value={payloadText} /> : <textarea readOnly value={payloadText} aria-label="TOON export preview" />}
              </div>
            ) : selectedTraces.length === 0 ? (
              <p className="turn-trace-empty">No traced turns in this range.</p>
            ) : (
              selectedTraces.map((trace) => (
                <article className={`turn-trace-card ${trace.status}`} key={trace.traceId}>
                  <header>
                    <div>
                      <strong>Turn {trace.turnNumber}</strong>
                      <span>{trace.channel} · {trace.status}</span>
                    </div>
                    <div><small>Run {trace.traceId}</small><time>{new Date(trace.startedAt).toLocaleString()} → {new Date(trace.completedAt).toLocaleTimeString()}</time></div>
                  </header>
                  <TraceMessages
                    title="1. Input"
                    messages={trace.input.messages}
                    graphText={trace.input.graphText}
                  />
                  <section className="turn-trace-route">
                    <h5>2. LLM / Prompt route</h5>
                    {trace.steps.length === 0 ? (
                      <p className="turn-trace-empty">No LLM request was captured.</p>
                    ) : (
                      trace.steps.map((step) => {
                        const stepId = `${trace.traceId}-${step.order}`;
                        return (
                          <TurnTraceStep
                            key={stepId}
                            step={step}
                            stepId={stepId}
                            expanded={expandedSteps[stepId] ?? !!step.promptPasses?.length}
                            onToggle={toggleStep}
                          />
                        );
                      })
                    )}
                  </section>
                  <TraceMessages
                    title={trace.status !== 'completed' ? '3. Output before interruption' : '3. Output'}
                    messages={trace.output.messages}
                    graphText={trace.output.graphText}
                  />
                  {trace.nodeExecutions?.length ? <details>
                    <summary>Node execution timeline ({trace.nodeExecutions.length} events)</summary>
                    {trace.nodeExecutions.map((event, index) => <div key={index}>
                      <strong>{event.nodeLabel} · {event.sourceHandle ?? 'default'} · {event.phase} · {event.status}</strong>
                      <small>{event.at}{event.preparedAtStart ? ' · prepared at start' : ''}</small>
                      {event.error && <p>{event.error}</p>}
                      {event.output !== undefined && <HighlightedPreviewText text={event.output} />}
                      {event.actionResults?.map((text, actionIndex) => <div key={actionIndex}><strong>Action result</strong><HighlightedPreviewText text={text} /></div>)}
                    </div>)}
                  </details> : null}
                  {trace.events?.map((event, index) => <div className="turn-trace-format-result" key={index}>
                    <strong>{event.nodeLabel ?? 'Run'} · {event.kind}</strong>
                    {event.kind === 'warning' ? <p>{event.message}</p> : <>
                      <p>{event.name} · {event.status}</p>
                      {event.detail && <p>{event.detail}</p>}
                      {event.preview && <HighlightedPreviewText text={event.preview} />}
                    </>}
                  </div>)}
                  {trace.warnings?.map((warning) => (
                    <p className="turn-trace-run-warning" key={warning}>{warning}</p>
                  ))}
                  {trace.error && <p className="turn-trace-run-error">{trace.error}</p>}
                </article>
              ))
            )}
          </main>
        </div>

        <footer className="turn-trace-actions">
          <span>Selected range ~{selectedTokenEstimate.toLocaleString()} tokens. Export uses bounded excerpts and local references; UI shows captured text. No image files or RP-save persistence.</span>
          {copyError && <em>{copyError}</em>}
          <label>Export format <select value={exportFormat} onChange={(event) => {
            setExportFormat(event.target.value as 'json' | 'toon');
            setCopiedText(null);
          }}><option value="json">JSON</option><option value="toon">TOON</option></select></label>
          <div className="debug-format-tabs" role="tablist" aria-label="Turn Trace View Mode">
            <button
              className={viewMode === 'ui' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={viewMode === 'ui'}
              onClick={() => setViewMode('ui')}
            >
              UI
            </button>
            <button
              className={viewMode === 'json' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={viewMode === 'json'}
              onClick={() => setViewMode('json')}
            >
              Export preview
            </button>
          </div>
          <button
            className="close-button primary"
            type="button"
            disabled={selectedTraces.length === 0}
            onClick={copyTrace}
          >
            {copied ? 'Copied' : 'Copy Turn Trace'}
          </button>
        </footer>
      </section>
    </div>
  );
}
