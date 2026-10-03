// The Home page. It loads on demand, the first time Home opens.
import { lazy } from 'react';

export const HomeView = lazy(() => import('./HomeView'));
