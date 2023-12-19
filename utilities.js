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
