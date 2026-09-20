import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveSocialPostCommand, resolveSocialPostReference, type SocialPostCommandBinding } from './socialPostCommands';
import { embeddedPhoneMessagesLivePreview, parseEmbeddedPhoneMessagesFromRpOutput } from './phoneMessages';
import { parseRpOutput } from './rpOutput';
import { socialPostHistoryText } from './socialMedia';
import { runActionAwarePrompt } from '../nodes/shared/promptRun';
import type { ExecuteContext } from '../nodes/types';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, SocialAppKind, WorkflowNode } from '../types';
import { defaultRpStorybookCharacterBanking } from '../nodes/rp-storybook/model';

function character(): StorybookCharacter {
  return {
    id: 'author', sourceId: 'author', name: 'Alex Rivera', label: 'Alex',
    kind: 'character', storybookNodeId: 'book',
    profile: { name: 'Alex Rivera', description: '', personality: '', speechStyle: '', role: '' },
    phoneSettings: { wallpaperId: 'wallpaper-1' }, banking: defaultRpStorybookCharacterBanking(),
    social: { fotogramUsername: 'alex.photos', onlyfriendsUsername: 'alex.private' },
    apps: {
      fotogram: { accountId: 'alex-f', enabled: true, profileName: 'alex.photos', bio: '' },
      onlyfriends: { accountId: 'alex-o', enabled: true, profileName: 'alex.private', bio: '' },
    },
    images: [{ id: 'photo-1', name: 'Sunset', mimeType: 'image/jpeg', size: 1,
      dataUrl: 'data:image/jpeg;base64,eA==', description: 'Sunset over the bay.' }],
  };
}

const cases = (['fotogram', 'onlyfriends'] as const).flatMap((app) =>
  [true, false].map((textOnly) => ({ app, textOnly, key: app === 'fotogram' ? 'fotogramPost' : 'onlyFriendsPost' })));

