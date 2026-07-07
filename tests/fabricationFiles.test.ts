import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFileSize, isOdbPackageFileName } from '../src/lib/domain/fabricationFiles.ts';

test('detects common ODB++ package names', () => {
	assert.equal(isOdbPackageFileName('board.odb'), true);
	assert.equal(isOdbPackageFileName('board.odb++'), true);
	assert.equal(isOdbPackageFileName('board.odb.tgz'), true);
	assert.equal(isOdbPackageFileName('board.odb.tar.gz'), true);
	assert.equal(isOdbPackageFileName('fab-package.tgz'), true);
	assert.equal(isOdbPackageFileName('fab-package.zip'), true);
	assert.equal(isOdbPackageFileName('gerbers.txt'), false);
});

test('formats fabrication package sizes', () => {
	assert.equal(formatFileSize(42), '42 B');
	assert.equal(formatFileSize(2048), '2.0 KB');
	assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
});
