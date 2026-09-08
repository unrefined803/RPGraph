# Editing Storybooks Without Loading Embedded Media

Bundled workflows and Storybooks are separate files under
`resources/default-content`. The workflows contain an empty RP Storybook V3 slot,
so workflow editing no longer needs media redaction. Use the workflow prompt tool
when changing only LLM Prompt Switch content.

Standalone Storybooks can contain large Base64 Data URLs. Do not load an original
image-bearing Storybook into an LLM context or edit it directly. The Storybook
media tool creates a lightweight JSON copy in which every Data URL is replaced by
a marker containing its SHA-256 hash, MIME type, and byte count.

## Edit a Storybook

1. Create a redacted working copy while keeping the original untouched:

   ```bash
   npm run storybook:redact -- "resources/default-content/My Story.v1.rpgraph-storybook.json" /tmp/rpgraph-storybook.redacted.json
   ```

2. Read and edit only `/tmp/rpgraph-storybook.redacted.json`. Do not change or
   remove media markers unless the corresponding image is intentionally removed
   from the Storybook.

3. Merge the edited copy with the original media. The destination may be the
   original Storybook after the redacted edit has been reviewed:

   ```bash
   npm run storybook:merge -- /tmp/rpgraph-storybook.redacted.json "resources/default-content/My Story.v1.rpgraph-storybook.json" "resources/default-content/My Story.v1.rpgraph-storybook.json"
   ```

4. Validate the resulting Storybook. Confirm that all intended text or structure
   changes are present, no redaction markers remain, and embedded media matches
   the original except for intentional image additions or removals.

The merge fails if a marker's hash cannot be found in the supplied original. This
prevents silently saving a Storybook with missing image data. Both commands accept
only plain `rpgraph-storybook` documents; encrypted files must be decrypted through
the application first.

## Edit Workflow Prompts

For LLM Prompt Switch changes, avoid touching unrelated graph data:

```bash
npm run workflow:prompts:extract -- resources/default-content/workflow.default_v28.json /tmp/rpgraph-prompts.json
npm run workflow:prompts:merge -- /tmp/rpgraph-prompts.json resources/default-content/workflow.default_v28.json resources/default-content/workflow.default_v28.json
```

Always pass the intended workflow explicitly because the repository contains both
classic and planning defaults.
