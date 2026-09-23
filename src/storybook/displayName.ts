export function storybookDisplayName(value: string) {
  return value
    .replace(/(\.rpgraph-storybook)?\.json$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}
