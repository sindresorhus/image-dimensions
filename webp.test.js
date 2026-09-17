import {Buffer} from 'node:buffer';
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

for (const [filename, minimumSize] of [['vp8.webp', 10], ['vp8l.webp', 5], ['vp8x.webp', 10]]) {
	test(`webp - ${filename} reads dimensions at the header boundary`, async t => {
		const data = fs.readFileSync(`fixtures/webp/${filename}`);
		const expected = {width: 30, height: 20, type: 'webp'};
		const headerLength = 20 + minimumSize;
		for (let length = 0; length < headerLength; length++) {
			t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
		}

		// A complete compressed payload is not needed to read the dimension header.
		const header = data.subarray(0, headerLength);
		t.deepEqual(imageDimensionsFromData(header), expected);
		t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(header, byte => Uint8Array.of(byte)))), expected);
		const padded = Buffer.concat([Buffer.alloc(7), header, Buffer.alloc(11)]);
		t.deepEqual(imageDimensionsFromData(padded.subarray(7, 7 + header.length)), expected);

		header.writeUInt32LE(minimumSize, 16);
		t.deepEqual(imageDimensionsFromData(header), expected);
	});

	for (let size = 0; size < minimumSize; size++) {
		test(`webp - ${filename} rejects declared payload size ${size}`, async t => {
			const data = fs.readFileSync(`fixtures/webp/${filename}`);
			// Keep the dimension bytes present to verify that reads respect the declared chunk boundary.
			data.writeUInt32LE(size, 16);
			t.is(imageDimensionsFromData(data), undefined);
			t.is(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), undefined);
		});
	}
}

test('webp - rejects undersized VP8X chunk', async t => {
	// RIFF/WEBP with a VP8X chunk declared smaller than the required 10 bytes.
	// The canvas fields then come from the following chunk, so the file is invalid.
	const bytes = new Uint8Array(40);
	const view = new DataView(bytes.buffer);
	bytes.set(Buffer.from('RIFF'), 0);
	view.setUint32(4, 32, true);
	bytes.set(Buffer.from('WEBP'), 8);
	bytes.set(Buffer.from('VP8X'), 12);
	view.setUint32(16, 4, true); // VP8X chunks need at least 10 payload bytes.
	// Canvas width/height would be read from the next chunk's header bytes.
	bytes.set(Buffer.from('ABCD'), 20);
	bytes.set([0x10, 0x22, 0x33], 24);
	bytes.set([0x44, 0x55, 0x66], 27);
	t.is(imageDimensionsFromData(bytes), undefined);
	t.is(await imageDimensionsFromStream(ReadableStream.from([bytes])), undefined);
});

test('webp - accepts oversized VP8X chunk with future fields', t => {
	// The extended format allows future fields after the 10 known payload bytes (“Unknown fields MUST be ignored”), so a larger VP8X chunk stays valid.
	const data = fs.readFileSync('fixtures/webp/vp8x.webp');
	const extended = Buffer.concat([data.subarray(0, 30), Buffer.alloc(2), data.subarray(30)]);
	extended.writeUInt32LE(12, 16); // Chunk payload is now 12 bytes.
	extended.writeUInt32LE(extended.length - 8, 4); // RIFF size excludes its first 8 bytes.
	t.deepEqual(imageDimensionsFromData(extended), {width: 30, height: 20, type: 'webp'});
});
