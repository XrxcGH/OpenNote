// The tools that have a part of their own beside the fields, such as a live recorder, loaded with the tool.
import type { ComponentType } from 'react';
import type { ExtraProps } from './ToolPanel';

export const EXTRAS: Readonly<Record<string, () => Promise<ComponentType<ExtraProps>>>> = {};
