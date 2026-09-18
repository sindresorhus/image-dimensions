import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {devNull} from 'node:os';
import test from 'ava';
import {getIsobmffFtypBrands, unboxIsobmffBox} from './utilities.js';
import {imageDimensionsFromStream, imageDimensionsFromData} from './index.js';

const fixture = filename => fs.readFileSync(path.join('fixtures', filename));

// Streams the data one byte at a time, so every intermediate buffer length is exercised.
const byteStream = data => ReadableStream.from(Array.from(data, byte => Uint8Array.of(byte)));

// Returns the same bytes as a view with a non-zero byte offset into a larger buffer.
const offsetView = data => Buffer.concat([Buffer.alloc(7, 0xFF), data, Buffer.alloc(11, 0xFF)]).subarray(7, 7 + data.length);

const matches = (t, filename, dimensions) => {
	t.deepEqual(imageDimensionsFromData(fixture(filename)), dimensions);
};

// Asserts the result through every input path: whole buffer, offset view, and a byte-by-byte stream.
const dimensionsMatch = async (t, data, expected) => {
	t.deepEqual(imageDimensionsFromData(data), expected);
	t.deepEqual(imageDimensionsFromData(offsetView(data)), expected);
	t.deepEqual(await imageDimensionsFromStream(byteStream(data)), expected);
};

// Asserts that every prefix shorter than `headerLength` is rejected and that `headerLength` bytes are enough.
const headerBoundaryMatches = (t, data, headerLength, expected) => {
	for (let length = 0; length < headerLength; length++) {
		t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
	}

	t.deepEqual(imageDimensionsFromData(data.subarray(0, headerLength)), expected);
};

const runCli = (...arguments_) => spawnSync(process.execPath, ['cli.js', ...arguments_], {encoding: 'utf8'});

for (const [filename, width, height, type] of [
	['png/valid.png', 30, 20, 'png'],
	['png/minified.png', 30, 20, 'png'],
	['png/apple-minified.png', 30, 20, 'png'],
	['png/animated.png', 30, 17, 'png'],
	['png/palette.png', 100, 60, 'png'],
	['png/gray16.png', 1, 1, 'png'],
	['png/tiny.png', 3, 1, 'png'],
	['png/interlaced.png', 200, 100, 'png'],
	['png/truecolor16-uncompressed.png', 40, 30, 'png'],
	['jpeg/valid.jpg', 200, 133, 'jpeg'],
	['jpeg/no-exif.jpg', 200, 133, 'jpeg'],
	['jpeg/progressive.jpg', 40, 27, 'jpeg'],
	['jpeg/arithmetic.jpg', 200, 133, 'jpeg'],
	['jpeg/arithmetic-progressive.jpg', 200, 133, 'jpeg'],
	['jpeg/orientation-6.jpg', 120, 90, 'jpeg'],
	['gif/valid.gif', 30, 17, 'gif'],
	['gif/animated.gif', 20, 10, 'gif'],
	['webp/vp8.webp', 30, 20, 'webp'],
	['webp/vp8l.webp', 30, 20, 'webp'],
	['webp/vp8x.webp', 30, 20, 'webp'],
	['webp/animated.webp', 30, 17, 'webp'],
	['webp/opaque-lossy.webp', 40, 30, 'webp'],
	['webp/wide-lossy.webp', 999, 257, 'webp'],
	['webp/wide-lossless.webp', 999, 257, 'webp'],
	['avif/valid.avif', 30, 20, 'avif'],
	['heic/valid.heic', 8, 10, 'heic'],
]) {
	test(`fixture - ${filename}`, async t => {
		await dimensionsMatch(t, fixture(filename), {width, height, type});
	});
}

test('png - invalid', t => {
	matches(t, 'png/invalid.png', undefined);
});

for (const [filename, chunkTypeOffset] of [['png/valid.png', 12], ['png/apple-minified.png', 28]]) {
	test(`png - missing IHDR chunk - ${filename}`, t => {
		const data = fixture(filename);
		data.write('IDAT', chunkTypeOffset);
		t.is(imageDimensionsFromData(data), undefined);
	});
}

