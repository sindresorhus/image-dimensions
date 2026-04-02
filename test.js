import fs from 'node:fs';
import path from 'node:path';
import test from 'ava';
import {getIsobmffFtypBrands, unboxIsobmffBox, getIsobmffIspeSizesFromMeta, getIsobmffOrientedSizeFromMeta, getLargestAreaSize, parseIsobmffIrotAngle} from './utilities.js';
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

test('jpg', t => {
	matches(t, 'jpeg/valid.jpg', {width: 200, height: 133, type: 'jpeg'});
});

test('jpg - no exif', t => {
	matches(t, 'jpeg/no-exif.jpg', {width: 200, height: 133, type: 'jpeg'});
});

test('jpg - progressive', t => {
	matches(t, 'jpeg/progressive.jpg', {width: 40, height: 27, type: 'jpeg'});
});

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
});

test('heic - raw largest ispe (ties pick first)', t => {
	const data = fs.readFileSync(path.join('fixtures', 'heic/valid-metadata-rotated.heic'));
	t.deepEqual(imageDimensionsFromData(data), {width: 4032, height: 3024, type: 'heic'});
});

test('heic - resolveOrientation', t => {
	const data = fs.readFileSync(path.join('fixtures', 'heic/valid-metadata-rotated.heic'));
	t.deepEqual(imageDimensionsFromData(data, {resolveOrientation: true}), {width: 3024, height: 4032, type: 'heic'});
});

test('heic - large raw vs oriented', t => {
	const data = fs.readFileSync(path.join('fixtures', 'heic/large.heic'));
	t.deepEqual(imageDimensionsFromData(data), {width: 4032, height: 3024, type: 'heic'});
	t.deepEqual(imageDimensionsFromData(data, {resolveOrientation: true}), {width: 3024, height: 4032, type: 'heic'});
});

test('avif - resolveOrientation unchanged without irot', t => {
	const data = fs.readFileSync(path.join('fixtures', 'avif/valid.avif'));
	t.deepEqual(imageDimensionsFromData(data, {resolveOrientation: true}), {width: 30, height: 20, type: 'avif'});
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

test('imageDimensionsFromStream - resolveOrientation for HEIC', async t => {
	const stream = fs.createReadStream('fixtures/heic/large.heic');
	t.deepEqual(await imageDimensionsFromStream(stream, {resolveOrientation: true}), {width: 3024, height: 4032, type: 'heic'});
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

const makeIsobmffBox = (type, payload) => {
	const size = 4 + 4 + payload.length;
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, size, false);
	bytes.set(Uint8Array.from([type.codePointAt(0), type.codePointAt(1), type.codePointAt(2), type.codePointAt(3)]), 4);
	bytes.set(payload, 8);
	return bytes;
};

test('parseIsobmffIrotAngle - single-byte and full-box payloads', t => {
	t.is(parseIsobmffIrotAngle(Uint8Array.of(1)), 1);
	const full = new Uint8Array(5);
	full[4] = 2;
	t.is(parseIsobmffIrotAngle(full), 2);
});

test('getIsobmffOrientedSizeFromMeta - pitm ipma ipco irot swaps dimensions', t => {
	// Ispe 123 x 45, irot 90 degrees (value 1) yields 45 x 123.
	const ispePayload = new Uint8Array(12);
	const ispeView = new DataView(ispePayload.buffer);
	ispeView.setUint32(0, 0, false);
	ispeView.setUint32(4, 123, false);
	ispeView.setUint32(8, 45, false);
	const ispe = makeIsobmffBox('ispe', ispePayload);
	const irot = makeIsobmffBox('irot', Uint8Array.of(1));
	const ipco = makeIsobmffBox('ipco', new Uint8Array([...ispe, ...irot]));

	// Ipma version 0: one entry, item 1, associations to prop 1 (ispe) and 2 (irot).
	const ipmaPayload = new Uint8Array(4 + 4 + 2 + 1 + 1 + 1);
	const ipmaView = new DataView(ipmaPayload.buffer);
	ipmaPayload.set([0, 0, 0, 0], 0);
	ipmaView.setUint32(4, 1, false);
	ipmaView.setUint16(8, 1, false);
	ipmaPayload[10] = 2;
	ipmaPayload[11] = 0x01;
	ipmaPayload[12] = 0x02;
	const ipma = makeIsobmffBox('ipma', ipmaPayload);

	const iprp = makeIsobmffBox('iprp', new Uint8Array([...ipco, ...ipma]));

	const pitmPayload = new Uint8Array(6);
	pitmPayload.set([0, 0, 0, 0], 0);
	new DataView(pitmPayload.buffer).setUint16(4, 1, false);
	const pitm = makeIsobmffBox('pitm', pitmPayload);

	const metaChildren = new Uint8Array(4 + pitm.length + iprp.length);
	metaChildren.set([0, 0, 0, 0], 0);
	metaChildren.set(pitm, 4);
	metaChildren.set(iprp, 4 + pitm.length);
	const meta = makeIsobmffBox('meta', metaChildren);

	t.deepEqual(getIsobmffOrientedSizeFromMeta(meta), {width: 45, height: 123});
	t.deepEqual(getIsobmffIspeSizesFromMeta(meta), [{width: 123, height: 45}]);
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
