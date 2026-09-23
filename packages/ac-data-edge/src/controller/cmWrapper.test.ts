import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyCmNameSuffix,
    CM_SUFFIX_SEP,
    LOBBY_NAME_MAX,
    stripCmNameSuffix,
    trimBaseToFitLobbyName,
    utf8ByteLength,
} from './cmWrapper.js';

test('stripCmNameSuffix removes CM wrapper port marker', () => {
    assert.equal(stripCmNameSuffix(`ProjectD ${CM_SUFFIX_SEP}18089`), 'ProjectD');
});

test('applyCmNameSuffix appends wrapper port', () => {
    const name = applyCmNameSuffix('ProjectD |Akina', 18081);
    assert.ok(name.endsWith(`${CM_SUFFIX_SEP}18081`));
    assert.equal(name, `ProjectD |Akina ${CM_SUFFIX_SEP}18081`);
});

test('applyCmNameSuffix clamps long names for lobby limit', () => {
    const longBase =
        'ProjectD |Tsukuba Fruits Line outbound Real | Competitive Touge Time Attack | Global Leaderboards | discord.gg/3Fqbg8a6qf';
    const name = applyCmNameSuffix(longBase, 18089);
    assert.ok(name.includes(`${CM_SUFFIX_SEP}18089`));
    assert.ok(name.length <= LOBBY_NAME_MAX);
    assert.ok(utf8ByteLength(name) <= LOBBY_NAME_MAX);
});

test('trimBaseToFitLobbyName handles multibyte CM suffix', () => {
    const suffix = ` ${CM_SUFFIX_SEP}18089`;
    const base = 'x'.repeat(LOBBY_NAME_MAX);
    const trimmed = trimBaseToFitLobbyName(base, suffix);
    const full = `${trimmed}${suffix}`;
    assert.ok(full.length <= LOBBY_NAME_MAX);
    assert.ok(utf8ByteLength(full) <= LOBBY_NAME_MAX);
});
