/* eslint-disable react-refresh/only-export-components */
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CharacterStatDefinition, CharacterStatsTimelineEntry, WorkflowNode } from '../../types';
import {
  characterStatDefinitionsForEditing,
  characterStatsMaxChange,
  normalizeCharacterStatsState,
} from '../../workflow';
import { defaultCharacterStatDefinitions } from '../../workflow/defaults';
import { storyCharacterRefsFromNodes } from '../../storybook/runtime';
import { useNodeActions } from '../NodeActionsContext';
import { useNodeView } from '../NodeViewContext';
import { ConnectionSelect } from '../shared/ConnectionSelect';
import { LlmCallMetrics, runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { PortLabel } from '../shared/PortValue';
import { PostOutputToggle } from '../shared/PostOutputToggle';

export const characterStatChartColors = ['#70d7ff', '#f87171', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#60a5fa', '#f472b6'];

const characterStatsHelpText = [
  'Tracks numeric 0-100 attributes for each named Storybook character.',
  'On first run, the LLM initializes baseline values and current values from the connected Initial Context.',
  'Baseline is the character default/resting state; current value is the scene state.',
  'On later turns, RP time moves current values back toward baseline before the LLM applies situation deltas from Last Message.',
  'Max Change Per Turn limits each LLM delta; code-driven time relaxation can still move values toward baseline between turns.',
].join('\n');

function parseChartDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatChartTime(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relaxedChartValue(current: number, baseline: number, elapsedHours: number) {
  const factor = Math.min(1, Math.max(0, elapsedHours / 10));
  return Math.min(100, Math.max(0, Math.round(current + (baseline - current) * factor)));
}

function normalizeCharacterStatsChanges(nodeIds: string[], changes?: ReturnType<typeof normalizeCharacterStatsState>) {
  return {
    characters: Object.fromEntries(
      nodeIds.map((nodeId) => [
        nodeId,
        Object.fromEntries(
          Object.entries(changes?.characters[nodeId] ?? {})
            .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
            .map(([statId, value]) => [statId, Math.round(value)]),
        ),
      ]),
    ),
  };
}

function nextCustomStatDefinition(definitions: CharacterStatDefinition[]): CharacterStatDefinition {
  const existingIds = new Set(definitions.map((definition) => definition.id));
  let index = definitions.length + 1;
  let id = `custom-stat-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `custom-stat-${index}`;
  }
  return {
    id,
    name: `Custom Stat ${index}`,
    description: '',
    enabled: true,
  };
}

export function CharacterStatsChart({
  definitions,
  selectedCharacterId,
  selectedStats,
  timeline = [],
}: {
  definitions: CharacterStatDefinition[];
  selectedCharacterId?: string;
  selectedStats: Set<string>;
  timeline?: CharacterStatsTimelineEntry[];
}) {
  const width = 920;
  const height = 480;
  const plot = { left: 52, right: 24, top: 22, bottom: 48 };
  const [viewport, setViewport] = useState<{ start: number; end: number } | undefined>();
  const dragRef = useRef<{ x: number; start: number; end: number } | undefined>(undefined);
  const entries = useMemo(
    () =>
      timeline
        .map((entry) => ({ ...entry, time: parseChartDate(entry.rpDateTime)?.getTime() }))
        .filter((entry): entry is CharacterStatsTimelineEntry & { time: number } => entry.time !== undefined)
        .sort((left, right) => left.time - right.time),
    [timeline],
  );
  if (!selectedCharacterId || entries.length === 0) {
    return <div className="character-stats-chart-empty">Run Character Stats with RP time to collect chart points.</div>;
  }
  const fullMinTime = entries[0].time;
  const fullMaxTime = entries.length > 1 ? entries[entries.length - 1].time : fullMinTime + 60 * 60 * 1000;
  const fullSpan = Math.max(1, fullMaxTime - fullMinTime);
  const viewStart = Math.max(fullMinTime, Math.min(viewport?.start ?? fullMinTime, fullMaxTime));
  const viewEnd = Math.max(viewStart + 1, Math.min(viewport?.end ?? fullMaxTime, fullMaxTime));
  const timeSpan = Math.max(1, viewEnd - viewStart);
  const x = (time: number) => plot.left + ((time - viewStart) / timeSpan) * (width - plot.left - plot.right);
  const y = (value: number) => plot.top + ((100 - value) / 100) * (height - plot.top - plot.bottom);
  const activeStats = definitions.filter((definition) => definition.enabled && selectedStats.has(definition.id));
  const turnClusters = entries.reduce<Array<{ time: number; turnNumbers: number[]; key: string }>>((clusters, entry) => {
    const last = clusters[clusters.length - 1];
    if (last && entry.time - last.time <= 10 * 60 * 1000) {
      last.time = (last.time + entry.time) / 2;
      if (entry.turnNumber !== undefined && !last.turnNumbers.includes(entry.turnNumber)) {
        last.turnNumbers.push(entry.turnNumber);
      }
      last.key += `-${entry.rpDateTime}`;
      return clusters;
    }
    clusters.push({
      time: entry.time,
      turnNumbers: entry.turnNumber === undefined ? [] : [entry.turnNumber],
      key: entry.rpDateTime,
    });
    return clusters;
  }, []);
  const linePath = (stat: CharacterStatDefinition) => {
    const points = entries.flatMap((entry, index) => {
      const current = entry.state.characters[selectedCharacterId]?.[stat.id] ?? 50;
      const baseline = entry.baselineState.characters[selectedCharacterId]?.[stat.id] ?? current;
      const nextTime = entries[index + 1]?.time ?? entry.time;
      const durationHours = Math.max(0, (nextTime - entry.time) / 3_600_000);
      const samples = Math.max(1, Math.min(12, Math.ceil(durationHours)));
      return Array.from({ length: samples + 1 }, (_, sampleIndex) => {
        const ratio = samples === 0 ? 0 : sampleIndex / samples;
        const sampleTime = entry.time + (nextTime - entry.time) * ratio;
        const value = relaxedChartValue(current, baseline, durationHours * ratio);
        return `${x(sampleTime)},${y(value)}`;
      });
    });
    return points.length ? `M ${points.join(' L ')}` : '';
  };
  const clampViewport = (start: number, end: number) => {
    const minSpan = Math.min(fullSpan, 5 * 60 * 1000);
    let nextStart = start;
    let nextEnd = Math.max(start + minSpan, end);
    const span = nextEnd - nextStart;
    if (span >= fullSpan) {
      return undefined;
    }
    if (nextStart < fullMinTime) {
      nextStart = fullMinTime;
      nextEnd = nextStart + span;
    }
    if (nextEnd > fullMaxTime) {
      nextEnd = fullMaxTime;
      nextStart = nextEnd - span;
    }
    return { start: nextStart, end: nextEnd };
  };
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const anchor = viewStart + timeSpan * pointerRatio;
    const zoom = event.deltaY < 0 ? 0.78 : 1.28;
    const nextSpan = timeSpan * zoom;
    setViewport(clampViewport(anchor - nextSpan * pointerRatio, anchor + nextSpan * (1 - pointerRatio)));
  };
  const handleMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    dragRef.current = { x: event.clientX, start: viewStart, end: viewEnd };
  };
  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pixels = Math.max(1, rect.width);
    const deltaTime = ((event.clientX - dragRef.current.x) / pixels) * timeSpan;
    setViewport(clampViewport(dragRef.current.start - deltaTime, dragRef.current.end - deltaTime));
  };
  const stopDragging = () => {
    dragRef.current = undefined;
  };

  return (
    <div className="character-stats-chart">
      <svg
        className="character-stats-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Character stats over RP time"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        <defs>
          <clipPath id="character-stats-chart-plot">
            <rect x={plot.left} y={plot.top} width={width - plot.left - plot.right} height={height - plot.top - plot.bottom} />
          </clipPath>
        </defs>
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line className="character-stats-chart-grid" x1={plot.left} x2={width - plot.right} y1={y(value)} y2={y(value)} />
            <text className="character-stats-chart-axis" x={plot.left - 7} y={y(value) + 4} textAnchor="end">{value}</text>
          </g>
        ))}
        {turnClusters.map((cluster) => (
          <g key={cluster.key}>
            <line className="character-stats-chart-turn" x1={x(cluster.time)} x2={x(cluster.time)} y1={plot.top} y2={height - plot.bottom} />
            <text className="character-stats-chart-turn-label" x={x(cluster.time) + 5} y={plot.top + 15}>
              {cluster.turnNumbers.length ? `Turn ${cluster.turnNumbers.join(', ')}` : 'Turn'}
            </text>
          </g>
        ))}
        <g clipPath="url(#character-stats-chart-plot)">
          {activeStats.map((stat, index) => (
            <path
              className="character-stats-chart-line"
              d={linePath(stat)}
              key={stat.id}
              stroke={characterStatChartColors[index % characterStatChartColors.length]}
            />
          ))}
        </g>
        <line className="character-stats-chart-axis-line" x1={plot.left} x2={width - plot.right} y1={height - plot.bottom} y2={height - plot.bottom} />
        <line className="character-stats-chart-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={height - plot.bottom} />
        <text className="character-stats-chart-axis" x={plot.left} y={height - 12}>{formatChartTime(viewStart)}</text>
        <text className="character-stats-chart-axis" x={width - plot.right} y={height - 12} textAnchor="end">{formatChartTime(viewEnd)}</text>
      </svg>
      <div className="character-stats-chart-legend">
        {activeStats.map((stat, index) => (
          <span key={stat.id}>
            <i style={{ background: characterStatChartColors[index % characterStatChartColors.length] }} />
            {stat.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatDefinitionRows({
  nodeId,
  label,
  field,
  definitions,
  primaryId,
  state,
  baselineState,
  lastChanges,
}: {
  nodeId: string;
  label: string;
  field: 'characterStatDefinitions';
  definitions: CharacterStatDefinition[];
  primaryId?: string;
  state: ReturnType<typeof normalizeCharacterStatsState>;
  baselineState: ReturnType<typeof normalizeCharacterStatsState>;
  lastChanges?: ReturnType<typeof normalizeCharacterStatsState>;
}) {
  const actions = useNodeActions();

  function changeDefinition(index: number, patch: Partial<CharacterStatDefinition>) {
    actions.updateData(nodeId, {
      [field]: definitions.map((definition, definitionIndex) =>
        definitionIndex === index ? { ...definition, ...patch } : definition,
      ),
    });
  }

  function addDefinition() {
    actions.updateData(nodeId, {
      [field]: [...definitions, nextCustomStatDefinition(definitions)],
    });
  }

  function removeDefinition(index: number) {
    actions.updateData(nodeId, {
      [field]: definitions.filter((_, definitionIndex) => definitionIndex !== index),
    });
  }

  const existingIds = new Set(definitions.map((definition) => definition.id));
  const missingDefaults = defaultCharacterStatDefinitions.filter(
    (definition) => !existingIds.has(definition.id),
  );

  function restoreDefaultDefinitions() {
    // Re-adds default stats the user removed (restoring each stat's original id,
    // and therefore its accumulated state and chart history). Also the upgrade
    // path when a release ships new default stats.
    actions.updateData(nodeId, {
      [field]: [...definitions, ...missingDefaults],
    });
  }

  function valueFor(definition: CharacterStatDefinition) {
    if (!primaryId) {
      return undefined;
    }
    return {
      value: state.characters[primaryId]?.[definition.id] ?? 50,
      baseline: baselineState.characters[primaryId]?.[definition.id] ?? 50,
      change: lastChanges?.characters[primaryId]?.[definition.id],
    };
  }

  function formatChange(change: number | undefined) {
    if (!change) {
      return '';
    }
    return ` (${change > 0 ? '+' : ''}${change})`;
  }

  return (
    <div className="character-stats-section">
      <span className="node-field-label">{label}</span>
      <div className="character-stats-definitions">
        {definitions.map((definition, index) => {
          const primaryValue = valueFor(definition);
          return (
            <div className="character-stats-definition" key={definition.id}>
              <input
                className="nodrag nowheel"
                type="checkbox"
                checked={definition.enabled}
                onChange={(event) => changeDefinition(index, { enabled: event.target.checked })}
              />
              <div className="character-stats-main">
                <div className="character-stats-name-row">
                  <input
                    className="node-stat-name-input nodrag nowheel"
                    value={definition.name}
                    onChange={(event) => changeDefinition(index, { name: event.target.value })}
                    aria-label={`${definition.name} stat name`}
                  />
                  <button
                    className="character-stats-remove-button nodrag"
                    type="button"
                    onClick={() => removeDefinition(index)}
                    disabled={definitions.length <= 1}
                    title={
                      definitions.length <= 1
                        ? 'At least one attribute is required'
                        : undefined
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="character-stats-values" aria-label={`${definition.name} values`}>
                {primaryValue && (
                  <>
                    <span className="character-stat-baseline">[{primaryValue.baseline}]</span>
                    <span className="character-stat-value primary">
                      {primaryValue.value}{formatChange(primaryValue.change)}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="character-stats-definition-actions">
        <button className="inspect-button character-stats-add-button nodrag" type="button" onClick={addDefinition}>
          Add Attribute
        </button>
        {missingDefaults.length > 0 && (
          <button
            className="inspect-button nodrag"
            type="button"
            onClick={restoreDefaultDefinitions}
          >
            Restore Default Stats
          </button>
        )}
      </div>
    </div>
  );
}

export function CharacterStatsNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const actions = useNodeActions();
  const view = useNodeView();
  const nodeBodyRef = useNodeLayoutSync(id);
  const characters = storyCharacterRefsFromNodes(view.nodes);
  const characterStats = characterStatDefinitionsForEditing(data);
  const characterIds = new Set(characters.map((character) => character.nodeId));
  const selectedPrimaryId =
    data.characterStatsPrimaryId && characterIds.has(data.characterStatsPrimaryId)
      ? data.characterStatsPrimaryId
      : characters[0]?.nodeId;
  const statsState = normalizeCharacterStatsState(view.nodes, data.characterStatsState);
  const baselineState = normalizeCharacterStatsState(view.nodes, data.characterStatsBaselineState);
  const lastChanges = data.characterStatsLastChanges
    ? normalizeCharacterStatsChanges([...characterIds], data.characterStatsLastChanges)
    : undefined;
  function selectCharacter(characterId: string) {
    if (characterId === selectedPrimaryId) {
      return;
    }
    actions.updateData(id, { characterStatsPrimaryId: characterId });
  }

  return (
    <div className={`workflow-node character-stats-node${runStateClassName(data)}`} ref={nodeBodyRef}>
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label}</strong>
        <button
          className="node-info-button character-stats-help-button nodrag"
          type="button"
          aria-label="Character Stats help"
          data-tooltip={characterStatsHelpText}
        >
          ?
        </button>
      </div>
      <LlmCallMetrics data={data} />
      <span className="node-description">{data.description}</span>
      <ConnectionSelect id={id} label="STATS LLM" connectionId={data.connectionId} />
      <PostOutputToggle id={id} enabled={data.runAfterRpOutput} />
      <label className="node-field-label" htmlFor={`${id}-max-change`}>
        MAX CHANGE PER TURN
      </label>
      <input
        className="node-number-input nodrag nowheel"
        id={`${id}-max-change`}
        type="number"
        min={0}
        max={100}
        step={1}
        value={characterStatsMaxChange(data)}
        onChange={(event) => actions.updateData(id, { characterStatsMaxChange: Number(event.target.value) })}
      />
      <span className="node-field-label">KNOWN STORYBOOK CHARACTERS</span>
      <div className="resolver-cast-list">
        {characters.length > 0
          ? characters.map((character) => (
              <button
                className={`resolver-cast-chip character-select-chip nodrag ${
                  character.nodeId === selectedPrimaryId
                    ? 'primary'
                    : 'inactive'
                }`}
                key={character.nodeId}
                type="button"
                onClick={() => selectCharacter(character.nodeId)}
              >
                {character.label}
              </button>
            ))
          : <span className="run-note">Add a named Storybook character.</span>}
      </div>
      <StatDefinitionRows
        nodeId={id}
        label="CHARACTER STATS"
        field="characterStatDefinitions"
        definitions={characterStats}
        primaryId={selectedPrimaryId}
        state={statsState}
        baselineState={baselineState}
        lastChanges={lastChanges}
      />
      <div className="node-actions resolver-actions">
        <span className="run-note">{data.characterStatsStatus ?? data.preview}</span>
        <button className="inspect-button nodrag" type="button" onClick={() => actions.clearCharacterStatsState(id)}>
          Reinitialize
        </button>
        <button className="inspect-button nodrag" type="button" onClick={() => actions.textPreview(id)}>
          Show State
        </button>
        <button className="inspect-button nodrag" type="button" onClick={() => actions.showCharacterStatsContext(id)}>
          Show Context + Stats
        </button>
        <button className="inspect-button nodrag" type="button" onClick={() => actions.showCharacterStatsPrompts(id)}>
          Prompts
        </button>
        <button className="inspect-button character-stats-chart-button nodrag" type="button" onClick={() => actions.showCharacterStatsChart(id)}>
          Chart
        </button>
        <button
          className="inspect-button nodrag"
          type="button"
          disabled={!data.characterStatsLastResponse}
          onClick={() => actions.showCharacterStatsResponse(id)}
        >
          Show Update TOON
        </button>
      </div>
      <div className="resolver-ports character-stats-ports">
        <div className="resolver-port resolver-port-input">
          <Handle id="last-message" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="last-message" label="Last Message" valueType="text" />
        </div>
        <div className="resolver-port resolver-port-input">
          <Handle id="initial-context" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="initial-context" label="Initial Context" valueType="text" />
        </div>
        <div className="resolver-port resolver-port-output">
          <PortLabel data={data} direction="output" label="Stats State" valueType="text" />
          <Handle type="source" position={Position.Right} />
        </div>
        <div className="resolver-port resolver-port-output">
          <PortLabel data={data} direction="output" handle="context" label="Context + Stats" valueType="text" />
          <Handle id="context" type="source" position={Position.Right} />
        </div>
      </div>
    </div>
  );
}
