import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import test from 'ava';
import {imageDimensionsFromData, imageDimensionsFromStream} from './index.js';

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
}

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
