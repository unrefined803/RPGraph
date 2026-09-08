import { CharacterAvatar } from './CharacterAvatar';
import {
  defaultRpStorybookCharacterBanking,
  type RpStorybook,
  type RpStorybookCharacter,
} from '../nodes/rp-storybook/model';

type StorybookReadonlyPreviewProps = {
  storybook: RpStorybook;
  showDocumentHeader?: boolean;
};

export function StorybookReadonlyPreview({
  storybook,
  showDocumentHeader = true,
}: StorybookReadonlyPreviewProps) {
  return (
    <div className="storybook-ui-view">
      {showDocumentHeader && (
        <div className="storybook-ui-header">
          <div className="storybook-ui-cover-art">
            <div className="book-spine" />
            <div className="book-details">
              <h3>{storybook.title || 'Untitled RP Storybook'}</h3>
              <p className="storybook-intro">{storybook.introduction || 'No introduction defined.'}</p>
            </div>
          </div>
        </div>
      )}

      <section className="storybook-section scenario-section">
        <div className="section-header">
          <h4>Scenario</h4>
        </div>
        <div className="section-content">
          <div className="scenario-field">
            <span className="field-label">Summary</span>
            <p>{storybook.scenario.summary || 'No scenario summary defined.'}</p>
          </div>
          <div className="scenario-grid">
            <div className="scenario-field">
              <span className="field-label">Opening Situation</span>
              <p>{storybook.scenario.openingSituation || 'No opening situation defined.'}</p>
            </div>
            <div className="scenario-field">
              <span className="field-label">Current Situation</span>
              <p>{storybook.scenario.currentSituation || 'No current situation defined.'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="storybook-section actors-section">
        <div className="section-header">
          <h4>Characters</h4>
        </div>
        {storybook.characters.length ? (
          <div className="storybook-actor-grid">
            {storybook.characters.map((character) => (
              <article className="storybook-actor-card" key={character.id}>
                <div className="character-card-header">
                  <CharacterAvatar
                    className="avatar-circle actor-avatar"
                    name={character.name || character.id}
                    fallback={(character.name || character.id).substring(0, 2).toUpperCase()}
                    profileImageDataUrl={character.profileImage?.dataUrl}
                  />
                  <div className="character-card-title-side">
                    <h5 className="character-name">{character.name || character.id}</h5>
                    {character.role ? <p className="character-subrole">{character.role}</p> : null}
                  </div>
                </div>

                <div className="character-fields">
                  {character.description ? (
                    <div className="character-field">
                      <span className="field-label">Description</span>
                      <p>{character.description}</p>
                    </div>
                  ) : null}
                  {character.personality ? (
                    <div className="character-field">
                      <span className="field-label">Personality</span>
                      <p>{character.personality}</p>
                    </div>
                  ) : null}
                  {character.speechStyle ? (
                    <div className="character-field">
                      <span className="field-label">Speech Style</span>
                      <p>{character.speechStyle}</p>
                    </div>
                  ) : null}
                  {character.comfyConfig?.appearance ? (
                    <div className="character-field">
                      <span className="field-label">Appearance</span>
                      <p>{character.comfyConfig.appearance}</p>
                    </div>
                  ) : null}
                  <div className="character-field">
                    <span className="field-label">Phone Apps</span>
                    <p>{characterPhoneSummary(character)}</p>
                  </div>
                  <div className="character-field character-images-summary-field">
                    <span className="field-label">Images</span>
                    <p>{character.images.length === 1 ? '1 image' : `${character.images.length} images`}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="storybook-empty-note">No characters defined.</p>
        )}
      </section>
    </div>
  );
}

function characterPhoneSummary(character: RpStorybookCharacter) {
  const banking = character.banking ?? defaultRpStorybookCharacterBanking();
  const accountStatus = (created: boolean) => (
    <span
      className={`character-phone-account-status${created ? ' created' : ''}`}
      aria-label={created ? 'Account created' : 'Account not created'}
    >
      {created ? '✓' : '×'}
    </span>
  );

  return (
    <span className="character-phone-summary">
      <span>Bank: ${banking.startBalance}</span>
      <span className="character-phone-summary-separator" aria-hidden="true">·</span>
      <span>Fotogram {accountStatus(true)}</span>
      <span className="character-phone-summary-separator" aria-hidden="true">·</span>
      <span>OnlyFriends {accountStatus(Boolean(character.apps?.onlyfriends?.enabled))}</span>
      <span className="character-phone-summary-separator" aria-hidden="true">·</span>
      <span>MatchMe {accountStatus(Boolean(character.apps?.matchme?.enabled))}</span>
    </span>
  );
}
