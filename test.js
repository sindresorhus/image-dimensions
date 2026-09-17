import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {devNull} from 'node:os';
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

for (const filename of ['no-exif.jpg', 'arithmetic.jpg']) {
	for (const markerCount of [1, 3]) {
		test(`jpg - ${filename} with ${markerCount} TEM markers`, async t => {
			const original = fs.readFileSync(`fixtures/jpeg/${filename}`);
			// TEM is a standalone marker and has no segment length.
			const markers = Buffer.from(Array.from({length: markerCount}, () => [0xFF, 0x01]).flat());
			const data = Buffer.concat([original.subarray(0, 2), markers, original.subarray(2)]);
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

test('avif - meta box with size 0', t => {
	// Fixture from libavif's test suite (draw_points_idat_metasize0.avif): its `meta` box is the last top-level box and uses size 0, meaning it extends to the end of the file.
	matches(t, 'avif/metasize0.avif', {width: 33, height: 11, type: 'avif'});
});

test('heic', t => {
	matches(t, 'heic/valid.heic', {width: 8, height: 10, type: 'heic'});
	// Returns raw pixel dimensions (orientation not applied)
	// matches(t, 'heic/valid-metadata-rotated.heic', {width: 4032, height: 3024, type: 'heic'});
});

test('heic - secondary item larger than primary', t => {
	// The file contains a 256×256 secondary (thumbnail-like) item and a 128×96 primary item.
	// Dimensions must come from the primary item, not the largest item.
	matches(t, 'heic/primary-smaller.heic', {width: 128, height: 96, type: 'heic'});
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

const box = (type, payload) => {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + payload.length);
	header.write(type, 4);
	return Buffer.concat([header, payload]);
};

const spatialExtents = (width, height) => {
	const payload = Buffer.alloc(12);
	payload.writeUInt32BE(width, 4);
	payload.writeUInt32BE(height, 8);
	return box('ispe', payload);
};

function image({brand = 'heic', version = 0, wideIndices = false, essential = false, primaryId = 7, propertyIndex = 3, reverseOrder = false, truncateAssociation = false, truncatePrimary = false} = {}) {
	const itemIdSize = version === 0 ? 2 : 4;
	const writeItemId = (data, value, offset) => {
		if (version === 0) {
			data.writeUInt16BE(value, offset);
		} else {
			data.writeUInt32BE(value, offset);
		}
	};

	const primary = Buffer.alloc(4 + itemIdSize);
	primary[0] = version;
	writeItemId(primary, primaryId, 4);

	const associationHeader = Buffer.alloc(8);
	associationHeader[0] = version;
	associationHeader[3] = Number(wideIndices);
	associationHeader.writeUInt32BE(2, 4);
	const entries = [];
	for (const [itemId, index] of [[1, 1], [7, propertyIndex]]) {
		const entry = Buffer.alloc(itemIdSize + 1 + (wideIndices ? 2 : 1));
		writeItemId(entry, itemId, 0);
		entry[itemIdSize] = 1;
		const value = index + (essential ? (wideIndices ? 0x80_00 : 0x80) : 0);
		if (wideIndices) {
			entry.writeUInt16BE(value, itemIdSize + 1);
		} else {
			entry[itemIdSize + 1] = value;
		}

		entries.push(entry);
	}

	const associations = Buffer.concat([associationHeader, ...entries]);
	const properties = box('ipco', Buffer.concat([
		spatialExtents(1024, 768),
		box('colr', Buffer.from('nclx')),
		spatialExtents(128, 96),
	]));
	const associationBox = box('ipma', truncateAssociation ? associations.subarray(0, -1) : associations);
	const itemProperties = box('iprp', Buffer.concat(reverseOrder ? [associationBox, properties] : [properties, associationBox]));
	const primaryBox = box('pitm', truncatePrimary ? Buffer.alloc(0) : primary);
	const meta = box('meta', Buffer.concat([Buffer.alloc(4), ...(reverseOrder ? [itemProperties, primaryBox] : [primaryBox, itemProperties])]));
	return Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4)])), meta]);
}

