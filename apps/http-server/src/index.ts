import express from 'express'
import { config } from "dotenv"
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
import rolesRoutes from './routes/roles.js'
import chatRoutes from './routes/chat.js'
import generateRoutes from './routes/generatedMessage.js'
import webhookRoutes from './routes/webhook.js'
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT

app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)
app.use('/api/roles', rolesRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/generate', generateRoutes)
app.use('/api/webhooks', webhookRoutes)


app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

