// A list asked of an agent, reused while it is fresh.
import assert from 'node:assert/strict';
import test from 'node:test';

import { listCache } from '../dist/listCache.js';

test('listCache: reused under the same key, asked again under another', async () => {
    const cache = listCache();
    let asked = 0;
    const ask = async () => [++asked];
    assert.deepEqual(await cache.get('a', ask), [1]);
    assert.deepEqual(await cache.get('a', ask), [1]);
    assert.deepEqual(await cache.get('b', ask), [2]);
});

test('listCache: an ask under way is joined, and refresh asks again', async () => {
    const cache = listCache();
    let asked = 0;
    const ask = () => new Promise((resolve) => setTimeout(() => resolve(++asked), 10));
    const [one, two] = await Promise.all([cache.get('a', ask), cache.get('a', ask)]);
    assert.equal(one, 1);
    assert.equal(two, 1);
    assert.equal(await cache.get('a', ask, true), 2);
    assert.equal(await cache.get('a', ask), 2);
});

test('listCache: a failure is not kept', async () => {
    const cache = listCache();
    await assert.rejects(cache.get('a', () => Promise.reject(new Error('not signed in'))), /not signed in/);
    assert.deepEqual(await cache.get('a', async () => ['ok']), ['ok']);
});

test('listCache: a list had another way is kept as if asked', async () => {
    const cache = listCache();
    cache.set('a', ['given']);
    assert.deepEqual(await cache.get('a', async () => ['asked']), ['given']);
});
