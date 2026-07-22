import type { ConnectionPreset, LlmCallStage, LlmCallStats } from '../types';
import type { CalibrationSample, NodeLlmRequest, NodeLlmResult } from './types';

type NodeLlmApiOptions = {
  resolveConnection: (
    connectionId?: string,
    purpose?: string,
    signal?: AbortSignal,
  ) => Promise<ConnectionPreset>;
  recordCall?: (
    nodeId: string,
    label: string,
    stats: LlmCallStats,
    metadata?: { startedAtMs: number; stage?: LlmCallStage },
  ) => void;
  recordCalibrationSample?: (sample: CalibrationSample) => void;
  onCallStart?: (
    nodeId: string,
    metadata: { hasImages: boolean; label: string; stage?: LlmCallStage; startedAtMs: number },
  ) => void;
  onCallEnd?: (nodeId: string) => void;
  signal?: AbortSignal;
};

function registerAbortCancel(signal: AbortSignal | undefined, cancel: () => void) {
  if (!signal) {
    return undefined;
  }
  if (signal.aborted) {
    cancel();
    return undefined;
  }
  signal.addEventListener('abort', cancel, { once: true });
  return () => signal.removeEventListener('abort', cancel);
}

export class NodeLlmApi {
  constructor(private readonly options: NodeLlmApiOptions) {}

  withCalibrationSamples(recordCalibrationSample: (sample: CalibrationSample) => void) {
    return new NodeLlmApi({
      ...this.options,
      recordCalibrationSample,
    });
  }

  withCallLifecycle(
    onCallStart: (
      nodeId: string,
      metadata: { hasImages: boolean; label: string; stage?: LlmCallStage; startedAtMs: number },
    ) => void,
    onCallEnd: (nodeId: string) => void,
  ) {
    return new NodeLlmApi({
      ...this.options,
      onCallStart,
      onCallEnd,
    });
  }

  withAbortSignal(signal: AbortSignal | undefined) {
    return new NodeLlmApi({
      ...this.options,
      signal,
    });
  }

  resolveConnection(connectionId?: string, purpose?: string, signal?: AbortSignal) {
    return this.options.resolveConnection(connectionId, purpose, signal ?? this.options.signal);
  }

  async supportsVision(connectionId?: string, purpose?: string, signal?: AbortSignal) {
    const connection = await this.resolveConnection(connectionId, purpose, signal);
    return !!connection.vision;
  }

  async complete(request: NodeLlmRequest): Promise<NodeLlmResult> {
    const signal = request.signal ?? this.options.signal;
    if (signal?.aborted) {
      throw new Error('The LLM request was cancelled.');
    }
    const startedAtMs = performance.now();
    let cleanupAbort: (() => void) | undefined;
    try {
      const connection = await this.options.resolveConnection(
        request.connectionId,
        request.purpose ?? request.label,
        signal,
      );
      const images = connection.vision ? request.images : undefined;
      if (request.nodeId) {
        this.options.onCallStart?.(request.nodeId, {
          hasImages: (images?.length ?? 0) > 0,
          label: request.label,
          stage: request.stage,
          startedAtMs,
        });
      }
      // Connection sampling settings are opt-in: only the story prompt
      // (LLM Prompt / LLM Prompt Switch) follows them. Every other call keeps
      // its fixed internal temperature so parsing-sensitive helpers stay stable.
      const sampling = request.useConnectionSampling
        ? {
            temperature: request.temperature ?? connection.temperature,
            topP: connection.topP,
            presencePenalty: connection.presencePenalty,
            frequencyPenalty: connection.frequencyPenalty,
          }
        : { temperature: request.temperature };
      const completion = request.onChunk
        ? await window.rpgraph.streamChatCompletion(
            {
              connection,
              prompt: request.prompt,
              images,
              maxTokens: request.maxTokens,
              ...sampling,
            },
            request.onChunk,
            (cancel) => {
              cleanupAbort = registerAbortCancel(signal, cancel);
            },
          )
        : await window.rpgraph.chatCompletion(
            {
              connection,
              prompt: request.prompt,
              images,
              maxTokens: request.maxTokens,
              ...sampling,
            },
            (cancel) => {
              cleanupAbort = registerAbortCancel(signal, cancel);
            },
          );

      if (request.nodeId) {
        this.options.recordCall?.(request.nodeId, request.label, completion.stats, {
          startedAtMs,
          stage: request.stage,
        });
      }
      if (request.contributesToTokenCalibration) {
        this.options.recordCalibrationSample?.({ prompt: request.prompt, stats: completion.stats });
      }

      return { ...completion, connection };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      cleanupAbort?.();
      if (request.nodeId) {
        this.options.onCallEnd?.(request.nodeId);
      }
    }
  }
}
