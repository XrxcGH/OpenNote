// Runs after every unit test file: waits for the start-up loads the file's registrations began, so none is cut off by
// the environment's teardown (boot/startUp.ts).
import { afterAll } from 'vitest';
import { startUpSettled } from '../boot/startUp';

afterAll(startUpSettled);