describe('social publication commands', () => {
  it.each(cases.flatMap((entry) => ['normal', 'autoplay'].flatMap((mode) =>
    [true, false].map((withProse) => ({ ...entry, mode, withProse })),
  )))('runs and resolves $app publication (textOnly=$textOnly, mode=$mode, withProse=$withProse)', async ({ app, textOnly, key, mode, withProse }) => {
    const command = `${app}_${textOnly ? 'text' : 'image'}_post`;
    const commentKey = app === 'fotogram' ? 'fotogramPostComment' : 'onlyFriendsPostComment';
    const payload = JSON.stringify({ [key]: { postRef: 'evening-photo', from: 'Alex Rivera', text: 'A lovely evening.', textOnly,
      ...(!textOnly ? { imageId: 'photo-1' } : {}) } }) + '\n' +
      JSON.stringify({ [commentKey]: { postId: 'new:evening-photo', from: 'Alex Rivera', text: 'What a sunset!' } });
    const prompts: string[] = [];
    const warning = vi.fn();
    const context = {
      nodes: [], historyMessages: [], appCharacters: [character()],
      reportWarning: warning, reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
      llm: { supportsVision: async () => false, complete: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return { text: prompts.length === 1 ? `${withProse ? 'Alex publishes a post. ' : ''}[${command}: Alex posts about the evening${textOnly ? '' : ', photo-1'}, postRef evening-photo] [${app}_post_comment: Alex comments on new:evening-photo]` : payload,
          connection: { label: 'Test' } };
      } },
    } as unknown as ExecuteContext;
    const result = await runActionAwarePrompt({
      node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode,
      context, inputValue: mode === 'autoplay' ? '[AUTOPLAY]\nPlayer-controlled character: Narrator' : 'Alex publishes.', images: [], referenceImages: [],
      promptBefore: '', promptAfter: `Write the scene.\n@command: ${command}\n@command: ${app}_post_comment`,
      actionConfigs: [], streamsVisibleOutput: false, contributesToTokenCalibration: false,
      callLabel: () => 'Narrator',
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(`"${key}"`);
    expect(prompts[1]).toContain('prefixing the exact postRef value');
    expect(prompts[1]).toContain(`Alex posts about the evening${textOnly ? '' : ', photo-1'}, postRef evening-photo`);
    expect(warning).not.toHaveBeenCalled();
    const parsed = parseEmbeddedPhoneMessagesFromRpOutput(parseRpOutput(result.generatedText).story);
    expect(parsed.text).toBe(withProse ? 'Alex publishes a post.' : '');
    expect(parsed.socialPosts).toHaveLength(1);
    expect(parsed.invalidSocialPostCount).toBe(0);
    const resolved = resolveSocialPostCommand(parsed.socialPosts[0], [character()], [], [`${app}-post-07`]);
    expect(resolved.post).toMatchObject({ app, author: 'Alex Rivera', authorCharacterId: 'author',
      authorAccountId: app === 'fotogram' ? 'alex-f' : 'alex-o', postId: `${app}-post-08`, caption: 'A lovely evening.' });
    const comment = parsed.socialPostComments[0];
    const target = resolveSocialPostReference(app, comment.postId, [
      { app, postRef: parsed.socialPosts[0].postRef, post: resolved.post },
    ], []);
    expect(target?.postId).toBe(`${app}-post-08`);
    expect(resolved.post).not.toHaveProperty('postRef');
    expect(resolved.post?.imageId).toBe(textOnly ? undefined : 'photo-1');
    expect(resolved.post?.textOnly).toBe(textOnly ? true : undefined);
    expect(socialPostHistoryText(resolved.post!)).toContain(`Post ID: ${app}-post-08`);
  });

  it.each(cases)('keeps $app payloads out of streaming prose (textOnly=$textOnly)', ({ key, textOnly }) => {
    const payload = JSON.stringify({ [key]: { from: 'Alex Rivera', text: 'Hello', textOnly,
      ...(!textOnly ? { imageId: 'photo-1' } : {}) } });
    expect(embeddedPhoneMessagesLivePreview(`Posted.\n${payload}`).text).toBe('Posted.');
    expect(embeddedPhoneMessagesLivePreview(`Posted.\n${payload.slice(0, -3)}`).text).toBe('Posted.');
  });

  it.each(['fotogramPost', 'onlyFriendsPost'])('strips malformed %s objects without publishing them', (key) => {
    for (const entry of [null, {}, { from: 'Alex', text: 'Hi' },
      { from: 'Alex', text: '', textOnly: true }, { from: '', text: 'Hi', textOnly: true },
      { from: 'Alex', text: 'Hi', textOnly: 'true' },
      ...['', 'new:photo', 'a b', 1, null].map((postRef) => ({ from: 'Alex', text: 'Hi', textOnly: true, postRef })),
      { from: 'Alex', text: 'Hi', textOnly: true, imageId: 'photo-1' },
      { from: 'Alex', text: 'Hi', textOnly: false },
      { from: 'Alex', text: 'Hi', textOnly: false, imageId: ' ' }]) {
      const parsed = parseEmbeddedPhoneMessagesFromRpOutput(`Before.\n${JSON.stringify({ [key]: entry })}\nAfter.`);
      expect(parsed.text).toBe('Before.\n\nAfter.');
      expect(parsed.socialPosts).toEqual([]);
      expect(parsed.invalidSocialPostCount).toBe(1);
    }
  });

  it.each<SocialAppKind>(['fotogram', 'onlyfriends'])('validates accounts and author-owned images for %s', (app) => {
    const author = character();
    const base = { app, from: author.name, text: 'Evening', textOnly: true as const };
    expect(resolveSocialPostCommand({ ...base, from: 'Unknown' }, [author], []).error).toBeTruthy();
    expect(resolveSocialPostCommand(base, [author, structuredClone(author)], []).error).toBeTruthy();
    author.apps!.matchme = { accountId: 'character:author:matchme', enabled: true, profileName: author.name, bio: '' };
    expect(resolveSocialPostCommand({ ...base, from: 'character:author:matchme' }, [author], []).error).toBeTruthy();
    author.apps![app]!.enabled = false;
    expect(resolveSocialPostCommand(base, [author], []).error).toBeTruthy();
    author.apps![app]!.enabled = true;
    expect(resolveSocialPostCommand({ ...base, from: author.apps![app]!.accountId }, [author], []).post).toBeTruthy();
    const other = { ...character(), id: 'other', sourceId: 'other', name: 'Other', apps: {}, social: { fotogramUsername: '', onlyfriendsUsername: '' } };
    author.images = [];
    expect(resolveSocialPostCommand({ ...base, textOnly: false, imageId: 'photo-1' }, [author, other], []).error).toBeTruthy();
    expect(resolveSocialPostCommand({ ...base, textOnly: false, imageId: 'missing' }, [character()], []).error).toBeTruthy();
  });

  it('assigns new IDs across persisted and pending posts and keeps phone reply parsing separate', () => {
    const reply = '{"message":"Just posted it."}';
    const parsed = parseEmbeddedPhoneMessagesFromRpOutput(reply + '\n' +
      '{"fotogramPost":{"from":"Alex Rivera","text":"Hello","textOnly":true}}');
    expect(parsed.text).toBe(reply);
    const first = resolveSocialPostCommand(parsed.socialPosts[0], [character()], [], ['fotogram-post-04']).post!;
    const history: MessageRecord[] = [{ id: 1, role: 'output', originalText: socialPostHistoryText(first), socialPost: first }];
    expect(resolveSocialPostCommand(parsed.socialPosts[0], [character()], history).post?.postId).toBe('fotogram-post-06');
  });

  it.each<SocialAppKind>(['fotogram', 'onlyfriends'])('resolves local %s references without guessing or crossing runs and apps', (app) => {
    const command = { app, from: 'Alex Rivera', text: 'Evening', textOnly: true as const };
    const first = resolveSocialPostCommand(command, [character()], [], [`${app}-post-08`]).post!;
    const second = resolveSocialPostCommand(command, [character()], [], [first.postId]).post!;
    const bindings: SocialPostCommandBinding[] = [
      { app, postRef: 'first', post: first }, { app, postRef: 'second', post: second },
      { app, postRef: 'failed' },
    ];
    const history: MessageRecord[] = [{ id: 1, role: 'output', originalText: '', socialPost: first }];
    expect(resolveSocialPostReference(app, 'new:first', bindings, history)).toBe(first);
    expect(resolveSocialPostReference(app, 'new:second', bindings, history)).toBe(second);
    expect(resolveSocialPostReference(app, 'new:failed', bindings, history)).toBeUndefined();
    expect(resolveSocialPostReference(app, 'new:missing', bindings, history)).toBeUndefined();
    expect(resolveSocialPostReference(app, 'new:', bindings, history)).toBeUndefined();
    expect(resolveSocialPostReference(app, 'new:first', [], history)).toBeUndefined();
    expect(resolveSocialPostReference(app, first.postId, [], history)).toBe(first);
    const otherApp = app === 'fotogram' ? 'onlyfriends' : 'fotogram';
    expect(resolveSocialPostReference(otherApp, 'new:first', bindings, history)).toBeUndefined();
    expect(resolveSocialPostReference(otherApp, first.postId, bindings, history)).toBeUndefined();
    bindings.push({ app, postRef: 'first' });
    expect(resolveSocialPostReference(app, 'new:first', bindings, history)).toBeUndefined();
    bindings[bindings.length - 1].post = second;
    expect(resolveSocialPostReference(app, 'new:first', bindings, history)).toBeUndefined();
  });

  it.each(cases)('resolves a $app DM emitted before its new post (textOnly=$textOnly)', ({ app, key, textOnly }) => {
    const messageKey = app === 'fotogram' ? 'fotogramApp' : 'onlyFriendsApp';
    const output = JSON.stringify({ [messageKey]: [{ from: 'Reader', to: 'Alex Rivera',
      message: 'Nice post!', postId: 'new:publication' }] }) + '\n' +
      JSON.stringify({ [key]: { from: 'Alex Rivera', postRef: 'publication', text: 'A lovely evening.',
        textOnly, ...(!textOnly ? { imageId: 'photo-1' } : {}) } });
    const parsed = parseEmbeddedPhoneMessagesFromRpOutput(output);
    const dm = parsed.socialDirectMessages[0];
    expect(dm.postId).toBe('new:publication');
    const post = resolveSocialPostCommand(parsed.socialPosts[0], [character()], [], [`${app}-post-07`]).post!;
    const bindings: SocialPostCommandBinding[] = [{ app, postRef: parsed.socialPosts[0].postRef, post }];
    const origin = resolveSocialPostReference(app, dm.postId!, bindings, []);
    expect(origin).toMatchObject({ postId: `${app}-post-08`, author: 'Alex Rivera', caption: 'A lovely evening.' });
    expect(origin?.imageId).toBe(textOnly ? undefined : 'photo-1');
    expect(origin?.imageDescription).toBe(textOnly ? undefined : 'Sunset over the bay.');
    expect(resolveSocialPostReference(app, dm.postId!, [{ ...bindings[0], post: undefined }], [])).toBeUndefined();
  });

  it.each(['normal', 'planning'])('places publication commands before comments in the %s workflow', (name) => {
    const workflow = JSON.parse(readFileSync(`resources/default-content/default_${name}_v32.json`, 'utf8'));
    const switches = workflow.nodes.filter((node: WorkflowNode) => node.data.nodeType === 'llm-prompt-switch');
    let checked = 0;
    for (const node of switches) {
      for (const text of node.data.llmPromptSwitchPromptAftersByOutput.flat()) {
        if (!text.includes('@command: Fotogram_post_comment')) continue;
        checked++;
        expect(text).toContain('prefixing the exact postRef value');
        expect(text).toContain('postRef');
        expect(text).not.toContain('always with an exact known postId');
        for (const command of ['Fotogram_text_post', 'Fotogram_image_post', 'OnlyFriends_text_post', 'OnlyFriends_image_post']) {
          expect(text.indexOf(`@command: ${command}`)).toBeGreaterThanOrEqual(0);
          expect(text.indexOf(`@command: ${command}`)).toBeLessThan(text.indexOf('@command: Fotogram_post_comment'));
        }
      }
    }
    expect(checked).toBe(16);
  });
});
