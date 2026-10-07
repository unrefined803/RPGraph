# Shared portrait conversion handoff

The application now uses three character-owned portrait slots. Existing bundled
characters are intentionally not rewritten by this implementation; a separate
authoring pass must select the correct real and persona images. Do not infer a
real face or secret identity from filenames alone.

## Canonical payload

```json
{
  "profileImage": { "imageId": "real-face", "crop": { "x": 10, "y": 15, "size": 35 } },
  "customPortraits": {
    "custom1": { "imageId": "work-persona", "crop": { "x": 20, "y": 10, "size": 30 } },
    "custom2": { "imageId": "dating-persona" }
  },
  "apps": {
    "whatsup": {
      "accountId": "existing-id",
      "enabled": true,
      "bio": "",
      "portraitId": "character",
      "alias": { "name": "Work Name", "portraitId": "custom1" }
    },
    "fotogram": {
      "accountId": "existing-social-id",
      "enabled": true,
      "profileName": "Public Persona",
      "bio": "",
      "privacyMode": true,
      "portraitId": "custom2"
    }
  }
}
```

- `profileImage` always identifies the real character. NPC Library rows use it.
- `customPortraits` is optional and allows only `custom1` and `custom2`.
  A real portrait must exist before creating either custom slot. The same image
  may be referenced by multiple slots with different crops.
- Every app, including MatchMe and the main WhatsUp account, selects `portraitId`.
  The second WhatsUp account has its own `alias.portraitId`. An omitted selection
  means `character`; a custom selection requires the corresponding slot.
- Fotogram, OnlyFriends and the second WhatsUp account may select `none` to show
  no portrait. MatchMe and the main WhatsUp account always require a portrait.
  Use `none` for accounts that previously showed no picture, such as private
  social accounts or a second WhatsUp account without its own avatar.
- A crop's `x` is a percentage of image width, `y` a percentage of image height,
  and `size` the square side as a percentage of image width. Omit `crop` to use
  the full image. Never store preview `dataUrl` values outside `images`.
- Privacy mode hides the real name, **not** the selected portrait. Explicitly
  choose a custom slot for accounts that must conceal their real appearance.
- Posts, wallpapers and MatchMe `profile.photoIds` remain independent gallery
  references. Do not replace them with portrait slot IDs.
- Preserve stable character/account/image/post IDs and original gallery bytes.
  There is no new application/container version bump in this change.

## Conversion procedure

1. Use `npm run character:inspect -- --input <container> --output <edit-spec>`.
   Inspect metadata and existing `profileImage`, `avatarImageId`, `avatarCrop`,
   WhatsUp alias and MatchMe photo selections. Extract individual images with
   `character:inspect -- --extract-image` when visual inspection is necessary.
2. Keep the real portrait in `profileImage`. Move each distinct intended persona
   and its existing crop into `custom1` or `custom2`. If more than two alternate
   portraits are present, make an explicit authoring decision; do not silently
   discard or merge them. Existing gallery images need not be removed.
3. Assign all relevant `portraitId` fields. Delete obsolete `avatarImageId` and
   `avatarCrop` account/alias fields after transferring their intended meaning.
   The application tolerates that metadata for inspection but never uses it as
   an avatar fallback. Until converted, unspecified app selections show the real
   portrait; private legacy accounts therefore need review before use.
4. Rebuild from the untouched source with `character:edit`, following the
   repository's blob-free character editing procedure. Validate the result,
   inspect it again, and verify unchanged media bytes and stable identities.
5. Apply the same payload rules to characters embedded in Storybooks or retained
   snapshots if those assets are included in the conversion scope. Use the
   documented redaction/merge procedure for image-bearing Storybooks.

`character:pack` keeps the `P` filename flag for the real portrait only. Custom
slots and app selections are authored in the blob-free specification. `P` no
longer assigns the same image to every account.
