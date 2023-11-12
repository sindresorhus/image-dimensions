const isSVG = bytes => {
	const text = new TextDecoder().decode(bytes);

	return text.includes('<svg') || text.includes('<?xml');
};

export default function svg(bytes) {
	if (!isSVG(bytes)) {
		return;
	}

	const text = new TextDecoder().decode(bytes);

	const widthRegex = /<svg[^>]*\swidth=["']?(\d+)["']?[^>]*>/i;
	const heightRegex = /<svg[^>]*\sheight=["']?(\d+)["']?[^>]*>/i;
	const viewBoxRegex = /<svg[^>]*\sviewbox="([^"]*)"/i;

	const viewBoxMatch = text.match(viewBoxRegex);
	const widthMatch = text.match(widthRegex);
	const heightMatch = text.match(heightRegex);

	if (viewBoxMatch) {
		const viewBoxData = viewBoxMatch[1].split(/\s+/);
		if (viewBoxData.length === 4) {
			return {
				width: Number.parseInt(viewBoxData[2], 10),
				height: Number.parseInt(viewBoxData[3], 10),
			};
		}
	}

	if (widthMatch && heightMatch) {
		return {
			width: Number.parseInt(widthMatch[1], 10),
			height: Number.parseInt(heightMatch[1], 10),
		};
	}
}
