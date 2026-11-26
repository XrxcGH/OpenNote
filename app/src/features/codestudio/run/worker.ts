// The run worker's entry (DESIGN 4.1): the run protocol over the registered runtimes.
import { ADAPTERS } from './adapters';
import { serve } from './serve';

serve(ADAPTERS);
