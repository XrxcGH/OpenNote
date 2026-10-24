// Every tool of the kit with its engine. The window loads this file the first time it opens.
import { acidBaseTool } from './acidbase/tool';
import { crystalsTool } from './crystals/tool';
import { electrochemTool } from './electrochem/tool';
import { equilibriumTool } from './equilibrium/tool';
import { kineticsTool } from './kinetics/tool';
import { solutionsTool } from './solutions/tool';
import { thermochemTool } from './thermochem/tool';
import type { ToolSpec } from './spec';

export const CHEMMAT_TOOLS: readonly ToolSpec[] = [
  thermochemTool,
  equilibriumTool,
  acidBaseTool,
  electrochemTool,
  kineticsTool,
  solutionsTool,
  crystalsTool,
];
