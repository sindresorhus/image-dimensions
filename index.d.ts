/**
Get the dimensions of an image by reading the least amount of data.

Prefer this method.

@param stream - The image data.
@returns The image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

@example
```
import {imageDimensionsFromStream} from 'image-dimensions';

// In this example, it will only read a few bytes of the image instead of fetching the whole thing.

const url = 'https://sindresorhus.com/unicorn';

const {body} = await fetch(url);

console.log(await imageDimensionsFromStream(body));
//=> {width: 1920, height: 1080}
```

@example
```
// Node.js example
import {createReadStream} from 'node:fs';
import {imageDimensionsFromStream} from 'image-dimensions';

const stream = createReadStream('unicorn.png');

console.log(await imageDimensionsFromStream(stream));
//=> {width: 1920, height: 1080}
```
*/
export function imageDimensionsFromStream(stream: ReadableStream<Uint8Array>): Promise<{width: number; height: number} | undefined>;

/**
Get the dimensions of an image.

Use this method if you already have the image loaded in memory.

@param data - The image data.
@returns The image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

@example
```
import {imageDimensionsFromData} from 'image-dimensions';

const data = getImage();

console.log(imageDimensionsFromData(data));
//=> {width: 1920, height: 1080}
```
*/
export function imageDimensionsFromData(data: Uint8Array): {width: number; height: number} | undefined;
