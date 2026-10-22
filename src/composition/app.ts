import { createProductController } from './controller.ts';
import { createLiveBackend } from './live';

export const productClient = createProductController(createLiveBackend);
