import { Router } from 'express';
import { optionalAuthenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import {
  stopSchema,
  stopUpdateSchema,
  routeSchema,
  routeUpdateSchema,
  fareSchema,
  fareUpdateSchema,
  generateFaresSchema,
  fareQuerySchema,
  fareListQuerySchema,
  cabsQuerySchema,
} from './routes.schema.js';
import * as c from './routes.controller.js';

export const publicRouter = Router();
// Visitors without an account may browse routes, stops, fares and nearby cabs (cab details are limited for them).
publicRouter.use(optionalAuthenticate);
publicRouter.get('/', c.publicList);
// Must stay above '/:id' so "live" is not read as a route id.
publicRouter.get('/live/cabs', c.liveCabs);
publicRouter.get('/:id', validate(idParams, 'params'), c.publicDetail);
publicRouter.get('/:id/fare', validate(idParams, 'params'), validate(fareQuerySchema, 'query'), c.publicFare);
publicRouter.get('/:id/cabs', validate(idParams, 'params'), validate(cabsQuerySchema, 'query'), c.publicCabs);

export const adminStopsRouter = Router();
adminStopsRouter.get('/', c.adminListStops);
adminStopsRouter.post('/', validate(stopSchema), c.adminCreateStop);
adminStopsRouter.patch('/:id', validate(idParams, 'params'), validate(stopUpdateSchema), c.adminUpdateStop);
adminStopsRouter.delete('/:id', validate(idParams, 'params'), c.adminDeleteStop);

export const adminRoutesRouter = Router();
adminRoutesRouter.get('/', c.adminListRoutes);
adminRoutesRouter.post('/', validate(routeSchema), c.adminCreateRoute);
adminRoutesRouter.patch('/:id', validate(idParams, 'params'), validate(routeUpdateSchema), c.adminUpdateRoute);
adminRoutesRouter.delete('/:id', validate(idParams, 'params'), c.adminDeleteRoute);

export const adminFaresRouter = Router();
adminFaresRouter.get('/', validate(fareListQuerySchema, 'query'), c.adminListFares);
adminFaresRouter.post('/preview', validate(generateFaresSchema), c.adminPreviewFares);
adminFaresRouter.post('/generate', validate(generateFaresSchema), c.adminGenerateFares);
adminFaresRouter.post('/', validate(fareSchema), c.adminUpsertFare);
adminFaresRouter.patch('/:id', validate(idParams, 'params'), validate(fareUpdateSchema), c.adminUpdateFare);
adminFaresRouter.delete('/:id', validate(idParams, 'params'), c.adminDeleteFare);