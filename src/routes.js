import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import { publicRouter as routeCatalogRoutes } from './modules/routes/routes.routes.js';
import driverRoutes from './modules/drivers/driver.routes.js';
import { passengerRouter, shareRouter } from './modules/bookings/booking.routes.js';
import { sosRouter } from './modules/sos/sos.routes.js';
import { complaintRouter } from './modules/complaints/complaint.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import uploadRoutes from './modules/uploads/upload.routes.js';
import commuteRoutes from './modules/commute/commute.routes.js';
import { walletRouter, webhookRouter } from './modules/wallet/wallet.routes.js';
import alertRoutes from './modules/alerts/alerts.routes.js';
import privacyRoutes from './modules/privacy/privacy.routes.js';
import receiptRoutes from './modules/receipts/receipts.routes.js';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import { whatsappEnabled } from './modules/whatsapp/whatsapp.client.js';
import { env } from './config/env.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { organizationRouter } from './modules/organizations/organization.routes.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/me', userRoutes);
router.use('/routes', routeCatalogRoutes);
router.use('/driver', driverRoutes);
router.use('/bookings', passengerRouter);
router.use('/share', shareRouter);
router.use('/sos', sosRouter);
router.use('/complaints', complaintRouter);
router.use('/uploads', uploadRoutes);
router.use('/organizations', organizationRouter);
router.use('/commute', commuteRoutes);
router.use('/wallet', walletRouter);
router.use('/webhooks', webhookRouter);
router.use('/webhooks/whatsapp', whatsappRouter); // FEATURE: WHATSAPP
// Public settings the apps can read
router.get('/config', (_req, res) => {
  res.json({ whatsapp: { enabled: whatsappEnabled(), number: env.WHATSAPP_BUSINESS_NUMBER || null } });
});
router.use('/alerts', alertRoutes);
router.use('/privacy', privacyRoutes);
router.use('/receipts', receiptRoutes);
router.use('/notifications', notificationRouter);
router.use('/admin', adminRoutes);

export default router;
