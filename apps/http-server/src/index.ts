import express from 'express'
import { config } from "dotenv"
import { authenticateUser } from './middleware/authenticateUser.js'
import userRoutes from './routes/users.js'
import templatesRoutes from './routes/templates.js'
import { generateMessage } from './config/gemini.js'
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT

app.use('/api/users', userRoutes)
app.use('/api/templates', templatesRoutes)

app.get('/g', async (req, res) => {
    try {
        const message = await generateMessage('i am yatin ad i am a system')
        res.status(200).json({ message })
    } catch (error) {
        console.log(error);
        res.status(500).json({error})
    }
})

// app.use(authenticateUser)

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

