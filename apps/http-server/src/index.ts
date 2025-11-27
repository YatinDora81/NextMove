import express from 'express'
import { config } from "dotenv"
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
import rolesRoutes from './routes/roles.js'
import chatRoutes from './routes/chat.js'
import generateRoutes from './routes/generatedMessage.js'
import webhookRoutes from './routes/webhook.js'
import cors from 'cors'
import logger from './config/logger.js'

const app = express()
config()

app.use('/api/webhooks', webhookRoutes)
app.use(cors())

app.use(express.json())
const PORT = process.env.PORT

app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)
app.use('/api/roles', rolesRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/generate', generateRoutes)

app.get('/' , (_,res)=>{
    res.status(200).json({
        status: "Ok",
        time : Date.now(),
        message: "Next Move Server is Up!!!"
    })
})

// // Global error handler middleware (catches errors from routes)
// app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
//     logger.error('[GLOBAL ERROR HANDLER] Unhandled error in route:', err)
//     res.status(500).json({
//         success: false,
//         data: err,
//         message: "Internal Server Error"
//     })
// })

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

