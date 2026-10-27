import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyWindowsProcesses, quoteWindowsArgument } from '../src/qualification/windows-process.ts';

test('Windows arguments retain spaces, quotes and trailing backslashes', () => {
  assert.equal(quoteWindowsArgument('C:\\path with spaces\\'), '"C:\\path with spaces\\\\"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.throws(() => quoteWindowsArgument('a\0b'));
});

test('Windows owned jobs cancel descendants on request and host loss', {
  skip: process.platform !== 'win32', timeout: 45000,
}, async () => {
  const report = await qualifyWindowsProcesses();
  assert.equal(report.status, 'passed');
  assert.equal(report.scenarios.length, 2);
});
