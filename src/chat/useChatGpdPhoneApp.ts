import { useState, type Dispatch, type SetStateAction } from 'react';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { WorkflowNode } from '../types';
import type {
  ChatGpdChatRecord,
  ChatGpdChatsByCharacter,
} from './phoneAppsSessions';
import { chatGpdFallbackTitle } from './phoneAppsSessions';

export const chatGpdModels = ['ChatGPD 5.6', 'ChatGPD 6'] as const;

export type ChatGpdModel = (typeof chatGpdModels)[number];

export type ChatGpdPhoneApp = {
  chats: ChatGpdChatRecord[];
  activeChat?: ChatGpdChatRecord;
  model: ChatGpdModel;
  isSending: boolean;
  sendingChatId?: string;
  /** Partial answer of the chat currently receiving a streamed response. */
  streaming?: { chatId: string; text: string };
  nodeAvailable: boolean;
  characterAvailable: boolean;
  selectModel: (model: ChatGpdModel) => void;
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  deleteChat: (chatId: string) => void;
  sendMessage: (text: string) => Promise<void>;
};

type UseChatGpdPhoneAppOptions = {
  nodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  viewedCharacterId?: string;
  chatsByCharacter: ChatGpdChatsByCharacter;
  setChatsByCharacter: Dispatch<SetStateAction<ChatGpdChatsByCharacter>>;
  model: ChatGpdModel;
  onModelChange: (model: ChatGpdModel) => void;
  nodeLlm: NodeLlmApi;
  updateLlmNodeActive: (nodeId: string, runActive: boolean, label?: string) => void;
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

function chatGpdPrompt(model: ChatGpdModel, history: ChatGpdChatRecord['messages'], userMessage: string) {
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

function chatGpdTitlePrompt(question: string, answer: string) {
  return [
    'Write a very short chat title (3 to 5 words) describing the topic of this conversation.',
    'Use the language of the user message. Reply with the title only: no quotes, no punctuation at the end.',
    '',
    `User: ${question}`,
    `Assistant: ${answer}`,
    '',
    'Title:',
  ].join('\n');
}

function nextChatId() {
  return `chatgpd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useChatGpdPhoneApp({
  nodes,
  nodesRef,
  viewedCharacterId,
  chatsByCharacter,
  setChatsByCharacter,
  model,
  onModelChange,
  nodeLlm,
  updateLlmNodeActive,
  notifySystem,
}: UseChatGpdPhoneAppOptions): ChatGpdPhoneApp {
  const [isSending, setIsSending] = useState(false);
  const [sendingChatId, setSendingChatId] = useState<string>();
  const [streaming, setStreaming] = useState<{ chatId: string; text: string }>();
  const [activeChatIdByCharacter, setActiveChatIdByCharacter] =
    useState<Record<string, string | undefined>>({});

  const characterId = viewedCharacterId ?? '';
  const chats = chatsByCharacter[characterId] ?? [];
  const activeChatId = activeChatIdByCharacter[characterId];
  const activeChat = chats.find((chat) => chat.id === activeChatId);

  function selectChat(chatId: string) {
    setActiveChatIdByCharacter((current) => ({ ...current, [characterId]: chatId }));
  }

  function startNewChat() {
    setActiveChatIdByCharacter((current) => ({ ...current, [characterId]: undefined }));
  }

  function deleteChat(chatId: string) {
    setChatsByCharacter((current) => ({
      ...current,
      [characterId]: (current[characterId] ?? []).filter((chat) => chat.id !== chatId),
    }));
    setActiveChatIdByCharacter((current) =>
      current[characterId] === chatId ? { ...current, [characterId]: undefined } : current,
    );
  }

  function patchChat(chatId: string, patch: (chat: ChatGpdChatRecord) => ChatGpdChatRecord) {
    setChatsByCharacter((current) => ({
      ...current,
      [characterId]: (current[characterId] ?? []).map((chat) =>
        chat.id === chatId ? patch(chat) : chat,
      ),
    }));
  }

  async function generateChatTitle(nodeId: string, connectionId: string | undefined, chatId: string, question: string, answer: string) {
    let title = chatGpdFallbackTitle(question);
    try {
      const completion = await nodeLlm.complete({
        connectionId,
        nodeId,
        label: 'ChatGPD Title',
        purpose: 'ChatGPD chat title',
        prompt: chatGpdTitlePrompt(question, answer),
        maxTokens: 40,
        temperature: 0.3,
      });
      const generated = completion.text.trim().split('\n')[0]?.replace(/^["']|["'.]$/g, '').trim();
      if (generated) {
        title = generated;
      }
    } catch {
      // The fallback title is already set; a failed title call should not
      // disturb the finished chat answer.
    }
    patchChat(chatId, (chat) => ({ ...chat, title }));
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }
    if (!characterId) {
      notifySystem('warning', 'ChatGPD needs a selected phone character.');
      return;
    }
    const node = nodesRef.current.find(
      (entry) => entry.data.kind === undefined && entry.data.nodeType === 'phone-apps',
    );
    if (!node) {
      notifySystem('warning', 'ChatGPD needs a Phone Apps node in the workflow to select its provider.');
      return;
    }
    let chatId = activeChat?.id;
    const history = activeChat?.messages ?? [];
    const isFirstExchange = history.length === 0;
    if (!chatId) {
      chatId = nextChatId();
      const newChat: ChatGpdChatRecord = {
        id: chatId,
        title: '',
        createdAt: new Date().toISOString(),
        messages: [],
      };
      setChatsByCharacter((current) => ({
        ...current,
        [characterId]: [newChat, ...(current[characterId] ?? [])],
      }));
      setActiveChatIdByCharacter((current) => ({ ...current, [characterId]: chatId }));
    }
    patchChat(chatId, (chat) => ({
      ...chat,
      messages: [...chat.messages, { role: 'user', text: trimmed }],
    }));
    setIsSending(true);
    setSendingChatId(chatId);
    setStreaming({ chatId, text: '' });
    updateLlmNodeActive(node.id, true, 'ChatGPD');
    try {
      const streamedChatId = chatId;
      const completion = await nodeLlm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: 'ChatGPD',
        purpose: 'ChatGPD phone app',
        prompt: chatGpdPrompt(model, history, trimmed),
        onChunk: (text) => setStreaming({ chatId: streamedChatId, text }),
        maxTokens: 1200,
        temperature: 0.7,
      });
      const answer = completion.text.trim() || '...';
      patchChat(chatId, (chat) => ({
        ...chat,
        messages: [...chat.messages, { role: 'assistant', text: answer }],
      }));
      // The saved answer replaces the temporary streaming bubble. Clear it
      // before the separate title request so the answer is not shown twice.
      setStreaming(undefined);
      if (isFirstExchange) {
        await generateChatTitle(node.id, node.data.connectionId, chatId, trimmed, answer);
      }
    } catch (error) {
      notifySystem(
        'error',
        `ChatGPD request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      updateLlmNodeActive(node.id, false);
      setStreaming(undefined);
      setSendingChatId(undefined);
      setIsSending(false);
    }
  }

  return {
    chats,
    activeChat,
    model,
    isSending,
    sendingChatId,
    streaming,
    nodeAvailable: nodes.some(
      (node) => node.data.kind === undefined && node.data.nodeType === 'phone-apps',
    ),
    characterAvailable: !!characterId,
    selectModel: onModelChange,
    selectChat,
    startNewChat,
    deleteChat,
    sendMessage,
  };
}
