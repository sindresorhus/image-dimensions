/**
Supported image format types.
*/
export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'heic';

/**
Options for reading image dimensions.
*/
export type ImageDimensionsOptions = {
	/**
	When `true`, HEIF/HEIC and AVIF use the primary item's `ispe` plus `irot` from `ipma`/`pitm` so width and height match the oriented display (90° and 270° rotation swap dimensions). If orientation metadata cannot be resolved, falls back to the largest `ispe` in the file.

	Does not affect JPEG, PNG, GIF, or WebP (JPEG EXIF orientation is not read).

	@default false
	*/
	resolveOrientation?: boolean;
};

/**
Get the dimensions of an image by reading the least amount of data.

Prefer this method.

@param stream - The image data.
@param options - Optional settings; see `ImageDimensionsOptions`.
@returns The image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

By default returns raw pixel dimensions from the bitstream. Set `resolveOrientation: true` for HEIF/HEIC and AVIF to apply `irot` to width and height.

@example
```
import {imageDimensionsFromStream} from 'image-dimensions';

// In this example, it will only read a few bytes of the image instead of fetching the whole thing.

const url = 'https://sindresorhus.com/unicorn';

const {body} = await fetch(url);

console.log(await imageDimensionsFromStream(body));
//=> {width: 1920, height: 1080, type: 'png'}
```

@example
```
// Node.js example
import {createReadStream} from 'node:fs';
import {imageDimensionsFromStream} from 'image-dimensions';

const stream = ReadableStream.from(createReadStream('unicorn.png'));

console.log(await imageDimensionsFromStream(stream));
//=> {width: 1920, height: 1080, type: 'png'}
```
*/
export function imageDimensionsFromStream(stream: ReadableStream<Uint8Array>, options?: ImageDimensionsOptions): Promise<{width: number; height: number; type: ImageType} | undefined>;

/**
Get the dimensions of an image.

Use this method if you already have the image loaded in memory.

@param data - The image data.
@param options - Optional settings; see `ImageDimensionsOptions`.
@returns The image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

By default returns raw pixel dimensions from the bitstream. Set `resolveOrientation: true` for HEIF/HEIC and AVIF to apply `irot` to width and height.

@example
```
import {imageDimensionsFromData} from 'image-dimensions';

const data = getImage();

console.log(imageDimensionsFromData(data));
//=> {width: 1920, height: 1080, type: 'png'}
```
*/
export function imageDimensionsFromData(data: Uint8Array, options?: ImageDimensionsOptions): {width: number; height: number; type: ImageType} | undefined;
