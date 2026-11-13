import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { idParams } from '../../utils/schemas.js';
import { startSessionSchema, seatsSchema, locationSchema } from './session.schema.js';
import * as c from './session.controller.js';

const router = Router();
router.post('/', validate(startSessionSchema), c.start);
router.get('/current', c.current);
router.patch('/:id/seats', validate(idParams, 'params'), validate(seatsSchema), c.seats);
router.post('/:id/location', validate(idParams, 'params'), validate(locationSchema), c.location);
router.post('/:id/end', validate(idParams, 'params'), c.end);
router.get('/:id/bookings', validate(idParams, 'params'), c.bookings);
router.get('/:id/waiting', validate(idParams, 'params'), c.waiting);

export default router;
