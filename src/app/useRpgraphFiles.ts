import { useRef, useState } from 'react';
import { getAccountPassword } from '../accounts/accountSession';
import type {
  SavedFileSummary,
  WorkflowFile,
  WorkflowNodeData,
} from '../types';
import type { RpgraphSessionV2 } from '../data-management/types';
import {
  currentEncryptedSessionEnvelopeFormatVersion,
  currentSessionFormatVersion,
} from '../session/version';
import {
  currentEncryptedWorkflowEnvelopeFormatVersion,
  currentWorkflowFormatVersion,
} from '../workflow/version';
import storybookFormatVersions from '../storybook/formatVersions.json';
import { rpStorybookJsonText, type RpStorybook } from '../nodes/rp-storybook/model';
import type { RpCharacterCard } from '../storybook/characterCard';
import { workflowNeedsStorybookSelection } from './workflowSnapshot';
import { fileNameLabel, readableFileName } from './fileDisplayNames';

export type WorkflowSaveScope = 'workflow' | 'workflow-storybook';
export type CharacterSaveLocation = 'characters' | 'npc-characters' | 'account-npc-characters' | 'choose';

type FileProtection = 'plain' | 'encrypted';

type LoadedRpgraphFile = {
  fileName: string;
  name: string;
  filePath: string;
  type: SavedFileSummary['type'];
  protection: SavedFileSummary['protection'];
  value: unknown;
};

type UseRpgraphFilesOptions = {
  currentWorkflowForSave: (includeStorybook?: boolean) => Promise<WorkflowFile>;
  currentSession: (name: string) => Promise<RpgraphSessionV2>;
  currentStorybookForSave: () => { storybook: RpStorybook; name: string; nodeId: string };
  latestSessionTurnNumber: (session: RpgraphSessionV2) => number;
  suggestedWorkflowName: () => string;
  suggestedSessionName: () => string;
  // Returns false when the file was read but its content was not applied.
  applyLoadedRpgraphFile: (result: LoadedRpgraphFile, password?: string) => boolean | void;
  applyLoadedWorkflow: (
    workflow: unknown,
    filePath: string | null,
    status: string,
    fileName?: string | null,
    resetSnapshotFileName?: string,
    hydrateOpeningHistory?: boolean,
  ) => void;
  applyStorybookToNode: (
    nodeId: string,
    storybookValue: unknown,
    fileName?: string,
    filePath?: string,
    status?: string,
    protection?: FileProtection,
  ) => boolean;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
  errorMessage: (error: unknown) => string;
  workflowFileMissing: (error: unknown) => boolean;
  setActiveWorkflowProtection: (protection: FileProtection) => void;
  setActiveStorybookProtection: (protection: FileProtection) => void;
  clearWorkspaceForLockedStartup: () => void;
  onWorkspacePasswordChange?: (password: string) => Promise<unknown>;
  workflowRequiresProtection?: () => boolean;
  workflowFollowsStorybookProtection?: () => boolean;
  defaultCharacterExportDestination?: 'npc-characters' | 'account-npc-characters';
};

export function workflowName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? 'workflow';
}

/**
 * Picks the workflow the start dialog preselects: the first preferred file
 * name that still exists, otherwise the first compatible workflow.
 */
export function startDialogWorkflowFileName(
  files: SavedFileSummary[],
  preferredFileNames: Array<string | null | undefined>,
) {
  const workflows = files.filter((file) => file.type === 'workflow');
  for (const fileName of preferredFileNames) {
    if (fileName && workflows.some((file) => file.fileName === fileName)) {
      return fileName;
    }
  }
  return (workflows.find((file) => file.compatible) ?? workflows[0])?.fileName ?? null;
}

