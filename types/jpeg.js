import {isValidOffsetToRead, getUint16} from '../utilities.js';

// Frame header markers (SOF0-SOF15, except DHT/JPG/DAC which are not frame headers).
const isFrameMarker = marker =>
	marker >= 0xFF_C0
	&& marker <= 0xFF_CF
	&& marker !== 0xFF_C4
	&& marker !== 0xFF_C8
	&& marker !== 0xFF_CC;

const isJpeg = bytes =>
	bytes[0] === 0xFF
	&& bytes[1] === 0xD8
	&& bytes[2] === 0xFF;

export default function jpeg(bytes) {
	if (!isJpeg(bytes)) {
		return;
	}

	const dataView = new DataView(bytes.buffer);

	let offset = 2; // Start after the SOI marker.

	while (isValidOffsetToRead(dataView, offset, 2)) {
		// A marker is 0xFF followed by a non-0xFF byte. Skip fill bytes (0xFF) and any extraneous bytes before it, like libjpeg does.
		if (dataView.getUint8(offset) !== 0xFF || dataView.getUint8(offset + 1) === 0xFF) {
			offset++;
			continue;
		}

		const marker = dataView.getUint16(offset);
		offset += 2; // Move past the marker.

		// TEM is a standalone marker with no segment length.
		if (marker === 0xFF_01) {
			continue;
		}

		// SOS starts the entropy-coded data, which cannot be skipped by segment length. A frame header must precede it, so stop here instead of misreading scan data as markers.
		if (marker === 0xFF_DA) {
			return;
		}

		if (isFrameMarker(marker)) {
			const height = getUint16(dataView, offset + 3);
			const width = getUint16(dataView, offset + 5);

			if (height === undefined || width === undefined) {
				return;
			}

			return {
				height,
				width,
				type: 'jpeg',
			};
		}

		const segmentLength = getUint16(dataView, offset);

		if (segmentLength === undefined) {
			return; // Unexpected EOF when reading segment length.
		}

		offset += segmentLength; // Skip over the segment.

		if (offset > dataView.byteLength) {
			return; // Segment length exceeds byte range.
		}
	}
}
