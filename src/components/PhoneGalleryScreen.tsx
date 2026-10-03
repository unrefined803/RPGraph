import { useEffect, useState } from 'react';
import { usePanelNavigationOverlay } from '../navigation/usePanelNavigation';
import type { ChatImageAttachment } from '../types';
import { appDialogCoversPhone } from './phoneEscape';

const phoneGalleryPageSize = 100;

type PhoneGalleryScreenProps = {
  title: string;
  images: ChatImageAttachment[];
  action: 'select' | 'wallpaper';
  selectedWallpaperId?: string;
  onBack: () => void;
  onSelectImage: (image: ChatImageAttachment) => void;
};

export function PhoneGalleryScreen({
  title,
  images,
  action,
  selectedWallpaperId,
  onBack,
  onSelectImage,
}: PhoneGalleryScreenProps) {
  const [selectedImage, setSelectedImage] = useState<ChatImageAttachment>();
  usePanelNavigationOverlay(() => setSelectedImage(undefined), !!selectedImage);
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
            <div className="phone-gallery-detail-overlay-actions">
              <button
                type="button"
                className="phone-gallery-action-btn cancel"
                onClick={() => setSelectedImage(undefined)}
                title="Cancel"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className={`phone-gallery-action-btn select${action === 'wallpaper' ? ' wallpaper' : ''}`}
                onClick={() => {
                  onSelectImage(selectedImage);
                  setSelectedImage(undefined);
                }}
                title={action === 'wallpaper' ? 'Set as wallpaper' : 'Select image'}
              >
                {action === 'wallpaper' ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8" cy="8" r="1.25" />
                      <path d="m4 18 5-5 3 3 2-2 6 4" />
                    </svg>
                    <span>Wallpaper</span>
                  </>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </div>
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
