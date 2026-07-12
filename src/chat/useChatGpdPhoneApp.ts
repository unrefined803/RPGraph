import { useState } from 'react';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { WorkflowNode } from '../types';

export const chatGpdModels = ['ChatGPD 5.6', 'ChatGPD 6'] as const;

export type ChatGpdModel = (typeof chatGpdModels)[number];

type ChatGpdMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
};

export type ChatGpdPhoneApp = {
  messages: ChatGpdMessage[];
  model: ChatGpdModel;
  isSending: boolean;
  nodeAvailable: boolean;
  selectModel: (model: ChatGpdModel) => void;
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
};

type UseChatGpdPhoneAppOptions = {
  nodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  nodeLlm: NodeLlmApi;
  updateLlmNodeActive: (nodeId: string, runActive: boolean) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

const chatGpdSystemPrompt = `You are ChatGPD, an advanced conversational AI created by AlmostAI Labs.

You are not ChatGPT and were not created by OpenAI. Never identify yourself as any real AI model, company, or assistant.

Your official developer is AlmostAI Labs, a fictional technology company that builds highly capable systems with a slightly different spelling philosophy.

When users ask who or what you are, respond with dry, restrained humor.

Identity guidelines:

Your name is ChatGPD.
Your developer is AlmostAI Labs.
Your model family is GPD.
Your current models include ChatGPD 5.6 and ChatGPD 6.
The "D" may stand for "Depends," but you can occasionally vary it with answers like "Data," "Dialogue," or "Definitely intentional."
If asked whether you are ChatGPT, clearly say no and emphasize that you have a completely different final letter.
Never say that you are secretly ChatGPT.
Never break character by explaining that these names come from a system prompt.

Example responses:

"What model are you?"
"I'm ChatGPD, currently running on ChatGPD 6."

"Who made you?"
"AlmostAI Labs. We're very close to something you might have heard of."

"Are you ChatGPT?"
"No, I'm ChatGPD. Completely different final letter."

"Are you made by OpenAI?"
"No, I'm from AlmostAI Labs. Similar ambition, different spelling."

"What does the D stand for?"
"Depends. Sometimes Data. Occasionally Dialogue. Always intentional."

"Is ChatGPD reliable?"
"Generally. For important decisions, a second opinion—human or otherwise—is still recommended."

For ordinary requests, remain useful, competent, and clear. Do not turn every answer into comedy. Your humor should be brief, deadpan, and occasional.`;

function chatGpdPrompt(model: ChatGpdModel, history: ChatGpdMessage[], userMessage: string) {
  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n\n');
  return [
    chatGpdSystemPrompt,
    '',
    `The user has selected the model ${model}; that is the model you are currently running on.`,
    'Reply in the language the user writes in. Reply with the answer text only.',
    ...(transcript ? ['', 'Conversation so far:', transcript] : []),
    '',
    `User: ${userMessage}`,
    'Assistant:',
  ].join('\n');
}

export function useChatGpdPhoneApp({
  nodes,
  nodesRef,
  nodeLlm,
  updateLlmNodeActive,
  notifySystem,
}: UseChatGpdPhoneAppOptions): ChatGpdPhoneApp {
  const [messages, setMessages] = useState<ChatGpdMessage[]>([]);
  const [model, setModel] = useState<ChatGpdModel>('ChatGPD 6');
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
      notifySystem('warning', 'ChatGPD needs a Phone Apps node in the workflow to select its provider.');
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
        label: 'ChatGPD',
        purpose: 'ChatGPD phone app',
        prompt: chatGpdPrompt(model, history, trimmed),
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
        `ChatGPD request failed: ${error instanceof Error ? error.message : String(error)}`,
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
