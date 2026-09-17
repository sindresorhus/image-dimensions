import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {getIsobmffFtypBrands, unboxIsobmffBox, getIsobmffIspeSizesFromMeta, getLargestAreaSize} from './utilities.js';
import {imageDimensionsFromStream, imageDimensionsFromData} from './index.js';

const matches = (t, filename, dimensions) => {
	const data = fs.readFileSync(path.join('fixtures', filename));
	t.deepEqual(imageDimensionsFromData(data), dimensions);
};

test('png', t => {
	matches(t, 'png/valid.png', {width: 30, height: 20, type: 'png'});
});

test('png - minified', t => {
	matches(t, 'png/minified.png', {width: 30, height: 20, type: 'png'});
});

test('png - apple minified', t => {
	matches(t, 'png/apple-minified.png', {width: 30, height: 20, type: 'png'});
});

test('png - invalid', t => {
	matches(t, 'png/invalid.png', undefined);
});

test('png - animated', t => {
	matches(t, 'png/animated.png', {width: 30, height: 17, type: 'png'});
});

test('png - missing IHDR chunk', t => {
	const data = fs.readFileSync('fixtures/png/valid.png');
	data.set(new TextEncoder().encode('IDAT'), 12);
	t.is(imageDimensionsFromData(data), undefined);
});

test('png - apple minified missing IHDR chunk', t => {
	const data = fs.readFileSync('fixtures/png/apple-minified.png');
	data.set(new TextEncoder().encode('IDAT'), 28);
	t.is(imageDimensionsFromData(data), undefined);
});

test('jpg', t => {
	matches(t, 'jpeg/valid.jpg', {width: 200, height: 133, type: 'jpeg'});
});

test('jpg - no exif', t => {
	matches(t, 'jpeg/no-exif.jpg', {width: 200, height: 133, type: 'jpeg'});
});

test('jpg - progressive', t => {
	matches(t, 'jpeg/progressive.jpg', {width: 40, height: 27, type: 'jpeg'});
});

for (const fillCount of [1, 2, 8]) {
	for (const location of ['first segment', 'frame header']) {
		test(`jpg - ${fillCount} fill bytes before ${location}`, async t => {
			const original = fs.readFileSync('fixtures/jpeg/no-exif.jpg');
			const offset = location === 'first segment' ? 2 : original.indexOf(Buffer.from([0xFF, 0xC2]));
			t.true(offset >= 2);
			// Fill bytes are permitted before any marker, including the first segment.
			const data = Buffer.concat([original.subarray(0, offset), Buffer.alloc(fillCount, 0xFF), original.subarray(offset)]);
			const expected = {width: 200, height: 133, type: 'jpeg'};
			t.deepEqual(imageDimensionsFromData(data), expected);
			t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
		});
	}
}

test('jpg - truncated fill bytes', t => {
	for (const fillCount of [1, 2, 8]) {
		const data = Uint8Array.from([0xFF, 0xD8, ...new Uint8Array(fillCount).fill(0xFF)]);
		t.is(imageDimensionsFromData(data), undefined);
	}
});

for (const filename of ['arithmetic.jpg', 'arithmetic-progressive.jpg']) {
	test(`jpg - ${filename}`, async t => {
		const data = fs.readFileSync(`fixtures/jpeg/${filename}`);
		const expected = {width: 200, height: 133, type: 'jpeg'};
		t.deepEqual(imageDimensionsFromData(data), expected);
		t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
	});
}

for (const marker of [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]) {
	test(`jpg - SOF marker ${marker.toString(16)}`, t => {
		// One-component frame header with 513×257 dimensions.
		const data = Uint8Array.from([0xFF, 0xD8, 0xFF, marker, 0, 11, 8, 1, 1, 2, 1, 1, 1, 0x11, 0]);
		t.deepEqual(imageDimensionsFromData(data), {width: 513, height: 257, type: 'jpeg'});
		for (let length = 0; length < 11; length++) {
			t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
		}
	});
}

