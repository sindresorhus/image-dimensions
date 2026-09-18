import {getIsobmffImageDimensions} from '../utilities.js';

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

export default function heic(bytes) {
	return getIsobmffImageDimensions(bytes, heifBrands, 'heic');
}
