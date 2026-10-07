import { PhonePortraits } from './PortraitManager';
import type { PortraitOwner } from '../characters/portraits';
import type { RpStorybookCharacterImage } from '../nodes/rp-storybook/model';
import { useEffect, useState } from 'react';
import { usePanelNavigationOverlay } from '../navigation/usePanelNavigation';
import type { ChatImageAttachment } from '../types';
import { appDialogCoversPhone } from './phoneEscape';

const phoneGalleryPageSize = 100;

type PhoneGalleryScreenProps = {
  title: string;
  portraitOwner?: PortraitOwner & { name: string };
  onPortraitsChange?: (owner: PortraitOwner) => void;
  images: ChatImageAttachment[];
  action: 'select' | 'wallpaper';
  selectedWallpaperId?: string;
  onBack: () => void;
  onSelectImage: (image: ChatImageAttachment) => void;
};

export function PhoneGalleryScreen({
  title,
  portraitOwner,
  onPortraitsChange,
  images,
  action,
  selectedWallpaperId,
  onBack,
  onSelectImage,
}: PhoneGalleryScreenProps) {
  const [portraitsOpen, setPortraitsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment>();
  usePanelNavigationOverlay(() => setSelectedImage(undefined), !!selectedImage);
  usePanelNavigationOverlay(() => setPortraitsOpen(false), portraitsOpen);
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(images.length / phoneGalleryPageSize));
  const visiblePage = Math.min(page, totalPages - 1);
  const visibleImages = images.slice(
    visiblePage * phoneGalleryPageSize,
    (visiblePage + 1) * phoneGalleryPageSize,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (appDialogCoversPhone()) {
        return;
      }
      if (event.key === 'Escape') {
        if (selectedImage) {
          setSelectedImage(undefined);
        } else {
          onBack();
        }
      } else if (event.key === 'Enter' && selectedImage) {
        onSelectImage(selectedImage);
        setSelectedImage(undefined);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack, onSelectImage, selectedImage]);

  if (portraitsOpen && portraitOwner && onPortraitsChange) {
    return (
      <div className="phone-gallery-screen" aria-label={`${portraitOwner.name} portraits`}>
        <PhonePortraits
          owner={{ ...portraitOwner, images: images.map((image) => ({ ...image, description: image.description ?? '' })) as RpStorybookCharacterImage[] }}
          initialImageId={selectedImage?.id} onChange={onPortraitsChange} onClose={() => setPortraitsOpen(false)} />
      </div>
    );
  }

  return (
    <div className="phone-gallery-screen" aria-label={title}>
      <header className="phone-gallery-header">
        <button
          type="button"
          onClick={() => (selectedImage ? setSelectedImage(undefined) : onBack())}
          aria-label={selectedImage ? 'Back to gallery' : 'Back'}
          title={selectedImage ? 'Back to gallery' : 'Back'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <span>Phone Gallery</span>
          <strong>{title}</strong>
        </div>
        {portraitOwner && onPortraitsChange && (
          <button type="button" className="phone-gallery-header-button" onClick={() => setPortraitsOpen(true)}>
            {selectedImage ? 'Portrait' : 'Portraits'}
          </button>
        )}
        {selectedImage && (
          <button type="button" className="phone-gallery-header-button" onClick={() => { onSelectImage(selectedImage); setSelectedImage(undefined); }}>
            {action === 'wallpaper' ? 'Wallpaper' : 'Select'}
          </button>
        )}
      </header>

      {selectedImage ? (
        <div className="phone-gallery-detail">
          <div className="phone-gallery-detail-stage">
            <img src={selectedImage.dataUrl} alt={selectedImage.name} />
            {selectedImage.description?.trim() && (
              <div className="phone-gallery-detail-caption">
                {selectedImage.description}
              </div>
            )}
          </div>
        </div>
      ) : images.length ? (
        <>
          {images.length > phoneGalleryPageSize && (
            <div className="phone-gallery-pagination image-gallery-pagination">
              <button
                type="button"
                disabled={visiblePage === 0}
                onClick={() => setPage(Math.max(0, visiblePage - 1))}
              >
                Previous
              </button>
              <span>
                Page {visiblePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={visiblePage >= totalPages - 1}
                onClick={() => setPage(Math.min(totalPages - 1, visiblePage + 1))}
              >
                Next
              </button>
            </div>
          )}
          <div className="phone-gallery-scroll">
            <div className="phone-gallery-grid">
              {visibleImages.map((image) => {
              const receivedLabel = image.receivedFrom?.trim()
                ? `Received from ${image.receivedFrom.trim()}`
                : (image.imageAccess ? 'Image Access' : '');
              const description = image.description || '';
              return (
                <button
                  type="button"
                  key={image.id}
                  className={`phone-gallery-tile${
                    action === 'wallpaper' && selectedWallpaperId === image.id ? ' active' : ''
                  }`}
                  onClick={() => setSelectedImage(image)}
                  aria-label={`Preview ${image.name}`}
                  title={[receivedLabel, description.trim() || image.name].filter(Boolean).join('\n')}
                >
                  <div className="phone-gallery-image-preview">
                    <img src={image.dataUrl} alt={image.name} loading="lazy" decoding="async" />
                    {receivedLabel && (
                      <span className="phone-gallery-received-badge" title={receivedLabel}>
                        {receivedLabel}
                      </span>
                    )}
                  </div>
                </button>
              );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="phone-gallery-empty">
          <span aria-hidden="true">▦</span>
          <strong>No images in this Phone Gallery</strong>
          <small>Add images to this character in RP Storybook first.</small>
        </div>
      )}
    </div>
  );
}
