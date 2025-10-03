import express from 'express'
import { config } from "dotenv"
import { authenticateUser } from './middleware/authenticateUser.js'
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT

app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)

app.use(authenticateUser)

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

