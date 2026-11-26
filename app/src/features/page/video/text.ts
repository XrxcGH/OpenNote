// The video words join the video namespace here, so they load with the video code and not at start-up. Every module
// of the video code that words something imports this file first; start-up holds only strings/en/videoStart.ts.
import { en } from '../../../strings/en';
import { video } from '../../../strings/en/video';

Object.assign(en.video as object, video);
