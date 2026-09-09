import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { normalizeRpStorybook } from '../nodes/rp-storybook/model';
import { StorybookReadonlyPreview } from './StorybookReadonlyPreview';

const storybook = normalizeRpStorybook({
  format: 'rpgraph-storybook',
  version: '3.0.0',
  title: 'Hidden document title',
  introduction: 'Hidden introduction',
  scenario: {
    summary: 'A rainy evening.',
    openingSituation: 'The guests arrive.',
    currentSituation: 'Dinner begins.',
  },
  characters: [{
    id: 'alex',
    name: 'Alex',
    role: 'Host',
    description: 'Keeps the evening moving.',
    personality: 'Warm',
    speechStyle: 'Direct',
    images: [{
      id: 'alex-gallery-1',
      name: 'Gallery image',
      mimeType: 'image/jpeg',
      size: 3,
      dataUrl: 'data:image/jpeg;base64,AQID',
      description: 'A gallery image that must not be rendered.',
    }],
  }],
  phoneContacts: { blocked: [{ owner: 'alex', contact: 'sam' }] },
  openingHistory: { summary: 'Hidden history', turns: [] },
});

describe('StorybookReadonlyPreview', () => {
  it('can render only scenario and character information', () => {
    const markup = renderToStaticMarkup(
      createElement(StorybookReadonlyPreview, { storybook, showDocumentHeader: false }),
    );

    expect(markup).toContain('Scenario');
    expect(markup).toContain('A rainy evening.');
    expect(markup).toContain('Characters');
    expect(markup).toContain('Alex');
    expect(markup).toContain('1 image');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('A gallery image that must not be rendered.');
    expect(markup).not.toContain('Hidden document title');
    expect(markup).not.toContain('Hidden introduction');
    expect(markup).not.toContain('Phone + Fotogram Contacts');
    expect(markup).not.toContain('Opening History');
    expect(markup).not.toContain('Hidden history');
  });
});