for (const fillCount of [1, 2, 8]) {
	for (const location of ['first segment', 'frame header']) {
		test(`jpg - ${fillCount} fill bytes before ${location}`, async t => {
			const original = fixture('jpeg/no-exif.jpg');
			const offset = location === 'first segment' ? 2 : original.indexOf(Buffer.from([0xFF, 0xC2]));
			t.true(offset >= 2);
			// Fill bytes are permitted before any marker, including the first segment.
			const data = Buffer.concat([original.subarray(0, offset), Buffer.alloc(fillCount, 0xFF), original.subarray(offset)]);
			await dimensionsMatch(t, data, {width: 200, height: 133, type: 'jpeg'});
		});
	}
}

for (const filename of ['no-exif.jpg', 'arithmetic.jpg']) {
	for (const markerCount of [1, 3]) {
		test(`jpg - ${filename} with ${markerCount} TEM markers`, async t => {
			const original = fixture(`jpeg/${filename}`);
			// TEM is a standalone marker and has no segment length.
			const markers = Buffer.from(Array.from({length: markerCount}, () => [0xFF, 0x01]).flat());
			const data = Buffer.concat([original.subarray(0, 2), markers, original.subarray(2)]);
			await dimensionsMatch(t, data, {width: 200, height: 133, type: 'jpeg'});
		});
	}
}

test('jpg - extraneous bytes before a marker are skipped like libjpeg does', async t => {
	const original = fixture('jpeg/no-exif.jpg');
	const offset = original.indexOf(Buffer.from([0xFF, 0xC2]));
	// Decoders skip garbage between segments ("extraneous bytes before marker"), so the file still decodes.
	const data = Buffer.concat([original.subarray(0, offset), Buffer.from([0x00, 0x12, 0x34]), original.subarray(offset)]);
	await dimensionsMatch(t, data, {width: 200, height: 133, type: 'jpeg'});
});

test('jpg - truncated fill bytes', t => {
	for (const fillCount of [1, 2, 8]) {
		const data = Uint8Array.from([0xFF, 0xD8, ...new Uint8Array(fillCount).fill(0xFF)]);
		t.is(imageDimensionsFromData(data), undefined);
	}
});

test('jpg - segment length exceeding the data', t => {
	// APP0 segment claiming 1000 bytes in a 20-byte file.
	const data = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0x03, 0xE8, ...new Uint8Array(14)]);
	t.is(imageDimensionsFromData(data), undefined);
});

test('jpg - zero segment length does not hang', t => {
	const data = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0xFF, 0xE1, 0, 1, ...new Uint8Array(10)]);
	t.is(imageDimensionsFromData(data), undefined);
});

test('jpg - does not read markers from scan data', t => {
	// A start of scan (SOS) segment without a preceding frame header. The entropy-coded data after it happens to contain bytes that look like a SOF2 frame header.
	const startOfScan = [0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 0x3F, 0];
	const scanData = [0x12, 0x34, 0xFF, 0xC2, 0, 11, 8, 1, 1, 2, 1, 1, 1, 0x11, 0];
	t.is(imageDimensionsFromData(Uint8Array.from([0xFF, 0xD8, ...startOfScan, ...scanData])), undefined);
});

