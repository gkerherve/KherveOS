// The shared example-file helper (src/os/exampleFiles.ts): addresses and the HTML-fallback guard.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exampleUrl, looksLikeHtml } from '../../src/os/exampleFiles.ts'

test('example addresses keep , + = literal (Vite does not decode %2C %2B %3D)', () => {
  const base = '/examples/kreaction/'
  assert.equal(exampleUrl(base, '01 Ethanol combustion, balanced.kreact'), '/examples/kreaction/01%20Ethanol%20combustion,%20balanced.kreact')
  assert.equal(exampleUrl(base, '03 SN2 - bromoethane + hydroxide.kreact'), '/examples/kreaction/03%20SN2%20-%20bromoethane%20+%20hydroxide.kreact')
  assert.equal(exampleUrl(base, '10 N2O4 = 2 NO2.kreact'), '/examples/kreaction/10%20N2O4%20=%202%20NO2.kreact')
  assert.equal(exampleUrl(base, 'a#b?c%d.txt'), '/examples/kreaction/a%23b%3Fc%25d.txt')
})

test('the single-page-app fallback page is recognised', () => {
  assert.ok(looksLikeHtml('<!doctype html>\n<html lang="en">'))
  assert.ok(looksLikeHtml('  <!DOCTYPE HTML><html>'))
  assert.ok(looksLikeHtml('<html><head>'))
  assert.ok(!looksLikeHtml('{"format":"kclim","version":1}'))
  assert.ok(!looksLikeHtml('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
})
