import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RpStorybookCharacterImage, RpStorybookCharacterProfileImage } from '../nodes/rp-storybook/model';
import { useBackdropDismiss } from './useBackdropDismiss';

type ProfileCrop = NonNullable<RpStorybookCharacterProfileImage['crop']>;
const profilePickOutputSize = 512;
const profilePickMinSize = 18;

function profileCropHeightPercent(crop: ProfileCrop, imageRatio: number) {
  return crop.size * imageRatio;
}

function clampProfileCrop(crop: ProfileCrop, imageRatio: number): ProfileCrop {
  const maxSize = Math.max(profilePickMinSize, Math.min(100, 100 / imageRatio));
  const size = Math.min(maxSize, Math.max(profilePickMinSize, crop.size));
  const maxX = Math.max(0, 100 - size);
  const maxY = Math.max(0, 100 - size * imageRatio);
  return {
    x: Math.min(maxX, Math.max(0, crop.x)),
    y: Math.min(maxY, Math.max(0, crop.y)),
    size,
  };
}

function centeredProfileCrop(imageRatio: number): ProfileCrop {
  const size = Math.min(56, 100, 100 / imageRatio);
  const crop = {
    x: (100 - size) / 2,
    y: (100 - size * imageRatio) / 2,
    size,
  };
  return clampProfileCrop(crop, imageRatio);
}

function imageElementFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image for profile pic.'));
    image.src = dataUrl;
  });
}

async function croppedProfileImageDataUrl(image: RpStorybookCharacterImage, crop: ProfileCrop) {
  const source = await imageElementFromDataUrl(image.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = profilePickOutputSize;
  canvas.height = profilePickOutputSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable.');
  }
  const sourceSize = (crop.size / 100) * source.naturalWidth;
  context.drawImage(
    source,
    (crop.x / 100) * source.naturalWidth,
    (crop.y / 100) * source.naturalHeight,
    sourceSize,
    sourceSize,
    0,
    0,
    profilePickOutputSize,
    profilePickOutputSize,
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Drag a round crop over a gallery image; shared by character portraits and app avatars. */
export function ProfilePickDialog({
  characterName,
  image,
  currentProfileImage,
  onApply,
  onClose,
}: {
  characterName: string;
  image: RpStorybookCharacterImage;
  currentProfileImage?: RpStorybookCharacterProfileImage;
  onApply: (profileImage: RpStorybookCharacterProfileImage) => void;
  onClose: () => void;
}) {
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCrop: ProfileCrop;
    frameWidth: number;
    frameHeight: number;
  } | null>(null);
  const [imageRatio, setImageRatio] = useState(() =>
    image.width && image.height ? image.width / image.height : 1
  );
  const [crop, setCrop] = useState<ProfileCrop>(() =>
    currentProfileImage?.imageId === image.id && currentProfileImage.crop
      ? currentProfileImage.crop
      : centeredProfileCrop(image.width && image.height ? image.width / image.height : 1)
  );
  const [status, setStatus] = useState('');
  const clampedCrop = clampProfileCrop(crop, imageRatio);
  const cropHeight = profileCropHeightPercent(clampedCrop, imageRatio);

  function beginDrag(mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) {
    const frame = imageFrameRef.current;
    if (!frame) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: clampedCrop,
      frameWidth: rect.width,
      frameHeight: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragCrop(event: ReactPointerEvent<HTMLElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - active.startClientX;
    const deltaY = event.clientY - active.startClientY;
    if (active.mode === 'move') {
      setCrop(clampProfileCrop({
        ...active.startCrop,
        x: active.startCrop.x + (deltaX / active.frameWidth) * 100,
        y: active.startCrop.y + (deltaY / active.frameHeight) * 100,
      }, imageRatio));
      return;
    }
    const deltaSize = Math.max(deltaX, deltaY) / active.frameWidth * 100;
    setCrop(clampProfileCrop({
      ...active.startCrop,
      size: active.startCrop.size + deltaSize,
    }, imageRatio));
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  async function applyProfileImage() {
    try {
      setStatus('Applying profile pic ...');
      const nextCrop = clampedCrop;
      const dataUrl = await croppedProfileImageDataUrl(image, nextCrop);
      onApply({
        imageId: image.id,
        dataUrl,
        crop: nextCrop,
      });
    } catch (error) {
      setStatus(`Profile pic failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  // Escape closes only this dialog: the capture phase runs before the dialogs and
  // phone screens underneath, which would otherwise close as well.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    }
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', closeOnEscape, { capture: true });
  }, []);

  return (
    <div
      className="profile-pick-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="profile-pick-dialog" role="dialog" aria-modal="true" aria-label={`${characterName} profile pic`}>
        <div className="profile-pick-header">
          <div>
            <h4>Change Profile Pic</h4>
            <p>{image.name}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>
        {status && <span className="run-note storybook-image-status">{status}</span>}
        <div className="profile-pick-stage">
          <div className="profile-pick-image-frame" ref={imageFrameRef}>
            <img
              src={image.dataUrl}
              alt={image.name}
              onLoad={(event) => {
                const loadedImage = event.currentTarget;
                const nextRatio = loadedImage.naturalWidth / loadedImage.naturalHeight || 1;
                setImageRatio(nextRatio);
                if (currentProfileImage?.imageId !== image.id) {
                  setCrop(centeredProfileCrop(nextRatio));
                }
              }}
            />
            <div className="profile-pick-scrim" aria-hidden="true" />
            <button
              type="button"
              className="profile-pick-crop"
              style={{
                left: `${clampedCrop.x}%`,
                top: `${clampedCrop.y}%`,
                width: `${clampedCrop.size}%`,
                height: `${cropHeight}%`,
              }}
              onPointerDown={(event) => beginDrag('move', event)}
              onPointerMove={dragCrop}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label="Move profile crop"
            >
              <span className="profile-pick-crop-handle" aria-hidden="true" />
              <span
                className="profile-pick-crop-resize"
                role="presentation"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag('resize', event);
                }}
                onPointerMove={dragCrop}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            </button>
          </div>
        </div>
        <div className="profile-pick-actions">
          <button className="inspect-button nodrag" type="button" onClick={() => onApply({ imageId: image.id, dataUrl: image.dataUrl })}>
            Use Full Image
          </button>
          <button className="contextual-action-button nodrag" type="button" onClick={() => void applyProfileImage()}>
            Apply
          </button>
        </div>
      </section>
    </div>
  );
}
