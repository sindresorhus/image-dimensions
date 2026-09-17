import fs from 'node:fs';
import test from 'ava';
import {imageDimensionsFromData, imageDimensionsFromStream} from './index.js';

for (const signature of [0, 0x2E, 0x30, 0xFF]) {
	test(`webp - rejects lossless signature ${signature}`, async t => {
		const data = fs.readFileSync('fixtures/webp/vp8l.webp');
		data[20] = signature;
		t.is(imageDimensionsFromData(data), undefined);
		t.is(await imageDimensionsFromStream(ReadableStream.from([data])), undefined);
		t.is(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), undefined);
	});
}