export function useRpgraphFiles({
  currentWorkflowForSave,
  currentSession,
  currentStorybookForSave,
  latestSessionTurnNumber,
  suggestedWorkflowName,
  suggestedSessionName,
  applyLoadedRpgraphFile: applyLoadedFile,
  applyLoadedWorkflow,
  applyStorybookToNode,
  updateRuntimeNode,
  notifySystem,
  errorMessage,
  workflowFileMissing,
  setActiveWorkflowProtection,
  setActiveStorybookProtection,
  clearWorkspaceForLockedStartup,
  onWorkspacePasswordChange,
  workflowRequiresProtection,
  workflowFollowsStorybookProtection,
  defaultCharacterExportDestination = 'npc-characters',
}: UseRpgraphFilesOptions) {
  const accountPassword = getAccountPassword();
  const workspacePasswordRef = useRef(accountPassword);
  const [workspacePassword, setWorkspacePasswordState] = useState(accountPassword);
  const [encryptionRequired, setEncryptionRequired] = useState(false);
  function setWorkspacePassword(password: string) {
    workspacePasswordRef.current = password;
    setWorkspacePasswordState(password);
    setEncryptionRequired(!!password && !accountPassword);
    void onWorkspacePasswordChange?.(password).catch((error) => notifySystem('error', `Unable to update game protection: ${errorMessage(error)}`));
  }
  function checkImportedPassword(password: string) {
    if (!accountPassword && workspacePasswordRef.current && workspacePasswordRef.current !== password &&
      !workflowFollowsStorybookProtection?.() && (workflowRequiresProtection?.() ?? true)) {
      throw new Error('Use the same password as the current protected game, or open a different RP Save or workflow first.');
    }
  }
  const [showFiles, setShowFiles] = useState(false);
  const [showStorybookPicker, setShowStorybookPicker] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const startDialogOpenRef = useRef(false);
  const [startWorkflowFileName, setStartWorkflowFileName] = useState<string | null>(null);
  const [startTargetFileName, setStartTargetFileName] = useState<string | null>(null);
  // Storybook that still has to be loaded once the selected workflow is open.
  const pendingStartStorybookRef = useRef<{
    workflowFileName: string;
    storybook: SavedFileSummary;
  } | null>(null);
  const [savedFiles, setSavedFiles] = useState<SavedFileSummary[]>([]);
  const [unlockedFileNames, setUnlockedFileNames] = useState<Record<string, string>>({});
  function rememberFileDisplayName(fileName: string, name: string) {
    setUnlockedFileNames(current => ({ ...current, [fileName]: name }));
  }
  function fileDisplayName(fileName: string | null | undefined) {
    return readableFileName(fileName, unlockedFileNames, savedFiles);
  }
  function applyLoadedRpgraphFile(result: LoadedRpgraphFile, password?: string) {
    const applied = applyLoadedFile(result, password) !== false;
    rememberFileDisplayName(result.fileName, result.name);
    return applied;
  }
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [workflowNameDraft, setWorkflowNameDraft] = useState('');
  const [storybookNameDraft, setStorybookNameDraft] = useState('');
  const [characterNameDraft, setCharacterNameDraft] = useState('');
  const [fileStorageStatus, setFileStorageStatus] = useState('');
  const [workflowOverwritePending, setWorkflowOverwritePending] = useState(false);
  const [activeSessionFileName, setActiveSessionFileName] = useState<string | null>(null);
  const [activeSessionSavedTurn, setActiveSessionSavedTurn] = useState<number | null>(null);
  const activeSessionPathRef = useRef<string | null>(null);
  const [activeSessionProtection, setActiveSessionProtection] = useState<FileProtection>('plain');
  const activeSessionPasswordRef = useRef('');
  const [sessionName, setSessionName] = useState('');
  const [sessionPasswordDraft, setSessionPassword] = useState('');
  const [sessionPasswordAction, setSessionPasswordAction] =
    useState<'save-workflow' | 'save-session' | 'save-storybook' | 'save-character' | 'load' | 'open-file' | 'load-storybook' | 'load-character' | null>(null);
  const [fileProtectionDraft, setFileProtection] = useState<FileProtection>('plain');
  const inheritedProtection = encryptionRequired && !!sessionPasswordAction?.startsWith('save-');
  const fileProtection = inheritedProtection ? 'encrypted' : fileProtectionDraft;
  const sessionPassword = sessionPasswordAction?.startsWith('save-') && accountPassword
    ? accountPassword : inheritedProtection ? workspacePassword : sessionPasswordDraft;
  const [workflowSaveScope, setWorkflowSaveScope] = useState<WorkflowSaveScope>('workflow-storybook');
  const [sessionOverwritePending, setSessionOverwritePending] = useState(false);
  const [chooseSaveLocation, setChooseSaveLocation] = useState(false);
  const [characterSaveLocation, setCharacterSaveLocation] = useState<CharacterSaveLocation>('npc-characters');
  const [includeCharacterOwnPosts, setIncludeCharacterOwnPosts] = useState(true);
  const [includeCharacterReceivedImages, setIncludeCharacterReceivedImages] = useState(false);
  const returnToFilesAfterSaveRef = useRef(false);
  const [pendingSessionFilePath, setPendingSessionFilePath] = useState<string | null>(null);
  const [pendingStorybookLoad, setPendingStorybookLoad] = useState<{
    nodeId: string;
    filePath: string;
    fileName: string;
  } | null>(null);
  const [pendingCharacterSave, setPendingCharacterSave] = useState<{
    nodeId: string;
    characterCard: RpCharacterCard;
    createCard: (includePosts: boolean, includeReceivedImages: boolean) => RpCharacterCard;
  } | null>(null);
  const [activeWorkflowPath, setActiveWorkflowPath] = useState<string | null>(null);
  const activeWorkflowPathRef = useRef<string | null>(null);
  const [activeWorkflowFileName, setActiveWorkflowFileName] = useState<string | null>(null);
  const activeWorkflowResetSnapshotRef = useRef<{
    workflow: WorkflowFile;
    fileName: string;
  } | null>(null);

  function activateWorkflowPath(filePath: string | null, fileName?: string | null) {
    activeWorkflowPathRef.current = filePath;
    setActiveWorkflowPath(filePath);
    setActiveWorkflowFileName(fileName === undefined
      ? filePath
        ? workflowName(filePath)
        : null
      : fileName);
  }

  function activateWorkflowSnapshot(workflow: WorkflowFile, fileName: string) {
    activeWorkflowResetSnapshotRef.current = {
      workflow: structuredClone(workflow),
      fileName,
    };
    activateWorkflowPath(null, fileName);
  }

  function completeStorybookReplacement(protection: FileProtection) {
    const followsStorybook = workflowFollowsStorybookProtection?.() === true;
    if (followsStorybook) {
      setActiveWorkflowProtection(protection);
      activeWorkflowResetSnapshotRef.current = null;
    }
    if (protection === 'plain' && (followsStorybook || workflowRequiresProtection?.() === false)) {
      // Never restore a snapshot containing the previous protected Storybook
      // after releasing its password.
      activeWorkflowResetSnapshotRef.current = null;
      setWorkspacePassword('');
    }
  }

  function updateStorybookPickerForWorkflow(workflow: unknown) {
    setShowStorybookPicker(workflowNeedsStorybookSelection(workflow));
  }

  async function completeFileLoad(result: LoadedRpgraphFile, applied: boolean, password = '') {
    const pendingStart = pendingStartStorybookRef.current;
    pendingStartStorybookRef.current = null;
    if (applied && result.type === 'workflow' && pendingStart?.workflowFileName === result.fileName) {
      // Second step of a start dialog selection: the workflow is open, now
      // load the chosen Storybook into it.
      setShowStorybookPicker(false);
      const { storybook } = pendingStart;
      if (
        storybook.protection === 'encrypted' && password &&
        await tryLoadStoredFile(storybook.fileName, password, storybook.storage) !== false
      ) {
        return;
      }
      await openStoredFile(storybook);
      return;
    }
    if (startDialogOpenRef.current) {
      setShowStorybookPicker(false);
      if (applied) closeStartDialog();
      return;
    }
    if (result.type === 'workflow') {
      updateStorybookPickerForWorkflow(result.value);
    } else if (result.type === 'storybook') {
      setShowStorybookPicker(false);
    }
  }

  async function refreshFiles(
    selectFileName: string | null | undefined = selectedFile,
  ) {
    const files = await window.rpgraph.listFiles();
    setSavedFiles(files);
    const retainedFileName =
      selectFileName && files.some((file) => file.fileName === selectFileName)
        ? selectFileName
        : null;
    setSelectedFile(retainedFileName);
    return files;
  }

  async function openFiles() {
    returnToFilesAfterSaveRef.current = false;
    setShowFiles(true);
    setSelectedFile(null);
    setWorkflowOverwritePending(false);
    setSessionOverwritePending(false);
    setSessionPasswordAction(null);
    setSessionPassword('');
    setFileStorageStatus('');
    setWorkflowNameDraft(suggestedWorkflowName());
    if (!activeSessionFileName) {
      setSessionName(suggestedSessionName());
    }
    try {
      await refreshFiles(null);
    } catch (error) {
      setFileStorageStatus(
        `Unable to list files: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function openStorybookPicker() {
    setShowFiles(false);
    setShowStorybookPicker(true);
    setSelectedFile(null);
    setSessionPasswordAction(null);
    setSessionPassword('');
    setFileStorageStatus('');
    try {
      await refreshFiles(null);
    } catch (error) {
      setFileStorageStatus(
        `Unable to list Storybooks: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function openStartDialog(preferredWorkflowFileName?: string | null) {
    pendingStartStorybookRef.current = null;
    setShowFiles(false);
    setShowStorybookPicker(false);
    setSessionPasswordAction(null);
    setSessionPassword('');
    setFileStorageStatus('');
    let files: SavedFileSummary[] = [];
    try {
      files = await refreshFiles(null);
    } catch (error) {
      setFileStorageStatus(`Unable to list files: ${errorMessage(error)}`);
    }
    setStartWorkflowFileName(startDialogWorkflowFileName(files, [
      preferredWorkflowFileName,
      activeWorkflowFileName,
      startWorkflowFileName,
    ]));
    setStartTargetFileName((current) =>
      files.some((file) =>
        file.fileName === current && (file.type === 'storybook' || file.type === 'session'))
        ? current
        : null);
    startDialogOpenRef.current = true;
    setShowStartDialog(true);
  }

  function closeStartDialog() {
    pendingStartStorybookRef.current = null;
    startDialogOpenRef.current = false;
    setShowStartDialog(false);
  }

  /**
   * Opens a start dialog selection. A Storybook loads the selected workflow
   * first and then the Storybook; an RP Save opens directly; without a target
   * only the selected workflow is opened.
   */
  async function openStartSelection(target?: SavedFileSummary) {
    pendingStartStorybookRef.current = null;
    if (target) setStartTargetFileName(target.fileName);
    if (target?.type === 'session') {
      await openStoredFile(target);
      return;
    }
    const workflow = savedFiles.find(
      (file) => file.type === 'workflow' && file.fileName === startWorkflowFileName,
    );
    if (!workflow) {
      setFileStorageStatus('Select a workflow first.');
      return;
    }
    if (!workflow.compatible) {
      setFileStorageStatus(incompatibleWorkflowStatus(workflow));
      return;
    }
    if (target) {
      if (!target.compatible) {
        setFileStorageStatus(incompatibleStorybookStatus(target));
        return;
      }
      pendingStartStorybookRef.current = { workflowFileName: workflow.fileName, storybook: target };
    }
    await openStoredFile(workflow);
  }

  async function saveNamedWorkflow() {
    const name = workflowNameDraft.trim() || suggestedWorkflowName();
    if (fileProtection === 'encrypted' && !sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted workflow.');
      return;
    }
    if (chooseSaveLocation) {
      await saveWorkflowToChosenLocation(name);
      return;
    }
    setFileStorageStatus(
      fileProtection === 'encrypted'
        ? 'Encrypting and saving workflow ...'
        : 'Saving workflow as plain JSON ...',
    );
    try {
      const workflow = await currentWorkflowForSave(workflowSaveScope === 'workflow-storybook');
      const result = await window.rpgraph.saveNamedWorkflow(
        name,
        workflow,
        fileProtection,
        sessionPassword,
        workflowOverwritePending,
      );
      if (result.conflict) {
        setWorkflowOverwritePending(true);
        setFileStorageStatus(
          `A workflow named "${result.name}" already exists. Confirm to overwrite it.`,
        );
        return;
      }
      setWorkflowNameDraft(result.name);
      rememberFileDisplayName(result.fileName, result.name);
      setWorkflowOverwritePending(false);
      setSessionPassword('');
      if (fileProtection === 'plain') {
        activeWorkflowResetSnapshotRef.current = null;
        activateWorkflowPath(result.filePath, result.fileName);
      } else {
        activateWorkflowSnapshot(workflow, result.fileName);
      }
      setActiveWorkflowProtection(fileProtection);
      if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
      await refreshFiles(result.fileName);
      notifySystem('info', `Saved: ${workflowName(result.filePath)}`);
      setFileStorageStatus(
        fileProtection === 'encrypted'
          ? `Saved password-protected workflow: ${result.name}`
          : `Saved plain workflow: ${result.name}`,
      );
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(
        `Save failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function requestExportWorkflow(returnToFilesAfterSave = false) {
    const selectedWorkflow = savedFiles.find(
      (file) => file.fileName === selectedFile && file.type === 'workflow',
    );
    setShowFiles(false);
    setWorkflowNameDraft(selectedWorkflow?.name ?? suggestedWorkflowName());
    setWorkflowOverwritePending(false);
    setSessionPassword('');
    setFileProtection(accountPassword ? 'encrypted' : 'plain');
    setWorkflowSaveScope('workflow-storybook');
    setChooseSaveLocation(false);
    setFileStorageStatus('');
    returnToFilesAfterSaveRef.current = returnToFilesAfterSave;
    setSessionPasswordAction('save-workflow');
  }

  async function saveWorkflowToChosenLocation(name: string) {
    setFileStorageStatus('Choose save location ...');
    try {
      const workflow = await currentWorkflowForSave(workflowSaveScope === 'workflow-storybook');
      const result = await window.rpgraph.saveRpgraphFileToPath({
        kind: 'workflow',
        name,
        workflow,
        protection: fileProtection,
        password: sessionPassword,
      });
      if (result.canceled) {
        setFileStorageStatus('');
        return;
      }
      setWorkflowNameDraft(result.name ?? name);
      if (result.fileName) rememberFileDisplayName(result.fileName, result.name ?? name);
      setWorkflowOverwritePending(false);
      setSessionPassword('');
      if (fileProtection === 'plain' && result.filePath) {
        activeWorkflowResetSnapshotRef.current = null;
        activateWorkflowPath(result.filePath, result.fileName);
      } else {
        activateWorkflowSnapshot(workflow, result.fileName ?? name);
      }
      setActiveWorkflowProtection(fileProtection);
      if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
      notifySystem('info', `Saved workflow file: ${fileNameLabel(result.fileName ?? workflowName(result.filePath ?? ''), result.name ?? name)}`);
      setFileStorageStatus(`Saved workflow file: ${result.filePath}`);
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(`Save to file failed: ${errorMessage(error)}`);
    }
  }

  function requestSaveStorybook(returnToFilesAfterSave = false) {
    try {
      const { name } = currentStorybookForSave();
      const selectedStorybook = savedFiles.find(
        (file) => file.fileName === selectedFile && file.type === 'storybook',
      );
      setStorybookNameDraft(selectedStorybook?.name ?? name);
      setShowFiles(false);
      setSessionPassword('');
      setFileProtection(accountPassword ? 'encrypted' : 'plain');
      setSessionOverwritePending(false);
      setChooseSaveLocation(false);
      setFileStorageStatus('');
      returnToFilesAfterSaveRef.current = returnToFilesAfterSave;
      setSessionPasswordAction('save-storybook');
    } catch (error) {
      setFileStorageStatus(`Save Storybook unavailable: ${errorMessage(error)}`);
    }
  }

  function requestSaveCharacter(
    nodeId: string,
    characterCard: RpCharacterCard,
    createCard: (includePosts: boolean, includeReceivedImages: boolean) => RpCharacterCard,
    returnToFilesAfterSave = false,
  ) {
    const name = characterCard.character.name || characterCard.character.id;
    setPendingCharacterSave({ nodeId, characterCard, createCard });
    setCharacterNameDraft(name);
    setShowFiles(false);
    setSessionPassword('');
    setFileProtection(accountPassword ? 'encrypted' : 'plain');
    setSessionOverwritePending(false);
    setChooseSaveLocation(false);
    setCharacterSaveLocation(
      accountPassword && defaultCharacterExportDestination === 'account-npc-characters'
        ? 'account-npc-characters'
        : 'npc-characters',
    );
    setIncludeCharacterOwnPosts(true);
    setIncludeCharacterReceivedImages(false);
    setFileStorageStatus('');
    returnToFilesAfterSaveRef.current = returnToFilesAfterSave;
    setSessionPasswordAction('save-character');
  }

  async function saveCharacter() {
    const pending = pendingCharacterSave;
    if (!pending) {
      setFileStorageStatus('Character export is no longer available.');
      return;
    }
    const name = characterNameDraft.trim() || pending.characterCard.character.name || pending.characterCard.character.id;
    if (fileProtection === 'encrypted' && !sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted character card.');
      return;
    }
    setFileStorageStatus(
      fileProtection === 'encrypted'
        ? 'Encrypting and saving character card ...'
        : 'Saving character card as plain JSON ...',
    );
    try {
      const characterCard = pending.createCard(includeCharacterOwnPosts, includeCharacterReceivedImages);
      const result = characterSaveLocation === 'choose'
        ? await window.rpgraph.saveRpgraphFileToPath({
            kind: 'character',
            name,
            characterCard,
            protection: fileProtection,
            password: sessionPassword,
          })
        : await window.rpgraph.saveCharacter(
            name,
            characterCard,
            fileProtection,
            sessionPassword,
            sessionOverwritePending,
            characterSaveLocation,
          );
      if ('conflict' in result && result.conflict) {
        setSessionOverwritePending(true);
        setFileStorageStatus(
          `A character card named "${result.name}" already exists. Confirm to overwrite it.`,
        );
        return;
      }
      if ('canceled' in result && result.canceled) {
        setFileStorageStatus('');
        return;
      }
      const fileName = result.fileName ?? `${name.trim().replace(/\s+/g, '-')}.json`;
      const label = fileNameLabel(fileName, result.name ?? name);
      updateRuntimeNode(pending.nodeId, {
        storybookStatus: fileProtection === 'encrypted'
          ? `Exported encrypted character: ${label}`
          : `Exported character: ${label}`,
      });
      notifySystem('info', `Exported character ${pending.characterCard.character.name || pending.characterCard.character.id}: ${label}`);
      setCharacterNameDraft(result.name ?? name);
      setPendingCharacterSave(null);
      setSessionOverwritePending(false);
      setSessionPassword('');
      if (characterSaveLocation === 'characters') {
        await refreshFiles(fileName);
      }
      setFileStorageStatus(`Saved character card: ${result.filePath}`);
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      const message = `Character export failed: ${errorMessage(error)}`;
      updateRuntimeNode(pending.nodeId, { storybookStatus: message });
      notifySystem('error', message);
      setFileStorageStatus(message);
    }
  }

  async function loadStoredFile(fileName: string, password = '', storage?: SavedFileSummary['storage']) {
    setFileStorageStatus('Loading file ...');
    try {
      const result = await window.rpgraph.loadFile(fileName, password, storage);
      await completeFileLoad(result, applyLoadedRpgraphFile(result, password), password);
      return true;
    } catch (error) {
      setFileStorageStatus(
        `Load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async function tryLoadStoredFile(fileName: string, password: string, storage?: SavedFileSummary['storage']) {
    setFileStorageStatus('Loading file ...');
    try {
      const result = await window.rpgraph.tryLoadFile(fileName, password, storage);
      if (!result) return false;
      await completeFileLoad(result, applyLoadedRpgraphFile(result, password), password);
      return true;
    } catch (error) {
      setFileStorageStatus(
        `Load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async function openStoredFile(file?: SavedFileSummary) {
    const summary = file ?? savedFiles.find((entry) => entry.fileName === selectedFile);
    if (!summary) {
      setFileStorageStatus('Select a saved file first.');
      return;
    }
    if (!summary.compatible) {
      const message =
        summary.type === 'workflow'
          ? incompatibleWorkflowStatus(summary)
          : summary.type === 'session'
            ? incompatibleSessionStatus(summary)
            : summary.type === 'storybook'
              ? incompatibleStorybookStatus(summary)
            : summary.type === 'character-card'
              ? incompatibleCharacterCardStatus(summary)
            : 'This is not a supported RPGraph file.';
      setFileStorageStatus(message);
      if (summary.type === 'storybook') {
        notifySystem('info', message);
      }
      return;
    }
    setSelectedFile(summary.fileName);
    if (summary.protection === 'plain') {
      await loadStoredFile(summary.fileName, '', summary.storage);
      return;
    }
    await requestUnlockStoredFile(summary);
  }

  async function deleteStoredFile(file: SavedFileSummary) {
    setFileStorageStatus(`Deleting ${file.type}: ${file.name} ...`);
    try {
      await window.rpgraph.deleteFile(file.fileName, file.storage);
      if (
        activeWorkflowPathRef.current &&
        workflowName(activeWorkflowPathRef.current) === file.fileName
      ) {
        activeWorkflowResetSnapshotRef.current = null;
        activateWorkflowPath(null);
        setActiveWorkflowProtection('plain');
      } else if (activeWorkflowFileName === file.fileName) {
        activeWorkflowResetSnapshotRef.current = null;
        setActiveWorkflowFileName(null);
        setActiveWorkflowProtection('plain');
      }
      try {
        const activeStorybook = currentStorybookForSave();
        if (activeStorybook && activeStorybook.name === file.name) {
          setActiveStorybookProtection('plain');
        }
      } catch {
        // No active storybook or storybook creator node is not loaded
      }
      if (activeSessionFileName === file.fileName) {
        setActiveSessionFileName(null);
        setActiveSessionSavedTurn(null);
        activeSessionPathRef.current = null;
        setActiveSessionProtection('plain');
        activeSessionPasswordRef.current = '';
      }
      await refreshFiles(selectedFile === file.fileName ? null : selectedFile);
      setFileStorageStatus(`Deleted ${file.type}: ${file.name}`);
    } catch (error) {
      setFileStorageStatus(
        `Delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function requestSaveSession(returnToFilesAfterSave = false) {
    const selectedSession = savedFiles.find(
      (file) => file.fileName === selectedFile && file.type === 'session',
    );
    if (selectedSession) {
      setSessionName(selectedSession.name);
    } else if (!activeSessionFileName) {
      setSessionName(suggestedSessionName());
    }
    setShowFiles(false);
    setSessionPassword('');
    setFileProtection(accountPassword ? 'encrypted' : 'plain');
    setSessionOverwritePending(false);
    setChooseSaveLocation(false);
    setFileStorageStatus('');
    returnToFilesAfterSaveRef.current = returnToFilesAfterSave;
    setSessionPasswordAction('save-session');
  }

  async function requestUnlockStoredFile(file?: SavedFileSummary) {
    const fileName = file?.fileName ?? selectedFile;
    if (!fileName) {
      setFileStorageStatus('Select a saved file first.');
      return;
    }
    const summary = file ?? savedFiles.find((entry) => entry.fileName === fileName);
    if (summary && !summary.compatible) {
      setFileStorageStatus(
        summary.type === 'workflow'
          ? incompatibleWorkflowStatus(summary)
          : summary.type === 'storybook'
            ? incompatibleStorybookStatus(summary)
          : summary.type === 'character-card'
            ? incompatibleCharacterCardStatus(summary)
            : incompatibleSessionStatus(summary),
      );
      return;
    }
    if (file) {
      setSelectedFile(file.fileName);
      setSessionName(file.name);
    }
    if (accountPassword && await tryLoadStoredFile(fileName, accountPassword, summary?.storage) !== false) return;
    setSessionPassword('');
    setSessionOverwritePending(false);
    setShowFiles(false);
    setFileStorageStatus('This file is password protected. Enter its password or PIN to continue.');
    setSessionPasswordAction('load');
  }

  async function requestOpenFile() {
    setSessionPassword('');
    setSessionOverwritePending(false);
    setSessionPasswordAction(null);
    try {
      const file = await window.rpgraph.selectFile();
      if (file.canceled || !file.filePath) {
        setFileStorageStatus('');
        return;
      }
      if (!file.compatible) {
        const message =
          file.type === 'workflow'
            ? incompatibleWorkflowStatus(file)
            : file.type === 'session'
              ? incompatibleSessionStatus(file)
              : file.type === 'storybook'
                ? incompatibleStorybookStatus(file)
              : file.type === 'character-card'
                ? incompatibleCharacterCardStatus(file)
              : 'This is not a supported RPGraph file.';
        setFileStorageStatus(message);
        if (file.type === 'storybook') {
          notifySystem('info', message);
        }
        return;
      }
      if (file.protection === 'plain') {
        await openFilePath(file.filePath);
        return;
      }
      if (accountPassword) {
        const result = await window.rpgraph.tryLoadFilePath(file.filePath, accountPassword);
        if (result) {
          await completeFileLoad(result, applyLoadedRpgraphFile(result, accountPassword), accountPassword);
          await refreshFiles(result.fileName);
          return;
        }
      }
      setPendingSessionFilePath(file.filePath);
      setShowFiles(false);
      setFileStorageStatus('This file is password protected. Enter its password or PIN to continue.');
      setSessionPasswordAction('open-file');
    } catch (error) {
      setPendingSessionFilePath(null);
      setFileStorageStatus(`Load failed: ${errorMessage(error)}`);
    }
  }

  async function saveSession() {
    const name = sessionName.trim() || suggestedSessionName();
    if (fileProtection === 'encrypted' && !sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted RP save.');
      return;
    }
    if (chooseSaveLocation) {
      await saveSessionToChosenLocation(name);
      return;
    }
    setFileStorageStatus(
      fileProtection === 'encrypted'
        ? 'Encrypting and saving RP save ...'
        : 'Saving RP save as plain JSON ...',
    );
    try {
      const session = await currentSession(name);
      const result = await window.rpgraph.saveSession(
        name,
        session,
        fileProtection,
        sessionPassword,
        sessionOverwritePending,
      );
      if (result.conflict) {
        setSessionOverwritePending(true);
        setFileStorageStatus(
          `A file named "${result.name}" already exists. Confirm to overwrite it with this session.`,
        );
        return;
      }
      setActiveSessionFileName(result.fileName);
      setActiveSessionSavedTurn(latestSessionTurnNumber(session));
      activeSessionPathRef.current = result.filePath;
      setActiveSessionProtection(fileProtection);
      if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
      activeSessionPasswordRef.current = fileProtection === 'encrypted' ? sessionPassword : '';
      activateWorkflowSnapshot(await currentWorkflowForSave(), activeWorkflowFileName ?? 'Untitled workflow');
      setSessionName(result.name);
      rememberFileDisplayName(result.fileName, result.name);
      setSessionOverwritePending(false);
      setSessionPassword('');
      await refreshFiles(result.fileName);
      setFileStorageStatus(
        fileProtection === 'encrypted'
          ? `Saved password-protected RP save: ${result.name} at Turn ${latestSessionTurnNumber(session)}`
          : `Saved plain RP save: ${result.name} at Turn ${latestSessionTurnNumber(session)}`,
      );
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(
        `Save failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function saveSessionToChosenLocation(name: string) {
    setFileStorageStatus('Choose save location ...');
    try {
      const session = await currentSession(name);
      const result = await window.rpgraph.saveRpgraphFileToPath({
        kind: 'session',
        name,
        session,
        protection: fileProtection,
        password: sessionPassword,
      });
      if (result.canceled) {
        setFileStorageStatus('');
        return;
      }
      if (result.filePath && result.fileName) {
        setActiveSessionFileName(result.fileName);
        setActiveSessionSavedTurn(latestSessionTurnNumber(session));
        activeSessionPathRef.current = result.filePath;
        setActiveSessionProtection(fileProtection);
        if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
        activeSessionPasswordRef.current = fileProtection === 'encrypted' ? sessionPassword : '';
      }
      activateWorkflowSnapshot(await currentWorkflowForSave(), activeWorkflowFileName ?? 'Untitled workflow');
      setSessionName(result.name ?? name);
      if (result.fileName) rememberFileDisplayName(result.fileName, result.name ?? name);
      setSessionOverwritePending(false);
      setSessionPassword('');
      setFileStorageStatus(
        `Saved RP file: ${result.fileName ?? workflowName(result.filePath ?? '')} at Turn ${latestSessionTurnNumber(session)}`,
      );
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(`Save to file failed: ${errorMessage(error)}`);
    }
  }

  async function saveStorybook() {
    const current = currentStorybookForSave();
    const name = storybookNameDraft.trim() || current.name || 'storybook';
    if (fileProtection === 'encrypted' && !sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted storybook.');
      return;
    }
    if (chooseSaveLocation) {
      await saveStorybookToChosenLocation(current, name);
      return;
    }
    setFileStorageStatus(
      fileProtection === 'encrypted'
        ? 'Encrypting and saving storybook ...'
        : 'Saving storybook as plain JSON ...',
    );
    try {
      const result = await window.rpgraph.saveStorybook(
        name,
        JSON.parse(rpStorybookJsonText(current.storybook)),
        fileProtection,
        sessionPassword,
        sessionOverwritePending,
      );
      if (result.conflict) {
        setSessionOverwritePending(true);
        setFileStorageStatus(
          `A storybook named "${result.name}" already exists. Confirm to overwrite it.`,
        );
        return;
      }
      updateRuntimeNode(current.nodeId, {
        storybookStatus: fileProtection === 'encrypted'
          ? `Saved encrypted storybook: ${fileNameLabel(result.fileName, result.name)}`
          : `Saved storybook: ${fileNameLabel(result.fileName, result.name)}`,
        storybookFileName: result.fileName,
        storybookFilePath: result.filePath,
      });
      setStorybookNameDraft(result.name);
      rememberFileDisplayName(result.fileName, result.name);
      setActiveStorybookProtection(fileProtection);
      if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
      setSessionOverwritePending(false);
      setSessionPassword('');
      await refreshFiles(result.fileName);
      setFileStorageStatus(
        fileProtection === 'encrypted'
          ? `Saved password-protected storybook: ${result.name}`
          : `Saved plain storybook: ${result.name}`,
      );
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(`Save failed: ${errorMessage(error)}`);
    }
  }

  async function saveStorybookToChosenLocation(
    current: ReturnType<UseRpgraphFilesOptions['currentStorybookForSave']>,
    name: string,
  ) {
    setFileStorageStatus('Choose save location ...');
    try {
      const result = await window.rpgraph.saveRpgraphFileToPath({
        kind: 'storybook',
        name,
        storybook: JSON.parse(rpStorybookJsonText(current.storybook)),
        protection: fileProtection,
        password: sessionPassword,
      });
      if (result.canceled) {
        setFileStorageStatus('');
        return;
      }
      updateRuntimeNode(current.nodeId, {
        storybookStatus: fileProtection === 'encrypted'
          ? `Saved encrypted storybook: ${fileNameLabel(result.fileName ?? name, result.name ?? name)}`
          : `Saved storybook: ${fileNameLabel(result.fileName ?? name, result.name ?? name)}`,
        storybookFileName: result.fileName,
        storybookFilePath: result.filePath,
      });
      setStorybookNameDraft(result.name ?? name);
      if (result.fileName) rememberFileDisplayName(result.fileName, result.name ?? name);
      setActiveStorybookProtection(fileProtection);
      if (fileProtection === 'encrypted') setWorkspacePassword(sessionPassword);
      setSessionOverwritePending(false);
      setSessionPassword('');
      setFileStorageStatus(`Saved storybook file: ${result.filePath}`);
      setSessionPasswordAction(null);
      setShowFiles(returnToFilesAfterSaveRef.current);
      returnToFilesAfterSaveRef.current = false;
    } catch (error) {
      setFileStorageStatus(`Save to file failed: ${errorMessage(error)}`);
    }
  }

  async function openFilePath(filePath: string, password = '') {
    const result = await window.rpgraph.loadFilePath(filePath, password);
    await completeFileLoad(result, applyLoadedRpgraphFile(result, password), password);
    await refreshFiles(result.fileName);
  }

  async function unlockStorybookFile() {
    const pending = pendingStorybookLoad;
    if (!pending) {
      setSessionPasswordAction(null);
      return;
    }
    if (!sessionPassword) {
      setFileStorageStatus('Enter a password or PIN for the encrypted storybook.');
      updateRuntimeNode(pending.nodeId, { storybookStatus: 'Encrypted storybook needs a password.' });
      return;
    }
    try {
      setFileStorageStatus('Unlocking storybook ...');
      updateRuntimeNode(pending.nodeId, { storybookStatus: `Unlocking encrypted storybook: ${fileDisplayName(pending.fileName) ?? 'protected file'}` });
      const result = await window.rpgraph.loadFilePath(pending.filePath, sessionPassword);
      checkImportedPassword(sessionPassword);
      if (result.type !== 'storybook') {
        throw new Error('The selected file is not an RP Storybook.');
      }
      const applied = applyStorybookToNode(
        pending.nodeId,
        result.value,
        result.fileName,
        result.filePath,
        'Loaded encrypted storybook',
        'encrypted',
      );
      if (!applied) {
        setFileStorageStatus('Cannot load storybook: it conflicts with the running chat history.');
        return;
      }
      rememberFileDisplayName(result.fileName, result.name);
      setActiveStorybookProtection('encrypted');
      setWorkspacePassword(sessionPassword);
      await refreshFiles(result.fileName);
      setPendingStorybookLoad(null);
      setPendingSessionFilePath(null);
      setShowStorybookPicker(false);
      setSessionPassword('');
      setSessionPasswordAction(null);
      setFileStorageStatus(`Loaded encrypted storybook: ${result.name}`);
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(pending.nodeId, { storybookStatus: `Load failed: ${messageText}` });
      setFileStorageStatus(`Load failed: ${messageText}`);
    }
  }

  async function unlockOpenFilePath(filePath: string) {
    setFileStorageStatus('Unlocking file ...');
    try {
      await openFilePath(filePath, sessionPassword);
    } catch (error) {
      setFileStorageStatus(`Load failed: ${errorMessage(error)}`);
    }
  }

  async function unlockStoredFile() {
    if (!selectedFile) {
      setFileStorageStatus('Select a saved file first.');
      return;
    }
    setFileStorageStatus('Unlocking file ...');
    try {
      const summary = savedFiles.find((file) => file.fileName === selectedFile);
      await loadStoredFile(selectedFile, sessionPassword, summary?.storage);
    } catch (error) {
      setFileStorageStatus(
        `Load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function saveCurrentSession() {
    const filePath = activeSessionPathRef.current;
    if (!filePath || !activeSessionFileName) {
      requestSaveSession();
      return;
    }
    const protection = !accountPassword && workspacePasswordRef.current ? 'encrypted' : activeSessionProtection;
    const password = accountPassword || workspacePasswordRef.current || activeSessionPasswordRef.current;
    if (protection === 'encrypted' && !password) {
      notifySystem('error', 'Save RP failed: the password is no longer available in memory.');
      return;
    }
    const name = sessionName.trim() || suggestedSessionName();
    try {
      const session = await currentSession(name);
      const result = await window.rpgraph.saveCurrentSession(
        filePath,
        session,
        protection,
        password,
      );
      rememberFileDisplayName(result.fileName, fileDisplayName(activeSessionFileName) ?? name);
      activeSessionPathRef.current = result.filePath;
      setActiveSessionFileName(result.fileName);
      setActiveSessionProtection(protection);
      activeSessionPasswordRef.current = password;
      setActiveSessionSavedTurn(latestSessionTurnNumber(session));
      activateWorkflowSnapshot(await currentWorkflowForSave(), activeWorkflowFileName ?? 'Untitled workflow');
      await refreshFiles(result.fileName);
      notifySystem(
        'info',
        `Saved RP: ${fileNameLabel(activeSessionFileName, fileDisplayName(activeSessionFileName) ?? name)} at Turn ${latestSessionTurnNumber(session)}${protection === 'encrypted' ? ' (password encrypted)' : ''}`,
      );
    } catch (error) {
      notifySystem('error', `Save RP failed: ${errorMessage(error)}`);
    }
  }

  async function loadStartupWorkflow() {
    let startupWorkflowFileName: string | null = null;
    try {
      const result = await window.rpgraph.loadStartupWorkflow();
      startupWorkflowFileName = result.fileName;
      if (result.requiresPassword) {
        const unlocked = accountPassword
          ? await window.rpgraph.tryLoadFile(result.fileName, accountPassword)
          : null;
        if (unlocked) {
          applyLoadedRpgraphFile(unlocked, accountPassword);
        } else {
          // The start dialog requests the password once a selection is opened.
          clearWorkspaceForLockedStartup();
        }
      } else {
        applyLoadedWorkflow(
          result.workflow ?? result.value,
          result.protection === 'plain' ? result.filePath : null,
          'Loaded',
          result.fileName,
          result.protection === 'encrypted' ? result.fileName : undefined,
        );
        setActiveWorkflowProtection(result.protection === 'encrypted' ? 'encrypted' : 'plain');
      }
    } catch (error) {
      notifySystem(
        'error',
        `Startup workflow load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await openStartDialog(startupWorkflowFileName);
  }

  async function loadDefaultWorkflow() {
    try {
      const result = await window.rpgraph.loadDefaultWorkflow();
      applyLoadedWorkflow(result.workflow, result.filePath, 'Loaded', result.fileName);
      updateStorybookPickerForWorkflow(result.workflow);
      setActiveWorkflowProtection('plain');
    } catch (error) {
      notifySystem(
        'error',
        `Default load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function restoreDefaultFiles() {
    try {
      setFileStorageStatus('Restoring default files ...');
      const result = await window.rpgraph.restoreDefaultFiles();
      clearCurrentFileSelection();
      if (result.workflow) {
        applyLoadedWorkflow(
          result.workflow.value,
          result.workflow.filePath,
          'Restored default workflow',
          result.workflow.fileName,
        );
        updateStorybookPickerForWorkflow(result.workflow.value);
        setActiveWorkflowProtection('plain');
      }
      await refreshFiles(result.workflow?.fileName ?? null);
      setSelectedFile(result.workflow?.fileName ?? null);
      setFileStorageStatus(
        result.restoredTypes.length > 0
          ? `Restored default files: ${result.restoredTypes.join(' and ')}.`
          : 'All default files are already available.',
      );
    } catch (error) {
      setFileStorageStatus(
        `Restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function clearCurrentFileSelection() {
    setWorkflowOverwritePending(false);
    setSessionOverwritePending(false);
    setSessionPasswordAction(null);
    setSessionPassword('');
    setPendingSessionFilePath(null);
    setPendingStorybookLoad(null);
  }

  async function resetWorkflow() {
    const workflowPath = activeWorkflowPathRef.current;
    const workflowSnapshot = activeWorkflowResetSnapshotRef.current;
    try {
      if (workflowSnapshot) {
        applyLoadedWorkflow(
          structuredClone(workflowSnapshot.workflow),
          null,
          'Reset',
          workflowSnapshot.fileName,
          workflowSnapshot.fileName,
        );
        updateStorybookPickerForWorkflow(workflowSnapshot.workflow);
        return;
      }
      const result = workflowPath
        ? await window.rpgraph.reloadWorkflow(workflowPath)
        : await window.rpgraph.loadDefaultWorkflow();
      const resultFileName =
        'fileName' in result && typeof result.fileName === 'string'
          ? result.fileName
          : undefined;
      applyLoadedWorkflow(result.workflow, result.filePath, 'Reset', resultFileName);
      updateStorybookPickerForWorkflow(result.workflow);
      setActiveWorkflowProtection('plain');
    } catch (error) {
      if (workflowPath && workflowFileMissing(error)) {
        try {
          const result = await window.rpgraph.loadDefaultWorkflow();
          applyLoadedWorkflow(result.workflow, result.filePath, 'Reset to default', result.fileName);
          updateStorybookPickerForWorkflow(result.workflow);
          setActiveWorkflowProtection('plain');
          notifySystem('warning', `The previous workflow file no longer exists: ${workflowName(workflowPath)}`);
          return;
        } catch (defaultError) {
          notifySystem(
            'error',
            `Reset failed: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`,
          );
          return;
        }
      }
      notifySystem('error', `Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function saveWorkflowAs() {
    requestExportWorkflow();
  }

  async function saveCurrentWorkflow() {
    if (accountPassword || workspacePasswordRef.current) {
      requestExportWorkflow();
      return;
    }
    if (!activeWorkflowPath) {
      await saveWorkflowAs();
      return;
    }

    try {
      const workflow = await currentWorkflowForSave();
      const result = await window.rpgraph.saveCurrentWorkflow(
        activeWorkflowPath,
        workflow,
      );
      notifySystem('info', `Saved: ${workflowName(result.filePath)}`);
    } catch (error) {
      notifySystem('error', `Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    workspacePasswordRef,
    workspacePassword,
    setWorkspacePassword,
    completeStorybookReplacement,
    checkImportedPassword,
    encryptionRequired,
    showFiles,
    setShowFiles,
    showStorybookPicker,
    setShowStorybookPicker,
    showStartDialog,
    startWorkflowFileName,
    setStartWorkflowFileName,
    startTargetFileName,
    setStartTargetFileName,
    openStartDialog,
    closeStartDialog,
    openStartSelection,
    savedFiles,
    fileDisplayName,
    rememberFileDisplayName,
    selectedFile,
    setSelectedFile,
    workflowNameDraft,
    setWorkflowNameDraft,
    storybookNameDraft,
    setStorybookNameDraft,
    characterNameDraft,
    setCharacterNameDraft,
    fileStorageStatus,
    setFileStorageStatus,
    workflowOverwritePending,
    setWorkflowOverwritePending,
    activeSessionFileName,
    setActiveSessionFileName,
    activeSessionSavedTurn,
    setActiveSessionSavedTurn,
    activeSessionPathRef,
    activeSessionProtection,
    setActiveSessionProtection,
    activeSessionPasswordRef,
    sessionName,
    setSessionName,
    sessionPassword,
    setSessionPassword,
    sessionPasswordAction,
    setSessionPasswordAction,
    fileProtection,
    setFileProtection,
    workflowSaveScope,
    setWorkflowSaveScope,
    sessionOverwritePending,
    setSessionOverwritePending,
    chooseSaveLocation,
    setChooseSaveLocation,
    characterSaveLocation,
    setCharacterSaveLocation,
    includeCharacterReceivedImages,
    setIncludeCharacterReceivedImages,
    includeCharacterOwnPosts,
    setIncludeCharacterOwnPosts,
    returnToFilesAfterSaveRef,
    pendingSessionFilePath,
    setPendingSessionFilePath,
    pendingStorybookLoad,
    setPendingStorybookLoad,
    activeWorkflowPath,
    activeWorkflowPathRef,
    activeWorkflowFileName,
    setActiveWorkflowFileName,
    activeWorkflowResetSnapshotRef,
    activateWorkflowPath,
    activateWorkflowSnapshot,
    refreshFiles,
    openFiles,
    openStorybookPicker,
    saveNamedWorkflow,
    requestExportWorkflow,
    requestSaveStorybook,
    requestSaveCharacter,
    loadStoredFile,
    openStoredFile,
    deleteStoredFile,
    requestSaveSession,
    requestUnlockStoredFile,
    requestOpenFile,
    saveSession,
    saveStorybook,
    saveCharacter,
    openFilePath,
    unlockStorybookFile,
    unlockOpenFilePath,
    unlockStoredFile,
    saveCurrentSession,
    loadStartupWorkflow,
    loadDefaultWorkflow,
    restoreDefaultFiles,
    resetWorkflow,
    saveWorkflowAs,
    saveCurrentWorkflow,
  };
}

type IncompatibleFileMetadata = {
  envelopeFormatVersion?: string;
  formatVersion?: string;
  protection?: SavedFileSummary['protection'];
};

export function incompatibleSessionStatus(file: IncompatibleFileMetadata) {
  if (
    file.protection === 'encrypted' &&
    !['2.1', currentEncryptedSessionEnvelopeFormatVersion].includes(file.envelopeFormatVersion ?? '')
  ) {
    return `Encrypted RP save Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${currentEncryptedSessionEnvelopeFormatVersion}.`;
  }
  return `RP Save Format v${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports RP Save Format v${currentSessionFormatVersion}.`;
}

export function incompatibleWorkflowStatus(file: IncompatibleFileMetadata) {
  if (
    file.protection === 'encrypted' &&
    !['2.0', currentEncryptedWorkflowEnvelopeFormatVersion].includes(file.envelopeFormatVersion ?? '')
  ) {
    return `Encrypted workflow Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${currentEncryptedWorkflowEnvelopeFormatVersion}.`;
  }
  return `Workflow File Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Workflow File Format ${currentWorkflowFormatVersion}.`;
}

export function incompatibleStorybookStatus(file: IncompatibleFileMetadata) {
  return `Storybook Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Storybook Format ${storybookFormatVersions.storybook}.`;
}

export function incompatibleCharacterCardStatus(file: IncompatibleFileMetadata) {
  if (
    file.protection === 'encrypted' &&
    !['1.0', storybookFormatVersions.encryptedCharacterCardEnvelope].includes(file.envelopeFormatVersion ?? '')
  ) {
    return `Encrypted character card Envelope Format ${file.envelopeFormatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Envelope Format ${storybookFormatVersions.encryptedCharacterCardEnvelope}.`;
  }
  return `Character Card Format ${file.formatVersion ?? 'Unknown'} is incompatible. This RPGraph build supports Character Card Format ${storybookFormatVersions.characterCard}.`;
}
