import express from 'express'
import { config } from "dotenv"
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
import rolesRoutes from './routes/roles.js'
import chatRoutes from './routes/chat.js'
import generateRoutes from './routes/generatedMessage.js'
import webhookRoutes from './routes/webhook.js'
import authRoutes from './routes/auth.js'
import cors from 'cors'
import cacheRoutes from './routes/cache.js'

const app = express()
config()

app.use('/api/webhooks', webhookRoutes)

const allowedOrigins: string[] | string = process.env.ORIGINS || [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json())
const PORT = process.env.PORT

app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)
app.use('/api/roles', rolesRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/generate', generateRoutes)
app.use('/api/cache', cacheRoutes)

app.get('/', (_, res) => {
    res.status(200).json({
        status: "Ok",
        timestamp: new Date().toISOString(),
        message: "Next Move Server is Up!!!"
    })
})


app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

