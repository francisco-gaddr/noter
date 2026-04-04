'use client';

import type React from 'react';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ChatMessage } from '@repo/ai';
import { shouldStopToolIteration, toToolCallKeys, toToolIterationSignature } from '../../services/ai/toolChain';

type Options = {
  stopRequestedRef: React.MutableRefObject<boolean>;
  activeChatIdRef: React.MutableRefObject<string | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  assistantConvRef: React.MutableRefObject<Record<string, string>>;
  assistantCreatedRef: React.MutableRefObject<Record<string, string>>;
  setCollapsedThinking: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fetchAIStream: (history: ChatMessage[], assistantMsg: ChatMessage, convId: string) => Promise<string>;
  processToolCalls: (conversationId: string, assistantId: string, assistantText: string, intentText: string) => Promise<ChatMessage[]>;
  extractToolCalls: (text: string) => { calls: Array<{ tool: string; arguments: Record<string, any> }>; cleaned: string };
  enableToolUse: boolean;
  db: {
    saveMessage: (conversationId: string, message: ChatMessage) => Promise<void>;
  };
  isConversationLocalOnly: (conversationId: string) => boolean;
  syncConversationPayload: (payload: any) => Promise<void>;
};

export const useAIGenerationLoop = ({
  stopRequestedRef,
  activeChatIdRef,
  abortControllerRef,
  assistantConvRef,
  assistantCreatedRef,
  setCollapsedThinking,
  setMessages,
  setLoading,
  fetchAIStream,
  processToolCalls,
  extractToolCalls,
  enableToolUse,
  db,
  isConversationLocalOnly,
  syncConversationPayload,
}: Options) => {
  const runAIGeneration = useCallback(async (convId: string, initialHistory: ChatMessage[]) => {
    let currentHistory = [...initialHistory];
    const intentText = [...initialHistory].reverse().find((msg) => msg.role === 'user')?.content || '';
    let iterations = 0;
    const maxIterations = 5;
    const executedCallKeys = new Set<string>();
    const iterationSignatures = new Set<string>();

    while (iterations < maxIterations && !stopRequestedRef.current) {
      iterations += 1;

      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString()
      };

      activeChatIdRef.current = assistantMsg.id as string;
      assistantConvRef.current[assistantMsg.id as string] = convId;
      assistantCreatedRef.current[assistantMsg.id as string] = assistantMsg.createdAt as string;
      setCollapsedThinking((prev) => ({ ...prev, [assistantMsg.id as string]: true }));
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        let fullText = '';
        const tryFetch = async () => {
          fullText = await fetchAIStream(currentHistory, assistantMsg, convId);
        };
        try {
          await tryFetch();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await tryFetch();
        }

        const generatedMsg = { ...assistantMsg, content: fullText } as ChatMessage;
        await db.saveMessage(convId, generatedMsg);
        if (!isConversationLocalOnly(convId)) {
          syncConversationPayload({ messages: [{ conversationId: convId, message: generatedMsg }] }).catch(() => {});
        }

        const extractedBeforeTools = extractToolCalls(fullText);
        if (!enableToolUse && extractedBeforeTools.cleaned !== fullText) {
          fullText = extractedBeforeTools.cleaned;
          setMessages((prev) => prev.map((message) => message.id === assistantMsg.id ? { ...message, content: fullText } : message));
          const cleanedMsg = { ...assistantMsg, content: fullText } as ChatMessage;
          await db.saveMessage(convId, cleanedMsg);
          if (!isConversationLocalOnly(convId)) {
            syncConversationPayload({ messages: [{ conversationId: convId, message: cleanedMsg }] }).catch(() => {});
          }
        }

        const newToolMessages = await processToolCalls(convId, assistantMsg.id as string, fullText, intentText);

        if (newToolMessages.length === 0) {
          break;
        }

        const extracted = extractToolCalls(fullText);
        const callKeys = toToolCallKeys(extracted.calls);
        const signature = toToolIterationSignature(extracted.cleaned || '', fullText, callKeys);
        if (shouldStopToolIteration(signature, callKeys, iterationSignatures, executedCallKeys)) {
          break;
        }
        if (extracted.calls.some((call) => /^(create|update|delete)_/.test(call.tool))) {
          break;
        }

        const cleaned = extracted.cleaned || fullText;
        currentHistory = [...currentHistory, { ...assistantMsg, content: cleaned }, ...newToolMessages];
      } catch (error: any) {
        if (!stopRequestedRef.current) {
          console.error(error);
          setMessages((prev) => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + error.message, createdAt: new Date().toISOString() }]);
        }
        break;
      }
    }

    abortControllerRef.current = null;
    activeChatIdRef.current = null;
    setLoading(false);
  }, [
    abortControllerRef,
    activeChatIdRef,
    assistantConvRef,
    assistantCreatedRef,
    db,
    enableToolUse,
    extractToolCalls,
    fetchAIStream,
    isConversationLocalOnly,
    processToolCalls,
    setCollapsedThinking,
    setLoading,
    setMessages,
    stopRequestedRef,
    syncConversationPayload,
  ]);

  return {
    runAIGeneration,
  };
};
