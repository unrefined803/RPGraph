import { useMemo } from 'react';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import type { ConnectionPreset, LlmCallStage, LlmCallStats } from '../types';

type RecordNodeLlmCall = (
  nodeId: string,
  label: string,
  stats: LlmCallStats,
  metadata?: { startedAtMs: number; stage?: LlmCallStage },
) => void;

type UseNodeLlmApiOptions = {
  resolveConnection: (
    connectionId?: string,
    purpose?: string,
    signal?: AbortSignal,
  ) => Promise<ConnectionPreset>;
  recordCall: RecordNodeLlmCall;
};

export function useNodeLlmApi({
  resolveConnection,
  recordCall,
}: UseNodeLlmApiOptions) {
  return useMemo(
    () => new NodeLlmApi({
      resolveConnection,
      recordCall,
    }),
    [recordCall, resolveConnection],
  );
}
