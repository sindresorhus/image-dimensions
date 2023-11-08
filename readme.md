# image-dimensions

> Get the dimensions of an image

*Works in any modern JavaScript environment (browsers, Node.js, Bun, Deno, etc).*

Supporting all kinds of image formats is a non-goal. However, pull requests for adding JPEG XL and HEIC formats are welcome.

## Supported formats

- JPEG
- PNG (and APNG)
- GIF
- WebP
- AVIF

## Install

```sh
npm install image-dimensions
```

## Usage

```js
import {imageDimensionsFromStream} from 'image-dimensions';

// In this example, it will only read a few bytes of the image instead of fetching the whole thing.

const url = 'https://sindresorhus.com/unicorn';

const {body} = await fetch(url);

console.log(await imageDimensionsFromStream(body));
//=> {width: 1920, height: 1080}
```

## API

### `imageDimensionsFromStream(stream: ReadableStream<Uint8Array>): Promise<{width: number; height: number} | undefined>`

Get the dimensions of an image by reading the least amount of data.

Prefer this method.

Returns the image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

```js
// Node.js example
import {createReadStream} from 'node:fs';
import {imageDimensionsFromStream} from 'image-dimensions';

const stream = createReadStream('unicorn.png');

console.log(await imageDimensionsFromStream(stream));
//=> {width: 1920, height: 1080}
```

### `imageDimensionsFromData(data: Uint8Array): {width: number; height: number} | undefined`

Get the dimensions of an image from data.

This method can be useful if you already have the image loaded in memory.

Returns the image dimensions, or `undefined` if the image format is not supported or the image data is invalid.

```js
import {imageDimensionsFromData} from 'image-dimensions';

const data = getImage();

console.log(imageDimensionsFromData(data));
//=> {width: 1920, height: 1080}
```

## CLI

```sh
npx image-dimensions unicorn.png
630x400
```

## FAQ

### How does this differ from [`image-size`](https://github.com/image-size/image-size)?

**Advantages of this package**

- Zero dependencies
- Smaller
- Works in non-Node.js environments like the browser
- Does not include unnecessary APIs for file reading
- Supports the AVIF image format

**Advantages of `image-size`**

- More mature
- Supports more image formats
- Supports getting JPEG image orientation

## Related

- [image-type](https://github.com/sindresorhus/image-type) - Detect the type of an image
- [file-type](https://github.com/sindresorhus/file-type) - Detect the type of a file
