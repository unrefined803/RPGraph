import { expect, it } from 'vitest';
import { createRunClock } from './runClock';

it('freezes during user input and resumes without adding human waiting time', () => {
  let now = 100;
  const clock = createRunClock(() => now);
  now = 3100;
  clock.pause();
  now = 73100;
  expect(clock.elapsedMs()).toBe(3000);
  clock.resume();
  expect(clock.startTimeMs()).toBe(70100);
  now = 75100;
  expect(clock.elapsedMs()).toBe(5000);
});

it('keeps the final duration frozen when cancelled while waiting', () => {
  let now = 0;
  const clock = createRunClock(() => now);
  now = 5000;
  clock.pause();
  now = 75000;
  clock.pause();
  expect(clock.elapsedMs()).toBe(5000);
});

it('excludes each pause without double counting repeated resumes', () => {
  let now = 0;
  const clock = createRunClock(() => now);
  for (let index = 0; index < 3; index++) {
    now += 2000;
    clock.pause();
    now += 60000;
    clock.resume();
    clock.resume();
  }
  expect(clock.elapsedMs()).toBe(6000);
  expect(now - clock.startTimeMs()).toBe(6000);
});
