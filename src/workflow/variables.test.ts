import { describe, it, expect } from 'vitest';
import { parseWorkflowVariableSetCommands, resolveWorkflowVariables } from './variables';

const definitions = [
  { key: 'name', label: 'Name' },
  { key: 'loc', label: 'Current Location' },
];
const values = { name: 'World', loc: 'Old Harbor' };

describe('resolveWorkflowVariables', () => {
  it('substitutes <Alias> with its value, matching aliases case-insensitively', () => {
    expect(resolveWorkflowVariables('Hello <Name>!', definitions, values)).toBe('Hello World!');
    expect(resolveWorkflowVariables('At <current location>.', definitions, values)).toBe('At Old Harbor.');
  });

  it('keeps an escaped \\<Alias> as a literal, minus the escape', () => {
    expect(resolveWorkflowVariables('Literal \\<Name>', definitions, values)).toBe('Literal <Name>');
  });

  it('leaves unknown aliases and delimiter-free text untouched', () => {
    expect(resolveWorkflowVariables('<Unknown>', definitions, values)).toBe('<Unknown>');
    expect(resolveWorkflowVariables('no variables here', definitions, values)).toBe('no variables here');
  });
});

describe('parseWorkflowVariableSetCommands', () => {
  it('parses a one-line @set assignment', () => {
    expect(parseWorkflowVariableSetCommands('@set Current Location = "Old Harbor"')).toEqual([
      { name: 'Current Location', value: 'Old Harbor' },
    ]);
  });

  it('parses a @set/@endset block, and an unterminated block commits nothing', () => {
    const block = ['@set', 'Name = "Nova"', 'Score = 12', '@endset'].join('\n');
    expect(parseWorkflowVariableSetCommands(block)).toEqual([
      { name: 'Name', value: 'Nova' },
      { name: 'Score', value: '12' },
    ]);
    expect(parseWorkflowVariableSetCommands('@set\nName = "Nova"')).toEqual([]);
  });
});
