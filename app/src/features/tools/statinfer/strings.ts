// The statistics kit's detailed words load with the kit, not at start-up: this module adds them to the kitStatInfer
// strings the first time any tool loads, so t() and the kit foundation's parts find every key. The palette and the
// window's tabs use only the words in strings/en/kitStatInfer.ts, which start-up has.
import { en } from '../../../strings/en';
import { kitStatInferDetail } from '../../../strings/en/kitStatInfer/detail';

Object.assign(en.kitStatInfer as Record<string, unknown>, kitStatInferDetail);

export type StatInferMessages = typeof kitStatInferDetail;