for (const brand of ['heic', 'avif']) {
	for (const version of [0, 1]) {
		for (const wideIndices of [false, true]) {
			for (const essential of [false, true]) {
				test(`${brand} primary association: version ${version}, wide ${wideIndices}, essential ${essential}`, async t => {
					const data = image({brand, version, wideIndices, essential});
					const expected = {width: 128, height: 96, type: brand};
					t.deepEqual(imageDimensionsFromData(data), expected);
					t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
				});
			}
		}
	}

	test(`${brand} primary selection does not depend on box order`, t => {
		t.deepEqual(imageDimensionsFromData(image({brand, reverseOrder: true})), {width: 128, height: 96, type: brand});
	});

	for (const options of [{primaryId: 99}, {propertyIndex: 0}, {propertyIndex: 2}, {propertyIndex: 9}, {truncateAssociation: true}, {truncatePrimary: true}]) {
		test(`${brand} unresolved primary: ${JSON.stringify(options)}`, t => {
			t.is(imageDimensionsFromData(image({brand, ...options})), undefined);
		});
	}

	test(`${brand} truncated metadata never returns a secondary size`, t => {
		const data = image({brand});
		for (let length = 0; length < data.length; length++) {
			t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
		}
	});

	test(`${brand} nested size-0 box is invalid`, t => {
		// A size of 0 is only valid for the last top-level box (ISO/IEC 14496-12 §4.2.2).
		const data = image({brand});
		// Overwrite the size field of the `ipma` box (nested inside `meta` → `iprp`).
		const ipmaOffset = data.indexOf(Buffer.from('ipma'));
		data.writeUInt32BE(0, ipmaOffset - 4);
		t.is(imageDimensionsFromData(data), undefined);
	});
}

test('avif - size-0 metadata works with partial data and byte streams', async t => {
	const data = fs.readFileSync('fixtures/avif/metasize0.avif');
	const expected = {width: 33, height: 11, type: 'avif'};
	t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
	const padded = Buffer.concat([Buffer.alloc(7), data, Buffer.alloc(11)]);
	t.deepEqual(imageDimensionsFromData(padded.subarray(7, 7 + data.length)), expected);

	// The metadata needed to resolve the primary dimensions ends at byte 426, before the image payload.
	for (let length = 0; length < 426; length++) {
		t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
	}

	t.deepEqual(imageDimensionsFromData(data.subarray(0, 426)), expected);
});

// Each fixture uses a 64-bit size for one box; its item data offset is adjusted to preserve the original image.
for (const filename of ['extended-ftyp.avif', 'extended-meta.avif']) {
	test(`isobmff - extended 64-bit box size - ${filename}`, async t => {
		const data = fs.readFileSync(`fixtures/avif/${filename}`);
		const expected = {width: 30, height: 20, type: 'avif'};
		t.deepEqual(imageDimensionsFromData(data), expected);
		t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
		const padded = Buffer.concat([Buffer.alloc(7), data, Buffer.alloc(11)]);
		t.deepEqual(imageDimensionsFromData(padded.subarray(7, 7 + data.length)), expected);

		// Both fixtures need the complete metadata box, which ends at byte 270.
		for (let length = 0; length < 270; length++) {
			t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
		}

		t.deepEqual(imageDimensionsFromData(data.subarray(0, 270)), expected);
	});
}

test('isobmff - truncated 64-bit extended size returns undefined', t => {
	const data = fs.readFileSync('fixtures/avif/extended-ftyp.avif');
	for (let length = 8; length < 16; length++) {
		t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
	}
});

for (const [filename, width, height, type] of [
	['png/palette.png', 100, 60, 'png'],
	['png/gray16.png', 1, 1, 'png'],
	['png/tiny.png', 3, 1, 'png'],
	['png/interlaced.png', 200, 100, 'png'],
	['png/truecolor16-uncompressed.png', 40, 30, 'png'],
	['gif/animated.gif', 20, 10, 'gif'],
	['webp/opaque-lossy.webp', 40, 30, 'webp'],
	['webp/wide-lossy.webp', 999, 257, 'webp'],
	['webp/wide-lossless.webp', 999, 257, 'webp'],
	['jpeg/orientation-6.jpg', 120, 90, 'jpeg'],
	['jpeg/valid.jpg', 200, 133, 'jpeg'],
	['webp/vp8l.webp', 30, 20, 'webp'],
	['webp/vp8x.webp', 30, 20, 'webp'],
]) {
	test(`additional fixture - ${filename}`, async t => {
		const data = fs.readFileSync(`fixtures/${filename}`);
		const expected = {width, height, type};
		t.deepEqual(imageDimensionsFromData(data), expected);
		const padded = Buffer.concat([Buffer.alloc(7, 0xFF), data, Buffer.alloc(11, 0xFF)]);
		t.deepEqual(imageDimensionsFromData(padded.subarray(7, 7 + data.length)), expected);
		t.deepEqual(await imageDimensionsFromStream(ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)))), expected);
	});
}

for (const [filename, headerLength] of [
	['png/valid.png', 24],
	['png/apple-minified.png', 40],
	['gif/valid.gif', 10],
	['jpeg/no-exif.jpg', 163],
	['webp/vp8.webp', 30],
	['webp/vp8l.webp', 25],
	['webp/vp8x.webp', 30],
]) {
	test(`dimension header boundary - ${filename}`, t => {
		const data = fs.readFileSync(`fixtures/${filename}`);
		const expected = imageDimensionsFromData(data);
		t.truthy(expected);
		for (let length = 0; length < headerLength; length++) {
			t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
		}

		t.deepEqual(imageDimensionsFromData(data.subarray(0, headerLength)), expected);
	});
}