for (const marker of [0xC4, 0xC8, 0xCC]) {
	test(`jpg - non-frame marker ${marker.toString(16)}`, t => {
		// These marker codes lie between SOF markers, but do not contain dimensions.
		const segment = [0xFF, marker, 0, 9, 8, 0, 99, 0, 77, 0, 0];
		const header = [0xFF, 0xC0, 0, 11, 8, 1, 1, 2, 1, 1, 1, 0x11, 0];
		t.is(imageDimensionsFromData(Uint8Array.from([0xFF, 0xD8, ...segment])), undefined);
		t.deepEqual(imageDimensionsFromData(Uint8Array.from([0xFF, 0xD8, ...segment, ...header])), {width: 513, height: 257, type: 'jpeg'});
	});
}

test('gif', t => {
	matches(t, 'gif/valid.gif', {width: 30, height: 17, type: 'gif'});
});

test.failing('jpeg xl', t => {
	matches(t, 'jpeg xl/valid.jxl', {width: 30, height: 17});
});

test('avif', t => {
	matches(t, 'avif/valid.avif', {width: 30, height: 20, type: 'avif'});
});

test('heic', t => {
	matches(t, 'heic/valid.heic', {width: 8, height: 10, type: 'heic'});
	// Returns raw pixel dimensions (orientation not applied)
	// matches(t, 'heic/valid-metadata-rotated.heic', {width: 4032, height: 3024, type: 'heic'});
});

test('webp - vp8', t => {
	matches(t, 'webp/vp8.webp', {width: 30, height: 20, type: 'webp'});
});

test('webp - vp8l', t => {
	matches(t, 'webp/vp8l.webp', {width: 30, height: 20, type: 'webp'});
});

test('webp - vp8x', t => {
	matches(t, 'webp/vp8x.webp', {width: 30, height: 20, type: 'webp'});
});

test('webp - animated', t => {
	matches(t, 'webp/animated.webp', {width: 30, height: 17, type: 'webp'});
});

test('imageDimensionsFromData - error handling on DataView methods', t => {
	const data = fs.readFileSync('fixtures/png/valid.png').subarray(0, 20);
	t.is(imageDimensionsFromData(data), undefined);
});

test('imageDimensionsFromStream - Node.js stream', async t => {
	const stream = fs.createReadStream('fixtures/png/valid.png');
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
});

test('imageDimensionsFromStream - web stream', async t => {
	const stream = ReadableStream.from(fs.createReadStream('fixtures/png/valid.png'));
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
});

test('imageDimensionsFromStream - web stream non-async iterable', async t => {
	const readableStream = ReadableStream.from(fs.createReadStream('fixtures/png/valid.png'));
	const stream = {
		getReader: readableStream.getReader.bind(readableStream),
	};

	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
});

test('imageDimensionsFromStream - web stream non-async iterable cancels early', async t => {
	let canceled = false;
	const data = await fs.promises.readFile('fixtures/png/valid.png');
	const readableStream = new ReadableStream({
		start(controller) {
			controller.enqueue(data);
			// Never closes
		},
		cancel() {
			canceled = true;
		},
	});
	const stream = {
		getReader: readableStream.getReader.bind(readableStream),
	};

	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
	t.true(canceled);
});

test('empty', t => {
	t.notThrows(() => {
		imageDimensionsFromData(new Uint8Array());
	});
});

// --- GetFtypBrands unit tests ---

const makeFtyp = (major, compatibles = []) => {
	const brandToBytes = brand => Uint8Array.from([
		brand.codePointAt(0),
		brand.codePointAt(1),
		brand.codePointAt(2),
		brand.codePointAt(3),
	]);

	const size = 4 + 4 + 4 + 4 + (compatibles.length * 4);
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);

	// Size (Big-endian)
	view.setUint32(0, size, false);
	// 'ftyp'
	bytes.set(Uint8Array.from([0x66, 0x74, 0x79, 0x70]), 4);
	// Major brand
	bytes.set(brandToBytes(major), 8);
	// Minor version
	bytes.set(Uint8Array.from([0, 0, 0, 0]), 12);
	// Compatible brands
	let offset = 16;
	for (const b of compatibles) {
		bytes.set(brandToBytes(b), offset);
		offset += 4;
	}

	return bytes;
};

test('getIsobmffFtypBrands - Parses major and compatible brands', t => {
	const buf = makeFtyp('mif1', ['heic', 'avif']);
	t.deepEqual(getIsobmffFtypBrands(buf), ['mif1', 'heic', 'avif']);
});

