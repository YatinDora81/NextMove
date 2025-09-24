import express from 'express'
import {config} from "dotenv"
const app = express()
config()

app.use(express.json())
const PORT = process.env.PORT



app.listen(PORT , ()=>{
    console.log(`App is running on ${PORT} PORT`)
})

