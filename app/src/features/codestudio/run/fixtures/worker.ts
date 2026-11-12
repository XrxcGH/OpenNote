// The run worker of run.test.tsx: the real run protocol (serve.ts) over the two test runtimes.
import { serve } from '../serve';

serve({
  javascript: () => import('./quickjs').then((loaded) => loaded.quickjsFixture),
  lua: () => import('./jspi').then((loaded) => loaded.jspiFixture),
});
