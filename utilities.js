export function isValidOffsetToRead(dataView, offset, bytesToRead) {
	return dataView.byteLength >= offset + bytesToRead;
}

export function getUint32(dataView, offset, littleEndian = false) {
	if (isValidOffsetToRead(dataView, offset, 4)) {
		return dataView.getUint32(offset, littleEndian);
	}
}

export function getUint16(dataView, offset, littleEndian = false) {
	if (isValidOffsetToRead(dataView, offset, 2)) {
		return dataView.getUint16(offset, littleEndian);
	}
}

/*
Parse the FileTypeBox (ftyp) at the start of an ISOBMFF container and return an array of 4CC brand strings (major brand first, followed by compatible brands).

Applicable to ISOBMFF-based image formats like HEIF/HEIC and AVIF. Not applicable to PNG, JPEG, GIF, or WebP.
*/
export function getIsobmffFtypBrands(bytes) {
	// Minimum size: 4 (size) + 4 ('ftyp') + 4 (major_brand) + 4 (minor_version)
	if (bytes.length < 16) {
		return;
	}

	// Validate 'ftyp' marker at offset 4
	const isFtyp = bytes[4] === 0x66
		&& bytes[5] === 0x74
		&& bytes[6] === 0x79
		&& bytes[7] === 0x70;

	if (!isFtyp) {
		return;
	}

	// Box size (Big-endian) at offset 0
	const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const size = getUint32(dataView, 0);
	if (size === undefined || size < 16 || size > bytes.length) {
		return;
	}

	const brands = [];
	// Major brand
	brands.push(String.fromCodePoint(...bytes.slice(8, 12)));
	// Compatible brands start at offset 16
	for (let i = 16; i + 4 <= size; i += 4) {
		brands.push(String.fromCodePoint(...bytes.slice(i, i + 4)));
	}

	return brands;
}

/*
Read a generic ISOBMFF box at the given offset.

Returns an object with {type, data, tail} or undefined if invalid.

Applicable to ISOBMFF-based image formats like HEIF/HEIC and AVIF.
*/
export function unboxIsobmffBox(data, offset) {
	const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const size = getUint32(dataView, offset);

	if (size === undefined) {
		return;
	}

	// Size includes the first 4 bytes (length)
	if (data.length < size + offset || size < 8) {
		return;
	}

	return {
		type: String.fromCodePoint(...data.slice(offset + 4, offset + 8)),
		data: data.slice(offset + 8, offset + size),
		tail: offset + size,
	};
}

/*
Traverse ISOBMFF boxes to collect image spatial extents from `ispe` properties under the `meta` → `iprp` → `ipco` hierarchy.

Applicable to HEIF/HEIC and AVIF; codec-agnostic within ISOBMFF.
*/
export function getIsobmffIspeSizesFromMeta(data) {
	const sizes = [];
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'meta') {
			parseIsobmffMetaBox(box.data, sizes);
		}

		offset = box.tail;
	}

	return sizes;
}

// Parses `meta` box
function parseIsobmffMetaBox(data, sizes) {
	// Skip version (1 byte) and flags (3 bytes).
	let offset = 4; // Version + flags

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'iprp') {
			parseIsobmffIprpBox(box.data, sizes);
		}

		offset = box.tail;
	}

	return sizes;
}

// Parses `meta.iprp` box (Item Properties)
function parseIsobmffIprpBox(data, sizes) {
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'ipco') {
			parseIsobmffIpcoBox(box.data, sizes);
		}

		offset = box.tail;
	}
}

// Parses `meta.iprp.ipco` box (Item Property Container)
function parseIsobmffIpcoBox(data, sizes) {
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		// Image Spatial Extent
		if (box.type === 'ispe') {
			const dataView = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
			const width = getUint32(dataView, 4);
			const height = getUint32(dataView, 8);

			if (width === undefined || height === undefined) {
				return;
			}

			sizes.push({
				width,
				height,
			});
		}

		offset = box.tail;
	}
}

/*
Return the size with the largest area from a list of {width, height}.

Generic helper used by HEIF/HEIC and AVIF readers.
*/
export function getLargestAreaSize(sizes) {
	let maxSize = sizes[0];

	for (const size of sizes) {
		if (size.width * size.height > maxSize.width * maxSize.height) {
			maxSize = size;
		}
	}

	return maxSize;
}

function findTopLevelMetaBox(data) {
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'meta') {
			return box.data;
		}

		offset = box.tail;
	}
}

function parsePitmItemId(pitmData) {
	if (pitmData.length < 6) {
		return;
	}

	const dataView = new DataView(pitmData.buffer, pitmData.byteOffset, pitmData.byteLength);
	return getUint16(dataView, 4);
}

/*
Parse `irot` (ImageRotation) payload: counter-clockwise 90-degree steps 0..3.

Some writers use a FullBox (4-byte version/flags + angle byte). Others use a 9-byte
box total (8-byte header + single angle byte), per common HEIC encoders.
*/
export function parseIsobmffIrotAngle(irotData) {
	if (irotData.length === 0) {
		return 0;
	}

	if (irotData.length >= 5) {
		return irotData[4] % 4;
	}

	return irotData[0] % 4;
}

