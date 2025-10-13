import express, { Request, Response, Router } from 'express';
const router: Router = express.Router();
// import bodyParser from 'body-parser';
import { Webhook } from 'svix';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

router.post('/clerk', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    try {
        const payload = req.body;
        const headers = req.headers;

        const svixId = headers['svix-id'];
        const svixTimestamp = headers['svix-timestamp'];
        const svixSignature = headers['svix-signature'];

        if (!svixId || !svixTimestamp || !svixSignature) {
            return res.status(400).send('Missing Clerk Headers');
        }

        const wh = new Webhook(WEBHOOK_SECRET!);

        let event: any;

        event = wh.verify(payload, {
            'svix-id': svixId as string,
            'svix-timestamp': svixTimestamp as string,
            'svix-signature': svixSignature as string,
        });


        switch (event.type) {
            case 'user.created':
                console.log('New user created:', event?.data);

                break;
            case 'user.updated':
                console.log('User updated:', event.data);
                // Example: Update user data in your database
                break;
            case 'user.deleted':
                console.log('User deleted:', event.data);
                // Example: Remove user data from your database
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }

        res.status(200).send('Webhook received and processed');
    } catch (err) {
        console.error('[ CLERK WEBHOOK ] Something Went Wrong In Clerk Webhook', err);
        return res.status(400).send(`Something Went Wrong In Clerk Webhook ${err}`);
    }
});


export default router;