for (const marker of [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]) {
	test(`jpg - SOF marker ${marker.toString(16)}`, t => {
		// One-component frame header with 513×257 dimensions.
		const data = Uint8Array.from([0xFF, 0xD8, 0xFF, marker, 0, 11, 8, 1, 1, 2, 1, 1, 1, 0x11, 0]);
		headerBoundaryMatches(t, data, 11, {width: 513, height: 257, type: 'jpeg'});
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

test('gif - GIF87a logical screen dimensions', t => {
	const data = fixture('gif/valid.gif');
	data.write('GIF87a');
	t.deepEqual(imageDimensionsFromData(data), {width: 30, height: 17, type: 'gif'});
});

test.failing('jpeg xl', t => {
	matches(t, 'jpeg xl/valid.jxl', {width: 30, height: 17});
});

test('heic - returns raw dimensions without applying rotation', t => {
	matches(t, 'heic/valid-metadata-rotated.heic', {width: 4032, height: 3024, type: 'heic'});
});

test('heic - secondary item larger than primary', t => {
	// The file contains a 256×256 secondary (thumbnail-like) item and a 128×96 primary item.
	// Dimensions must come from the primary item, not the largest item.
	matches(t, 'heic/primary-smaller.heic', {width: 128, height: 96, type: 'heic'});
});

test('avif - meta box with size 0', async t => {
	// Fixture from libavif's test suite (draw_points_idat_metasize0.avif): its `meta` box is the last top-level box and uses size 0, meaning it extends to the end of the file.
	const data = fixture('avif/metasize0.avif');
	const expected = {width: 33, height: 11, type: 'avif'};
	await dimensionsMatch(t, data, expected);
	// The metadata needed to resolve the primary dimensions ends at byte 426, before the image payload.
	headerBoundaryMatches(t, data, 426, expected);
});

// Each fixture uses a 64-bit size for one box; its item data offset is adjusted to preserve the original image.
for (const filename of ['extended-ftyp.avif', 'extended-meta.avif']) {
	test(`isobmff - extended 64-bit box size - ${filename}`, async t => {
		const data = fixture(`avif/${filename}`);
		const expected = {width: 30, height: 20, type: 'avif'};
		await dimensionsMatch(t, data, expected);
		// Both fixtures need the complete metadata box, which ends at byte 270.
		headerBoundaryMatches(t, data, 270, expected);
	});
}

test('isobmff - truncated 64-bit extended size returns undefined', t => {
	const data = fixture('avif/extended-ftyp.avif');
	for (let length = 8; length < 16; length++) {
		t.is(imageDimensionsFromData(data.subarray(0, length)), undefined);
	}
});

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
		const data = fixture(filename);
		const expected = imageDimensionsFromData(data);
		t.truthy(expected);
		headerBoundaryMatches(t, data, headerLength, expected);
	});
}

for (const signature of [0x2E, 0x30]) {
	test(`webp - rejects lossless signature ${signature}`, async t => {
		const data = fixture('webp/vp8l.webp');
		data[20] = signature;
		await dimensionsMatch(t, data, undefined);
	});
}

for (const [filename, minimumSize] of [['vp8.webp', 10], ['vp8l.webp', 5], ['vp8x.webp', 10]]) {
	test(`webp - ${filename} reads dimensions at the header boundary`, async t => {
		const data = fixture(`webp/${filename}`);
		const expected = {width: 30, height: 20, type: 'webp'};
		// A complete compressed payload is not needed to read the dimension header.
		const header = data.subarray(0, 20 + minimumSize);
		headerBoundaryMatches(t, data, header.length, expected);
		await dimensionsMatch(t, header, expected);

		header.writeUInt32LE(minimumSize, 16);
		t.deepEqual(imageDimensionsFromData(header), expected);
	});

	for (const size of [0, minimumSize - 1]) {
		test(`webp - ${filename} rejects declared payload size ${size}`, async t => {
			const data = fixture(`webp/${filename}`);
			// Keep the dimension bytes present to verify that reads respect the declared chunk boundary.
			data.writeUInt32LE(size, 16);
			await dimensionsMatch(t, data, undefined);
		});
	}
}

test('webp - accepts oversized VP8X chunk with future fields', t => {
	// The extended format allows future fields after the 10 known payload bytes (“Unknown fields MUST be ignored”), so a larger VP8X chunk stays valid.
	const data = fixture('webp/vp8x.webp');
	const extended = Buffer.concat([data.subarray(0, 30), Buffer.alloc(2), data.subarray(30)]);
	extended.writeUInt32LE(12, 16); // Chunk payload is now 12 bytes.
	extended.writeUInt32LE(extended.length - 8, 4); // RIFF size excludes its first 8 bytes.
	t.deepEqual(imageDimensionsFromData(extended), {width: 30, height: 20, type: 'webp'});
});

