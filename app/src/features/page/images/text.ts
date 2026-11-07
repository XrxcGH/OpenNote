// The image words join the images namespace here, so they load with the image code and not at start-up. Every module
// that words an image imports this file first; start-up holds only strings/en/imagesStart.ts.
import { en } from '../../../strings/en';
import { images } from '../../../strings/en/images';

Object.assign(en.images as object, images);
