import {isValidOffsetToRead, getUint32, getFourCC} from '../utilities.js';

// Specification: https://developers.google.com/speed/webp/docs/riff_container

const isWebp = bytes => getFourCC(bytes, 0) === 'RIFF' && getFourCC(bytes, 8) === 'WEBP';

function readUInt24LE(dataView, offset) {
	const byte1 = dataView.getUint8(offset);
	const byte2 = dataView.getUint8(offset + 1);
	const byte3 = dataView.getUint8(offset + 2);

	// Combine the three bytes into a 24-bit integer.
	// eslint-disable-next-line no-bitwise
	return (byte3 << 16) | (byte2 << 8) | byte1;
}

export default function webp(bytes) {
	if (!isWebp(bytes)) {
		return;
	}

	const dataView = new DataView(bytes.buffer);
	// The first chunk is `VP8 ` (lossy, note the space), `VP8L` (lossless), or `VP8X` (extended).
	const chunkType = getFourCC(bytes, 12);
	const chunkSize = getUint32(dataView, 16, true);

	// The chunk payload is at least 5 bytes for VP8L and 10 bytes for VP8 and VP8X (32-bit chunk size at offset 16).
	// A smaller chunk means the dimension fields would come from the next chunk. VP8X allows future fields, so larger sizes are fine.
	if (chunkSize === undefined || chunkSize < (chunkType === 'VP8L' ? 5 : 10)) {
		return;
	}

	const maxSize = 0x3F_FF;

	if (chunkType === 'VP8 ') {
		if (!isValidOffsetToRead(dataView, 28, 2)) {
			return;
		}

		return {
			// eslint-disable-next-line no-bitwise
			width: dataView.getUint16(26, true) & maxSize,
			// eslint-disable-next-line no-bitwise
			height: dataView.getUint16(28, true) & maxSize,
			type: 'webp',
		};
	}

	if (chunkType === 'VP8L') {
		// The lossless bitstream starts with a 1-byte signature (0x2F) before the packed dimension bits.
		if (bytes[20] !== 0x2F) {
			return;
		}

		const bits = getUint32(dataView, 21, true);

		if (bits === undefined) {
			return;
		}

		return {
			// eslint-disable-next-line no-bitwise
			width: (bits & maxSize) + 1,
			// eslint-disable-next-line no-bitwise
			height: ((bits >> 14) & maxSize) + 1,
			type: 'webp',
		};
	}

	if (chunkType === 'VP8X') {
		if (!isValidOffsetToRead(dataView, 27, 3)) {
			return;
		}

		return {
			width: readUInt24LE(dataView, 24) + 1,
			height: readUInt24LE(dataView, 27) + 1,
			type: 'webp',
		};
	}
}
