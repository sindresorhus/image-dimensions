import {getIsobmffFtypBrands, getIsobmffIspeSizesFromMeta, getIsobmffOrientedSizeFromMeta, getLargestAreaSize} from '../utilities.js';

// HEIC/HEIF format specification: ISO/IEC 23008-12

// HEIF identifiers: generic ('mif1', 'msf1') and HEVC-coded variants
const heifBrands = new Set([
	'mif1',
	'msf1',
	'heic',
	'heix',
	'hevc',
	'hevx',
	'heim',
	'heis',
	'hevm',
	'hevs',
]);

const isHeic = bytes => {
	const brands = getIsobmffFtypBrands(bytes);
	if (!brands) {
		return false;
	}

	return brands.some(brand => heifBrands.has(brand));
};

export default function heic(bytes, options) {
	if (!isHeic(bytes)) {
		return;
	}

	const sizes = getIsobmffIspeSizesFromMeta(bytes);

	if (sizes.length === 0) {
		return;
	}

	if (options?.resolveOrientation) {
		const oriented = getIsobmffOrientedSizeFromMeta(bytes);

		if (oriented) {
			return {
				...oriented,
				type: 'heic',
			};
		}
	}

	return {
		...getLargestAreaSize(sizes),
		type: 'heic',
	};
}
