// The page service, reached through the platform, for the features that edit a page without showing it.
import { commandContext } from '../../commands/registry';

export const pagesClient = () => commandContext('menu').platform.pages;
