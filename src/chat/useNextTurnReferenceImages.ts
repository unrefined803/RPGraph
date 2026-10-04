import { measureUiWork } from '../diagnostics/uiPerformance';
import { createStableDerivedValueSelector } from './stableDerivedValue';
import { useStorybookContentNodes } from '../storybook/useStorybookContentNodes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatImageAttachment, MessageRecord, WorkflowNode } from '../types';
import {
  collectRecentReferenceImages,
  messageImageIds,
  referenceImageScopeForMessage,
  type ReferenceImageOptions,
} from './referenceImages';

function uniqueImageIds(...groups: string[][]) {
  return [...new Set(groups.flat().map((imageId) => imageId.trim()).filter(Boolean))];
}

export function useNextTurnReferenceImages({
  messages,
  nodes,
  options,
  replyToMessage,
}: {
  messages: MessageRecord[];
  nodes: WorkflowNode[];
  options: ReferenceImageOptions;
  replyToMessage?: MessageRecord;
}) {
  const [selectContextualIds] = useState(() => createStableDerivedValueSelector<Set<string>>());
  const [selectSelectedIds] = useState(() => createStableDerivedValueSelector<Set<string>>());
  const [selection, setSelection] = useState<{ scope?: string; ids: string[] }>({ ids: [] });
  const selectionRef = useRef(selection);
  const selectedImageIds = useMemo(
    () => selection.scope === options.scope ? selection.ids : [],
    [selection, options.scope],
  );
  useEffect(() => {
    if (selectionRef.current.scope !== options.scope) {
      const empty = { scope: options.scope, ids: [] };
      selectionRef.current = empty;
      setSelection(empty);
    }
  }, [options.scope]);

  const updateSelectedImageIds = useCallback((update: (current: string[]) => string[]) => {
    const current = selectionRef.current;
    const next = { scope: options.scope, ids: update(current.scope === options.scope ? current.ids : []) };
    selectionRef.current = next;
    setSelection(next);
  }, [options.scope]);

  const toggleSelectedImage = useCallback((image: ChatImageAttachment) => {
    if (!options.enabled) {
      return;
    }
    const imageId = image.id.trim();
    if (!imageId) {
      return;
    }
    updateSelectedImageIds((current) =>
      current.includes(imageId)
        ? current.filter((entry) => entry !== imageId)
        : [...current, imageId],
    );
  }, [options.enabled, updateSelectedImageIds]);

  const clearSelectedImages = useCallback(() => {
    const empty = { scope: selectionRef.current.scope, ids: [] };
    selectionRef.current = empty;
    setSelection(empty);
  }, []);

  const retainMessageImages = useCallback((message?: MessageRecord) => {
    if (!options.enabled) {
      return;
    }
    const imageIds = message && referenceImageScopeForMessage(message) === options.scope
      ? messageImageIds(message) : [];
    if (imageIds.length > 0) {
      updateSelectedImageIds((current) => uniqueImageIds(current, imageIds));
    }
  }, [options.enabled, options.scope, updateSelectedImageIds]);

  const additionalImageIds = useMemo(
    () => options.enabled
      ? uniqueImageIds(selectedImageIds, replyToMessage && referenceImageScopeForMessage(replyToMessage) === options.scope
        ? messageImageIds(replyToMessage) : [])
      : [],
    [options.enabled, options.scope, replyToMessage, selectedImageIds],
  );
  const nextTurnOptions = useMemo(
    () => ({ ...options, additionalImageIds, additionalImageScope: options.scope }),
    [additionalImageIds, options],
  );
  const storybookContentNodes = useStorybookContentNodes(nodes);
  const contextualImageIds = useMemo(
    () => measureUiWork('images.contextualIds', () => selectContextualIds(new Set(
      collectRecentReferenceImages({ messages, nodes: storybookContentNodes, options: nextTurnOptions })
        .map((reference) => reference.imageId)
        .filter(Boolean),
    ))),
    [messages, nextTurnOptions, storybookContentNodes, selectContextualIds],
  );
  const selectedImageIdSet = useMemo(
    () => selectSelectedIds(new Set(selectedImageIds)),
    [selectedImageIds, selectSelectedIds],
  );

  const optionsForRun = useCallback((replyMessage?: MessageRecord): ReferenceImageOptions => ({
    ...options,
    additionalImageScope: options.scope,
    additionalImageIds: options.enabled
      ? uniqueImageIds(
          selectionRef.current.scope === options.scope ? selectionRef.current.ids : [],
          replyMessage && referenceImageScopeForMessage(replyMessage) === options.scope
            ? messageImageIds(replyMessage) : [],
        )
      : [],
  }), [options]);

  return {
    contextualImageIds,
    selectedImageIds: selectedImageIdSet,
    nextTurnOptions,
    optionsForRun,
    toggleSelectedImage,
    retainMessageImages,
    clearSelectedImages,
  };
}
