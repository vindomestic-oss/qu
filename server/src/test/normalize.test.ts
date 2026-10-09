import './env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { damerauLevenshtein, INVISIBLE_CHARS_RE, matchKey, nearMatch, normalizeForMatch } from '../lib/aiGrading/normalize';
import { cleanAccepted, matchesKeys, parseAccepted, referenceKeys } from '../lib/aiGrading/accepted';

// Wish 7, layer A (S13): the comparison form of free-text answers.

const same = (a: string, b: string) => assert.equal(normalizeForMatch(a), normalizeForMatch(b), `${a} ≠ ${b}`);
const sameKey = (a: string, b: string) => assert.equal(matchKey(normalizeForMatch(a)), matchKey(normalizeForMatch(b)), `${a} ≠ ${b}`);
const differ = (a: string, b: string) =>
  assert.notEqual(matchKey(normalizeForMatch(a)), matchKey(normalizeForMatch(b)), `${a} should differ from ${b}`);

describe('normalizeForMatch', () => {
  test('case, trailing punctuation and spaces', () => {
    same('Yishmael.', 'yishmael');
    same('  YISHMAEL !! ', 'yishmael');
    assert.equal(normalizeForMatch('Yishmael.'), 'yishmael');
  });

  test('Hebrew with and without niqqud and cantillation', () => {
    same('יִשְׁמָעֵאל', 'ישמעאל');
    same('יְהוֹשֻׁעַ', 'יהושע');
    // Cantillation (te'amim) are marks too.
    same('בְּרֵאשִׁ֖ית', 'בראשית');
    // The maqaf is punctuation: a space, so the match key joins the words.
    sameKey('בֶּן־נוּן', 'בן נון');
    // Geresh and gershayim are deleted like apostrophes.
    same('ג׳ורג׳', "ג'ורג'");
    same('רמב״ם', 'רמבם');
  });

  test('Cyrillic: ё and й lose their marks', () => {
    same('Ёсиф', 'Есиф');
    same('Иосиф', 'иосиф');
    same('Моисей', 'Моисеи');
  });

  test('Latin accents and umlauts', () => {
    same('Mosché', 'Mosche');
    same('Ägypten', 'agypten');
    same('Želva Šťastná', 'zelva stastna');
    // NFC and NFD input give the same result.
    same('Mosch\u00E9', 'Mosche\u0301');
  });

  test('invisible and bidi characters are removed', () => {
    same('Yish\u200Bmael', 'Yishmael');
    same('\u200FYishmael\u200E', 'Yishmael');
    same('\u2067ישמעאל\u2069', 'ישמעאל');
    same('Yish\u00ADmael', 'Yishmael');
    same('\uFEFFYishmael', 'Yishmael');
    // Arabic letter mark, Hangul fillers, Mongolian vowel separator, tag characters.
    same('Yish\u061Cmael', 'Yishmael');
    same('Yishmael\u3164', 'Yishmael');
    same('\u115F\u1160Yishmael\uFFA0', 'Yishmael');
    same('Yish\u180Emael', 'Yishmael');
    same('\u{E0041}\u{E0042}Yishmael\u{E007F}', 'Yishmael');
    assert.equal(normalizeForMatch('\u{E0041}\u3164\u200B'), '');
  });

  test('digit groups stay apart in the match key (no merging across a space between digits)', () => {
    differ('70', '7.0');
    differ('70', '7 0');
    differ('1/2 Schekel', '12 Schekel');
    differ('Gen 1:12', 'Gen 11:2');
    differ('2,21', '22,1');
    differ('3,5', '35');
    assert.equal(matchKey(normalizeForMatch('Bereschit 2,21-22')), 'bereschit2 21 22');
    // Words still join: hyphen, space or nothing between letters, and between a word and a number.
    sameKey('Ein-Dor', 'Eindor');
    sameKey('Ein Dor', 'Eindor');
    sameKey('70 Älteste', '70älteste');
    sameKey('Psalm 23', 'Psalm23');
  });

  test("apostrophes, hyphens and a leading article: \"The Giv'onites\" = 'Givonites'", () => {
    same("The Giv'onites", 'Givonites');
    same('The Giv’onites', 'givonites');
    same('Ein-Dor', 'Ein Dor');
    assert.equal(matchKey('ein dor'), matchKey('eindor'));
    sameKey('Ein-Dor', 'Eindor');
    same('der Pharao', 'Pharao');
    same('a farmer', 'Farmer');
    // Only one leading article, and only before a word.
    assert.equal(normalizeForMatch('The the end'), 'the end');
    assert.equal(normalizeForMatch('the'), 'the');
    assert.equal(normalizeForMatch('Theodor'), 'theodor');
  });

  test('symbols and punctuation become spaces; nothing comparable left gives ""', () => {
    assert.equal(normalizeForMatch('Sarah & Lot'), 'sarah lot');
    assert.equal(normalizeForMatch('(Seite)'), 'seite');
    assert.equal(normalizeForMatch('?!…'), '');
    assert.equal(normalizeForMatch('   '), '');
  });

  test('what it deliberately does not do', () => {
    differ('Yishmael', 'Ishmael'); // transliterations: only via accepted answers
    differ('70', 'siebzig'); // number words
    differ('Sarah and Lot', 'Lot and Sarah'); // word order
    differ('Yishmael', 'Yishmeal'); // no fuzzy matching
    differ('Groß', 'Gross'); // ß has no decomposition
    differ('eine Rippe', 'Rippe'); // only the/a/an/der/die/das are dropped
  });

  test('the step-2 regex is written with \\u escapes only', () => {
    // Checked in the source file (a build may turn the escapes into the characters themselves):
    // a copy from a PDF could otherwise carry, drop or reorder invisible characters unnoticed.
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'aiGrading', 'normalize.ts'), 'utf-8');
    const line = source.split('\n').find((l) => l.startsWith('export const INVISIBLE_CHARS_RE'));
    assert.ok(line, 'INVISIBLE_CHARS_RE is declared on one line');
    assert.match(line!, /= \/\[(\\u([0-9A-F]{4}|\{[0-9A-F]{5}\})(-\\u([0-9A-F]{4}|\{[0-9A-F]{5}\}))?)+\]\/gu;$/);
    assert.ok(![...line!].some((c) => c.charCodeAt(0) > 0x7e), 'no literal non-ASCII character on that line');
    assert.ok(INVISIBLE_CHARS_RE.global);
  });
});