test('imageDimensionsFromData - AVIF subarray still works', t => {
	const original = fs.readFileSync('fixtures/avif/valid.avif');
	const padded = new Uint8Array(10 + original.length);
	padded.set(original, 10);
	const view = padded.subarray(10); // Non-zero byteOffset
	t.deepEqual(imageDimensionsFromData(view), {width: 30, height: 20, type: 'avif'});
});

test('imageDimensionsFromData - HEIC subarray still works', t => {
	const original = fs.readFileSync('fixtures/heic/valid.heic');
	const padded = new Uint8Array(10 + original.length);
	padded.set(original, 10);
	const view = padded.subarray(10); // Non-zero byteOffset
	t.deepEqual(imageDimensionsFromData(view), {width: 8, height: 10, type: 'heic'});
});

test('getIsobmffFtypBrands - Works on subarray view', t => {
	const buf = makeFtyp('mif1', ['heic']);
	const padded = new Uint8Array(8 + buf.length);
	padded.set(buf, 8);
	const view = padded.subarray(8);
	t.deepEqual(getIsobmffFtypBrands(view), ['mif1', 'heic']);
});

test('unboxIsobmffBox - Reads box header and payload', t => {
	const type = 'abcd';
	const payload = Uint8Array.from([1, 2, 3, 4, 5]);
	const size = 4 + 4 + payload.length;
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, size, false);
	bytes.set(Uint8Array.from([type.codePointAt(0), type.codePointAt(1), type.codePointAt(2), type.codePointAt(3)]), 4);
	bytes.set(payload, 8);

	const box = unboxIsobmffBox(bytes, 0);
	t.truthy(box);
	t.is(box.type, type);
	t.deepEqual(box.data, payload);
	t.is(box.tail, size);
});

test('getIsobmffIspeSizesFromMeta - Extracts width/height from ispe', t => {
// Helper to make a box
	const makeBox = (type, payload) => {
		const size = 4 + 4 + payload.length;
		const bytes = new Uint8Array(size);
		const view = new DataView(bytes.buffer);
		view.setUint32(0, size, false);
		bytes.set(Uint8Array.from([type.codePointAt(0), type.codePointAt(1), type.codePointAt(2), type.codePointAt(3)]), 4);
		bytes.set(payload, 8);
		return bytes;
	};

	// Build ispe: [version+flags][width][height]
	const ispePayload = new Uint8Array(12);
	const ispeView = new DataView(ispePayload.buffer);
	ispeView.setUint32(0, 0, false);
	ispeView.setUint32(4, 123, false);
	ispeView.setUint32(8, 45, false);
	const ispe = makeBox('ispe', ispePayload);

	// Ipco contains ispe
	const ipco = makeBox('ipco', ispe);

	// Iprp contains ipco
	const iprp = makeBox('iprp', ipco);

	// Meta has 4 bytes version+flags prefix before its children
	const metaChildren = new Uint8Array(4 + iprp.length);
	metaChildren.set(new Uint8Array([0, 0, 0, 0]), 0);
	metaChildren.set(iprp, 4);
	const meta = makeBox('meta', metaChildren);

	const sizes = getIsobmffIspeSizesFromMeta(meta);
	t.deepEqual(sizes, [{width: 123, height: 45}]);
	t.deepEqual(getLargestAreaSize(sizes), {width: 123, height: 45});
});

test('getLargestAreaSize - Picks largest by area', t => {
	const sizes = [
		{width: 10, height: 10},
		{width: 5, height: 50},
		{width: 20, height: 20},
	];
	t.deepEqual(getLargestAreaSize(sizes), {width: 20, height: 20});
});

test('getIsobmffFtypBrands - Invalid marker returns undefined', t => {
	const buf = makeFtyp('mif1', ['heic']);
	buf[4] = 0x78; // Corrupt the 'f' in 'ftyp'
	t.is(getIsobmffFtypBrands(buf), undefined);
});

test('getIsobmffFtypBrands - Too small buffer returns undefined', t => {
	t.is(getIsobmffFtypBrands(new Uint8Array(8)), undefined);
});

test('getIsobmffFtypBrands - Truncated size returns undefined', t => {
	const buf = makeFtyp('mif1', ['heic']);
	// Claim size larger than actual buffer
	const larger = buf.length + 8;
	const view = new DataView(buf.buffer);
	view.setUint32(0, larger, false);
	t.is(getIsobmffFtypBrands(buf), undefined);
});
