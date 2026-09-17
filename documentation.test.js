import fs from 'node:fs';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import test from 'ava';

for (const filename of ['readme.md', 'index.d.ts']) {
	test(`Node.js example works without ReadableStream.from - ${filename}`, t => {
		const documentation = fs.readFileSync(filename, 'utf8');
		const example = documentation.match(/\/\/ Node\.js example\n([\s\S]*?)```/)[1]
			.replaceAll('\'image-dimensions\'', '\'./index.js\'')
			.replaceAll('\'unicorn.png\'', '\'fixtures/png/valid.png\'');
		// Node 18 supports web streams, but does not provide ReadableStream.from().
		const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `delete ReadableStream.from;\n${example}`], {encoding: 'utf8'});
		t.is(result.status, 0);
		t.is(result.stderr, '');
		t.is(result.stdout, '{ width: 30, height: 20, type: \'png\' }\n');
	});
}
