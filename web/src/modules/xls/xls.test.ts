import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, toBase64 } from './encode';
import { xlsLabelsEn } from './labels.en';
import { xlsNav } from './index';

describe('encode', () => {
  it('base64-encodes bytes, including large inputs, the same as Buffer', () => {
    const small = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(toBase64(small)).toBe(btoa(String.fromCharCode(...small)));
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(atob(toBase64(big)).length).toBe(200_000);
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('labels', () => {
  it('has a label for every nav item and permission prefix xls', () => {
    for (const n of xlsNav) { expect(xlsLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^xls\./); }
  });
  it('defines every literal xls.* label key used by the screens, and the dynamic families', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](xls\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in xlsLabelsEn) && !/^xls\.(template|export|import)\./.test(k));
    expect(missing).toEqual([]);
    for (const k of ['total', 'create', 'update', 'skip', 'errors']) expect(xlsLabelsEn[`xls.stat.${k}`]).toBeTruthy();
    for (const k of ['create', 'update', 'skip', 'error']) expect(xlsLabelsEn[`xls.result.${k}`]).toBeTruthy();
    for (const k of ['previewed', 'committed', 'failed']) expect(xlsLabelsEn[`xls.job.status.${k}`]).toBeTruthy();
  });
});
