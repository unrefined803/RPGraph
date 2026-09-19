import { useState, useRef, useEffect, useCallback, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { agencyTagCatalog } from '../../shared/agency-tags.cjs';

export const AGENCY_TAG_TOOLTIP_DELAY_MS = 700;

export function getAgencyTagMeaning(tagId: string): string | undefined {
  return agencyTagCatalog.find((tag) => tag.id === tagId)?.meaning;
}

export type AgencyTooltipState = {
  tagId: string;
  meaning: string;
  extra?: string;
  rect: DOMRect;
  placement: 'top' | 'bottom' | 'side';
  sideAlign?: 'left' | 'right';
};

export function useAgencyTagHoverTooltip(delayMs: number = AGENCY_TAG_TOOLTIP_DELAY_MS) {
  const [tooltipState, setTooltipState] = useState<AgencyTooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimer();
    currentTargetRef.current = null;
    setTooltipState(null);
  }, [clearTimer]);

  const showTooltipForElement = useCallback((
    tagId: string,
    element: HTMLElement,
    extra?: string,
    isDropdownOption = false,
  ) => {
    clearTimer();
    setTooltipState(null);
    currentTargetRef.current = element;

    const meaning = getAgencyTagMeaning(tagId);
    if (!meaning) return;

    timerRef.current = setTimeout(() => {
      if (currentTargetRef.current !== element) return;
      const rect = element.getBoundingClientRect();

      let placement: AgencyTooltipState['placement'];
      let sideAlign: AgencyTooltipState['sideAlign'] = 'right';

      if (isDropdownOption) {
        if (rect.right + 300 < window.innerWidth) {
          placement = 'side';
          sideAlign = 'right';
        } else if (rect.left - 300 > 0) {
          placement = 'side';
          sideAlign = 'left';
        } else {
          placement = rect.top > 130 ? 'top' : 'bottom';
        }
      } else {
        placement = rect.top > 130 ? 'top' : 'bottom';
      }

      setTooltipState({
        tagId,
        meaning,
        extra,
        rect,
        placement,
        sideAlign,
      });
    }, delayMs);
  }, [clearTimer, delayMs]);

  const handleTagMouseEnter = useCallback((tagId: string, extra?: string) => {
    return (event: MouseEvent<HTMLElement>) => {
      showTooltipForElement(tagId, event.currentTarget, extra, false);
    };
  }, [showTooltipForElement]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (!tooltipState) return;

    const handleWindowScroll = () => {
      hideTooltip();
    };
    const handleWindowResize = () => {
      hideTooltip();
    };

    window.addEventListener('scroll', handleWindowScroll, true);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('scroll', handleWindowScroll, true);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [tooltipState, hideTooltip]);

  const calculateTooltipStyle = (state: AgencyTooltipState) => {
    const { rect, placement, sideAlign } = state;
    const tooltipWidth = 280;

    if (placement === 'side') {
      const top = Math.max(12, Math.min(window.innerHeight - 150, rect.top - 4));
      const left = sideAlign === 'right' ? rect.right + 8 : rect.left - tooltipWidth - 8;
      return {
        position: 'fixed' as const,
        top,
        left,
        maxWidth: tooltipWidth,
        zIndex: 100060,
        pointerEvents: 'none' as const,
      };
    }

    const placeAbove = placement === 'top';
    const top = placeAbove ? rect.top - 8 : rect.bottom + 8;
    const center = rect.left + rect.width / 2;
    const left = Math.max(16, Math.min(window.innerWidth - tooltipWidth - 16, center - tooltipWidth / 2));

    return {
      position: 'fixed' as const,
      top,
      left,
      maxWidth: tooltipWidth,
      transform: placeAbove ? 'translateY(-100%)' : 'none',
      zIndex: 100060,
      pointerEvents: 'none' as const,
    };
  };

  const TooltipPortal = tooltipState && typeof document !== 'undefined'
    ? createPortal(
        <div
          className={`character-agency-tooltip placement-${tooltipState.placement}${tooltipState.sideAlign ? ` side-${tooltipState.sideAlign}` : ''}`}
          role="tooltip"
          style={calculateTooltipStyle(tooltipState)}
        >
          <div className="character-agency-tooltip-header">
            <span className="character-agency-tooltip-tag">{tooltipState.tagId}</span>
          </div>
          <div className="character-agency-tooltip-meaning">
            {tooltipState.meaning}
          </div>
          {tooltipState.extra && (
            <div className="character-agency-tooltip-extra">
              {tooltipState.extra}
            </div>
          )}
        </div>,
        document.body
      )
    : null;

  return {
    handleTagMouseEnter,
    handleTagMouseLeave: hideTooltip,
    handleTagClick: hideTooltip,
    handlePointerDown: hideTooltip as (event: ReactPointerEvent<HTMLElement>) => void,
    showTooltipForElement,
    hideTooltip,
    TooltipPortal,
    tooltipState,
  };
}
