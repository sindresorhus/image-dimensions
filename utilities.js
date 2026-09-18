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
	// Box size (Big-endian) at offset 0, including an optional extended size.
	const box = unboxIsobmffBox(bytes, 0);

	// Validate 'ftyp' marker at offset 4.
	// Minimum payload size: 4 (major_brand) + 4 (minor_version).
	if (!box || box.type !== 'ftyp' || box.data.length < 8) {
		return;
	}

	const brands = [];
	// Major brand
	brands.push(String.fromCodePoint(...box.data.slice(0, 4)));
	// Compatible brands start at payload offset 8.
	for (let i = 8; i + 4 <= box.data.length; i += 4) {
		brands.push(String.fromCodePoint(...box.data.slice(i, i + 4)));
	}

	return brands;
}

/*
Read a generic ISOBMFF box at the given offset.

Returns an object with {type, data, tail} or undefined if invalid.

Applicable to ISOBMFF-based image formats like HEIF/HEIC and AVIF.
*/
export function unboxIsobmffBox(data, offset, {isTopLevel = false} = {}) {
	const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let size = getUint32(dataView, offset);
	let headerSize = 8; // 4 (size) + 4 (type)

	// An extended size of 1 means the real size is a 64-bit value following the type (ISO/IEC 14496-12 §4.2.2).
	if (size === 1) {
		headerSize += 8;

		if (!isValidOffsetToRead(dataView, offset, headerSize)) {
			return;
		}

		const extendedSize = dataView.getBigUint64(offset + 8);
		if (extendedSize > BigInt(data.length - offset)) {
			return;
		}

		size = Number(extendedSize);
	}

	if (size === undefined) {
		return;
	}

	// A size of 0 is only valid for a top-level box and means it extends to the end of the file (ISO/IEC 14496-12 §4.2.2).
	if (size === 0 && isTopLevel) {
		size = data.length - offset;
	}

	// Size includes the header
	if (data.length < size + offset || size < headerSize) {
		return;
	}

	return {
		type: String.fromCodePoint(...data.slice(offset + 4, offset + 8)),
		data: data.slice(offset + headerSize, offset + size),
		tail: offset + size,
	};
}

/*
Traverse ISOBMFF boxes to collect image spatial extents from `ispe` properties under the `meta` → `iprp` → `ipco` hierarchy.

Applicable to HEIF/HEIC and AVIF; codec-agnostic within ISOBMFF.
*/
export function getIsobmffIspeSizesFromMeta(data) {
	return getIsobmffMetaInfo(data).sizes.map(({width, height}) => ({width, height}));
}

/*
Resolve the image dimensions of a HEIF/HEIC/AVIF file from its `meta` box.

Follows the primary item (`pitm`) to its `ispe` property via the item-to-property associations (`ipma`), so thumbnails or secondary items do not leak in.

Returns {width, height} or undefined when the primary item has no `ispe` property.
*/
export function getIsobmffImageSizeFromMeta(data) {
	const {sizes, primaryItemId, associations} = getIsobmffMetaInfo(data);

	// Property indices in `ipma` are 1-based over `ipco` children.
	const primaryAssociations = new Set(associations
		.filter(association => association.itemId === primaryItemId)
		.flatMap(association => association.propertyIndices));
	const primarySize = sizes.find(size => primaryAssociations.has(size.propertyIndex));

	if (!primarySize) {
		return;
	}

	return {
		width: primarySize.width,
		height: primarySize.height,
	};
}

function getIsobmffMetaInfo(data) {
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset, {isTopLevel: true});

		if (!box) {
			break;
		}

		if (box.type === 'meta') {
			return parseIsobmffMetaBox(box.data);
		}

		offset = box.tail;
	}

	return {
		sizes: [],
		primaryItemId: undefined,
		associations: [],
	};
}

// Parses `meta` box
function parseIsobmffMetaBox(data) {
	const info = {
		sizes: [],
		primaryItemId: undefined,
		associations: [],
	};

	// Skip version (1 byte) and flags (3 bytes).
	let offset = 4; // Version + flags

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'iprp') {
			parseIsobmffIprpBox(box.data, info);
		} else if (box.type === 'pitm') {
			info.primaryItemId = parseIsobmffPitmBox(box.data);
		}

		offset = box.tail;
	}

	return info;
}

// Parses `meta.pitm` box (Primary Item), returns the primary item ID.
function parseIsobmffPitmBox(data) {
	if (data.length < 6 || data[0] > 1) {
		return;
	}

	const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

	// Version 0 uses a 16-bit item ID, version 1 a 32-bit one.
	return data[0] === 0 ? getUint16(dataView, 4) : getUint32(dataView, 4);
}

// Parses `meta.iprp.ipma` box (Item to Property Association), returns [{itemId, propertyIndices}].
function parseIsobmffIpmaBox(data) {
	if (data.length < 8 || data[0] > 1) {
		return [];
	}

	const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const version = dataView.getUint8(0);
	const flags = dataView.getUint8(3);
	const entryCount = getUint32(dataView, 4);

	if (entryCount === undefined) {
		return [];
	}

	const itemIdSize = version === 0 ? 2 : 4;
	// eslint-disable-next-line no-bitwise
	const associationSize = (flags & 1) === 0 ? 1 : 2;
	const essentialMask = associationSize === 1 ? 0x7F : 0x7F_FF;

	const associations = [];
	let offset = 8;

	for (let entry = 0; entry < entryCount && offset + itemIdSize + 1 <= data.byteLength; entry++) {
		const itemId = itemIdSize === 2 ? getUint16(dataView, offset) : getUint32(dataView, offset);
		offset += itemIdSize;
		const propertyCount = dataView.getUint8(offset);
		offset++;

		if (!isValidOffsetToRead(dataView, offset, propertyCount * associationSize)) {
			return [];
		}

		const propertyIndices = [];
		for (let index = 0; index < propertyCount; index++) {
			const value = associationSize === 1 ? dataView.getUint8(offset) : dataView.getUint16(offset);
			offset += associationSize;

			// The essential bit is not part of the property index. Index 0 means "no property".
			// eslint-disable-next-line no-bitwise
			const propertyIndex = value & essentialMask;
			if (propertyIndex > 0) {
				propertyIndices.push(propertyIndex);
			}
		}

		associations.push({itemId, propertyIndices});
	}

	return associations;
}

// Parses `meta.iprp` box (Item Properties)
function parseIsobmffIprpBox(data, info) {
	let offset = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'ipco') {
			parseIsobmffIpcoBox(box.data, info);
		} else if (box.type === 'ipma') {
			info.associations.push(...parseIsobmffIpmaBox(box.data));
		}

		offset = box.tail;
	}
}

// Parses `meta.iprp.ipco` box (Item Property Container)
function parseIsobmffIpcoBox(data, info) {
	let offset = 0;
	// Property indices are 1-based over the `ipco` children.
	let propertyIndex = 0;

	while (offset < data.length) {
		const box = unboxIsobmffBox(data, offset);

		if (!box) {
			break;
		}

		propertyIndex++;

		// Image Spatial Extent
		if (box.type === 'ispe') {
			const dataView = new DataView(box.data.buffer, box.data.byteOffset, box.data.byteLength);
			const width = getUint32(dataView, 4);
			const height = getUint32(dataView, 8);

			if (width === undefined || height === undefined) {
				return;
			}

			info.sizes.push({
				width,
				height,
				propertyIndex,
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