describe('edit distance and near matches (hints only)', () => {
  test('damerauLevenshtein', () => {
    assert.equal(damerauLevenshtein('yishmael', 'yishmeal'), 1);
    assert.equal(damerauLevenshtein('yishmael', 'yishmael'), 0);
    assert.equal(damerauLevenshtein('', 'abc'), 3);
    assert.equal(damerauLevenshtein('kitten', 'sitting'), 3);
    assert.equal(damerauLevenshtein('ישמעאל', 'ישמאעל'), 1);
  });

  test('nearMatch: none below 5 characters, ≤ 1 edit up to 8, ≤ 2 from 9', () => {
    assert.equal(nearMatch('davd', ['David']), null);
    assert.equal(nearMatch('yishmeal', ['Yishmael', 'Yitzhak']), 'Yishmael');
    assert.equal(nearMatch('yshmeal', ['Yishmael']), null); // 2 edits at 7 characters
    assert.equal(nearMatch('yehoshua bin nun', ['Yehoshua ben Nun']), 'Yehoshua ben Nun');
    assert.equal(nearMatch('shimshon', ['Shmuel']), null);
  });
});

describe('accepted answers', () => {
  test('cleanAccepted trims, drops blanks and normalized duplicates, enforces 30 × 120', () => {
    assert.deepEqual(cleanAccepted([' Ishmael ', 'ishmael.', '', '?!', 'Ismael']), ['Ishmael', 'Ismael']);
    assert.deepEqual(cleanAccepted(null), []);
    // Invisible and bidi characters are removed from what is stored.
    assert.deepEqual(cleanAccepted(['\u202BIsh\u200Bmael\u202C']), ['Ishmael']);
    assert.ok('error' in (cleanAccepted('Ishmael') as object));
    assert.ok('error' in (cleanAccepted([5]) as object));
    assert.ok('error' in (cleanAccepted(['x'.repeat(121)]) as object));
    assert.deepEqual(cleanAccepted(['x'.repeat(120)]), ['x'.repeat(120)]);
    const thirty = Array.from({ length: 30 }, (_, i) => `variant ${i}`);
    assert.equal((cleanAccepted(thirty) as string[]).length, 30);
    assert.ok('error' in (cleanAccepted([...thirty, 'one more']) as object));
    // Duplicates do not count against the limit.
    assert.equal((cleanAccepted([...thirty, 'VARIANT 0']) as string[]).length, 30);
  });

  test('parseAccepted tolerates anything stored', () => {
    assert.deepEqual(parseAccepted('["a","b"]'), ['a', 'b']);
    assert.deepEqual(parseAccepted(null), []);
    assert.deepEqual(parseAccepted('not json'), []);
    assert.deepEqual(parseAccepted('{"a":1}'), []);
    assert.deepEqual(parseAccepted('["a", 5, ""]'), ['a']);
  });

  test('referenceKeys and matchesKeys: model answer and accepted answers, never a blank answer', () => {
    const keys = referenceKeys({ reference_answer: 'Yishmael', accepted_answers: '["Ishmael","Ein Dor","?!"]' });
    assert.deepEqual([...keys].sort(), ['eindor', 'ishmael', 'yishmael']);
    assert.ok(matchesKeys(normalizeForMatch('yishmael.'), keys));
    assert.ok(matchesKeys(normalizeForMatch('Eindor'), keys));
    assert.ok(!matchesKeys(normalizeForMatch('Yitzhak'), keys));
    assert.ok(!matchesKeys('', keys));
    assert.ok(!matchesKeys(null, keys));
    assert.equal(referenceKeys({ reference_answer: null, accepted_answers: null }).size, 0);
  });
});
