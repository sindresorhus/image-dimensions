import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {devNull} from 'node:os';
import test from 'ava';

for (const filename of ['package.json', devNull]) {
	test(`cli - unsupported or empty input - ${filename}`, t => {
		const result = spawnSync(process.execPath, ['cli.js', filename], {encoding: 'utf8'});
		t.is(result.status, 1);
		t.is(result.stdout, '');
		t.is(result.stderr, 'Unsupported image format or invalid image data.\n');
	});
}

test('cli - valid image', t => {
	const result = spawnSync(process.execPath, ['cli.js', 'fixtures/png/valid.png'], {encoding: 'utf8'});
	t.is(result.status, 0);
	t.is(result.stdout, '30x20\n');
	t.is(result.stderr, '');
});

test('cli - no argument', t => {
	const result = spawnSync(process.execPath, ['cli.js'], {encoding: 'utf8'});
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.is(result.stderr, 'Usage: image-dimensions <image>\n');
});

test('cli - missing file', t => {
	const result = spawnSync(process.execPath, ['cli.js', 'nonexistent-file.png'], {encoding: 'utf8'});
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.regex(result.stderr, /^ENOENT:.*nonexistent-file\.png.*\n$/);
});

test('cli - directory', t => {
	const result = spawnSync(process.execPath, ['cli.js', 'fixtures'], {encoding: 'utf8'});
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.regex(result.stderr, /^EISDIR:.*\n$/);
});
