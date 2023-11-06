const isGif = bytes =>
	bytes[0] === 0x47
	&& bytes[1] === 0x49
	&& bytes[2] === 0x46
	&& bytes[3] === 0x38
	&& (bytes[4] === 0x37 || bytes[4] === 0x39)
	&& bytes[5] === 0x61;

export default function gif(bytes) {
	if (!isGif(bytes)) {
		return;
	}

	const dataView = new DataView(bytes.buffer);

	return {
		width: dataView.getUint16(6, true),
		height: dataView.getUint16(8, true),
	};
}
