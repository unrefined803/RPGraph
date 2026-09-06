import { formatContextValue } from '../data-management/formatters';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

function TraceDisclosure({ title, detail, children, open = false }: {
  title: string; detail?: string; children: ReactNode; open?: boolean;
}) {
  return <details className="turn-trace-disclosure" open={open}>
    <summary><span>{title}</span>{detail && <small>{detail}</small>}<span className="turn-trace-disclosure-chevron" aria-hidden="true">▾</span></summary>
    <div className="turn-trace-disclosure-body">{children}</div>
  </details>;
}

function TraceMetadata({ values }: { values: Record<string, unknown> }) {
  return <dl className="turn-trace-metadata">
    {Object.entries(values).filter(([, value]) => value !== undefined).map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>,
    )}
  </dl>;
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
  const distinctGraphText = graphText && !messages.some((message) =>
    message.text === graphText || message.translatedText === graphText,
  ) && messages.map((message) => message.text).join('\n\n') !== graphText;
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
      {distinctGraphText && <TraceDisclosure title="Graph text" detail="Additional graph content" open={messages.length === 0}>
        <HighlightedPreviewText text={graphText} />
      </TraceDisclosure>}
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
  if (!section.text && !section.parts?.some((part) => part.text)) return null;
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
          {!!pass.images?.length && (
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
  const toggle = () => onToggle(stepId, expanded);
  return (
    <div
      className={`turn-trace-step${expandable ? ' collapsible' : ''}${expanded ? ' expanded' : ''}`}
    >
      <button type="button" className="turn-trace-step-heading" onClick={toggle} aria-expanded={expanded} disabled={!expandable}>
        <span className="turn-trace-step-label">
          <strong>{step.order}. {step.nodeLabel}</strong>
          <span>{step.nodeType ?? 'LLM'} · {step.prompt}</span>
        </span>
        {expandable && <span className="turn-trace-step-chevron" aria-hidden="true">▾</span>}
      </button>
      <div className="turn-trace-badges">
          <span className={`turn-trace-status ${step.status ?? 'pending'}`}>{step.status ?? 'Recorded'}</span>
          <span>{step.phase === 'prepare-next-turn' ? 'Next-turn preparation' : 'Response'}</span>
          {step.selectedOutputChannel !== undefined && <span>Output {step.selectedOutputChannel} · Prompt {step.selectedPromptSlot ?? '–'}</span>}
          {step.usage && <span>{(step.usage.durationMs / 1000).toFixed(2)} s</span>}
        </div>
        {step.error && <p className="turn-trace-step-warning">{step.error}</p>}
      <div className="turn-trace-step-body">
        {step.partialResponse && <div className="turn-trace-output-pass"><strong>Partial response</strong><HighlightedPreviewText text={step.partialResponse} /></div>}
        <TraceDisclosure title="Request details" detail={step.requestSettings?.model}>
          <TraceMetadata values={{
            Capture: step.capture, Dispatched: step.dispatched, Model: step.requestSettings?.model,
            Provider: step.requestSettings?.providerKind, Connection: step.requestSettings?.connectionId,
            Temperature: step.requestSettings?.temperature, 'Top P': step.requestSettings?.topP,
            'Presence penalty': step.requestSettings?.presencePenalty, 'Frequency penalty': step.requestSettings?.frequencyPenalty,
            'Reasoning effort': step.requestSettings?.reasoningEffort, 'Maximum tokens': step.requestSettings?.maxTokens,
            Stage: step.stage?.kind, 'Stage name': step.stage && 'name' in step.stage ? step.stage.name : undefined,
            Replay: step.stage?.kind === 'step' ? step.stage.replay : undefined,
            Correction: step.stage && 'correction' in step.stage ? step.stage.correction : undefined,
            'Routing input': step.routing?.outputChannelValue, 'Prompt input': step.routing?.promptSlotValue,
            'Input tokens': step.usage?.inputTokens, 'Output tokens': step.usage?.outputTokens,
            'Reasoning tokens': step.usage?.reasoningTokens, 'Total tokens': step.usage?.totalTokens,
            Started: step.startedAt, Completed: step.completedAt,
          }} />
        </TraceDisclosure>
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
        <button type="button" className="turn-trace-step-expand-hint" onClick={toggle} aria-expanded={expanded}>
          <span>{expanded ? 'Collapse' : 'Expand'}</span>
          <span aria-hidden="true">▾</span>
        </button>
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
          <div className="turn-trace-title">
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
              <p title="Up to 90 attempts across 30 turn numbers. Loading or resetting clears traces; undo removes that turn’s attempts.">Recent runs · stored in memory</p>
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
                    <div title={`Run ${trace.traceId}`}><time>{new Date(trace.startedAt).toLocaleString()} → {new Date(trace.completedAt).toLocaleTimeString()}</time></div>
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
                            expanded={expandedSteps[stepId] ?? (step.nodeType === 'llm-prompt' || step.nodeType === 'llm-prompt-switch' || step.status === 'error')}
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
                  <section className="turn-trace-diagnostics">
                    {trace.nodeExecutions?.length ? <TraceDisclosure title="Node execution timeline" detail={`${trace.nodeExecutions.length} events`}
                      open={trace.nodeExecutions.some((event) => event.status === 'error')}>
                      {(['response', 'prepare-next-turn'] as const).map((phase) => {
                        const events = trace.nodeExecutions!.filter((event) => event.phase === phase);
                        return events.length ? <div className="turn-trace-node-phase" key={phase}>
                          <h5>{phase === 'response' ? 'Response' : 'Next-turn preparation'}</h5>
                          {events.map((event, index) => <div className={`turn-trace-node-event ${event.status}`} key={index}>
                            <div className="turn-trace-node-event-heading">
                              <strong>{event.nodeLabel}</strong>
                              <span className={`turn-trace-status ${event.status}`}>{event.status}</span>
                              <time title={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
                            </div>
                            <div className="turn-trace-node-event-meta">{event.sourceHandle ?? 'Default output'}{event.preparedAtStart ? ' · prepared at start' : ''}</div>
                            {event.error && <p className="turn-trace-step-warning">{event.error}</p>}
                            {!!event.output && <TraceDisclosure title="Node output"><HighlightedPreviewText text={event.output} /></TraceDisclosure>}
                            {event.actionResults?.map((text, actionIndex) => <TraceDisclosure key={actionIndex} title={`Action result ${actionIndex + 1}`}><HighlightedPreviewText text={text} /></TraceDisclosure>)}
                          </div>)}
                        </div> : null;
                      })}
                    </TraceDisclosure> : null}
                    {!!trace.events?.length && <TraceDisclosure title="Validation and diagnostics"
                      detail={`${trace.events.length} checks`}
                      open={trace.events.some((event) => event.kind === 'warning' || event.status === 'error')}>
                      {trace.events.map((event, index) => <div className={`turn-trace-format-result ${event.kind === 'warning' ? 'warning' : event.status}`} key={index}>
                        <strong>{event.kind === 'warning' ? event.nodeLabel ?? 'Run warning' : event.name}</strong>
                        <span>{event.kind === 'warning' ? 'Warning' : event.status}</span>
                        {event.kind === 'warning' ? <p>{event.message}</p> : <>
                          {event.detail && <p>{event.detail}</p>}
                          {event.preview && <HighlightedPreviewText text={event.preview} />}
                        </>}
                      </div>)}
                    </TraceDisclosure>}
                    <TraceDisclosure title="Run details">
                      <TraceMetadata values={{ 'Run ID': trace.traceId, 'Turn ID': trace.turnId,
                        'Turn created': trace.turnCreatedAt, Started: trace.startedAt, Completed: trace.completedAt }} />
                    </TraceDisclosure>
                  </section>
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
          <span className="turn-trace-export-note" title="Exports contain bounded text excerpts and local references. Image files are excluded; traces are not saved with the RP.">Text export · no image files</span>
          {copyError && <em role="alert">{copyError}</em>}
          <div className="turn-trace-export-format">
            <span>Export format</span>
            <div className="debug-format-tabs" role="group" aria-label="Export format">
              {(['json', 'toon'] as const).map((format) => <button key={format} type="button"
                className={exportFormat === format ? 'active' : ''} aria-pressed={exportFormat === format}
                onClick={() => { setExportFormat(format); setCopiedText(null); }}>
                {format.toUpperCase()}
              </button>)}
            </div>
          </div>
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
