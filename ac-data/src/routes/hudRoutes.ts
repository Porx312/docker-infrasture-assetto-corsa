import { Router, type Request, type Response } from 'express';

import { handleHudStreamSse } from '../services/hud/hudStreamSse.js';

const router = Router();

router.get('/stream', (req: Request, res: Response) => {
  void handleHudStreamSse(req, res);
});

export default router;