test('gif - GIF87a logical screen dimensions', t => {
	const data = fs.readFileSync('fixtures/gif/valid.gif');
	data.write('GIF87a');
	t.deepEqual(imageDimensionsFromData(data), {width: 30, height: 17, type: 'gif'});
});

test('heic - returns raw dimensions without applying rotation', t => {
	const data = fs.readFileSync('fixtures/heic/valid-metadata-rotated.heic');
	t.deepEqual(imageDimensionsFromData(data), {width: 4032, height: 3024, type: 'heic'});
});

for (const filename of ['png/valid.png', 'jpeg/valid.jpg', 'gif/valid.gif', 'webp/vp8l.webp', 'heic/valid.heic', 'avif/valid.avif']) {
	test(`stream - stops after dimensions are available - ${filename}`, async t => {
		const data = fs.readFileSync(`fixtures/${filename}`);
		const expected = imageDimensionsFromData(data);
		t.truthy(expected);
		let closed = false;
		async function * chunks() {
			try {
				yield new Uint8Array();
				yield data;
				t.fail('The stream must not read another chunk after finding dimensions');
			} finally {
				closed = true;
			}
		}

		t.deepEqual(await imageDimensionsFromStream(chunks()), expected);
		t.true(closed);
	});
}

test('stream - propagates source errors', async t => {
	const error = new Error('Source failed');
	async function * chunks() {
		yield Uint8Array.of(0x89, 0x50);
		throw error;
	}

	await t.throwsAsync(imageDimensionsFromStream(chunks()), {is: error});
});

test('stream - empty and unsupported data', async t => {
	t.is(await imageDimensionsFromStream(ReadableStream.from([])), undefined);
	t.is(await imageDimensionsFromStream(ReadableStream.from([new Uint8Array(), Uint8Array.of(1, 2, 3)])), undefined);
});

for (const [filename, width, height, type] of [
	['png/valid.png', 30, 20, 'png'],
	['jpeg/no-exif.jpg', 200, 133, 'jpeg'],
	['gif/valid.gif', 30, 17, 'gif'],
	['webp/vp8l.webp', 30, 20, 'webp'],
	['avif/valid.avif', 30, 20, 'avif'],
	['heic/valid.heic', 8, 10, 'heic'],
]) {
	test(`stream preserves chunk view boundaries - ${filename}`, async t => {
		const data = fs.readFileSync(`fixtures/${filename}`);
		async function * chunks() {
			for (let offset = 0; offset < data.length; offset += 17) {
				const chunk = data.subarray(offset, offset + 17);
				// Bytes outside each view must not enter the accumulated image data.
				const padded = Buffer.concat([Buffer.alloc(7, 0xFF), chunk, Buffer.alloc(11, 0xFF)]);
				yield padded.subarray(7, 7 + chunk.length);
				yield new Uint8Array();
			}
		}

		t.deepEqual(await imageDimensionsFromStream(chunks()), {width, height, type});
	});
}

for (const outcome of ['dimensions', 'unsupported', 'empty']) {
	test(`non-iterable web stream releases its lock after ${outcome}`, async t => {
		let canceled = false;
		const readableStream = new ReadableStream({
			start(controller) {
				if (outcome === 'dimensions') {
					controller.enqueue(fs.readFileSync('fixtures/png/valid.png'));
				} else {
					if (outcome === 'unsupported') {
						controller.enqueue(Uint8Array.of(1, 2, 3));
					}

					controller.close();
				}
			},
			cancel() {
				canceled = true;
			},
		});
		const stream = {getReader: readableStream.getReader.bind(readableStream)};
		const expected = outcome === 'dimensions' ? {width: 30, height: 20, type: 'png'} : undefined;
		t.deepEqual(await imageDimensionsFromStream(stream), expected);
		t.false(readableStream.locked);
		t.is(canceled, outcome === 'dimensions');
	});
}

for (const failure of ['read', 'cancel']) {
	test(`non-iterable web stream releases its lock after ${failure} fails`, async t => {
		const error = new Error(`${failure} failed`);
		const readableStream = new ReadableStream({
			start(controller) {
				if (failure === 'read') {
					controller.error(error);
				} else {
					controller.enqueue(fs.readFileSync('fixtures/png/valid.png'));
				}
			},
			cancel() {
				throw error;
			},
		});
		const stream = {getReader: readableStream.getReader.bind(readableStream)};

		// Preserve the source error, including errors from cancellation.
		await t.throwsAsync(imageDimensionsFromStream(stream), {is: error});
		t.false(readableStream.locked);
	});
}

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
