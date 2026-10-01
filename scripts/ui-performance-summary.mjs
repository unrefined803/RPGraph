#!/usr/bin/env node
// Condenses an exported rpgraph-ui-performance-*.json report into stall windows.
import { readFileSync } from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run perf:summary -- <report.json> [--min-gap=34] [--top=8] [--context=60]');
  process.exit(1);
}
const option = (name, fallback) => {
  const value = Number(flags.find((flag) => flag.startsWith(`--${name}=`))?.split('=')[1]);
  return Number.isFinite(value) ? value : fallback;
};
const minGap = option('min-gap', 34);
const top = option('top', 8);
const context = option('context', 60);

const report = JSON.parse(readFileSync(file, 'utf8'));
const events = [...report.events].sort((a, b) => a.startMs - b.startMs);
const ms = (value) => value.toFixed(1).padStart(8);
const isStall = (entry) => ['frame-gap', 'longtask', 'long-animation-frame'].includes(entry.kind);
// Per-frame scroll samples dominate the timeline; keep only unusually slow ones.
const isNoise = (entry) => entry.name.startsWith('scroll.') && entry.kind === 'work' && entry.durationMs < 2;

console.log(`${file}\nApp ${report.appVersion}, ${(report.durationMs / 1000).toFixed(1)} s, ` +
  `${events.length} samples, ${report.overwrittenSamples} overwritten, ` +
  `React Profiler ${report.reactProfilerObserved ? 'observed' : 'not observed'}`);

const gaps = events.filter((entry) => entry.kind === 'frame-gap');
console.log(`\nFrame gaps: ${gaps.length} recorded, ${gaps.filter((gap) => gap.durationMs >= minGap).length} of at least ` +
  `${minGap} ms, longest ${Math.max(0, ...gaps.map((gap) => gap.durationMs)).toFixed(1)} ms`);

const totals = new Map();
for (const entry of events) {
  if (entry.kind !== 'work' && entry.kind !== 'react-render') continue;
  const total = totals.get(entry.name) ?? { count: 0, sum: 0, max: 0 };
  total.count++;
  total.sum += entry.durationMs;
  total.max = Math.max(total.max, entry.durationMs);
  totals.set(entry.name, total);
}
console.log('\nMeasured work (nested spans overlap; do not add them together)');
for (const [name, total] of [...totals].sort((a, b) => b[1].max - a[1].max).slice(0, 15)) {
  console.log(`  ${name.padEnd(30)} n=${String(total.count).padStart(5)} max=${ms(total.max)} total=${ms(total.sum)}`);
}

// Merge overlapping browser and frame-gap entries into one window per stall.
const windows = [];
for (const stall of events.filter((entry) => isStall(entry) && entry.durationMs >= minGap)) {
  const end = stall.startMs + stall.durationMs;
  const current = windows.find((window) => stall.startMs <= window.end + context && end >= window.start - context);
  if (current) {
    current.start = Math.min(current.start, stall.startMs);
    current.end = Math.max(current.end, end);
    current.longest = Math.max(current.longest, stall.durationMs);
  } else windows.push({ start: stall.startMs, end, longest: stall.durationMs });
}

for (const window of windows.sort((a, b) => b.longest - a.longest).slice(0, top)) {
  console.log(`\n=== Stall of ${window.longest.toFixed(1)} ms, ${ms(window.start).trim()}–${ms(window.end).trim()} ms`);
  let previousEnd;
  for (const entry of events) {
    if (entry.startMs < window.start - context || entry.startMs > window.end + 5 || isNoise(entry)) continue;
    // Unattributed time between instrumented samples is where uninstrumented work hides.
    if (!isStall(entry)) {
      if (previousEnd !== undefined && entry.startMs - previousEnd >= 5) {
        console.log(`${' '.repeat(20)}… ${(entry.startMs - previousEnd).toFixed(1)} ms without samples`);
      }
      previousEnd = Math.max(previousEnd ?? 0, entry.startMs + entry.durationMs);
    }
    const detail = entry.detail ? JSON.stringify(entry.detail) : '';
    console.log(`${ms(entry.startMs)} +${ms(entry.durationMs).trim().padStart(6)} ` +
      `${isStall(entry) ? '!' : ' '} ${entry.name} ${detail.length > 240 ? `${detail.slice(0, 240)}…` : detail}`);
  }
}