/*
Parse `ipco` into an ordered list of property boxes (type + full-box payload after size+type).
*/
function parseIpcoPropertyList(ipcoData) {
	const properties = [];
	let offset = 0;

	while (offset < ipcoData.length) {
		const box = unboxIsobmffBox(ipcoData, offset);

		if (!box) {
			break;
		}

		properties.push({
			type: box.type,
			data: box.data,
		});
		offset = box.tail;
	}

	return properties;
}

function parseIpmaEntries(ipmaData) {
	if (ipmaData.length < 8) {
		return;
	}

	const version = ipmaData[0];
	const flags = (ipmaData[1] * 65_536) + (ipmaData[2] * 256) + ipmaData[3];
	const dataView = new DataView(ipmaData.buffer, ipmaData.byteOffset, ipmaData.byteLength);
	let offset = 4;
	const entryCount = getUint32(dataView, offset);

	if (entryCount === undefined) {
		return;
	}

	offset += 4;
	const use32BitItemId = version === 1 && (flags % 2) === 1;
	const use15BitPropertyIndex = version === 1 && (Math.floor(flags / 2) % 2) === 1;
	const entries = [];

	for (let i = 0; i < entryCount; i++) {
		let itemId;

		if (use32BitItemId) {
			itemId = getUint32(dataView, offset);
			offset += 4;
		} else {
			itemId = getUint16(dataView, offset);
			offset += 2;
		}

		if (itemId === undefined || offset >= ipmaData.length) {
			return;
		}

		const associationCount = ipmaData[offset];
		offset += 1;
		const associations = [];

		for (let j = 0; j < associationCount; j++) {
			if (use15BitPropertyIndex) {
				const word = getUint16(dataView, offset);

				if (word === undefined) {
					return;
				}

				offset += 2;
				associations.push({
					essential: word >= 32_768,
					propertyIndex: word % 32_768,
				});
			} else {
				const b = ipmaData[offset];
				offset += 1;

				if (b === undefined) {
					return;
				}

				associations.push({
					essential: b >= 128,
					propertyIndex: b % 128,
				});
			}
		}

		entries.push({
			itemId,
			associations,
		});
	}

	return entries;
}

function readIspeDimensions(ispeData) {
	const dataView = new DataView(ispeData.buffer, ispeData.byteOffset, ispeData.byteLength);
	const width = getUint32(dataView, 4);
	const height = getUint32(dataView, 8);

	if (width === undefined || height === undefined) {
		return;
	}

	return {
		width,
		height,
	};
}

function resolvePrimaryItemAssociations(entries, pitmItemId) {
	if (entries.length === 0) {
		return;
	}

	if (pitmItemId !== undefined) {
		const match = entries.find(entry => entry.itemId === pitmItemId);

		if (match) {
			return match;
		}
	}

	return entries[0];
}

function dimensionsFromPrimaryItemProperties(properties, associations) {
	let width;
	let height;
	let irot = 0;

	for (const {propertyIndex} of associations) {
		if (propertyIndex === 0) {
			continue;
		}

		const prop = properties[propertyIndex - 1];

		if (!prop) {
			continue;
		}

		if (prop.type === 'ispe') {
			const dims = readIspeDimensions(prop.data);

			if (dims) {
				({
					width,
					height,
				} = dims);
			}
		} else if (prop.type === 'irot') {
			irot = parseIsobmffIrotAngle(prop.data);
		}
	}

	if (width === undefined || height === undefined) {
		return;
	}

	if ((irot % 2) === 1) {
		return {
			width: height,
			height: width,
		};
	}

	return {
		width,
		height,
	};
}

function parseIprpForOrientedSize(iprpData, pitmItemId) {
	let properties = [];
	let ipmaEntries;

	let offset = 0;

	while (offset < iprpData.length) {
		const box = unboxIsobmffBox(iprpData, offset);

		if (!box) {
			break;
		}

		if (box.type === 'ipco') {
			properties = parseIpcoPropertyList(box.data);
		} else if (box.type === 'ipma') {
			ipmaEntries = parseIpmaEntries(box.data);
		}

		offset = box.tail;
	}

	if (!ipmaEntries || properties.length === 0) {
		return;
	}

	const primaryEntry = resolvePrimaryItemAssociations(ipmaEntries, pitmItemId);

	if (!primaryEntry) {
		return;
	}

	return dimensionsFromPrimaryItemProperties(properties, primaryEntry.associations);
}

function parseMetaForOrientedSize(metaData) {
	let pitmItemId;
	let iprpData;
	let offset = 4;

	while (offset < metaData.length) {
		const box = unboxIsobmffBox(metaData, offset);

		if (!box) {
			break;
		}

		if (box.type === 'pitm') {
			pitmItemId = parsePitmItemId(box.data);
		} else if (box.type === 'iprp') {
			iprpData = box.data;
		}

		offset = box.tail;
	}

	if (!iprpData) {
		return;
	}

	return parseIprpForOrientedSize(iprpData, pitmItemId);
}

/*
Resolve display-oriented width/height for the primary HEIF/AVIF item using `pitm`, `ipma`, `ipco` (`ispe` + `irot`).

Returns `undefined` if orientation metadata cannot be resolved (caller should fall back to largest `ispe`).
*/
export function getIsobmffOrientedSizeFromMeta(data) {
	const metaPayload = findTopLevelMetaBox(data);

	if (!metaPayload) {
		return;
	}

	return parseMetaForOrientedSize(metaPayload);
}
