import { useState } from 'react';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { WorkflowNode } from '../types';

export const chatGbdModels = ['ChatGBD 5.5', 'ChatGBD 6'] as const;

export type ChatGbdModel = (typeof chatGbdModels)[number];

type ChatGbdMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

export type ChatGbdPhoneApp = {
  messages: ChatGbdMessage[];
  model: ChatGbdModel;
  isSending: boolean;
  nodeAvailable: boolean;
  selectModel: (model: ChatGbdModel) => void;
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
};

type UseChatGbdPhoneAppOptions = {
  nodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  nodeLlm: NodeLlmApi;
  updateLlmNodeActive: (nodeId: string, runActive: boolean) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

function chatGbdPrompt(model: ChatGbdModel, history: ChatGbdMessage[], userMessage: string) {
  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n\n');
  return [
    `You are ${model}, a helpful AI assistant inside a phone chat app.`,
    'Answer the user directly and conversationally. Keep answers concise unless the user asks for detail.',
    'Reply in the language the user writes in. Reply with the answer text only.',
    ...(transcript ? ['', 'Conversation so far:', transcript] : []),
    '',
    `User: ${userMessage}`,
    'Assistant:',
  ].join('\n');
}

export function useChatGbdPhoneApp({
  nodes,
  nodesRef,
  nodeLlm,
  updateLlmNodeActive,
  notifySystem,
}: UseChatGbdPhoneAppOptions): ChatGbdPhoneApp {
  const [messages, setMessages] = useState<ChatGbdMessage[]>([]);
  const [model, setModel] = useState<ChatGbdModel>('ChatGBD 6');
  const [isSending, setIsSending] = useState(false);

  const phoneAppsNode = () =>
    nodesRef.current.find(
      (node) => node.data.kind === undefined && node.data.nodeType === 'phone-apps',
    );

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }
    const node = phoneAppsNode();
    if (!node) {
      notifySystem('warning', 'ChatGBD needs a Phone Apps node in the workflow to select its provider.');
      return;
    }
    const history = messages;
    setMessages((current) => [
      ...current,
      { id: current.length + 1, role: 'user', text: trimmed },
    ]);
    setIsSending(true);
    updateLlmNodeActive(node.id, true);
    try {
      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: 'ChatGBD',
        purpose: 'ChatGBD phone app',
        prompt: chatGbdPrompt(model, history, trimmed),
        maxTokens: 1200,
        temperature: 0.7,
      });
      const answer = completion.text.trim();
      setMessages((current) => [
        ...current,
        {
          id: current.length + 1,
          role: 'assistant',
          text: answer || '...',
        },
      ]);
    } catch (error) {
      notifySystem(
        'error',
        `ChatGBD request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      updateLlmNodeActive(node.id, false);
      setIsSending(false);
    }
  }

  return {
    messages,
    model,
    isSending,
    nodeAvailable: nodes.some(
      (node) => node.data.kind === undefined && node.data.nodeType === 'phone-apps',
    ),
    selectModel: setModel,
    sendMessage,
    clearConversation: () => setMessages([]),
  };
}
