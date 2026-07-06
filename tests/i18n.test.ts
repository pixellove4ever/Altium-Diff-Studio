import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOCALE, resolveLocale, translate } from '../src/lib/i18n.ts';

test('uses French as the default locale', () => {
	assert.equal(DEFAULT_LOCALE, 'fr');
	assert.equal(resolveLocale(undefined), 'fr');
	assert.equal(resolveLocale('fr-FR'), 'fr');
	assert.equal(resolveLocale('en-US'), 'en');
});

test('translates shared messages and interpolates variables', () => {
	assert.equal(translate('fr', 'menu.file'), 'Fichier');
	assert.equal(translate('en', 'menu.file'), 'File');
	assert.equal(translate('fr', 'app.version', { version: '1.2.3' }), 'Version 1.2.3');
});
