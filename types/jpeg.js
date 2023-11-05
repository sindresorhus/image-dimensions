const SOF0 = 0xFF_C0;
const SOF3 = 0xFF_C3;

const jsJpeg = bytes =>
	bytes[0] === 0xFF
	&& bytes[1] === 0xD8
	&& bytes[2] === 0xFF;

export default function jpeg(bytes) {
	if (!jsJpeg(bytes)) {
		return;
	}

	const dataView = new DataView(bytes.buffer);

	let offset = 2; // Start after the SOI marker.

	while (offset < dataView.byteLength - 1) {
		const marker = dataView.getUint16(offset);
		offset += 2; // Move past the marker.

		if (marker >= SOF0 && marker <= SOF3) {
			return {
				height: dataView.getUint16(offset + 3, false),
				width: dataView.getUint16(offset + 5, false),
			};
		}

		if (dataView.byteLength - offset < 2) {
			return; // Unexpected EOF when reading segment length.
		}

		const segmentLength = dataView.getUint16(offset);
		offset += segmentLength; // Skip over the segment.

		if (offset > dataView.byteLength) {
			return; // Segment length exceeds byte range.
		}
	}
}
