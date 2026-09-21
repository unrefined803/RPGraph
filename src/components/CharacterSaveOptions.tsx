import { useId } from 'react';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';

/** Shared presentation for Storybook exports and standalone character saves. */
export function CharacterSaveOptions<T extends string>({ action = 'Export', includePosts, onIncludePostsChange,
  includeReceivedImages, onIncludeReceivedImagesChange, destination, onDestinationChange, destinations, disabled = false }: {
  action?: 'Export' | 'Save';
  includePosts: boolean;
  onIncludePostsChange: (value: boolean) => void;
  includeReceivedImages: boolean;
  onIncludeReceivedImagesChange: (value: boolean) => void;
  destination: T;
  onDestinationChange: (value: T) => void;
  destinations: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className="character-export-options">
    <label className="dialog-action-checkbox character-export-posts">
      <input type="checkbox" checked={includePosts} disabled={disabled} onChange={(event) => onIncludePostsChange(event.target.checked)} />
      <span><strong>{action} Character with Own Posts</strong><small>Include posts published by this character</small></span>
    </label>
    <label className="dialog-action-checkbox character-export-posts">
      <input type="checkbox" checked={includeReceivedImages} disabled={disabled} onChange={(event) => onIncludeReceivedImagesChange(event.target.checked)} />
      <span><strong>Include Received Images</strong><small>Embed received and shared gallery images in this character file. When excluded, posts keep their text and profile image references are removed; MatchMe is disabled if no photos remain.</small></span>
    </label>
    <label className="character-export-location" htmlFor={id}>
      <span>{action.toUpperCase()} LOCATION</span>
      <NodeCustomSelect id={id} value={destination} options={destinations} onChange={onDestinationChange} disabled={disabled} />
    </label>
  </div>;
}
