import {getUint32} from '../utilities.js';

// Specification: https://aomediacodec.github.io/av1-avif/v1.1.0.html

const isAvif = bytes =>
	// `ftypavif` magic bytes
	bytes[4] === 0x66
	&& bytes[5] === 0x74
	&& bytes[6] === 0x79
	&& bytes[7] === 0x70
	&& bytes[8] === 0x61
	&& bytes[9] === 0x76
	&& bytes[10] === 0x69
	&& bytes[11] === 0x66;

export default function avif(bytes) {
	if (!isAvif(bytes)) {
		return;
	}

	const sizes = getMeta(bytes);

	if (sizes.length === 0) {
		return;
	}

	return getMaxSize(sizes);
}

function unbox(data, offset) {
	const dataView = new DataView(data.buffer);
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

function getMeta(data) {
	const sizes = [];
	let offset = 0;

	while (offset < data.length) {
		const box = unbox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'meta') {
			parseMetaBox(box.data, sizes);
		}

		offset = box.tail;
	}

	return sizes;
}

// Parses `meta` box
function parseMetaBox(data, sizes) {
	let offset = 4; // Version + flags

	while (offset < data.length) {
		const box = unbox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'iprp') {
			parseIprpBox(box.data, sizes);
		}

		offset = box.tail;
	}

	return sizes;
}

// Parses `meta.iprp` box (Item Properties)
function parseIprpBox(data, sizes) {
	let offset = 0;

	while (offset < data.length) {
		const box = unbox(data, offset);

		if (!box) {
			break;
		}

		if (box.type === 'ipco') {
			parseIpcoBox(box.data, sizes);
		}

		offset = box.tail;
	}
}

// Parses `meta.iprp.ipco` box (Item Property Container)
function parseIpcoBox(data, sizes) {
	let offset = 0;

	while (offset < data.length) {
		const box = unbox(data, offset);

		if (!box) {
			break;
		}

		// Image Spatial Extent
		if (box.type === 'ispe') {
			const dataView = new DataView(box.data.buffer);
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

// Get the image size with the largest area
function getMaxSize(sizes) {
	let maxSize = sizes[0];

	for (const size of sizes) {
		if (size.width * size.height > maxSize.width * maxSize.height) {
			maxSize = size;
		}
	}

	return maxSize;
}
