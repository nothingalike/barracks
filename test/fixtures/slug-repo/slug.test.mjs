import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './slug.mjs';
test('slugifies a title', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('trims separators', () => assert.equal(slugify('  Hello, World!  '), 'hello-world'));
test('handles empty input', () => assert.equal(slugify(''), ''));
