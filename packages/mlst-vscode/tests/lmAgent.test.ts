/**
 * Pure helpers from lmAgent.
 *
 * `slugify` and `todayISO` build the filenames written into the user's
 * workspace (`specs/SPEC-<date>-<slug>.md` and friends), and `extractSection`
 * decides how much of a model response gets saved. All three fail quietly —
 * a bad slug is an ugly filename, a failed extraction silently saves nothing —
 * so they are worth pinning down.
 */
import { describe, it, expect } from 'vitest';
import { extractSection, slugify, todayISO, formatAgentOutputs } from '../src/lmAgent';

describe('extractSection', () => {
    const wrap = (name: string, body: string) =>
        `preamble\n<!-- BEGIN ${name} -->\n${body}\n<!-- END ${name} -->\ntrailer`;

    it('returns the content between the markers', () => {
        expect(extractSection(wrap('SPECIFICATION', '# Spec\n\nBody.'), 'SPECIFICATION'))
            .toBe('# Spec\n\nBody.');
    });

    it('trims surrounding whitespace', () => {
        expect(extractSection('<!-- BEGIN X -->\n\n  hi  \n\n<!-- END X -->', 'X')).toBe('hi');
    });

    it('returns null when the section is absent', () => {
        expect(extractSection('no markers here', 'SPECIFICATION')).toBeNull();
    });

    it('returns null when only the begin marker is present', () => {
        expect(extractSection('<!-- BEGIN X -->\nbody', 'X')).toBeNull();
    });

    it('returns null when only the end marker is present', () => {
        expect(extractSection('body\n<!-- END X -->', 'X')).toBeNull();
    });

    it('returns null when the markers are inverted', () => {
        // Guards the `endIdx <= startIdx` branch — without it, substring()
        // would silently return an empty string and save an empty file.
        expect(extractSection('<!-- END X -->\nbody\n<!-- BEGIN X -->', 'X')).toBeNull();
    });

    it('does not confuse one section for another', () => {
        const text = `${wrap('TASK_BREAKDOWN', 'tasks')}\n${wrap('SPECIFICATION', 'spec')}`;
        expect(extractSection(text, 'SPECIFICATION')).toBe('spec');
        expect(extractSection(text, 'TASK_BREAKDOWN')).toBe('tasks');
    });

    it('handles an empty section body', () => {
        expect(extractSection('<!-- BEGIN X --><!-- END X -->', 'X')).toBe('');
    });
});

describe('slugify', () => {
    it('lowercases and joins words with dashes', () => {
        expect(slugify('Add User Authentication')).toBe('add-user-authentication');
    });

    it('collapses runs of punctuation into a single dash', () => {
        expect(slugify('a  --  b')).toBe('a-b');
        expect(slugify('feat: add OAuth2 (v2)!')).toBe('feat-add-oauth2-v2');
    });

    it('strips leading and trailing separators', () => {
        expect(slugify('   hello   ')).toBe('hello');
        expect(slugify('!!!wrapped!!!')).toBe('wrapped');
    });

    it('caps length at 50 characters', () => {
        expect(slugify('x'.repeat(80))).toHaveLength(50);
    });

    it('never ends in a dash, even when truncation cuts mid-word', () => {
        // Regression: slice() used to run before the trailing-dash strip, so a
        // cut landing on a separator produced `...-` and filenames like
        // `SPEC-2026-07-26-aaa-.md`. refine.ts slugifies the whole idea text,
        // so this was reachable with ordinary input, not just pathological input.
        const cutOnSeparator = `${'a'.repeat(49)} bcd`;
        const out = slugify(cutOnSeparator);
        expect(out.endsWith('-')).toBe(false);
        expect(out).toBe('a'.repeat(49));
    });

    it('returns an empty string when nothing survives, so callers can fall back', () => {
        // Every call site does `slugify(x) || 'fallback'`, which relies on ''.
        expect(slugify('!!!')).toBe('');
        expect(slugify('')).toBe('');
    });

    it('produces filename-safe output', () => {
        const nasty = 'spec/for: "auth" <v2> | 50% done?\\ *test*';
        expect(slugify(nasty)).toMatch(/^[a-z0-9-]*$/);
    });
});

describe('todayISO', () => {
    it('returns a bare YYYY-MM-DD date', () => {
        expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('agrees with the current UTC date', () => {
        expect(todayISO()).toBe(new Date().toISOString().slice(0, 10));
    });
});

describe('formatAgentOutputs', () => {
    it('renders each agent under its own heading, separated by rules', () => {
        expect(
            formatAgentOutputs([
                { name: 'spec-writer', text: 'one' },
                { name: 'reviewer', text: 'two' },
            ]),
        ).toBe('## spec-writer\n\none\n\n---\n\n## reviewer\n\ntwo');
    });

    it('returns an empty string for no outputs', () => {
        expect(formatAgentOutputs([])).toBe('');
    });
});
