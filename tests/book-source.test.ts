import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_SOURCE_ENV, getBookSource, resolveBookSource } from '../src/lib/book/source.ts';

test('resolveBookSource only returns "model" for the explicit model flag', () => {
  assert.equal(resolveBookSource('model'), 'model');
  assert.equal(resolveBookSource(' MODEL '), 'model');
  assert.equal(resolveBookSource('blend'), 'blend');
  assert.equal(resolveBookSource(''), 'blend');
  assert.equal(resolveBookSource(undefined), 'blend');
  assert.equal(resolveBookSource(null), 'blend');
  assert.equal(resolveBookSource('ml'), 'blend');
  assert.equal(resolveBookSource('true'), 'blend');
});

test('getBookSource reads DIRTIQ_BOOK_SOURCE from the environment and defaults to blend', () => {
  assert.equal(BOOK_SOURCE_ENV, 'DIRTIQ_BOOK_SOURCE');
  const previous = process.env[BOOK_SOURCE_ENV];
  try {
    delete process.env[BOOK_SOURCE_ENV];
    assert.equal(getBookSource(), 'blend');
    process.env[BOOK_SOURCE_ENV] = 'model';
    assert.equal(getBookSource(), 'model');
    process.env[BOOK_SOURCE_ENV] = 'anything-else';
    assert.equal(getBookSource(), 'blend');
  } finally {
    if (previous === undefined) delete process.env[BOOK_SOURCE_ENV];
    else process.env[BOOK_SOURCE_ENV] = previous;
  }
});