test('webp - unknown first chunk', async t => {
	// A WebP file must start with a `VP8 `, `VP8L`, or `VP8X` chunk. `ALPH` only appears inside the extended format.
	const data = fixture('webp/vp8x.webp');
	data.write('ALPH', 12);
	await dimensionsMatch(t, data, undefined);
});

test('imageDimensionsFromStream - Node.js stream', async t => {
	const stream = fs.createReadStream('fixtures/png/valid.png');
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
});

test('imageDimensionsFromStream - Node.js stream errors are propagated', async t => {
	await t.throwsAsync(imageDimensionsFromStream(fs.createReadStream('fixtures/nonexistent.png')), {code: 'ENOENT'});
});

test('imageDimensionsFromStream - web stream', async t => {
	const stream = ReadableStream.from(fs.createReadStream('fixtures/png/valid.png'));
	t.deepEqual(await imageDimensionsFromStream(stream), {width: 30, height: 20, type: 'png'});
});

for (const filename of ['png/valid.png', 'jpeg/valid.jpg', 'gif/valid.gif', 'webp/vp8l.webp', 'heic/valid.heic', 'avif/valid.avif']) {
	test(`stream - stops after dimensions are available - ${filename}`, async t => {
		const data = fixture(filename);
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
		const data = fixture(filename);
		async function * chunks() {
			for (let offset = 0; offset < data.length; offset += 17) {
				// Bytes outside each view must not enter the accumulated image data.
				yield offsetView(data.subarray(offset, offset + 17));
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
					controller.enqueue(fixture('png/valid.png'));
					// Never closes, so the consumer must cancel it.
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
					controller.enqueue(fixture('png/valid.png'));
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

for (const filename of ['package.json', devNull]) {
	test(`cli - unsupported or empty input - ${filename}`, t => {
		const result = runCli(filename);
		t.is(result.status, 1);
		t.is(result.stdout, '');
		t.is(result.stderr, 'Unsupported image format or invalid image data.\n');
	});
}

test('cli - valid image', t => {
	const result = runCli('fixtures/png/valid.png');
	t.is(result.status, 0);
	t.is(result.stdout, '30x20\n');
	t.is(result.stderr, '');
});

test('cli - no argument', t => {
	const result = runCli();
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.is(result.stderr, 'Usage: image-dimensions <image>\n');
});

test('cli - missing file', t => {
	const result = runCli('nonexistent-file.png');
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.regex(result.stderr, /^ENOENT:.*nonexistent-file\.png.*\n$/);
});

test('cli - directory', t => {
	const result = runCli('fixtures');
	t.is(result.status, 1);
	t.is(result.stdout, '');
	t.regex(result.stderr, /^EISDIR:.*\n$/);
});

// --- ISOBMFF (HEIF/AVIF) structure tests ---

const box = (type, payload) => {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(8 + payload.length);
	header.write(type, 4);
	return Buffer.concat([header, payload]);
};

// Box using the 64-bit `largesize` field (size field set to 1).
const extendedBox = (type, payload) => {
	const header = Buffer.alloc(16);
	header.writeUInt32BE(1);
	header.write(type, 4);
	header.writeBigUInt64BE(BigInt(16 + payload.length), 8);
	return Buffer.concat([header, payload]);
};

const fileType = (major, compatibles = []) => box('ftyp', Buffer.concat([Buffer.from(major), Buffer.alloc(4), ...compatibles.map(brand => Buffer.from(brand))]));

const spatialExtents = (width, height) => {
	const payload = Buffer.alloc(12);
	payload.writeUInt32BE(width, 4);
	payload.writeUInt32BE(height, 8);
	return box('ispe', payload);
};

// Builds a minimal HEIF/AVIF file with a 1024×768 secondary item (ID 1) and a 128×96 primary item (ID 7).
function image({brand = 'heic', compatibleBrands = [], version = 0, wideIndices = false, essential = false, primaryId = 7, propertyIndex = 3, reverseOrder = false, splitAssociations = false, truncateAssociation = false, truncatePrimary = false} = {}) {
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

	const associationBox = (...entries) => {
		const header = Buffer.alloc(8);
		header[0] = version;
		header[3] = Number(wideIndices);
		header.writeUInt32BE(entries.length, 4);
		const associations = Buffer.concat([header, ...entries]);
		return box('ipma', truncateAssociation ? associations.subarray(0, -1) : associations);
	};

	const properties = box('ipco', Buffer.concat([
		spatialExtents(1024, 768),
		box('colr', Buffer.from('nclx')),
		spatialExtents(128, 96),
	]));
	// A file may contain several `ipma` boxes, for example one per version/flags combination. The primary item's entry goes in the first box, so the boxes must be merged rather than the last one winning.
	const associationBoxes = splitAssociations ? entries.toReversed().map(entry => associationBox(entry)) : [associationBox(...entries)];
	const itemProperties = box('iprp', Buffer.concat(reverseOrder ? [...associationBoxes, properties] : [properties, ...associationBoxes]));
	const primaryBox = box('pitm', truncatePrimary ? Buffer.alloc(0) : primary);
	const meta = box('meta', Buffer.concat([Buffer.alloc(4), ...(reverseOrder ? [itemProperties, primaryBox] : [primaryBox, itemProperties])]));
	return Buffer.concat([fileType(brand, compatibleBrands), meta]);
}

for (const brand of ['heic', 'avif']) {
	for (const version of [0, 1]) {
		for (const wideIndices of [false, true]) {
			for (const essential of [false, true]) {
				test(`${brand} primary association: version ${version}, wide ${wideIndices}, essential ${essential}`, async t => {
					await dimensionsMatch(t, image({brand, version, wideIndices, essential}), {width: 128, height: 96, type: brand});
				});
			}
		}
	}

	for (const options of [{reverseOrder: true}, {splitAssociations: true}, {splitAssociations: true, version: 1}]) {
		test(`${brand} primary selection with ${JSON.stringify(options)}`, t => {
			t.deepEqual(imageDimensionsFromData(image({brand, ...options})), {width: 128, height: 96, type: brand});
		});
	}

	for (const options of [{primaryId: 99}, {propertyIndex: 0}, {propertyIndex: 2}, {propertyIndex: 9}, {truncateAssociation: true}, {truncatePrimary: true}]) {
		test(`${brand} unresolved primary: ${JSON.stringify(options)}`, t => {
			t.is(imageDimensionsFromData(image({brand, ...options})), undefined);
		});
	}

	for (const boxType of ['pitm', 'ipma']) {
		test(`${brand} unknown ${boxType} version is ignored`, t => {
			const data = image({brand, version: 1});
			// The version byte follows the 8-byte box header.
			data[data.indexOf(Buffer.from(boxType)) + 4] = 2;
			t.is(imageDimensionsFromData(data), undefined);
		});
	}

	test(`${brand} nested size-0 box is invalid`, t => {
		// A size of 0 is only valid for the last top-level box (ISO/IEC 14496-12 §4.2.2).
		const data = image({brand});
		// Overwrite the size field of the `ipma` box (nested inside `meta` → `iprp`).
		const ipmaOffset = data.indexOf(Buffer.from('ipma'));
		data.writeUInt32BE(0, ipmaOffset - 4);
		t.is(imageDimensionsFromData(data), undefined);
	});
}

test('isobmff - the AVIF brand wins over compatible HEIF brands', t => {
	// AVIF files commonly list `mif1` as a compatible brand, and HEIF files may list `avif`.
	t.is(imageDimensionsFromData(image({brand: 'avif', compatibleBrands: ['mif1', 'miaf']})).type, 'avif');
	t.is(imageDimensionsFromData(image({brand: 'mif1', compatibleBrands: ['avif']})).type, 'avif');
	t.is(imageDimensionsFromData(image({brand: 'mif1', compatibleBrands: ['heic']})).type, 'heic');
	t.is(imageDimensionsFromData(image({brand: 'isom', compatibleBrands: ['mp41']})), undefined);
});

test('isobmff - top-level boxes before meta are skipped', t => {
	// Real files may place `free` or `mdat` boxes before `meta`.
	const data = image();
	const fileTypeLength = unboxIsobmffBox(data, 0).tail;
	const withFreeBox = Buffer.concat([data.subarray(0, fileTypeLength), box('free', Buffer.alloc(4)), data.subarray(fileTypeLength)]);
	t.deepEqual(imageDimensionsFromData(withFreeBox), {width: 128, height: 96, type: 'heic'});
});

test('isobmff - box size smaller than its header is invalid', t => {
	const data = image();
	data.writeUInt32BE(4, 0); // The `ftyp` box claims to be 4 bytes, which cannot hold its own header.
	t.is(imageDimensionsFromData(data), undefined);
});

test('isobmff - nested box with a 64-bit size', t => {
	const data = image();
	const metaOffset = data.indexOf(Buffer.from('meta')) - 4;
	const meta = unboxIsobmffBox(data, metaOffset);
	const primaryItem = unboxIsobmffBox(meta.data, 4);
	// Rebuild `meta` with its `pitm` child using the 64-bit size form.
	const rebuiltMeta = box('meta', Buffer.concat([meta.data.subarray(0, 4), extendedBox('pitm', primaryItem.data), meta.data.subarray(primaryItem.tail)]));
	t.deepEqual(imageDimensionsFromData(Buffer.concat([data.subarray(0, metaOffset), rebuiltMeta])), {width: 128, height: 96, type: 'heic'});
});

test('isobmff - 64-bit size smaller than its header is invalid', t => {
	const data = Buffer.concat([extendedBox('ftyp', Buffer.concat([Buffer.from('heic'), Buffer.alloc(4)])), box('meta', Buffer.alloc(4))]);
	t.deepEqual(getIsobmffFtypBrands(data), ['heic']);
	data.writeBigUInt64BE(8n, 8); // Smaller than the 16-byte extended header.
	t.is(getIsobmffFtypBrands(data), undefined);
	t.is(imageDimensionsFromData(data), undefined);
});

test('getIsobmffFtypBrands - parses major and compatible brands', t => {
	t.deepEqual(getIsobmffFtypBrands(fileType('mif1', ['heic', 'avif'])), ['mif1', 'heic', 'avif']);
	t.deepEqual(getIsobmffFtypBrands(offsetView(fileType('mif1', ['heic']))), ['mif1', 'heic']);
});

test('getIsobmffFtypBrands - invalid or truncated header', t => {
	const data = fileType('mif1', ['heic']);
	t.is(getIsobmffFtypBrands(new Uint8Array(8)), undefined);
	t.is(getIsobmffFtypBrands(data.subarray(0, 15)), undefined);
	data.writeUInt32BE(data.length + 8, 0); // Claims to be larger than the buffer.
	t.is(getIsobmffFtypBrands(data), undefined);
	data.writeUInt32BE(data.length, 0);
	data.write('xtyp', 4);
	t.is(getIsobmffFtypBrands(data), undefined);
});

test('unboxIsobmffBox - reads box header and payload', t => {
	const payload = Uint8Array.from([1, 2, 3, 4, 5]);
	const data = Buffer.concat([box('abcd', payload), box('next', Buffer.alloc(0))]);
	const first = unboxIsobmffBox(data, 0);
	t.is(first.type, 'abcd');
	t.deepEqual([...first.data], [...payload]);
	t.is(first.tail, 13);
	t.is(unboxIsobmffBox(data, first.tail).type, 'next');
	t.is(unboxIsobmffBox(data, data.length), undefined);
});
