import express from 'express'
import { config } from "dotenv"
import { authenticateUser } from './middleware/authenticateUser.js'
import userRoutes from './routes/users.js'
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT

app.use('/api');
app.use('/users', userRoutes)


app.use(authenticateUser)

app.listen(PORT, () => {
    console.log(`App is running on ${PORT} PORT`)
})

